import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {buildTradeJourneys} from '../src/tradeJourneyEngine.js';

// Run the real service body with isolated dependency stubs. No DB or network writes.
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const page = read('../web/app/data/trade/[wallet]/[mint]/page.js');
const dt = vm.runInNewContext(page.slice(page.indexOf('const dt=') + 6, page.indexOf(';function Brand')));
const wallet = '11111111111111111111111111111111';
const mint = '22222222222222222222222222222222';
function row(type, time, sol, signature) {
  return {wallet_address:wallet, token_mint:mint, type, block_time:time == null ? null : new Date(time*1000).toISOString(), token_amount:10, sol_amount:sol, signature, event_index:0};
}
const rows = [row('BUY',100,1,'a'),row('SELL',110,2,'b'),row('BUY',200,1,'c'),row('SELL',210,6,'d')];
function service(trades=rows) {
  const source = read('../src/dataTradesService.js').replace(/^import .*;\n/gm,'').replace(/export /g,'');
  const context = vm.createContext({process:{env:{}}, buildTradeJourneys,
    getWalletTradePage:async (_wallet,limit,offset)=>trades.slice(offset,offset+limit),
    getPumpWalletProfile:async()=>null, getPumpTokenMetadata:async()=>null,
    getJupiterTokenMetadata:async()=>null, getTokenMetadata:async()=>null,
    fetch:async()=>{throw new Error('Unexpected market-cap/network request');}});
  return vm.runInContext(source+'\n({getTradeDetail})',context);
}
test('exact journey selects lower-PnL cycle and only its executions',async()=>{
  const d=await service().getTradeDetail(wallet,mint,`${mint}:100`);
  assert.equal(d.journeyId,`${mint}:100`);assert.equal(d.summary.pnlSol,1);
  assert.equal(d.events.map(e=>e.signature).join(','),'a,b');
});
test('legacy URL without journey chooses highest PnL',async()=>{
  assert.equal((await service().getTradeDetail(wallet,mint)).journeyId,`${mint}:200`);
});
test('unknown requested journey must not substitute another cycle',{todo:'P1: service silently falls back to highest PnL'},async()=>{
  assert.equal(await service().getTradeDetail(wallet,mint,`${mint}:999`),null);
});
test('same-second independent cycles require unique IDs',{todo:'P1: ID uses mint and entry second only'},()=>{
  const input=rows.map((r,i)=>({tokenMint:mint,type:r.type,blockTime:100,slot:i+1,tokenAmount:10,solAmount:r.sol_amount,signature:r.signature}));
  const journeys=buildTradeJourneys(input);assert.equal(journeys.length,2);
  assert.equal(new Set(journeys.map(j=>j.id)).size,2);
});
test('unknown hold duration must not become zero seconds',{todo:'P2: matchedTokens includes events without known times'},()=>{
  const [j]=buildTradeJourneys([{tokenMint:mint,type:'BUY',tokenAmount:10,solAmount:1,blockTime:null},{tokenMint:mint,type:'SELL',tokenAmount:10,solAmount:2,blockTime:null}]);
  assert.equal(j.holdSeconds,null);
});
test('incomplete/invalid timestamps do not throw',()=>{
  for(const input of [null,undefined,'bad-date',NaN,Infinity,1e20])assert.equal(dt(input),'—');
});
test('seconds, numeric strings and ISO timestamps render the same instant',()=>{
  assert.equal(dt(1791000000),dt('1791000000'));
  assert.equal(dt(1791000000),dt(new Date(1791000000000).toISOString()));
});
test('blank timestamps should stay unknown',{todo:'P2: Number(empty string) becomes epoch zero'},()=>{
  for(const input of ['', '   '])assert.equal(dt(input),'—');
});
test('market-cap removal preserves PnL, ROI, cost, proceeds, hold and executions',async()=>{
  const d=await service().getTradeDetail(wallet,mint,`${mint}:100`);
  assert.equal(d.summary.pnlSol,1);assert.equal(d.summary.pnlPct,100);
  assert.equal(d.summary.costSol,1);assert.equal(d.summary.proceedsSol,2);
  assert.equal(d.summary.holdSeconds,10);assert.equal(d.events.length,2);
  for(const key of ['entryMarketCap','exitMarketCap','marketCapStatus'])assert.equal(key in d.summary,false);
  assert.equal(d.events.some(e=>'marketCap' in e),false);
});
test('proxy forwards encoded journey unchanged and preserves 404/no-store',async()=>{
  let requested;
  const context=vm.createContext({process:{env:{}},URL,Response,fetch:async(url)=>{
    requested=url;return new Response('{"error":"trade_not_found"}',{status:404});}});
  const source=read('../web/app/api/data/trade/[wallet]/[mint]/route.js').replace('export async function','async function');
  const GET=vm.runInContext(source+'\nGET',context);
  const journey=`${mint}:100 +/&?`;
  const response=await GET({url:`http://localhost/api/data/trade/${wallet}/${mint}?journey=${encodeURIComponent(journey)}`},{params:Promise.resolve({wallet,mint})});
  assert.equal(new URL(requested).searchParams.get('journey'),journey);
  assert.equal(response.status,404);assert.equal(response.headers.get('cache-control'),'no-store');
});
test('seven execution cells require seven CSS tracks',{todo:'P2: eight-track CSS remained after column removal'},()=>{
  const css=read('../web/app/data/trade/[wallet]/[mint]/trade.css');
  const tracks=css.match(/\.event-row\{[^}]*grid-template-columns:([^;]+)/)[1].trim().split(/\s+/);
  assert.equal(tracks.length,7);
});
