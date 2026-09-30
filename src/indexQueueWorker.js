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

const maxJobsPerCycle = positiveInt(process.env.INDEX_WORKER_MAX_JOBS, 10);
// Larger batches reduce repeated schema/state/setup work while sync.js still
// checkpoints the pagination cursor after every page, so progress remains resumable.
const batchPages = positiveInt(process.env.INDEX_WORKER_BATCH_PAGES, 50);
const maxBatchesPerJob = positiveInt(process.env.INDEX_WORKER_MAX_BATCHES, 10);
const maxRuntimeMs = positiveInt(
  process.env.INDEX_WORKER_MAX_RUNTIME_MS,
  10 * 60 * 1000
);
const pauseMs = Math.max(0, Number(process.env.INDEX_WORKER_PAUSE_MS || 0));
const idlePollMs = positiveInt(process.env.INDEX_WORKER_IDLE_POLL_MS, 3000);
const cyclePauseMs = positiveInt(process.env.INDEX_WORKER_CYCLE_PAUSE_MS, 250);
const runOnce = process.env.INDEX_WORKER_ONCE === "true";
const storeRaw = process.env.INDEX_WORKER_STORE_RAW === "true";

async function processJob(job) {
  const wallet = job.wallet_address;
  const startedAt = Date.now();
  let batches = 0;
  let pagesProcessed = 0;
  let stopReason = "unknown";

  console.log(`[wallet-index] processing ${wallet} (attempt ${job.attempts || 1})`);

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
      pagesProcessed += Number(sync.pages || 0);

      console.log(
        `[wallet-index] ${wallet} batch ${batches}/${maxBatchesPerJob}: ` +
        `${Number(sync.pages || 0)} pages (${pagesProcessed} this job)`
      );

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

      console.log(`[wallet-index] complete ${wallet} in ${batches} batch(es), ${pagesProcessed} pages`);
      return {
        wallet,
        status: "complete",
        stopReason,
        batches,
        pagesProcessed,
        generatedAt: analysis.metrics.generatedAt
      };
    }

    if (!state?.backfill_pagination_token) {
      throw new Error(
        `Indexing stopped without a resume cursor (${stopReason})`
      );
    }

    await updateWalletIndexJob(wallet, {
      status: "queued",
      started_at: null,
      completed_at: null,
      last_error: null
    });

    console.log(`[wallet-index] requeued ${wallet} (${stopReason}, ${batches} batches, ${pagesProcessed} pages)`);
    return {
      wallet,
      status: "queued",
      stopReason,
      batches,
      pagesProcessed,
      historyComplete: false
    };
  } catch (error) {
    await updateWalletIndexJob(wallet, {
      status: "error",
      last_error: error.message
    });
    console.error(`[wallet-index] error ${wallet}: ${error.message}`);
    throw error;
  }
}

async function runCycle() {
  let processed = 0;
  const results = [];

  while (processed < maxJobsPerCycle) {
    const job = await claimWalletIndexJob();
    if (!job) break;

    try {
      results.push(await processJob(job));
    } catch (error) {
      results.push({
        wallet: job.wallet_address,
        status: "error",
        error: error.message
      });
    }

    processed++;
  }

  return { processed, results };
}

async function main() {
  console.log(
    `[wallet-index] worker started; polling every ${idlePollMs}ms; ` +
    `${batchPages} pages/batch, ${maxBatchesPerJob} batches/job` +
    (runOnce ? " (one-shot mode)" : "")
  );

  while (true) {
    const cycle = await runCycle();

    if (cycle.processed > 0) {
      console.log(JSON.stringify({
        worker: "wallet-index",
        ...cycle
      }, null, 2));
    }

    if (runOnce) break;
    await sleep(cycle.processed === 0 ? idlePollMs : cyclePauseMs);
  }
}

main().catch((error) => {
  console.error("Index queue worker failed:", error.message);
  process.exit(1);
});
