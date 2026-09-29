import test from "node:test";
import assert from "node:assert/strict";
import { buildWalletDashboardResponse } from "../src/walletDashboardContract.js";

test("wallet dashboard exposes stable final accounting contract", () => {
  const response = buildWalletDashboardResponse({
    wallet: "11111111111111111111111111111111",
    status: "ready",
    metricsStatus: "final",
    coverage: {
      status: "complete",
      historyComplete: true,
      backfillPending: false,
      pagesScanned: 10
    },
    metrics: {
      generatedAt: "2026-09-29T00:00:00.000Z",
      tradesAnalyzed: 100,
      transfersAnalyzed: 20,
      uniqueTokens: 7,
      totalVolumeSol: 42,
      realizedPnlSol: 5,
      unrealizedPnlSol: 1,
      totalPnlSol: 6,
      pnlComplete: false,
      unknownCostSoldTokens: 10,
      unknownCostSellProceedsSol: 2,
      unmatchedSoldTokens: 0.000002,
      unmatchedSellProceedsSol: 0,
      lowConfidenceTradesExcluded: 3,
      lowConfidenceVolumeSolExcluded: 0.006,
      topPositions: []
    }
  });

  assert.equal(response.schemaVersion, "wallet-intelligence.v1");
  assert.equal(response.metricsStatus, "final");
  assert.equal(response.coverage.historyComplete, true);
  assert.equal(response.performance.pnlCoverage.status, "partial");
  assert.equal(response.accounting.unmatchedSellProceedsSol, 0);
  assert.equal(response.confidence.level, "high");
  assert.equal(response.activity.lowConfidenceTradesExcluded, 3);
});

test("wallet dashboard marks incomplete history as partial confidence", () => {
  const response = buildWalletDashboardResponse({
    wallet: "11111111111111111111111111111111",
    status: "indexing",
    metricsStatus: "partial",
    coverage: {
      status: "indexing",
      historyComplete: false,
      backfillPending: true,
      pagesScanned: 5
    },
    metrics: {
      pnlComplete: true,
      topPositions: []
    },
    indexJob: { status: "queued" }
  });

  assert.equal(response.status, "indexing");
  assert.equal(response.confidence.level, "partial");
  assert.equal(response.indexing.refreshRecommended, true);
  assert.equal(response.indexing.job.status, "queued");
});
