import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregateTokenAccounts,readChainHoldings,TOKEN_PROGRAMS} from '../src/chainHoldings.js';
import {compactHoldingsSnapshot} from '../src/initialHoldingsSnapshot.js';
import {startProgressPolling} from '../web/lib/progressPolling.js';
const account=(mint,amount,decimals=6)=>({account:{data:{parsed:{info:{mint,state:'initialized',tokenAmount:{amount,decimals}}}}}});
test('combines SPL and Token-2022 accounts per mint without losing raw integer precision',()=>{
 const rows=aggregateTokenAccounts([{value:[account('same','9007199254740993'),account('zero','0')]},{value:[account('same','2'),account('pump','123000000')]}]);
 assert.equal(rows.length,2);assert.equal(rows[0].rawBalance,'9007199254740995');assert.equal(rows[1].amount,123);
});
test('current balances include tokens beyond the old 1000, 50 and 12 row cutoffs',()=>{
 const rows=aggregateTokenAccounts([{value:[]},{value:Array.from({length:1500},(_,i)=>account(`${i}pump`,'1000000'))}]);
 assert.equal(rows.length,1500);assert.equal(rows[1499].amount,1);
});
test('missing/unparsed program responses fail rather than invent an empty portfolio',async()=>{
 assert.throws(()=>aggregateTokenAccounts([{value:[]},null]),/Incomplete/);
 assert.throws(()=>aggregateTokenAccounts([{value:[{}]}]),/Unparsed/);
 const methods=[];
 await assert.rejects(readChainHoldings('wallet',async(method,params)=>{methods.push([method,params]);if(params[1]?.programId===TOKEN_PROGRAMS[1])throw Error('provider unavailable');return method==='getBalance'?{value:3,context:{slot:10}}:{value:[],context:{slot:10}};}),/provider unavailable/);
 assert.equal(methods.filter(([m])=>m==='getTokenAccountsByOwner').length,2);
});
test('snapshot retains exact amounts and capture time without metadata payloads',()=>{
 const snap=compactHoldingsSnapshot('wallet',{generatedAt:'2026-10-04T03:00:00Z',slotFrom:1,slotTo:2,nativeBalanceLamports:3,holdings:[{tokenMint:'mint',rawBalance:'9007199254740993',decimals:6,tokenName:'discard',imageUrl:'discard'}]},'first_recorded');
 assert.deepEqual(snap.balances,[['mint','9007199254740993',6]]);assert.equal(snap.snapshot_kind,'first_recorded');assert.equal(snap.captured_at,'2026-10-04T03:00:00Z');
});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('polling follows paused to resumed to complete, schedules safely and avoids repeated metric refreshes',async()=>{
 const responses=[{status:'paused',budgetExhausted:true,transactionsIndexed:5000,pagesScanned:5},{status:'paused',budgetExhausted:true,transactionsIndexed:5000,pagesScanned:5},{status:'syncing',transactionsIndexed:6000,pagesScanned:6},{status:'complete',historyComplete:true,transactionsIndexed:7000,pagesScanned:7}];
 const timers=[],updates=[],milestones=[];
 const stop=startProgressPolling({read:async()=>responses.shift(),onProgress:p=>updates.push(p),onMilestone:p=>milestones.push(p),schedule:(fn,delay)=>{timers.push({fn,delay});return 1;},cancel:()=>{}});
 await flush();assert.equal(timers[0].delay,8000);await timers.shift().fn();await timers.shift().fn();assert.equal(timers[0].delay,3000);await timers.shift().fn();assert.equal(updates.length,4);assert.equal(milestones.length,3);assert.equal(timers.length,0);stop();
});
test('network failure retries and unmounted poller never applies late responses',async()=>{
 const timers=[],updates=[];let resolve;
 const stop=startProgressPolling({read:async()=>{throw Error('offline')},onProgress:p=>updates.push(p),schedule:(fn,delay)=>{timers.push({fn,delay});},cancel:()=>{}});
 await flush();assert.equal(timers[0].delay,8000);stop();
 const stopLate=startProgressPolling({read:()=>new Promise(r=>resolve=r),onProgress:p=>updates.push(p),schedule:()=>assert.fail('unmounted poller scheduled'),cancel:()=>{}});
 stopLate();resolve({status:'syncing'});await flush();assert.equal(updates.length,0);
});

import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('DAS lag cannot override chain quantities, omit later holdings or retain stale USD totals',async()=>{
 const source=readFileSync(new URL('../src/walletPortfolioService.js',import.meta.url),'utf8');
 const normalize=source.slice(source.indexOf('function imageFromAsset'),source.indexOf('export function getFreshWalletHoldings'));
 const load=source.slice(source.indexOf('export async function loadWalletPortfolioSnapshot'),source.indexOf('export function applyPortfolioPrices')).replace('export ','');
 const chain={holdings:[{tokenMint:'a',amount:2,rawBalance:'2000000',decimals:6},{tokenMint:'laterpump',amount:10,rawBalance:'10000000',decimals:6}],nativeBalanceLamports:1e9,generatedAt:'2026-10-04T03:00:00Z',slotFrom:10,slotTo:11};
 let das={total:2000,items:[{id:'a',interface:'FungibleToken',token_info:{balance:200000000,decimals:6,price_info:{price_per_token:10,total_price:2000}}}],nativeBalance:{lamports:999e9,price_per_sol:100}};
 const context=vm.createContext({readChainHoldings:async()=>chain,rpc:async()=>das,Date});
 const fn=vm.runInContext(normalize+'\n'+load+'\nloadWalletPortfolioSnapshot',context);
 const result=await fn('wallet');assert.equal(result.holdings.length,2);assert.equal(result.holdings[0].amount,2);assert.equal(result.holdings[0].valueUsd,20);assert.equal(result.holdings[1].amount,10);assert.equal(result.solBalance,1);assert.equal(result.assetsTruncated,false);assert.equal(result.metadataIncomplete,true);assert.equal(result.generatedAt,chain.generatedAt);
 das=null;const noMetadata=await fn('wallet');assert.equal(noMetadata.tokenCount,2);assert.equal(noMetadata.solValueUsd,null);
});
test('live portfolio keeps every balance and resorts after enrichment, with bounded network lookups',async()=>{
 const source=readFileSync(new URL('../src/walletProductService.js',import.meta.url),'utf8');
 const mapper=source.slice(source.indexOf('async function mapWithConcurrency'),source.indexOf('export async function enrichTokenMetadata'));
 const build=source.slice(source.indexOf('async function buildLivePortfolio'),source.indexOf('function filterMeaningfulIncoming'));
 let calls=0;
 const holdings=Array.from({length:1500},(_,i)=>({tokenMint:`${i}pump`,amount:1500-i,priceUsd:null,valueUsd:null}));
 const context=vm.createContext({getWalletPortfolioSnapshot:async()=>({holdings,generatedAt:'capture',solBalance:1}),initialHoldingsSummary:async()=>null,getCachedTokenMetadata:mint=>mint==='1499pump'?{priceUsd:1e9}:null,getTokenMetadata:async()=>{calls++;return{priceUsd:1};},METADATA_CONCURRENCY:4,console,Date});
 const fn=vm.runInContext(mapper+'\n'+build+'\nbuildLivePortfolio',context);
 const result=await fn('wallet',true);assert.equal(result.positions.length,1500);assert.equal(result.positions[0].tokenMint,'1499pump');assert.equal(result.updatedAt,'capture');assert.equal(calls,50);
});
test('first scan captures before queue authorization and a rejected request never saves a snapshot',async()=>{
 const source=readFileSync(new URL('../src/creditService.js',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('export async function requestCreditWallet'),source.indexOf('export async function createCreditInvite')).replace('export ','');
 const order=[];let reject=false;
 const context=vm.createContext({creditError:()=>Error('invalid'),currentAccount:async()=>({id:'owner'}),assertWalletAllowed:async()=>{},prepareInitialHoldings:async()=>{order.push('capture');return{wallet:'wallet'};},rpc:async()=>{order.push('queue');if(reject)throw Error('insufficient_credits');return{cost:0,target:5000};},saveInitialHoldings:async()=>{order.push('save');},console});
 const fn=vm.runInContext(body+'\nrequestCreditWallet',context);assert.equal((await fn({},'wallet')).cost,0);assert.deepEqual(order,['capture','queue','save']);order.length=0;reject=true;await assert.rejects(fn({},'wallet'));assert.deepEqual(order,['capture','queue']);
});
