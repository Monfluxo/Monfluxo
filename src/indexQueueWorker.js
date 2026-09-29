import { syncWalletHistory } from "./sync.js";
import { analyzeWallet } from "./walletAnalyzer.js";
import { getSyncState } from "./db.js";
import {
  claimWalletIndexJob,
  updateWalletIndexJob
} from "./indexQueue.js";

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const maxJobs = positiveInt(process.env.INDEX_WORKER_MAX_JOBS, 10);
const batchPages = positiveInt(process.env.INDEX_WORKER_BATCH_PAGES, 20);
const maxBatchesPerJob = positiveInt(process.env.INDEX_WORKER_MAX_BATCHES, 25);
const maxRuntimeMs = positiveInt(
  process.env.INDEX_WORKER_MAX_RUNTIME_MS,
  10 * 60 * 1000
);
const pauseMs = Math.max(0, Number(process.env.INDEX_WORKER_PAUSE_MS || 500));
const storeRaw = process.env.INDEX_WORKER_STORE_RAW === "true";

async function processJob(job) {
  const wallet = job.wallet_address;
  const startedAt = Date.now();
  let batches = 0;
  let stopReason = "unknown";

  try {
    while (batches < maxBatchesPerJob) {
      if (Date.now() - startedAt >= maxRuntimeMs) {
        stopReason = "runtime_budget";
        break;
      }

      batches++;
      const sync = await syncWalletHistory(wallet, {
        mode: "deep",
        maxPages: batchPages,
        storeRaw
      });

      if (sync.historyComplete === true) {
        stopReason = "history_complete";
        break;
      }

      if (!sync.backfillCursorSaved) {
        stopReason = "no_resume_cursor";
        break;
      }

      if (pauseMs > 0) await sleep(pauseMs);
    }

    const state = await getSyncState(wallet);
    const historyComplete = state?.history_complete === true;

    if (historyComplete) {
      const analysis = await analyzeWallet(wallet, { mode: "incremental" });
      await updateWalletIndexJob(wallet, {
        status: "complete",
        completed_at: new Date().toISOString(),
        last_error: null
      });

      return {
        wallet,
        status: "complete",
        stopReason,
        batches,
        generatedAt: analysis.metrics.generatedAt
      };
    }

    if (!state?.backfill_pagination_token) {
      throw new Error(
        `Indexing stopped without a resume cursor (${stopReason})`
      );
    }

    // Budget exhaustion is normal for very large wallets. Requeue the same
    // persistent job so another worker pass resumes from the saved cursor.
    await updateWalletIndexJob(wallet, {
      status: "queued",
      started_at: null,
      completed_at: null,
      last_error: null
    });

    return {
      wallet,
      status: "queued",
      stopReason,
      batches,
      historyComplete: false
    };
  } catch (error) {
    await updateWalletIndexJob(wallet, {
      status: "error",
      last_error: error.message
    });
    throw error;
  }
}

let processed = 0;
const results = [];

try {
  while (processed < maxJobs) {
    const job = await claimWalletIndexJob();
    if (!job) break;

    try {
      const result = await processJob(job);
      results.push(result);
    } catch (error) {
      results.push({
        wallet: job.wallet_address,
        status: "error",
        error: error.message
      });
    }

    processed++;
  }

  console.log(JSON.stringify({
    worker: "wallet-index",
    processed,
    results
  }, null, 2));
} catch (error) {
  console.error("Index queue worker failed:", error.message);
  process.exit(1);
}
