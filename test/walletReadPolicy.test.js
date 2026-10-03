import {createResultCache} from "../src/resultCache.js";
import {isCurrentAnalysis,analysisRevision,ANALYSIS_VERSION} from "../src/analysisRevision.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {policyError,isAutomaticActivityReview,publicAnalysisPolicy} from '../src/walletPolicy.js';
import {transactionAllowance} from '../src/analysisBudget.js';
const wallet='11111111111111111111111111111111';
const auto={action:'review',source:'helius_preflight',category:'High activity',transaction_limit:5000};
test('activity warning never bypasses manual review or confirmed entity blocks',()=>{
 assert.equal(isAutomaticActivityReview(auto),true);assert.equal(policyError(auto),null);
 assert.equal(publicAnalysisPolicy(auto).warning.includes('High activity'),true);
 assert.equal(policyError({...auto,source:'manual'}).code,'wallet_review_required');
 assert.equal(policyError({action:'review',source:'manual'},{readOnly:true}),null);
 assert.equal(policyError({action:'block'},{readOnly:true}).code,'wallet_blocked');
});
function productHarness({state,policy={action:'allow',transaction_limit:5000},cached=null}={}){
 const calls={analysis:[],queued:0};
 const source=readFileSync(new URL('../src/walletProductService.js',import.meta.url),'utf8').replace(/^import[\s\S]*?;\n/gm,'').replace(/export /g,'').split('if(process.argv[1]')[0];
 const context=vm.createContext({process:{env:{},argv:[]},console,structuredClone,createResultCache,isCurrentAnalysis,analysisRevision,policyError,publicAnalysisPolicy,transactionAllowance,
  assertWalletReadable:async()=>policy,getSyncState:async()=>state,getAnalysisCache:async()=>cached,
  analyzeWallet:async(_a,options)=>{calls.analysis.push(options);return{metrics:{tradesAnalyzed:1}}},
  enqueueWalletIndexJob:async()=>{calls.queued++;return{status:'queued'}}
 });
 const request=vm.runInContext(source+'\nrequestWalletIntelligence',context);return{calls,request:()=>request(wallet)};
}
test('manual-review wallet exposes saved metrics without syncing or queuing',async()=>{
 const h=productHarness({state:{history_complete:false},policy:{action:'review',source:'manual'},cached:{metrics:{tradesAnalyzed:12,analysisVersion:ANALYSIS_VERSION,sourceRevision:analysisRevision({history_complete:false})}}});
 const r=await h.request();assert.equal(r.metrics.tradesAnalyzed,12);assert.equal(r.coverage.indexingRestricted,true);assert.equal(h.calls.analysis.length,0);assert.equal(h.calls.queued,0);
});
test('complete wallet with no cache reconstructs from storage without syncing',async()=>{
 const h=productHarness({state:{history_complete:true}});await h.request();assert.equal(h.calls.analysis[0].readOnly,true);assert.equal(h.calls.queued,0);
});
test('paused wallet without cache still exposes persisted events and does not refill budget',async()=>{
 const h=productHarness({state:{history_complete:false,transactions_scanned:5000}});const r=await h.request();assert.equal(r.status,'paused');assert.equal(h.calls.analysis[0].readOnly,true);assert.equal(h.calls.queued,0);
});
test('bounded activity wallet can queue new history but only while budget remains',async()=>{
 const h=productHarness({state:{history_complete:false,transactions_scanned:100},policy:{...auto,action:'allow'},cached:{metrics:{tradesAnalyzed:1}}});
 const r=await h.request();assert.equal(r.status,'indexing');assert.equal(h.calls.queued,1);assert.equal(r.analysisPolicy.transactionLimit,5000);
});
