import { syncWalletHistory } from "./sync.js";
import { analyzeWallet } from "./walletAnalyzer.js";
import { getSyncState } from "./db.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const address = process.argv[2];

if (!address) {
  console.error("Usage: npm run backfill:wallet -- <wallet>");
  process.exit(1);
}

const batchPages = positiveInt(process.env.BACKFILL_BATCH_PAGES, 20);
const maxBatches = positiveInt(process.env.BACKFILL_MAX_BATCHES, 25);
const pauseMs = positiveInt(process.env.BACKFILL_PAUSE_MS, 1500);
const maxRuntimeMs = positiveInt(process.env.BACKFILL_MAX_RUNTIME_MS, 10 * 60 * 1000);
const storeRaw = process.env.BACKFILL_STORE_RAW === "true";
const analyzePartial = process.env.BACKFILL_ANALYZE_PARTIAL === "true";

const startedAt = Date.now();
let batches = 0;
let pages = 0;
let transactions = 0;
let trades = 0;
let transfers = 0;
let rewards = 0;
let historyComplete = false;
let lastSync = null;
let stopReason = "unknown";

console.log("MONFLUXO BACKFILL WORKER");
console.log(JSON.stringify({
  wallet: address,
  batchPages,
  maxBatches,
  pauseMs,
  maxRuntimeMs,
  storeRaw
}, null, 2));

try {
  while (batches < maxBatches) {
    if (Date.now() - startedAt >= maxRuntimeMs) {
      stopReason = "runtime_budget";
      break;
    }

    batches++;
    console.log(`\nBACKFILL BATCH ${batches}/${maxBatches}`);

    const sync = await syncWalletHistory(address, {
      mode: "deep",
      maxPages: batchPages,
      storeRaw
    });

    lastSync = sync;
    pages += Number(sync.pages || 0);
    transactions += Number(sync.transactionsStored || 0);
    trades += Number(sync.tradesStored || 0);
    transfers += Number(sync.transfersStored || 0);
    rewards += Number(sync.rewardsStored || 0);
    historyComplete = sync.historyComplete === true;

    console.log(JSON.stringify({
      batch: batches,
      pages: sync.pages,
      transactionsStored: sync.transactionsStored,
      tradesStored: sync.tradesStored,
      transfersStored: sync.transfersStored,
      rewardsStored: sync.rewardsStored,
      historyComplete: sync.historyComplete,
      resumingBackfill: sync.resumingBackfill,
      backfillCursorSaved: sync.backfillCursorSaved,
      unifiedTokenHistory: sync.unifiedTokenHistory,
      tokenAccountsFilter: sync.tokenAccountsFilter
    }, null, 2));

    if (historyComplete) {
      stopReason = "history_complete";
      break;
    }

    if (!sync.backfillCursorSaved) {
      stopReason = "no_resume_cursor";
      break;
    }

    if (batches >= maxBatches) {
      stopReason = "batch_budget";
      break;
    }

    const remainingRuntime = maxRuntimeMs - (Date.now() - startedAt);
    if (remainingRuntime <= pauseMs) {
      stopReason = "runtime_budget";
      break;
    }

    if (pauseMs > 0) await sleep(pauseMs);
  }

  const state = await getSyncState(address);

  let analysis = null;
  if (historyComplete || analyzePartial) {
    console.log("\nRecalculating wallet metrics...");
    analysis = await analyzeWallet(address, { mode: "incremental" });
  }

  const summary = {
    wallet: address,
    stopReason,
    historyComplete: state?.history_complete === true,
    backfillPending:
      state?.history_complete !== true && Boolean(state?.backfill_pagination_token),
    batches,
    pages,
    transactionsStored: transactions,
    tradesStored: trades,
    transfersStored: transfers,
    rewardsStored: rewards,
    elapsedMs: Date.now() - startedAt,
    cursorUpdatedAt: state?.backfill_updated_at || null,
    oldestIndexedAt: state?.oldest_block_time || null,
    newestIndexedAt: state?.newest_block_time || null,
    finalMetrics: analysis?.metrics || null,
    lastSync
  };

  console.log("\nBACKFILL SUMMARY");
  console.log(JSON.stringify(summary, null, 2));

  if (!summary.historyComplete && !summary.backfillPending) {
    process.exitCode = 2;
  }
} catch (error) {
  console.error("Backfill worker failed:", error.message);
  process.exit(1);
}
