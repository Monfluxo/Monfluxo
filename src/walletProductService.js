import { analyzeWallet } from "./walletAnalyzer.js";
import { getAnalysisCache, getSyncState } from "./db.js";
import { enqueueWalletIndexJob } from "./indexQueue.js";
import { buildWalletDashboardResponse } from "./walletDashboardContract.js";
import { getTokenMetadata } from "./helius.js";
import { buildClusterIntelligence } from "./clusterEngine.js";

const WSOL_MINT = "So11111111111111111111111111111111111111112";
const clusterCache = new Map();
const CLUSTER_CACHE_MS = Number(process.env.CLUSTER_CACHE_MS || 60_000);
const INDEX_ACTIVE_WINDOW_MS = Number(process.env.INDEX_ACTIVE_WINDOW_MS || 90_000);
const MIN_INCOMING_USD = Number(process.env.MIN_INCOMING_USD || 5);
const MIN_RANKED_TRADE_COST_SOL = Number(process.env.MIN_RANKED_TRADE_COST_SOL || 0.005);

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
  const tokenNetRanking = metrics.rankingUnit === "TOKEN_LIFETIME_NET";
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
    .slice(0, 5);
  const worstTrades = cleanRanked(metrics.worstTrades)
    .filter((result) => Number(result.pnlSol) < 0)
    .slice(0, 5);

  return {
    ...metrics,
    bestTrades,
    worstTrades,
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

async function enrichTokenMetadata(dashboard) {
  const entities = [
    ...(dashboard?.positions?.top || []),
    dashboard?.positions?.best,
    dashboard?.positions?.worst,
    ...(dashboard?.trades?.best || []),
    ...(dashboard?.trades?.worst || []),
    ...(dashboard?.externalTokens?.topSales || []),
    ...(dashboard?.funding?.events || []),
    ...(dashboard?.rewards?.events || [])
  ].filter(Boolean);

  const mints = [...new Set(entities.map(mintForEntity).filter(Boolean))];
  const metadataEntries = await Promise.all(
    mints.map(async (mint) => {
      try {
        return [mint, await getTokenMetadata(mint)];
      } catch (error) {
        console.warn(`Unable to load metadata for ${mint}: ${error.message}`);
        return [mint, null];
      }
    })
  );

  const metadataByMint = new Map(metadataEntries);
  for (const entity of entities) {
    const mint = mintForEntity(entity);
    if (!mint) continue;
    const metadata = metadataByMint.get(mint);
    entity.tokenName = entity.assetType === "SOL" ? "Solana" : metadata?.name || null;
    entity.tokenSymbol = entity.assetType === "SOL" ? "SOL" : metadata?.symbol || null;
    entity.tokenImage = metadata?.image || null;
    entity.priceUsd = Number.isFinite(Number(metadata?.priceUsd)) ? Number(metadata.priceUsd) : null;
    entity.estimatedUsd = entity.priceUsd != null && Number.isFinite(Number(entity.amount))
      ? Number(entity.amount) * entity.priceUsd
      : null;
  }

  return dashboard;
}

function filterMeaningfulIncoming(dashboard) {
  const funding = dashboard?.funding || {};
  const rewards = dashboard?.rewards || {};
  const rawFunding = Array.isArray(funding.events) ? funding.events : [];
  const rawRewards = Array.isArray(rewards.events) ? rewards.events : [];

  const keep = (event) => Number.isFinite(Number(event?.estimatedUsd)) && Number(event.estimatedUsd) >= MIN_INCOMING_USD;
  const visibleFunding = rawFunding.filter(keep);
  const visibleRewards = rawRewards.filter(keep);

  funding.rawCount = rawFunding.length;
  funding.count = visibleFunding.length;
  funding.events = visibleFunding;
  funding.hiddenBelowThresholdOrUnpriced = rawFunding.length - visibleFunding.length;
  funding.minUsd = MIN_INCOMING_USD;
  funding.solTotal = visibleFunding
    .filter((event) => event.assetType === "SOL")
    .reduce((sum, event) => sum + Number(event.amount || 0), 0);

  rewards.events = visibleRewards;
  rewards.hiddenBelowThresholdOrUnpriced = rawRewards.length - visibleRewards.length;
  rewards.minUsd = MIN_INCOMING_USD;

  dashboard.incoming = {
    minUsd: MIN_INCOMING_USD,
    events: [...visibleFunding, ...visibleRewards]
      .sort((a, b) => Number(b.blockTime || 0) - Number(a.blockTime || 0))
      .slice(0, 30),
    transferCount: visibleFunding.length,
    rewardCount: visibleRewards.length,
    hiddenBelowThresholdOrUnpriced:
      funding.hiddenBelowThresholdOrUnpriced + rewards.hiddenBelowThresholdOrUnpriced
  };

  return dashboard;
}

async function clusterForWallet(address) {
  const cached = clusterCache.get(address);
  if (cached && Date.now() - cached.createdAt < CLUSTER_CACHE_MS) {
    return cached.value;
  }

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
  if (!coverage.historyComplete) {
    indexJob = await enqueueWalletIndexJob(address, priority);
  }

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
  const [enriched, cluster] = await Promise.all([
    enrichTokenMetadata(dashboard),
    clusterForWallet(address)
  ]);
  filterMeaningfulIncoming(enriched);
  enriched.cluster = cluster;
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
