function pct(n) { return Number.isFinite(n) ? n * 100 : null; }
function average(values) { return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null; }
function percentile(values, p) {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y);
  const i = (a.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return a[lo];
  return a[lo] + (a[hi] - a[lo]) * (i - lo);
}
function median(values) { return percentile(values, 0.5); }

const HOLD_EPSILON = 1e-9;
const MIN_OPEN_POSITION_VALUE_SOL = Number(process.env.MIN_OPEN_POSITION_VALUE_SOL || 0.005);

function estimatedResidualValueSol(position) {
  const tokens = Number(position?.purchasedTokensRemaining || 0);
  if (!(tokens > HOLD_EPSILON)) return 0;
  const lastPrice = Number(position?.lastPriceSol || 0);
  if (Number.isFinite(lastPrice) && lastPrice > 0) return tokens * lastPrice;
  const remainingCost = Number(position?.remainingCostSol || 0);
  return Number.isFinite(remainingCost) && remainingCost > 0 ? remainingCost : 0;
}

function hasMaterialPurchasedInventory(position) {
  return Number(position?.purchasedTokensRemaining || 0) > HOLD_EPSILON &&
    estimatedResidualValueSol(position) >= MIN_OPEN_POSITION_VALUE_SOL;
}

function classifyBehavior({ medianHoldSeconds, averageWinnerHoldSeconds, averageLoserHoldSeconds, reentryRatePct, top1Pct }) {
  const tags = [];
  if (Number.isFinite(medianHoldSeconds)) {
    if (medianHoldSeconds < 15 * 60) tags.push("FAST_SCALPER");
    else if (medianHoldSeconds < 6 * 3600) tags.push("INTRADAY_TRADER");
    else if (medianHoldSeconds < 7 * 86400) tags.push("SWING_TRADER");
    else tags.push("LONG_HOLDER");
  }
  if (Number.isFinite(reentryRatePct)) {
    if (reentryRatePct >= 50) tags.push("HIGH_REENTRY");
    else if (reentryRatePct >= 20) tags.push("MODERATE_REENTRY");
    else tags.push("LOW_REENTRY");
  }
  if (Number.isFinite(top1Pct)) {
    if (top1Pct >= 60) tags.push("HIGH_PNL_CONCENTRATION");
    else if (top1Pct >= 30) tags.push("MODERATE_PNL_CONCENTRATION");
    else tags.push("DISTRIBUTED_PNL");
  }
  if (Number.isFinite(averageWinnerHoldSeconds) && Number.isFinite(averageLoserHoldSeconds)) {
    if (averageLoserHoldSeconds > averageWinnerHoldSeconds * 2) tags.push("HOLDS_LOSERS_LONGER");
    else if (averageWinnerHoldSeconds > averageLoserHoldSeconds * 2) tags.push("HOLDS_WINNERS_LONGER");
  }
  return tags;
}

export function buildHoldBehavior(positions = []) {
  const closed = positions.filter((p) =>
    !hasMaterialPurchasedInventory(p) &&
    Number(p?.realizedCostBasis || 0) > 0 &&
    Number(p?.unmatchedSoldTokens || 0) <= HOLD_EPSILON &&
    Number(p?.transferredOutKnownCostSol || 0) <= HOLD_EPSILON &&
    Number.isFinite(Number(p?.avgHoldingSeconds))
  );

  const rows = closed.map((p) => ({
    tokenMint: p.mint,
    holdSeconds: Number(p.avgHoldingSeconds),
    realizedPnlSol: Number(p.realizedPnl || 0),
    realizedRoiPct: Number.isFinite(Number(p.realizedRoi)) ? Number(p.realizedRoi) * 100 : null,
    buys: Number(p.buys || 0),
    sells: Number(p.sells || 0),
    reentryCount: Math.max(0, Number(p.buys || 0) - 1),
    firstBlockTime: p.firstBlockTime ?? null,
    lastBlockTime: p.lastBlockTime ?? null
  }));

  const holds = rows.map((r) => r.holdSeconds).filter(Number.isFinite);
  const winners = rows.filter((r) => r.realizedPnlSol > 0).map((r) => r.holdSeconds);
  const losers = rows.filter((r) => r.realizedPnlSol < 0).map((r) => r.holdSeconds);
  const reentered = rows.filter((r) => r.reentryCount > 0);

  const totalPositivePnl = rows.filter((r) => r.realizedPnlSol > 0).reduce((s, r) => s + r.realizedPnlSol, 0);
  const sortedPositive = rows.filter((r) => r.realizedPnlSol > 0).sort((a, b) => b.realizedPnlSol - a.realizedPnlSol);
  const top1 = sortedPositive.slice(0, 1).reduce((s, r) => s + r.realizedPnlSol, 0);
  const top5 = sortedPositive.slice(0, 5).reduce((s, r) => s + r.realizedPnlSol, 0);

  const result = {
    methodology: "purchased_inventory_closed_tokens_v3_material_dust",
    sampleSize: rows.length,
    averageHoldSeconds: average(holds),
    medianHoldSeconds: median(holds),
    p25HoldSeconds: percentile(holds, 0.25),
    p75HoldSeconds: percentile(holds, 0.75),
    averageWinnerHoldSeconds: average(winners),
    averageLoserHoldSeconds: average(losers),
    longest: [...rows].sort((a, b) => b.holdSeconds - a.holdSeconds).slice(0, 6),
    shortest: [...rows].sort((a, b) => a.holdSeconds - b.holdSeconds).slice(0, 6),
    reentryRatePct: rows.length ? (reentered.length / rows.length) * 100 : null,
    avgReentriesWhenPresent: reentered.length ? average(reentered.map((r) => r.reentryCount)) : null,
    pnlConcentration: {
      top1Pct: totalPositivePnl > 0 ? pct(top1 / totalPositivePnl) : null,
      top5Pct: totalPositivePnl > 0 ? pct(top5 / totalPositivePnl) : null
    }
  };

  result.behaviorTags = classifyBehavior({
    medianHoldSeconds: result.medianHoldSeconds,
    averageWinnerHoldSeconds: result.averageWinnerHoldSeconds,
    averageLoserHoldSeconds: result.averageLoserHoldSeconds,
    reentryRatePct: result.reentryRatePct,
    top1Pct: result.pnlConcentration.top1Pct
  });

  return result;
}

function maxCandle(candles = [], field = "high") {
  let best = null;
  for (const candle of candles) {
    if (!Number.isFinite(Number(candle?.[field])) || Number(candle[field]) <= 0) continue;
    if (!best || Number(candle[field]) > Number(best[field])) best = candle;
  }
  return best;
}

export function analyzeTradeJourney({ candles = [], postExitCandles = [], entryPrice, exitPrice, entryTime, exitTime }) {
  const valid = candles.filter((c) => c.time >= entryTime && c.time <= exitTime && c.high > 0 && c.low > 0);
  if (!valid.length || !(entryPrice > 0) || !(exitPrice > 0)) return null;

  let peak = valid[0];
  let trough = valid[0];
  for (const c of valid) {
    if (c.high > peak.high) peak = c;
    if (c.low < trough.low) trough = c;
  }

  const realizedRoiPct = ((exitPrice / entryPrice) - 1) * 100;
  const mfePct = ((peak.high / entryPrice) - 1) * 100;
  const maePct = ((trough.low / entryPrice) - 1) * 100;
  const givebackPctPoints = Math.max(0, mfePct - realizedRoiPct);
  const profitCapturePct = mfePct > 0 ? Math.max(0, realizedRoiPct) / mfePct * 100 : null;

  let underwaterSeconds = 0;
  for (let i = 0; i < valid.length - 1; i++) {
    if (valid[i].close < entryPrice) underwaterSeconds += Math.max(0, valid[i + 1].time - valid[i].time);
  }

  const post = postExitCandles.filter((c) => c.time > exitTime && c.high > 0);
  const postExitPeak = maxCandle(post, "high");
  const postExitPeakRoiPct = postExitPeak ? ((postExitPeak.high / entryPrice) - 1) * 100 : null;
  const postExitMultipleFromExit = postExitPeak ? postExitPeak.high / exitPrice : null;
  const earlyExitMissedPctPoints = postExitPeakRoiPct == null ? 0 : Math.max(0, postExitPeakRoiPct - realizedRoiPct);

  const materialGiveback = givebackPctPoints >= 100;
  const materialEarlyExit = earlyExitMissedPctPoints >= 100 && Number(postExitMultipleFromExit || 0) >= 2;
  let missedMillionsType = null;
  if (materialGiveback && materialEarlyExit) missedMillionsType = "HYBRID";
  else if (materialEarlyExit) missedMillionsType = "EARLY_EXIT";
  else if (materialGiveback) missedMillionsType = "PROFIT_GIVEBACK";

  const missedUpsidePctPoints = Math.max(givebackPctPoints, earlyExitMissedPctPoints);

  return {
    realizedRoiPct,
    mfePct,
    maePct,
    profitCapturePct,
    givebackPctPoints,
    postExitPeakRoiPct,
    postExitPeakTime: postExitPeak?.time ?? null,
    postExitPeakPrice: postExitPeak?.high ?? null,
    postExitMultipleFromExit,
    earlyExitMissedPctPoints,
    missedUpsidePctPoints,
    missedMillionsType,
    peakTime: peak.time,
    peakPrice: peak.high,
    troughTime: trough.time,
    troughPrice: trough.low,
    timeToPeakSeconds: Math.max(0, peak.time - entryTime),
    timeUnderwaterSeconds: underwaterSeconds,
    holdSeconds: Math.max(0, exitTime - entryTime),
    candles: valid,
    postExitCandles: post
  };
}

export function rankJourneyIntelligence(journeys = []) {
  const valid = journeys.filter(Boolean);
  const diamondHands = valid
    .filter((j) => Number(j.realizedRoiPct) > 0 && Number(j.maePct) < 0)
    .sort((a, b) => Number(a.maePct) - Number(b.maePct))
    .slice(0, 10);

  const eliteExits = valid
    .filter((j) => Number(j.mfePct) > 0 && Number.isFinite(Number(j.profitCapturePct)))
    .sort((a, b) => Number(b.profitCapturePct) - Number(a.profitCapturePct))
    .slice(0, 10);

  const missedMillions = valid
    .filter((j) => j.missedMillionsType)
    .sort((a, b) => Number(b.missedUpsidePctPoints || 0) - Number(a.missedUpsidePctPoints || 0))
    .slice(0, 10);

  return { diamondHands, eliteExits, missedMillions };
}
