import test from 'node:test';
import assert from 'node:assert/strict';
import {createResultCache} from '../src/resultCache.js';
import {ANALYSIS_VERSION,analysisRevision,isCurrentAnalysis} from '../src/analysisRevision.js';
import {buildTradeJourneys} from '../src/tradeJourneyEngine.js';
import {buildPositions} from '../src/positionEngine.js';
const trade=(type,t,sol,signature)=>({type,blockTime:t,slot:t,solAmount:sol,tokenAmount:10,tokenMint:'mint',signature});
test('single-flight cache shares work but isolates mutable responses',async()=>{
 const c=createResultCache();let calls=0;let release;const gate=new Promise(r=>release=r);
 const load=async()=>{calls++;await gate;return{items:[1]}};
 const a=c.get('wallet',load),b=c.get('wallet',load);release();const[x,y]=await Promise.all([a,b]);
 assert.equal(calls,1);x.items.push(2);assert.deepEqual(y.items,[1]);assert.deepEqual((await c.get('wallet',load)).items,[1]);
});
test('failed cache request retries, bounded cache evicts settled entries',async()=>{
 const c=createResultCache({maxEntries:1});await assert.rejects(c.get('a',()=>{throw Error('offline')}));
 assert.equal(await c.get('a',()=>1),1);assert.equal(await c.get('b',()=>2),2);assert.equal(await c.get('a',()=>3),3);
});
test('analysis cache rejects old algorithms, changed cursors and truncated complete history',()=>{
 const state={history_complete:true,last_synced_at:'now',pages_scanned:5};
 const cache={metrics:{analysisVersion:ANALYSIS_VERSION,sourceRevision:analysisRevision(state),rowsTruncated:false}};
 assert.equal(isCurrentAnalysis(cache,state),true);assert.equal(isCurrentAnalysis({metrics:{}},state),false);
 assert.equal(isCurrentAnalysis(cache,{...state,pages_scanned:6}),false);
 assert.equal(isCurrentAnalysis({metrics:{...cache.metrics,rowsTruncated:true}},state),false);
});
test('transfer-out closes purchased inventory without inventing a sale or corrupting next journey',()=>{
 const trades=[trade('BUY',1,10,'a'),trade('BUY',3,1,'c'),trade('SELL',4,2,'d')];
 const transfers=[{mint:'mint',amount:10,direction:'OUT',blockTime:2,slot:2,signature:'b'}];
 const journeys=buildTradeJourneys(trades,transfers);
 assert.equal(journeys[0].closed,false);assert.equal(journeys[1].closed,true);assert.equal(journeys[1].realizedPnl,1);
 assert.equal(journeys.reduce((s,j)=>s+j.realizedPnl,0),buildPositions(trades,transfers).get('mint').realizedPnl);
});
test('external inventory does not become zero-cost journey profit; swap transfers are deduplicated',()=>{
 const trades=[trade('BUY',2,1,'buy'),trade('SELL',3,4,'sell')];trades[1].tokenAmount=20;
 const transfers=[{mint:'mint',amount:10,direction:'IN',blockTime:1,slot:1,signature:'in'},{mint:'mint',amount:10,direction:'IN',blockTime:2,slot:2,signature:'buy'}];
 const j=buildTradeJourneys(trades,transfers)[0];assert.equal(j.realizedCost,1);assert.equal(j.realizedPnl,1);
 assert.equal(j.realizedPnl,buildPositions(trades,transfers).get('mint').realizedPnl);
});
test('missing timestamps use slots consistently in both engines',()=>{
 const trades=[trade('SELL',3,2,'b'),trade('BUY',1,1,'a')];trades[0].blockTime=null;
 assert.equal(buildTradeJourneys(trades)[0].realizedPnl,1);assert.equal(buildPositions(trades).get('mint').realizedPnl,1);
 assert.equal(buildTradeJourneys(trades)[0].holdSeconds,null);
});
