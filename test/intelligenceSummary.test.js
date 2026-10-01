import test from "node:test";
import assert from "node:assert/strict";
import { buildWalletIntelligenceSummary } from "../src/intelligenceSummary.js";

test("builds risk and consistency intelligence from closed token lifecycles", () => {
  const positions = [
    { mint: "A", purchasedTokensRemaining: 0, realizedCostBasis: 1, realizedPnl: 3, realizedRoi: 3, unmatchedSoldTokens: 0, transferredOutKnownCostSol: 0, lastBlockTime: 100 },
    { mint: "B", purchasedTokensRemaining: 0, realizedCostBasis: 1, realizedPnl: -1, realizedRoi: -1, unmatchedSoldTokens: 0, transferredOutKnownCostSol: 0, lastBlockTime: 200 },
    { mint: "C", purchasedTokensRemaining: 0, realizedCostBasis: 2, realizedPnl: 2, realizedRoi: 1, unmatchedSoldTokens: 0, transferredOutKnownCostSol: 0, lastBlockTime: 300 },
    { mint: "OPEN", purchasedTokensRemaining: 1, remainingCostSol: 1, lastPriceSol: 1, realizedCostBasis: 2, realizedPnl: 9, realizedRoi: 4.5, unmatchedSoldTokens: 0, transferredOutKnownCostSol: 0, lastBlockTime: 400 }
  ];
  const holdBehavior = {
    behaviorTags: ["INTRADAY_TRADER", "LOW_REENTRY", "MODERATE_PNL_CONCENTRATION"],
    averageWinnerHoldSeconds: 100,
    averageLoserHoldSeconds: 500,
    reentryRatePct: 10,
    pnlConcentration: { top1Pct: 60, top5Pct: 100 }
  };

  const summary = buildWalletIntelligenceSummary(positions, holdBehavior, { historyComplete: true });
  assert.equal(summary.sampleSize, 3);
  assert.equal(summary.risk.grossProfitSol, 5);
  assert.equal(summary.risk.grossLossSol, 1);
  assert.equal(summary.risk.profitFactor, 5);
  assert.equal(summary.risk.maxLossStreak, 1);
  assert.equal(summary.risk.largestClosedPositionCostSol, 2);
  assert.equal(typeof summary.verdict, "string");
  assert.ok(["Low", "Medium", "High"].includes(summary.observedRisk));
  assert.ok(summary.weaknesses.some((text) => text.includes("single best token")));
  assert.ok(summary.weaknesses.some((text) => text.includes("2× longer")));
});

test("marks incomplete history as partial confidence", () => {
  const summary = buildWalletIntelligenceSummary([], {}, { historyComplete: false });
  assert.equal(summary.confidence, "partial");
  assert.ok(summary.observations.some((text) => text.includes("incomplete")));
});
