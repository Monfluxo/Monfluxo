import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {buildPositions,isLowConfidenceDustTrade} from '../src/positionEngine.js';
import {buildTradeJourneys} from '../src/tradeJourneyEngine.js';
import {buildHoldBehavior} from '../src/holdIntelligence.js';
import {buildAccountingReview} from '../src/accountingReview.js';
import {buildWalletIntelligenceSummary} from '../src/intelligenceSummary.js';
import {buildSmartWalletScore} from '../src/smartWalletScore.js';
import {ANALYSIS_VERSION,analysisRevision} from '../src/analysisRevision.js';
function harness(complete,limit=3){
 const rows=Array.from({length:5001},(_,i)=>({wallet_address:'wallet',signature:`s${i}`,event_index:0,type:'BUY',token_mint:'mint',token_amount:1,sol_amount:1,fee_sol:.001,slot:i,block_time:new Date(i*1000).toISOString()}));
 let written, persisted=0, synced=0;
 const source=readFileSync(new URL('../src/walletAnalyzer.js',import.meta.url),'utf8').replace(/^import[\s\S]*?;\n/gm,'').replace(/export /g,'').split('if (process.argv[1]')[0];
 const context=vm.createContext({process:{env:{MAX_QUICK_TRADE_ROWS:String(limit)}},console,ANALYSIS_VERSION,analysisRevision,buildPositions,isLowConfidenceDustTrade,buildTradeJourneys,buildHoldBehavior,buildAccountingReview,buildWalletIntelligenceSummary,buildSmartWalletScore,
 getSyncState:async()=>({history_complete:complete,last_synced_at:'revision'}),syncWalletHistory:async()=>{synced++;},getWalletTradePage:async(_w,l,o)=>rows.slice(o,o+l),getWalletTransferPage:async()=>[],getWalletRewardsPage:async()=>[],getWalletFundingPage:async()=>[],upsertAnalysisCache:async x=>written=x,persistTradeJourneys:async()=>persisted++});
 const analyze=vm.runInContext(source+'\nanalyzeWallet',context);return{run:()=>analyze('wallet',{mode:'quick',readOnly:true}),written:()=>written,persisted:()=>persisted,synced:()=>synced};
}
test('complete cache miss reads more than 5000 trades and stores reusable accounting snapshot',async()=>{
 const h=harness(true),r=await h.run();assert.equal(r.metrics.tradesAnalyzed,5001);assert.equal(r.metrics.rowsTruncated,false);assert.equal(r.metrics.metricsComplete,true);assert.equal(h.synced(),0);assert.equal(h.persisted(),1);assert.equal(h.written().source_last_synced_at,'revision');assert.equal(r.metrics.intelligenceSnapshot.positions[0].remainingCostSol,5001);
});
test('partial quick metrics respect non-page-aligned limit and never publish final rankings',async()=>{
 const h=harness(false),r=await h.run();assert.equal(r.metrics.tradesAnalyzed,3);assert.equal(r.metrics.rowsTruncated,true);assert.equal(r.metrics.metricsComplete,false);assert.equal(r.metrics.pnlComplete,false);assert.equal(h.persisted(),0);assert.equal(h.synced(),0);
});
