function pct(n) { return Number.isFinite(n) ? n * 100 : null; }
function median(values) { if (!values.length) return null; const a=[...values].sort((x,y)=>x-y); const m=Math.floor(a.length/2); return a.length%2?a[m]:(a[m-1]+a[m])/2; }
function average(values) { return values.length ? values.reduce((s,v)=>s+v,0)/values.length : null; }

export function buildHoldBehavior(positions = []) {
  const closed = positions.filter((p) => Number(p?.purchasedTokensRemaining || 0) <= 1e-9 && Number(p?.realizedCostBasis || 0) > 0 && Number.isFinite(Number(p?.avgHoldingSeconds)));
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

  const totalPositivePnl = rows.filter((r)=>r.realizedPnlSol>0).reduce((s,r)=>s+r.realizedPnlSol,0);
  const sortedPositive = rows.filter((r)=>r.realizedPnlSol>0).sort((a,b)=>b.realizedPnlSol-a.realizedPnlSol);
  const top1 = sortedPositive.slice(0,1).reduce((s,r)=>s+r.realizedPnlSol,0);
  const top5 = sortedPositive.slice(0,5).reduce((s,r)=>s+r.realizedPnlSol,0);

  return {
    methodology: "purchased_inventory_closed_tokens_v1",
    sampleSize: rows.length,
    averageHoldSeconds: average(holds),
    medianHoldSeconds: median(holds),
    averageWinnerHoldSeconds: average(winners),
    averageLoserHoldSeconds: average(losers),
    longest: [...rows].sort((a,b)=>b.holdSeconds-a.holdSeconds).slice(0,10),
    shortest: [...rows].sort((a,b)=>a.holdSeconds-b.holdSeconds).slice(0,10),
    reentryRatePct: rows.length ? (reentered.length / rows.length) * 100 : null,
    avgReentriesWhenPresent: reentered.length ? average(reentered.map((r)=>r.reentryCount)) : null,
    pnlConcentration: {
      top1Pct: totalPositivePnl > 0 ? pct(top1 / totalPositivePnl) : null,
      top5Pct: totalPositivePnl > 0 ? pct(top5 / totalPositivePnl) : null
    }
  };
}

export function analyzeTradeJourney({ candles = [], entryPrice, exitPrice, entryTime, exitTime }) {
  const valid = candles.filter((c) => c.time >= entryTime && c.time <= exitTime && c.high > 0 && c.low > 0);
  if (!valid.length || !(entryPrice > 0) || !(exitPrice > 0)) return null;

  let peak = valid[0], trough = valid[0];
  for (const c of valid) {
    if (c.high > peak.high) peak = c;
    if (c.low < trough.low) trough = c;
  }

  const realizedRoiPct = ((exitPrice / entryPrice) - 1) * 100;
  const mfePct = ((peak.high / entryPrice) - 1) * 100;
  const maePct = ((trough.low / entryPrice) - 1) * 100;
  const profitCapturePct = mfePct > 0 ? Math.max(0, realizedRoiPct) / mfePct * 100 : null;
  const missedUpsidePctPoints = mfePct - realizedRoiPct;

  let underwaterSeconds = 0;
  for (let i=0;i<valid.length-1;i++) {
    if (valid[i].close < entryPrice) underwaterSeconds += Math.max(0, valid[i+1].time-valid[i].time);
  }

  return {
    realizedRoiPct,
    mfePct,
    maePct,
    profitCapturePct,
    missedUpsidePctPoints,
    peakTime: peak.time,
    peakPrice: peak.high,
    troughTime: trough.time,
    troughPrice: trough.low,
    timeToPeakSeconds: Math.max(0, peak.time-entryTime),
    timeUnderwaterSeconds: underwaterSeconds,
    holdSeconds: Math.max(0, exitTime-entryTime),
    candles: valid
  };
}
