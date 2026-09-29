import { analyzeWallet } from "./walletAnalyzer.js";
import { getSyncState } from "./db.js";
import { enqueueWalletIndexJob } from "./indexQueue.js";
import { buildWalletDashboardResponse } from "./walletDashboardContract.js";
import { getTokenMetadata } from "./helius.js";

function coverageFromState(state) {
  const historyComplete = state?.history_complete === true;
  return {
    status: historyComplete ? "complete" : "indexing",
    historyComplete,
    backfillPending: !historyComplete && Boolean(state?.backfill_pagination_token),
    pagesScanned: Number(state?.pages_scanned || 0),
    oldestIndexedAt: state?.oldest_block_time || null,
    newestIndexedAt: state?.newest_block_time || null,
    lastSyncedAt: state?.last_synced_at || null,
    backfillUpdatedAt: state?.backfill_updated_at || null
  };
}

function mintForEntity(entity) {
  if (entity?.tokenMint) return entity.tokenMint;
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
    ...(dashboard?.funding?.events || [])
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
    entity.tokenName = metadata?.name || null;
    entity.tokenSymbol = metadata?.symbol || null;
    entity.tokenImage = metadata?.image || null;
  }

  return dashboard;
}

export async function requestWalletIntelligence(address, options = {}) {
  const priority = Number(options.priority || 100);
  const analysis = await analyzeWallet(address, { mode: "quick" });
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
    metrics: analysis.metrics,
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
  return enrichTokenMetadata(dashboard);
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
