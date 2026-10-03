import { getAnalysisCache } from "./db.js";
import { isCurrentAnalysis } from "./analysisRevision.js";
import { analyzeWallet } from "./walletAnalyzer.js";
import { createResultCache } from "./resultCache.js";
import { analysisRevision } from "./analysisRevision.js";
import { getSyncState } from "./db.js";
const behavioralResults = createResultCache({ttlMs: 300_000, maxEntries: 30});
import { attachLivePositionAccounting } from "./livePositionAccounting.js";
import { assertWalletReadable } from "./walletPolicy.js";
import { requestWalletDashboard, enrichTokenMetadata } from "./walletProductService.js";
import { buildCreatorRevenueIntelligence } from "./creatorRevenueService.js";
import { getWalletPortfolioSnapshot, applyPortfolioPricesToDashboard } from "./walletPortfolioService.js";
import { getTokenMetadata } from "./helius.js";
async function buildBehavioralIntelligence(address,historyComplete){
 const state=await getSyncState(address),cached=await getAnalysisCache(address);
 const metrics=isCurrentAnalysis(cached,state)&&cached.metrics.intelligenceSnapshot?cached.metrics:(await analyzeWallet(address,{mode:"deep",readOnly:true})).metrics;
 const snapshot=structuredClone(metrics.intelligenceSnapshot);
 const providerReady=Boolean(process.env.BIRDEYE_API_KEY);
 snapshot.holdBehavior.marketJourney={status:providerReady?"provider_ready":"provider_pending",provider:"birdeye"};
 snapshot.intelligence.marketIntelligence={status:providerReady?"provider_configured":"provider_pending",provider:"birdeye",features:["TRADE_JOURNEY","MFE_MAE","MISSED_MILLIONS","DIAMOND_HANDS","ELITE_EXITS"]};
 return snapshot;
}
function pendingIntelligence(){return{methodology:"explainable_behavior_summary_v1",status:"pending_history",confidence:"pending",strengths:[],weaknesses:[],observations:[],risk:{},smartScore:{methodology:"smart_score_v1",score:null,classification:"Pending history",eligible:false},marketIntelligence:{status:process.env.BIRDEYE_API_KEY?"provider_configured":"provider_pending",provider:"birdeye"}}}
function attachLazyPanels(dashboard,address){dashboard.creatorRevenue={status:"loading",wallet:address,source:"pump_fun_public_api",topCoins:[]};dashboard.incoming={status:"loading",wallet:address,minUsd:Number(process.env.MIN_INCOMING_USD||5),highestValue:[],latest:[],events:[]};return dashboard}
export async function requestCreatorRevenue(address){return buildCreatorRevenueIntelligence(address)}
export async function requestWalletDashboardWithIntelligence(address,options={}){await assertWalletReadable(address);const[dashboard,portfolioResult]=await Promise.all([requestWalletDashboard(address,options),getWalletPortfolioSnapshot(address).catch(error=>({status:"unavailable",error:error.message}))]);applyPortfolioPricesToDashboard(dashboard,portfolioResult);if(!dashboard.portfolio)dashboard.portfolio=portfolioResult;attachLazyPanels(dashboard,address);const historyComplete=dashboard?.coverage?.historyComplete===true;if(!historyComplete){dashboard.behavior=dashboard.behavior||{status:"pending_history",sampleSize:0,behaviorTags:[],longest:[],shortest:[]};dashboard.intelligence=pendingIntelligence();dashboard.responseMode="fast_snapshot";return dashboard}try{const state=await getSyncState(address);const extra=await behavioralResults.get(`${address}:${analysisRevision(state)}`,()=>buildBehavioralIntelligence(address,true));if(!dashboard.behavior||dashboard.behavior.status==="unavailable")dashboard.behavior=extra.holdBehavior;attachLivePositionAccounting(dashboard,extra.positions);dashboard.accounting={...dashboard.accounting,...extra.accountingReview};dashboard.intelligence=extra.intelligence;dashboard.trades={...(dashboard.trades||{}),best:extra.journeys.best,worst:extra.journeys.worst,rankingUnit:"TRADE_JOURNEY",journeysAnalyzed:extra.journeys.count}}catch(error){console.warn(`Unable to build behavioral intelligence for ${address}: ${error?.message||error}`);dashboard.intelligence={...pendingIntelligence(),confidence:"unavailable",status:"unavailable",observations:["Behavioral intelligence is temporarily unavailable."]}}await enrichTokenMetadata(dashboard,options.metadataFull===true);dashboard.responseMode="cached_deep";return dashboard}

