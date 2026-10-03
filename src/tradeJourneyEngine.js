import { buildAccountingEvents } from "./positionEngine.js";
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
export function buildTradeJourneys(trades, transfers = [], rewards = []) {
  const byMint = new Map();
  for (const event of buildAccountingEvents(trades, transfers, rewards)) {
    const mint = event.data.tokenMint || event.data.mint || event.data.quoteMint;
    if (!byMint.has(mint)) byMint.set(mint, []);
    byMint.get(mint).push(event);
  }
  const out = [];
  for (const [mint, events] of byMint) {
    let j = null;
    const lots = [];
    for (const event of events) {
      const e = {...event.data, blockTime: time(event.data.blockTime)};
      const buy = event.kind === 'TRADE' && e.type === 'BUY';
      const sell = event.kind === 'TRADE' && e.type === 'SELL';
      const inflow = event.kind === 'REWARD' || (event.kind === 'TRANSFER' && e.direction === 'IN');
      const qty = Number(event.kind === 'TRADE' ? e.tokenAmount : e.amount);
      if (!(qty > 0) || !Number.isFinite(qty)) continue;
      if (inflow) { lots.push({tokens: qty, cost: null, time: e.blockTime}); continue; }
      if (buy) {
        if (!j) j = {tokenMint: mint, events: [], tokensBought: 0, tokensSold: 0, costSol: 0, proceedsSol: 0, realizedCost: 0, realizedPnl: 0, holdingWeighted: 0, matchedTokens: 0, holdComplete: true, entryTime: e.blockTime, exitTime: null};
        j.events.push(e); j.tokensBought += qty; j.costSol += Number(e.solAmount);
        lots.push({tokens: qty, cost: Number(e.solAmount), time: e.blockTime});
        continue;
      }
      if (j) j.events.push(e);
      let remaining = qty, matched = 0, cost = 0, hold = 0;
      while (remaining > EPS && lots.length) {
        const lot = lots[0], take = Math.min(remaining, lot.tokens), ratio = take / lot.tokens;
        if (lot.cost !== null) {
          cost += lot.cost * ratio; matched += take;
          if (sell && j) {
            if (lot.time !== null && e.blockTime !== null && e.blockTime >= lot.time) hold += take * (e.blockTime - lot.time);
            else j.holdComplete = false;
          }
          lot.cost -= lot.cost * ratio;
        }
        lot.tokens -= take; remaining -= take;
        if (lot.tokens <= EPS) lots.shift();
      }
      if (!j) continue;
      if (sell) {
        const quote = Number(e.solAmount), proceedsMatched = quote * (matched / qty);
        j.tokensSold += qty; j.proceedsSol += quote;
        j.realizedCost += cost; j.realizedPnl += proceedsMatched - cost;
        j.holdingWeighted += hold; j.matchedTokens += matched;
      } else if (matched > EPS) {
        j.transferredOut = true;
      }
      if (lots.filter(lot => lot.cost !== null).reduce((sum, lot) => sum + lot.tokens, 0) <= EPS) {
        j.exitTime = e.blockTime;
        // A transfer is not a realized sale. Keep this lifecycle out of rankings.
        j.closed = sell && !j.transferredOut;
        finalize(j, out); j = null;
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
