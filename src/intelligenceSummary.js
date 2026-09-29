const EPSILON = 1e-9;

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function round(value, decimals = 2) {
  if (!Number.isFinite(value)) return null;
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

function maxLossStreak(rows) {
  let max = 0;
  let current = 0;
  for (const row of rows) {
    if (row.pnl < 0) {
      current += 1;
      max = Math.max(max, current);
    } else if (row.pnl > 0) {
      current = 0;
    }
  }
  return max;
}

function maxWinStreak(rows) {
  let max = 0;
  let current = 0;
  for (const row of rows) {
    if (row.pnl > 0) {
      current += 1;
      max = Math.max(max, current);
    } else if (row.pnl < 0) {
      current = 0;
    }
  }
  return max;
}

function realizedSequenceDrawdown(rows) {
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const row of rows) {
    equity += row.pnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, equity - peak);
  }
  return maxDrawdown;
}

function traderType(tags = []) {
  const speed = tags.find((tag) => ["FAST_SCALPER", "INTRADAY_TRADER", "SWING_TRADER", "LONG_HOLDER"].includes(tag));
  const reentry = tags.find((tag) => ["HIGH_REENTRY", "MODERATE_REENTRY"].includes(tag));
  const concentration = tags.find((tag) => ["HIGH_PNL_CONCENTRATION", "MODERATE_PNL_CONCENTRATION"].includes(tag));

  const speedLabel = {
    FAST_SCALPER: "Fast scalper",
    INTRADAY_TRADER: "Intraday trader",
    SWING_TRADER: "Swing trader",
    LONG_HOLDER: "Long-horizon holder"
  }[speed] || "Mixed-horizon trader";

  if (reentry === "HIGH_REENTRY") return `${speedLabel} · high re-entry`;
  if (concentration === "HIGH_PNL_CONCENTRATION") return `${speedLabel} · concentrated outcomes`;
  return speedLabel;
}

export function buildWalletIntelligenceSummary(positions = [], holdBehavior = {}, options = {}) {
  const closed = positions
    .filter((p) =>
      Number(p?.purchasedTokensRemaining || 0) <= EPSILON &&
      Number(p?.realizedCostBasis || 0) > 0 &&
      Number(p?.unmatchedSoldTokens || 0) <= EPSILON &&
      Number(p?.transferredOutKnownCostSol || 0) <= EPSILON
    )
    .map((p) => ({
      tokenMint: p.mint,
      pnl: Number(p.realizedPnl || 0),
      roiPct: finite(p.realizedRoi) == null ? null : Number(p.realizedRoi) * 100,
      costSol: Number(p.realizedCostBasis || 0),
      solSpent: Number(p.solSpent || 0),
      lastBlockTime: Number(p.lastBlockTime || 0)
    }));

  const ordered = [...closed].sort((a, b) => a.lastBlockTime - b.lastBlockTime);
  const winners = closed.filter((p) => p.pnl > 0);
  const losers = closed.filter((p) => p.pnl < 0);
  const grossProfit = winners.reduce((sum, p) => sum + p.pnl, 0);
  const grossLoss = Math.abs(losers.reduce((sum, p) => sum + p.pnl, 0));
  const netPnl = grossProfit - grossLoss;
  const winRatePct = closed.length ? (winners.length / closed.length) * 100 : null;
  const profitFactor = grossLoss > EPSILON ? grossProfit / grossLoss : grossProfit > 0 ? null : 0;
  const top1Concentration = finite(holdBehavior?.pnlConcentration?.top1Pct);
  const top5Concentration = finite(holdBehavior?.pnlConcentration?.top5Pct);
  const avgWinnerHold = finite(holdBehavior?.averageWinnerHoldSeconds);
  const avgLoserHold = finite(holdBehavior?.averageLoserHoldSeconds);
  const reentryRatePct = finite(holdBehavior?.reentryRatePct);

  const closedCost = closed.reduce((sum, p) => sum + p.costSol, 0);
  const largestCost = closed.reduce((max, p) => Math.max(max, p.costSol), 0);
  const largestPositionSharePct = closedCost > EPSILON ? (largestCost / closedCost) * 100 : null;
  const averageCostSol = closed.length ? closedCost / closed.length : null;

  const concentrationPenalty = top1Concentration == null ? 25 : clamp((top1Concentration - 20) * 0.75, 0, 45);
  const sampleFactor = clamp(closed.length / 25, 0, 1);
  const winComponent = winRatePct == null ? 50 : clamp(winRatePct, 0, 100);
  const pfComponent = profitFactor == null ? (grossProfit > 0 ? 85 : 50) : clamp(profitFactor * 35, 0, 100);
  const streakPenalty = clamp(maxLossStreak(ordered) * 4, 0, 24);
  const rawConsistency = (winComponent * 0.42) + (pfComponent * 0.38) + ((100 - concentrationPenalty * 2) * 0.20) - streakPenalty;
  const consistencyScore = closed.length ? round(50 + (clamp(rawConsistency) - 50) * sampleFactor, 0) : null;

  const strengths = [];
  const weaknesses = [];
  const observations = [];

  if (profitFactor != null && profitFactor >= 2) strengths.push(`Gross profits are ${round(profitFactor, 2)}× gross losses.`);
  if (winRatePct != null && winRatePct >= 60 && closed.length >= 5) strengths.push(`${round(winRatePct, 1)}% win rate across ${closed.length} closed token lifecycles.`);
  if (top1Concentration != null && top1Concentration < 30) strengths.push("Profits are relatively distributed rather than dependent on a single token.");
  if (avgWinnerHold != null && avgLoserHold != null && avgWinnerHold > avgLoserHold * 1.5) strengths.push("Winning positions are held materially longer than losing positions.");

  if (top1Concentration != null && top1Concentration >= 60) weaknesses.push(`${round(top1Concentration, 1)}% of positive PnL comes from the single best token.`);
  if (top5Concentration != null && top5Concentration >= 90 && closed.length > 5) weaknesses.push(`${round(top5Concentration, 1)}% of positive PnL is concentrated in the top five tokens.`);
  if (avgWinnerHold != null && avgLoserHold != null && avgLoserHold > avgWinnerHold * 2) weaknesses.push("Losing positions are held more than 2× longer than winners on average.");
  if (maxLossStreak(ordered) >= 4) weaknesses.push(`Maximum observed losing streak is ${maxLossStreak(ordered)} closed tokens.`);
  if (largestPositionSharePct != null && largestPositionSharePct >= 40) weaknesses.push(`Largest closed position represents ${round(largestPositionSharePct, 1)}% of observed closed cost basis.`);

  if (reentryRatePct != null) observations.push(`${round(reentryRatePct, 1)}% of closed tokens involved at least one re-entry.`);
  if (closed.length < 10) observations.push("Behavioral sample is still small; summary confidence is limited.");
  if (options.historyComplete !== true) observations.push("Historical indexing is incomplete, so intelligence remains provisional.");

  const confidence = options.historyComplete !== true
    ? "partial"
    : closed.length >= 25 ? "high"
      : closed.length >= 10 ? "medium"
        : "low";

  return {
    methodology: "explainable_behavior_summary_v1",
    traderType: traderType(holdBehavior?.behaviorTags || []),
    behaviorTags: holdBehavior?.behaviorTags || [],
    consistencyScore,
    confidence,
    sampleSize: closed.length,
    strengths: strengths.slice(0, 4),
    weaknesses: weaknesses.slice(0, 4),
    observations: observations.slice(0, 4),
    risk: {
      grossProfitSol: round(grossProfit, 6),
      grossLossSol: round(grossLoss, 6),
      netClosedPnlSol: round(netPnl, 6),
      profitFactor: profitFactor == null ? null : round(profitFactor, 2),
      maxWinStreak: maxWinStreak(ordered),
      maxLossStreak: maxLossStreak(ordered),
      realizedSequenceMaxDrawdownSol: round(realizedSequenceDrawdown(ordered), 6),
      largestClosedPositionCostSol: round(largestCost, 6),
      largestClosedPositionSharePct: largestPositionSharePct == null ? null : round(largestPositionSharePct, 2),
      averageClosedPositionCostSol: averageCostSol == null ? null : round(averageCostSol, 6),
      top1PositivePnlConcentrationPct: top1Concentration == null ? null : round(top1Concentration, 2),
      top5PositivePnlConcentrationPct: top5Concentration == null ? null : round(top5Concentration, 2)
    }
  };
}
