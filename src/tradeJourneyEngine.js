const EPS = 1e-9;
const finite = v => ['number','string'].includes(typeof v) && !(typeof v === 'string' && !v.trim()) && Number.isFinite(Number(v));
const time = v => finite(v) && Number(v) >= 0 ? Number(v) : null;
export function holdLabel(sec) {
  if (!Number.isFinite(sec)) return null;
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)}h`;
  return `${(sec / 86400).toFixed(1)}d`;
}
function order(a, b) {
  // Slots remain chronological when blockTime is missing; do not coerce null to epoch.
  if (finite(a.slot) && finite(b.slot) && Number(a.slot) !== Number(b.slot)) return Number(a.slot) - Number(b.slot);
  const at = time(a.blockTime), bt = time(b.blockTime);
  if (at !== null && bt !== null && at !== bt) return at - bt;
  return (Number(a.eventIndex) || 0) - (Number(b.eventIndex) || 0) || String(a.signature || '').localeCompare(String(b.signature || ''));
}
export function buildTradeJourneys(trades) {
  const byMint = new Map();
  for (const t of trades || []) {
    if (!t?.tokenMint || !['BUY', 'SELL'].includes(t.type)) continue;
    if (!byMint.has(t.tokenMint)) byMint.set(t.tokenMint, []);
    byMint.get(t.tokenMint).push({...t, blockTime: time(t.blockTime)});
  }
  const out = [];
  for (const [mint, events] of byMint) {
    events.sort(order);
    let j = null;
    for (const e of events) {
      const qty = Number(e.tokenAmount), quote = Number(e.solAmount);
      if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(quote) || quote < 0) continue;
      if (e.type === 'BUY') {
        if (!j) j = {tokenMint: mint, events: [], lots: [], tokensBought: 0, tokensSold: 0, costSol: 0, proceedsSol: 0, realizedCost: 0, realizedPnl: 0, holdingWeighted: 0, matchedTokens: 0, holdComplete: true, entryTime: e.blockTime, exitTime: null};
        j.events.push(e); j.tokensBought += qty; j.costSol += quote;
        j.lots.push({tokens: qty, cost: quote, time: e.blockTime});
        continue;
      }
      if (!j) continue;
      j.events.push(e); j.tokensSold += qty; j.proceedsSol += quote;
      let remaining = qty, matched = 0, cost = 0, hold = 0;
      while (remaining > EPS && j.lots.length) {
        const lot = j.lots[0], take = Math.min(remaining, lot.tokens), ratio = take / lot.tokens;
        cost += lot.cost * ratio; matched += take;
        if (lot.time !== null && e.blockTime !== null && e.blockTime >= lot.time) hold += take * (e.blockTime - lot.time);
        else j.holdComplete = false;
        lot.cost -= lot.cost * ratio; lot.tokens -= take; remaining -= take;
        if (lot.tokens <= EPS) j.lots.shift();
      }
      const proceedsMatched = quote * (matched / qty);
      j.realizedCost += cost; j.realizedPnl += proceedsMatched - cost;
      j.holdingWeighted += hold; j.matchedTokens += matched;
      if (j.lots.reduce((sum, lot) => sum + lot.tokens, 0) <= EPS) {
        j.exitTime = e.blockTime; j.closed = true; finalize(j, out); j = null;
      }
    }
    if (j) { j.closed = false; finalize(j, out); }
  }
  return out;
}
function finalize(j, out) {
  j.pnlPct = j.realizedCost > 0 ? j.realizedPnl / j.realizedCost * 100 : null;
  j.holdSeconds = j.matchedTokens > 0 && j.holdComplete ? j.holdingWeighted / j.matchedTokens : null;
  j.hold = holdLabel(j.holdSeconds);
  j.legacyId = `${j.tokenMint}:${j.entryTime ?? 0}`;
  const entry = j.events[0];
  j.id = entry.signature ? `${j.tokenMint}:v2:${entry.signature}:${Number(entry.eventIndex) || 0}` : j.legacyId;
  delete j.lots; delete j.holdComplete;
  out.push(j);
}
