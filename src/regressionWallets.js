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
const MAX_DEEP_PAGES = Number(process.env.MAX_DEEP_PAGES || 500);

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

function coverage(sync) {
  const mainHistoryCapped = Number(sync?.pages || 0) >= MAX_DEEP_PAGES;
  return {
    mainHistoryComplete: !mainHistoryCapped,
    mainHistoryCapped,
    maxDeepPages: MAX_DEEP_PAGES,
    pagesScanned: Number(sync?.pages || 0),
    transactionsScanned: Number(sync?.transactionsStored || 0)
  };
}

function evaluate(metrics, sync) {
  const errors = [];
  const warnings = [];
  const info = [];
  const unmatchedTokens = Number(metrics.unmatchedSoldTokens || 0);
  const unmatchedSol = Number(metrics.unmatchedSellProceedsSol || 0);
  const scanCoverage = coverage(sync);

  if (sync?.status !== "idle") errors.push(`sync status=${sync?.status || "unknown"}`);
  if (!Number.isFinite(Number(metrics.tradesAnalyzed))) errors.push("invalid tradesAnalyzed");
  if (!Number.isFinite(unmatchedTokens) || unmatchedTokens < 0) errors.push("invalid unmatchedSoldTokens");
  if (!Number.isFinite(unmatchedSol) || unmatchedSol < 0) errors.push("invalid unmatchedSellProceedsSol");
  if (Number(metrics.unknownCostSoldTokens || 0) < 0) errors.push("negative unknownCostSoldTokens");
  if (Number(metrics.unknownCostSellProceedsSol || 0) < 0) errors.push("negative unknownCostSellProceedsSol");
  if (Number(metrics.creatorRewardCount || 0) < 0) errors.push("negative creatorRewardCount");
  if (Number(metrics.creatorRewardTokenAmount || 0) < 0) errors.push("negative creatorRewardTokenAmount");

  if (scanCoverage.mainHistoryCapped) {
    info.push(
      `history truncated at ${MAX_DEEP_PAGES} pages / ${scanCoverage.transactionsScanned} transactions; unmatched accounting is non-diagnostic until older history is indexed`
    );
  } else {
    if (unmatchedSol > UNMATCHED_SOL_WARN) {
      warnings.push(`unmatched sell proceeds ${round(unmatchedSol, 9)} SOL > ${UNMATCHED_SOL_WARN} SOL`);
    }
    if (unmatchedTokens > 0 && unmatchedSol === 0) {
      warnings.push(`token dust remains unmatched: ${unmatchedTokens}`);
    }
  }

  if (metrics.pnlComplete === false && Number(metrics.incompletePnlPositions || 0) === 0) {
    errors.push("pnlComplete=false but incompletePnlPositions=0");
  }

  const verdict = errors.length
    ? "ERROR"
    : scanCoverage.mainHistoryCapped
      ? "INCOMPLETE"
      : warnings.length
        ? "REVIEW"
        : "PASS";

  return {
    verdict,
    errors,
    warnings,
    info,
    coverage: scanCoverage
  };
}

async function forceDeepRegression(address) {
  const previous = await getSyncState(address);

  await upsertWallet({
    address,
    updated_at: new Date().toISOString()
  });

  await upsertSyncState({
    wallet_address: address,
    status: "idle",
    newest_signature: null,
    newest_block_time: null,
    oldest_signature: null,
    oldest_block_time: null,
    pages_scanned: 0,
    history_complete: false,
    updated_at: new Date().toISOString()
  });

  try {
    const sync = await syncWalletHistory(address, {
      mode: "deep",
      maxPages: MAX_DEEP_PAGES,
      storeRaw: process.env.STORE_RAW_TRANSACTIONS !== "false"
    });
    const analysis = await analyzeWallet(address, { mode: "incremental" });
    const metrics = analysis.metrics;
    const evaluation = evaluate(metrics, sync);

    return {
      wallet: address,
      verdict: evaluation.verdict,
      errors: evaluation.errors,
      warnings: evaluation.warnings,
      info: evaluation.info,
      coverage: evaluation.coverage,
      sync: {
        pages: sync.pages,
        transactionsStored: sync.transactionsStored,
        tradesStored: sync.tradesStored,
        transfersStored: sync.transfersStored,
        rewardsStored: sync.rewardsStored,
        tokenAccountEnrichment: sync.tokenAccountEnrichment || null
      },
      accounting: {
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
      }
    };
  } catch (error) {
    if (previous) {
      await upsertSyncState({
        ...previous,
        status: "idle",
        updated_at: new Date().toISOString()
      });
    }
    return {
      wallet: address,
      verdict: "ERROR",
      errors: [error.message],
      warnings: [],
      info: [],
      coverage: null,
      sync: null,
      accounting: null
    };
  }
}

await assertEventModelV2Schema();
const wallets = walletList();
console.log(`MONFLUXO REGRESSION: ${wallets.length} wallet(s)`);
console.log(`Unmatched proceeds warning threshold: ${UNMATCHED_SOL_WARN} SOL`);
console.log(`Deep history cap: ${MAX_DEEP_PAGES} pages`);

const results = [];
for (let index = 0; index < wallets.length; index++) {
  const address = wallets[index];
  console.log(`\n[${index + 1}/${wallets.length}] ${address}`);
  const result = await forceDeepRegression(address);
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