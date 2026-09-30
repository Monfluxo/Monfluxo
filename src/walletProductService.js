import { analyzeWallet } from "./walletAnalyzer.js";
import { getAnalysisCache, getSyncState } from "./db.js";
import { enqueueWalletIndexJob } from "./indexQueue.js";
import { buildWalletDashboardResponse } from "./walletDashboardContract.js";
import { getTokenMetadata } from "./helius.js";
import { buildClusterIntelligence } from "./clusterEngine.js";
import { buildWalletHoldBehavior } from "./walletBehaviorService.js";

const WSOL_MINT = "So11111111111111111111111111111111111111112";
const clusterCache = new Map();
const behaviorCache = new Map();
const CLUSTER_CACHE_MS = Number(process.env.CLUSTER_CACHE_MS || 60_000);
const BEHAVIOR_CACHE_MS = Number(process.env.BEHAVIOR_CACHE_MS || 300_000);
const INDEX_ACTIVE_WINDOW_MS = Number(process.env.INDEX_ACTIVE_WINDOW_MS || 90_000);
const MIN_INCOMING_USD = Number(process.env.MIN_INCOMING_USD || 5);
const MIN_RANKED_TRADE_COST_SOL = Number(process.env.MIN_RANKED_TRADE_COST_SOL || 0.005);
const DASHBOARD_SAMPLE_SIZE = 6;
const METADATA_CONCURRENCY = Math.max(1, Number(process.env.TOKEN_METADATA_CONCURRENCY || 4));

function coverageFromState(state) {
  const historyComplete = state?.history_complete === true;
  const progressAt = state?.backfill_updated_at || state?.last_synced_at || null;
  const progressMs = progressAt ? new Date(progressAt).getTime() : 0;
  const progressAgeMs = progressMs > 0 ? Date.now() - progressMs : null;
  const active = !historyComplete && state?.status === "syncing" && progressAgeMs != null && progressAgeMs <= INDEX_ACTIVE_WINDOW_MS;
  const stalled = !historyComplete && state?.status === "syncing" && progressAgeMs != null && progressAgeMs > INDEX_ACTIVE_WINDOW_MS;

  return {
    status: historyComplete ? "complete" : active ? "active" : stalled ? "stalled" : "queued",
    historyComplete,
    active,
    stalled,
    backfillPending: !historyComplete && Boolean(state?.backfill_pagination_token),
    pagesScanned: Number(state?.pages_scanned || 0),
    oldestIndexedAt: state?.oldest_block_time || null,
    newestIndexedAt: state?.newest_block_time || null,
    lastSyncedAt: state?.last_synced_at || null,
    backfillUpdatedAt: state?.backfill_updated_at || null,
    progressAgeMs
  };
}

function sanitizeMetrics(metrics) {
  if (!metrics || typeof metrics !== "object") return metrics;
  const tokenNetRanking = ["TOKEN_LIFETIME_NET", "CLOSED_TOKEN_LIFETIME_NET"].includes(metrics.rankingUnit);
  const cleanRanked = (items) => (Array.isArray(items) ? items : []).filter((result) =>
    (tokenNetRanking || result?.pnlComplete === true) &&
    Number.isFinite(Number(result?.costSol)) &&
    Number(result.costSol) >= MIN_RANKED_TRADE_COST_SOL &&
    Number.isFinite(Number(result?.roiPct))
  );

  const originalBest = Array.isArray(metrics.bestTrades) ? metrics.bestTrades.length : 0;
  const originalWorst = Array.isArray(metrics.worstTrades) ? metrics.worstTrades.length : 0;
  const bestTrades = cleanRanked(metrics.bestTrades)
    .filter((result) => Number(result.pnlSol) > 0)
    .slice(0, DASHBOARD_SAMPLE_SIZE);
  const worstTrades = cleanRanked(metrics.worstTrades)
    .filter((result) => Number(result.pnlSol) < 0)
    .slice(0, DASHBOARD_SAMPLE_SIZE);

  return {
    ...metrics,
    bestTrades,
    worstTrades,
    topPositions: (Array.isArray(metrics.topPositions) ? metrics.topPositions : []).slice(0, DASHBOARD_SAMPLE_SIZE),
    rankingMinCostSol: Number(metrics.rankingMinCostSol || MIN_RANKED_TRADE_COST_SOL),
    rankingTradesExcluded: Number(metrics.rankingTradesExcluded || 0) +
      (originalBest - bestTrades.length) +
      (originalWorst - worstTrades.length),
    rankedRealizedTradesAnalyzed: Number(metrics.rankedRealizedTradesAnalyzed || metrics.realizedTradesAnalyzed || 0)
  };
}

function mintForEntity(entity) {
  if (entity?.tokenMint) return entity.tokenMint;
  if (entity?.assetType === "SOL") return WSOL_MINT;
  if (entity?.assetType === "TOKEN") return entity.assetId || null;
  return null;
}

async function mapWithConcurrency(items, limit, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return output;
}

async function enrichTokenMetadata(dashboard) {
  const behavior = dashboard?.behavior || {};
  const entities = [
    ...(dashboard?.positions?.top || []),
    dashboard?.positions?.best,
    dashboard?.positions?.worst,
    ...(dashboard?.trades?.best || []),
    ...(dashboard?.trades?.worst || []),
    ...(dashboard?.externalTokens?.topSales || []),
    ...(dashboard?.funding?.events || []),
    ...(dashboard?.rewards?.events || []),
    ...(behavior?.longest || []),
    ...(behavior?.shortest || [])
  ].filter(Boolean);

  const mints = [...new Set(entities.map(mintForEntity).filter(Boolean))];
  const metadataEntries = await mapWithConcurrency(mints, METADATA_CONCURRENCY, async (mint) => {
    try {
      return [mint, await getTokenMetadata(mint)];
    } catch (error) {
      console.warn(`Unable to load metadata for ${mint}: ${error.message}`);
      return [mint, null];
    }
  });

  const metadataByMint = new Map(metadataEntries);
  for (const entity of entities) {
    const mint = mintForEntity(entity);
    if (!mint) continue;
    const metadata = metadataByMint.get(mint);
    entity.tokenName = entity.assetType === "SOL" ? "Solana" : metadata?.name || null;
    entity.tokenSymbol = entity.assetType === "SOL" ? "SOL" : metadata?.symbol || null;
    entity.tokenImage = metadata?.image || null;
    entity.tokenImageSource = metadata?.imageSource || null;
    entity.priceUsd = Number.isFinite(Number(metadata?.priceUsd)) ? Number(metadata.priceUsd) : null;
    entity.estimatedUsd = entity.priceUsd != null && Number.isFinite(Number(entity.amount))
      ? Number(entity.amount) * entity.priceUsd
      : null;
  }

  return dashboard;
}

function aggregateCreatorRewards(events) {
  const grouped = new Map();
  for (const event of events) {
    const mint = event?.tokenMint || event?.assetId;
    if (!mint) continue;
    const previous = grouped.get(mint);
    const amount = Number(event?.amount || 0);
    const estimatedUsd = Number(event?.estimatedUsd);
    const blockTime = Number(event?.blockTime || 0);

    if (!previous) {
      grouped.set(mint, {
        ...event,
        assetType: "TOKEN",
        assetId: mint,
        tokenMint: mint,
        classification: "CREATOR_REWARD",
        amount,
        estimatedUsd: Number.isFinite(estimatedUsd) ? estimatedUsd : null,
        claimCount: 1,
        firstBlockTime: blockTime || null,
        lastBlockTime: blockTime || null,
        blockTime: blockTime || null,
        signature: event?.signature || null
      });
      continue;
    }

    previous.amount += amount;
    previous.claimCount += 1;
    if (Number.isFinite(estimatedUsd)) {
      previous.estimatedUsd = Number(previous.estimatedUsd || 0) + estimatedUsd;
    }
    if (blockTime && (!previous.firstBlockTime || blockTime < previous.firstBlockTime)) previous.firstBlockTime = blockTime;
    if (blockTime && (!previous.lastBlockTime || blockTime > previous.lastBlockTime)) {
      previous.lastBlockTime = blockTime;
      previous.blockTime = blockTime;
      previous.signature = event?.signature || previous.signature;
    }
  }
  return [...grouped.values()];
}

function filterMeaningfulIncoming(dashboard) {
  const funding = dashboard?.funding || {};
  const rewards = dashboard?.rewards || {};
  const rawFunding = Array.isArray(funding.events) ? funding.events : [];
  const rawRewards = Array.isArray(rewards.events) ? rewards.events : [];
  const aggregatedRewards = aggregateCreatorRewards(rawRewards);

  const keep = (event) => Number.isFinite(Number(event?.estimatedUsd)) && Number(event.estimatedUsd) >= MIN_INCOMING_USD;
  const visibleFunding = rawFunding.filter(keep);
  const visibleRewardGroups = aggregatedRewards.filter(keep);

  funding.rawCount = rawFunding.length;
  funding.count = visibleFunding.length;
  funding.events = visibleFunding;
  funding.hiddenBelowThresholdOrUnpriced = rawFunding.length - visibleFunding.length;
  funding.minUsd = MIN_INCOMING_USD;
  funding.solTotal = visibleFunding
    .filter((event) => event.assetType === "SOL")
    .reduce((sum, event) => sum + Number(event.amount || 0), 0);

  rewards.aggregatedEvents = aggregatedRewards;
  rewards.visibleAggregatedEvents = visibleRewardGroups;
  rewards.hiddenBelowThresholdOrUnpriced = aggregatedRewards.length - visibleRewardGroups.length;
  rewards.minUsd = MIN_INCOMING_USD;

  dashboard.incoming = {
    minUsd: MIN_INCOMING_USD,
    events: [...visibleFunding, ...visibleRewardGroups]
      .sort((a, b) => Number(b.blockTime || 0) - Number(a.blockTime || 0))
      .slice(0, 30),
    transferCount: visibleFunding.length,
    rewardCount: visibleRewardGroups.length,
    rewardClaimCount: visibleRewardGroups.reduce((sum, event) => sum + Number(event.claimCount || 0), 0),
    hiddenBelowThresholdOrUnpriced:
      funding.hiddenBelowThresholdOrUnpriced + rewards.hiddenBelowThresholdOrUnpriced
  };

  return dashboard;
}

async function clusterForWallet(address) {
  const cached = clusterCache.get(address);
  if (cached && Date.now() - cached.createdAt < CLUSTER_CACHE_MS) return cached.value;

  try {
    const value = await buildClusterIntelligence(address);
    clusterCache.set(address, { createdAt: Date.now(), value });
    return value;
  } catch (error) {
    console.warn(`Unable to build cluster intelligence for ${address}: ${error.message}`);
    return {
      methodology: "relationship_score_v1",
      status: "unavailable",
      candidateWallets: 0,
      analyzedCandidateWallets: 0,
      likelyRelatedWallets: 0,
      strongestScore: 0,
      members: [],
      relationships: [],
      disclaimer: "Cluster intelligence is temporarily unavailable. Relationship scores never establish human identity or ownership."
    };
  }
}

function pendingBehavior() {
  return {
    status: "pending_history",
    sampleSize: 0,
    behaviorTags: [],
    longest: [],
    shortest: [],
    marketJourney: {
      status: process.env.BIRDEYE_API_KEY ? "provider_ready" : "awaiting_birdeye",
      provider: "birdeye",
      features: ["MFE", "MAE", "profit_capture", "missed_millions", "diamond_hands", "elite_exits", "trade_journey_chart"]
    }
  };
}

async function behaviorForWallet(address, historyComplete) {
  if (!historyComplete) return pendingBehavior();
  const cached = behaviorCache.get(address);
  if (cached && Date.now() - cached.createdAt < BEHAVIOR_CACHE_MS) return cached.value;

  try {
    const behavior = await buildWalletHoldBehavior(address);
    const value = {
      status: "ready",
      ...behavior,
      marketJourney: {
        status: process.env.BIRDEYE_API_KEY ? "provider_ready" : "awaiting_birdeye",
        provider: "birdeye",
        missedMillionsTaxonomy: ["PROFIT_GIVEBACK", "EARLY_EXIT", "HYBRID"],
        features: ["MFE", "MAE", "profit_capture", "missed_millions", "diamond_hands", "elite_exits", "trade_journey_chart"]
      }
    };
    behaviorCache.set(address, { createdAt: Date.now(), value });
    return value;
  } catch (error) {
    console.warn(`Unable to build hold behavior for ${address}: ${error.message}`);
    return { ...pendingBehavior(), status: "unavailable", error: error.message };
  }
}

async function metricsForRequest(address, stateBefore) {
  if (stateBefore?.status === "syncing") {
    const cached = await getAnalysisCache(address);
    if (cached?.metrics) return sanitizeMetrics(cached.metrics);
  }

  try {
    const analysis = await analyzeWallet(address, { mode: "quick" });
    return sanitizeMetrics(analysis.metrics);
  } catch (error) {
    if (!String(error?.message || "").includes("already in progress")) throw error;
    const cached = await getAnalysisCache(address);
    if (cached?.metrics) return sanitizeMetrics(cached.metrics);
    throw error;
  }
}

export async function requestWalletIntelligence(address, options = {}) {
  const priority = Number(options.priority || 100);
  const stateBefore = await getSyncState(address);
  const metrics = await metricsForRequest(address, stateBefore);
  const state = await getSyncState(address);
  const coverage = coverageFromState(state);

  let indexJob = null;
  if (!coverage.historyComplete) indexJob = await enqueueWalletIndexJob(address, priority);

  return {
    wallet: address,
    status: coverage.historyComplete ? "ready" : "indexing",
    metricsStatus: coverage.historyComplete ? "final" : "partial",
    coverage,
    metrics,
    indexJob: indexJob
      ? {
          status: indexJob.status,
          priority: indexJob.priority,
          attempts: indexJob.attempts,
          requestedAt: indexJob.requested_at,
          updatedAt: indexJob.updated_at
        }
      : null
  };
}

export async function requestWalletDashboard(address, options = {}) {
  const result = await requestWalletIntelligence(address, options);
  const dashboard = buildWalletDashboardResponse(result);
  const [cluster, behavior] = await Promise.all([
    clusterForWallet(address),
    behaviorForWallet(address, result.coverage.historyComplete)
  ]);
  dashboard.cluster = cluster;
  dashboard.behavior = behavior;
  const enriched = await enrichTokenMetadata(dashboard);
  filterMeaningfulIncoming(enriched);
  return enriched;
}

if (process.argv[1]?.endsWith("walletProductService.js")) {
  const address = process.argv[2];
  if (!address) {
    console.error("Usage: npm run product:wallet -- <wallet>");
    process.exit(1);
  }

  try {
    const result = await requestWalletDashboard(address);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("Wallet product request failed:", error.message);
    process.exit(1);
  }
}
