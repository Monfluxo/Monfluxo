import {
  assertEventModelV2Schema,
  getSyncState,
  upsertWallet,
  upsertSyncState
} from "./db.js";
import { syncWalletHistory } from "./sync.js";
import { analyzeWallet } from "./walletAnalyzer.js";

const DEFAULT_BENCHMARK = "CjfLyafnK76qJyfTnBF8wb2H15D3bnMVNbRESmByDtmX";
const UNMATCHED_SOL_WARN = Number(process.env.REGRESSION_UNMATCHED_SOL_WARN || 0.001);
const BATCH_PAGES = Number(process.env.REGRESSION_BATCH_PAGES || 20);
const MAX_BATCHES = Number(process.env.REGRESSION_MAX_BATCHES || 25);
const PAUSE_MS = Number(process.env.REGRESSION_PAUSE_MS || 1500);
const MAX_RUNTIME_MS = Number(process.env.REGRESSION_MAX_RUNTIME_MS || 10 * 60 * 1000);
const RESET_HISTORY = process.env.REGRESSION_RESET_HISTORY === "true";
const STORE_RAW = process.env.REGRESSION_STORE_RAW === "true";
const ANALYZE_PARTIAL = process.env.REGRESSION_ANALYZE_PARTIAL === "true";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function walletList() {
  const cli = process.argv.slice(2).filter(Boolean);
  const env = String(process.env.REGRESSION_WALLETS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(cli.length ? cli : env.length ? env : [DEFAULT_BENCHMARK])];
}

function round(value, decimals = 6) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return null;
  const factor = 10 ** decimals;
  return Math.round(number * factor) / factor;
}

function evaluate(metrics, historyComplete, backfillPending) {
  const errors = [];
  const warnings = [];
  const info = [];

  if (!historyComplete) {
    info.push("historical backfill remains incomplete; full accounting evaluation deferred until historyComplete=true");
    if (!backfillPending) errors.push("history incomplete but no resume cursor is available");
    return {
      verdict: errors.length ? "ERROR" : "INCOMPLETE",
      errors,
      warnings,
      info
    };
  }

  if (!metrics) {
    errors.push("history complete but final metrics were not calculated");
    return { verdict: "ERROR", errors, warnings, info };
  }

  const unmatchedTokens = Number(metrics.unmatchedSoldTokens || 0);
  const unmatchedSol = Number(metrics.unmatchedSellProceedsSol || 0);

  if (!Number.isFinite(Number(metrics.tradesAnalyzed))) errors.push("invalid tradesAnalyzed");
  if (!Number.isFinite(unmatchedTokens) || unmatchedTokens < 0) errors.push("invalid unmatchedSoldTokens");
  if (!Number.isFinite(unmatchedSol) || unmatchedSol < 0) errors.push("invalid unmatchedSellProceedsSol");
  if (Number(metrics.unknownCostSoldTokens || 0) < 0) errors.push("negative unknownCostSoldTokens");
  if (Number(metrics.unknownCostSellProceedsSol || 0) < 0) errors.push("negative unknownCostSellProceedsSol");
  if (Number(metrics.creatorRewardCount || 0) < 0) errors.push("negative creatorRewardCount");
  if (Number(metrics.creatorRewardTokenAmount || 0) < 0) errors.push("negative creatorRewardTokenAmount");

  if (unmatchedSol > UNMATCHED_SOL_WARN) {
    warnings.push(`unmatched sell proceeds ${round(unmatchedSol, 9)} SOL > ${UNMATCHED_SOL_WARN} SOL`);
  }
  if (unmatchedTokens > 0 && unmatchedSol === 0) {
    warnings.push(`token dust remains unmatched: ${unmatchedTokens}`);
  }
  if (metrics.pnlComplete === false && Number(metrics.incompletePnlPositions || 0) === 0) {
    errors.push("pnlComplete=false but incompletePnlPositions=0");
  }

  const verdict = errors.length
    ? "ERROR"
    : warnings.length
      ? "REVIEW"
      : "PASS";

  return { verdict, errors, warnings, info };
}

async function prepareWallet(address) {
  const previous = await getSyncState(address);
  await upsertWallet({ address, updated_at: new Date().toISOString() });

  if (RESET_HISTORY) {
    await upsertSyncState({
      wallet_address: address,
      status: "idle",
      newest_signature: null,
      newest_block_time: null,
      oldest_signature: null,
      oldest_block_time: null,
      pages_scanned: 0,
      history_complete: false,
      backfill_pagination_token: null,
      backfill_started_at: null,
      backfill_updated_at: null,
      updated_at: new Date().toISOString()
    });
  } else if (previous?.status === "syncing" || previous?.status === "error") {
    await upsertSyncState({
      wallet_address: address,
      status: "idle",
      updated_at: new Date().toISOString()
    });
  }
}

async function runWalletRegression(address) {
  await prepareWallet(address);

  const startedAt = Date.now();
  let batches = 0;
  let pages = 0;
  let transactionsStored = 0;
  let tradesStored = 0;
  let transfersStored = 0;
  let rewardsStored = 0;
  let lastSync = null;
  let stopReason = "unknown";

  try {
    let state = await getSyncState(address);

    if (state?.history_complete === true && !RESET_HISTORY) {
      stopReason = "already_complete";
    } else {
      while (batches < MAX_BATCHES) {
        if (Date.now() - startedAt >= MAX_RUNTIME_MS) {
          stopReason = "runtime_budget";
          break;
        }

        batches++;
        console.log(`  batch ${batches}/${MAX_BATCHES}`);

        const sync = await syncWalletHistory(address, {
          mode: "deep",
          maxPages: BATCH_PAGES,
          storeRaw: STORE_RAW
        });

        lastSync = sync;
        pages += Number(sync.pages || 0);
        transactionsStored += Number(sync.transactionsStored || 0);
        tradesStored += Number(sync.tradesStored || 0);
        transfersStored += Number(sync.transfersStored || 0);
        rewardsStored += Number(sync.rewardsStored || 0);

        console.log(`    pages=${sync.pages} tx=${sync.transactionsStored} complete=${sync.historyComplete} resume=${sync.resumingBackfill}`);

        if (sync.historyComplete === true) {
          stopReason = "history_complete";
          break;
        }
        if (!sync.backfillCursorSaved) {
          stopReason = "no_resume_cursor";
          break;
        }
        if (batches >= MAX_BATCHES) {
          stopReason = "batch_budget";
          break;
        }

        const remainingRuntime = MAX_RUNTIME_MS - (Date.now() - startedAt);
        if (remainingRuntime <= PAUSE_MS) {
          stopReason = "runtime_budget";
          break;
        }
        if (PAUSE_MS > 0) await sleep(PAUSE_MS);
      }
    }

    state = await getSyncState(address);
    const historyComplete = state?.history_complete === true;
    const backfillPending = !historyComplete && Boolean(state?.backfill_pagination_token);

    let metrics = null;
    let metricsStatus = "deferred";
    if (historyComplete || ANALYZE_PARTIAL) {
      console.log(historyComplete ? "  calculating final metrics..." : "  calculating partial metrics...");
      const analysis = await analyzeWallet(address, { mode: "incremental" });
      metrics = analysis.metrics;
      metricsStatus = historyComplete ? "final" : "partial";
    }

    const evaluation = evaluate(metrics, historyComplete, backfillPending);

    return {
      wallet: address,
      verdict: evaluation.verdict,
      stopReason,
      errors: evaluation.errors,
      warnings: evaluation.warnings,
      info: evaluation.info,
      coverage: {
        historyComplete,
        backfillPending,
        batches,
        pages,
        transactionsStored,
        cursorUpdatedAt: state?.backfill_updated_at || null,
        oldestIndexedAt: state?.oldest_block_time || null,
        newestIndexedAt: state?.newest_block_time || null,
        elapsedMs: Date.now() - startedAt
      },
      sync: lastSync ? {
        tradesStored,
        transfersStored,
        rewardsStored,
        unifiedTokenHistory: lastSync.unifiedTokenHistory,
        tokenAccountsFilter: lastSync.tokenAccountsFilter,
        tokenAccountEnrichment: lastSync.tokenAccountEnrichment || null
      } : null,
      metricsStatus,
      accounting: metrics ? {
        tradesAnalyzed: metrics.tradesAnalyzed,
        transfersAnalyzed: metrics.transfersAnalyzed,
        creatorRewardCount: metrics.creatorRewardCount,
        creatorRewardTokenAmount: metrics.creatorRewardTokenAmount,
        unmatchedSoldTokens: metrics.unmatchedSoldTokens,
        unmatchedSellProceedsSol: metrics.unmatchedSellProceedsSol,
        unknownCostSoldTokens: metrics.unknownCostSoldTokens,
        unknownCostSellProceedsSol: metrics.unknownCostSellProceedsSol,
        incompletePnlPositions: metrics.incompletePnlPositions,
        pnlComplete: metrics.pnlComplete
      } : null
    };
  } catch (error) {
    return {
      wallet: address,
      verdict: "ERROR",
      stopReason: "exception",
      errors: [error.message],
      warnings: [],
      info: [],
      coverage: null,
      sync: null,
      metricsStatus: "unavailable",
      accounting: null
    };
  }
}

await assertEventModelV2Schema();
const wallets = walletList();
console.log(`MONFLUXO REGRESSION: ${wallets.length} wallet(s)`);
console.log(`Batch pages: ${BATCH_PAGES}`);
console.log(`Max batches/wallet: ${MAX_BATCHES}`);
console.log(`Runtime budget/wallet: ${MAX_RUNTIME_MS}ms`);
console.log(`Reset historical cursor: ${RESET_HISTORY}`);
console.log(`Analyze partial history: ${ANALYZE_PARTIAL}`);

const results = [];
for (let index = 0; index < wallets.length; index++) {
  const address = wallets[index];
  console.log(`\n[${index + 1}/${wallets.length}] ${address}`);
  const result = await runWalletRegression(address);
  results.push(result);
  console.log(JSON.stringify(result, null, 2));
}

const summary = {
  generatedAt: new Date().toISOString(),
  wallets: results.length,
  passed: results.filter((item) => item.verdict === "PASS").length,
  incomplete: results.filter((item) => item.verdict === "INCOMPLETE").length,
  review: results.filter((item) => item.verdict === "REVIEW").length,
  errors: results.filter((item) => item.verdict === "ERROR").length,
  results
};

console.log("\nREGRESSION SUMMARY");
console.log(JSON.stringify(summary, null, 2));

if (summary.errors > 0) process.exitCode = 1;
