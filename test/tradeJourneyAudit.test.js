import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {buildTradeJourneys} from '../src/tradeJourneyEngine.js';

// Run the real service body with isolated dependency stubs. No DB or network writes.
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
import {formatTimestamp as dt, signedNumber, metricClass, startJourneyRequest} from '../web/lib/tradeJourney.mjs';
const wallet = '11111111111111111111111111111111';
const mint = '22222222222222222222222222222222';
function row(type, time, sol, signature) {
  return {wallet_address:wallet, token_mint:mint, type, block_time:time == null ? null : new Date(time*1000).toISOString(), token_amount:10, sol_amount:sol, signature, event_index:0};
}
const rows = [row('BUY',100,1,'a'),row('SELL',110,2,'b'),row('BUY',200,1,'c'),row('SELL',210,6,'d')];
function service(trades=rows) {
  const source = read('../src/dataTradesService.js').replace(/^import .*;\n/gm,'').replace(/export /g,'');
  const context = vm.createContext({process:{env:{}}, buildTradeJourneys, assertWalletReadable:async()=>({action:"allow"}), excludedWallets:async()=>new Set(),
    getWalletTransferPage:async()=>[], getWalletRewardsPage:async()=>[],
    getWalletTradePage:async (_wallet,limit,offset)=>trades.slice(offset,offset+limit),
    getPumpWalletProfile:async()=>null, getPumpTokenMetadata:async()=>null,
    getJupiterTokenMetadata:async()=>null, getTokenMetadata:async()=>null,
    fetch:async()=>{throw new Error('Unexpected market-cap/network request');}});
  return vm.runInContext(source+'\n({getTradeDetail,persistTradeJourneys,selectRankedJourneys})',context);
}
test('exact journey selects lower-PnL cycle and only its executions',async()=>{
  const d=await service().getTradeDetail(wallet,mint,`${mint}:100`);
  assert.equal(d.journeyId,`${mint}:v2:a:0`);assert.equal(d.summary.pnlSol,1);
  assert.equal(d.events.map(e=>e.signature).join(','),'a,b');
});
test('legacy URL without journey chooses highest PnL',async()=>{
  assert.equal((await service().getTradeDetail(wallet,mint)).journeyId,`${mint}:v2:c:0`);
});
test('unknown requested journey must not substitute another cycle',async()=>{
  assert.equal(await service().getTradeDetail(wallet,mint,`${mint}:999`),null);
});
test('same-second independent cycles require unique IDs',()=>{
  const input=rows.map((r,i)=>({tokenMint:mint,type:r.type,blockTime:100,slot:i+1,tokenAmount:10,solAmount:r.sol_amount,signature:r.signature}));
  const journeys=buildTradeJourneys(input);assert.equal(journeys.length,2);
  assert.equal(new Set(journeys.map(j=>j.id)).size,2);
});
test('unknown hold duration must not become zero seconds',()=>{
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
test('blank timestamps should stay unknown',()=>{
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
  const context=vm.createContext({process:{env:{}},URL,Response,creditHeaders:()=>({}),fetch:async(url)=>{
    requested=url;return new Response('{"error":"trade_not_found"}',{status:404});}});
  const source=read('../web/app/api/data/trade/[wallet]/[mint]/route.js').replace(/^import .*;\n/gm,'').replace('export async function','async function');
  const GET=vm.runInContext(source+'\nGET',context);
  const journey=`${mint}:100 +/&?`;
  const response=await GET({url:`http://localhost/api/data/trade/${wallet}/${mint}?journey=${encodeURIComponent(journey)}`},{params:Promise.resolve({wallet,mint})});
  assert.equal(new URL(requested).searchParams.get('journey'),journey);
  assert.equal(response.status,404);assert.equal(response.headers.get('cache-control'),'no-store');
});
test('seven execution cells require seven CSS tracks',()=>{
  const css=read('../web/app/data/trade/[wallet]/[mint]/trade.css');
  const tracks=css.match(/\.event-row\{[^}]*grid-template-columns:([^;]+)/)[1].trim().split(/\s+/);
  assert.equal(tracks.length,7);
});

test('canonical ID selects second same-second cycle; ambiguous legacy alias fails closed',async()=>{
  const sameSecond=rows.map((r,i)=>({...r,block_time:new Date(100000).toISOString(),slot:i+1}));
  const api=service(sameSecond);
  assert.equal(await api.getTradeDetail(wallet,mint,`${mint}:100`),null);
  const d=await api.getTradeDetail(wallet,mint,`${mint}:v2:c:0`);
  assert.equal(d.events.map(e=>e.signature).join(','),'c,d');assert.equal(d.summary.pnlSol,5);
});
test('blank explicit journey cannot trigger legacy fallback',async()=>{
  assert.equal(await service().getTradeDetail(wallet,mint,''),null);
});
test('missing SELL timestamp is ordered by slot without losing the sale',()=>{
  const [j]=buildTradeJourneys([{tokenMint:mint,type:'SELL',tokenAmount:10,solAmount:2,blockTime:null,slot:20,signature:'b'},{tokenMint:mint,type:'BUY',tokenAmount:10,solAmount:1,blockTime:100,slot:10,signature:'a'}]);
  assert.equal(j.closed,true);assert.equal(j.realizedPnl,1);assert.equal(j.holdSeconds,null);
});
test('mixed known and missing hold times do not publish a falsely complete average',()=>{
  const [j]=buildTradeJourneys([{tokenMint:mint,type:'BUY',tokenAmount:5,solAmount:1,blockTime:100,slot:1},{tokenMint:mint,type:'BUY',tokenAmount:5,solAmount:1,blockTime:null,slot:2},{tokenMint:mint,type:'SELL',tokenAmount:10,solAmount:3,blockTime:200,slot:3}]);
  assert.equal(j.realizedPnl,1);assert.equal(j.holdSeconds,null);
});
test('formatters reject booleans, milliseconds and ISO without timezone; signs are accurate',()=>{
  for(const v of [true,false,1791000000000,'2026-10-03T01:00:00'])assert.equal(dt(v),'—');
  assert.equal(signedNumber(null),'—');assert.equal(signedNumber(-2),'-2');
  assert.equal(metricClass(-2),'negative');assert.equal(metricClass(null),'');
});
const payload=(id='A',events=[])=>({wallet,tokenMint:mint,journeyId:id,summary:{pnlSol:1},events});
const ok=data=>({ok:true,status:200,json:async()=>data});
test('cancelled slow A cannot overwrite fast B even if transport ignores abort',async()=>{
  const states=[];let resolveA;
  const a=startJourneyRequest({wallet,mint,journey:'A'},s=>states.push(s),()=>new Promise(resolve=>{resolveA=resolve}));
  a.cancel();
  const b=startJourneyRequest({wallet,mint,journey:'B'},s=>states.push(s),async()=>ok(payload('B')));
  await b.done;resolveA(ok(payload('A')));await a.done;
  assert.equal(states.at(-1).data.journeyId,'B');
});
test('error is reset before retry and successful response clears it',async()=>{
  const states=[];
  await startJourneyRequest({wallet,mint,journey:'A'},s=>states.push(s),async()=>({ok:false,status:404})).done;
  assert.equal(states.at(-1).error,'Trade journey not found');
  const retry=startJourneyRequest({wallet,mint,journey:'A'},s=>states.push(s),async()=>ok(payload()));
  assert.equal(states.at(-1).error,'');assert.equal(states.at(-1).data,null);
  await retry.done;assert.equal(states.at(-1).data.journeyId,'A');assert.equal(states.at(-1).error,'');
});
test('invalid response identity is rejected rather than displayed',async()=>{
  let state;
  await startJourneyRequest({wallet,mint,journey:'A'},s=>{state=s},async()=>ok(payload('B'))).done;
  assert.equal(state.data,null);assert.match(state.error,/identity mismatch/);
});
test('null execution entries are filtered; malformed list is rejected',async()=>{
  let state;
  await startJourneyRequest({wallet,mint,journey:'A'},s=>{state=s},async()=>ok(payload('A',[null,{signature:'tx',type:'BUY'}]))).done;
  assert.equal(state.data.events.length,1);
  await startJourneyRequest({wallet,mint,journey:'A'},s=>{state=s},async()=>ok(payload('A','bad'))).done;
  assert.equal(state.data,null);assert.match(state.error,/events/);
});
test('canonical ID remains stable when only timestamp is corrected',()=>{
  const input=[{tokenMint:mint,type:'BUY',tokenAmount:10,solAmount:1,blockTime:100,slot:1,signature:'a',eventIndex:2},{tokenMint:mint,type:'SELL',tokenAmount:10,solAmount:2,blockTime:200,slot:2,signature:'b'}];
  const first=buildTradeJourneys(input)[0];input[0].blockTime=101;
  assert.equal(buildTradeJourneys(input)[0].id,first.id);
});

test('rank migration hides the legacy duplicate without collapsing two canonical same-second cycles',()=>{
  const base={wallet_address:wallet,token_mint:mint,entry_time:new Date(100000).toISOString()};
  const selected=service().selectRankedJourneys([{...base,journey_id:`${mint}:100`},{...base,journey_id:`${mint}:v2:a:0`},{...base,journey_id:`${mint}:v2:c:0`}]);
  assert.equal(selected.length,2);assert.equal(selected[1].journey_id,`${mint}:v2:c:0`);
});
test('duplicate journey query parameters and blank identifiers return 400 at the proxy',async()=>{
  const context=vm.createContext({process:{env:{}},URL,Response,creditHeaders:()=>({}),fetch:async()=>{throw new Error('must not reach backend')}});
  const source=read('../web/app/api/data/trade/[wallet]/[mint]/route.js').replace(/^import .*;\n/gm,'').replace('export async function','async function');
  const GET=vm.runInContext(source+'\nGET',context);
  for(const qs of ['journey=', 'journey=%20', 'journey=A&journey=B']){
    const r=await GET({url:`http://localhost/api/data/trade/${wallet}/${mint}?${qs}`},{params:{wallet,mint}});
    assert.equal(r.status,400);
  }
});
test('malformed JSON is a safe unavailable state, not an exposed parser message',async()=>{
  let state;await startJourneyRequest({wallet,mint,journey:'A'},s=>{state=s},async()=>({ok:true,json:async()=>{throw new SyntaxError('Unexpected token <')}})).done;
  assert.equal(state.error,'Trade journey unavailable');assert.equal(state.data,null);
});
test('non-string metadata and event labels are normalized before React render',async()=>{
  let state;
  const data={...payload('A',[{type:{bad:true},signature:4,dex:{bad:true}}]),token:{name:{bad:true}},walletProfile:{name:{bad:true}}};
  await startJourneyRequest({wallet,mint,journey:'A'},s=>{state=s},async()=>ok(data)).done;
  assert.equal(state.data.token.name,null);assert.equal(state.data.events[0].type,null);
});
test('backend forwards exact journey, returns 404, and rejects duplicate keys',async()=>{
  let received;
  const context=vm.createContext({process:{env:{},argv:[]},URL,console,creditsEnabled:()=>false,getTradeDetail:async(w,m,id)=>{received=[w,m,id];return null}});
  const source=read('../src/httpApi.js').replace(/^import .*;\n/gm,'').replace(/export /g,'');
  const handle=vm.runInContext(source+'\nhandleRequest',context);
  const call=async qs=>{let status;const response={writeHead(code){status=code},end(){}};
    await handle({method:'GET',url:`/api/data/trade/${wallet}/${mint}?${qs}`,headers:{}},response);return status;};
  assert.equal(await call('journey='+encodeURIComponent(`${mint}:v2:a:0`)),404);
  assert.equal(received[2],`${mint}:v2:a:0`);
  assert.equal(await call('journey=A&journey=B'),400);
});


test('transfer out and later same-mint inflow restore the original purchased cost',()=>{
 const trades=[{tokenMint:mint,type:'BUY',tokenAmount:100,solAmount:10,blockTime:100,signature:'buy'},{tokenMint:mint,type:'SELL',tokenAmount:100,solAmount:180,blockTime:400,signature:'sale'}];
 const transfers=[{mint,amount:100,direction:'OUT',blockTime:200,signature:'out'},{mint,amount:100,direction:'IN',blockTime:300,signature:'in'}];
 const journeys=buildTradeJourneys(trades,transfers);
 assert.equal(journeys[0].closed,true);
 assert.equal(journeys[0].returnedTokens,100);
 assert.equal(journeys[0].realizedPnl,170);
});
