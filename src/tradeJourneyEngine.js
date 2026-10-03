import {restoreOutboundLots} from "./transferReturnLots.js";
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
    let active = null;
    const lots = [], outbound = [], journeys = [];
    const addEvent = (j,e) => { if (!j.events.includes(e)) j.events.push(e); };
    for (const event of events) {
      const e = {...event.data, blockTime: time(event.data.blockTime)};
      const buy = event.kind === 'TRADE' && e.type === 'BUY';
      const sell = event.kind === 'TRADE' && e.type === 'SELL';
      const inflow = event.kind === 'REWARD' || (event.kind === 'TRANSFER' && e.direction === 'IN');
      const qty = Number(event.kind === 'TRADE' ? e.tokenAmount : e.amount);
      if (!(qty > 0) || !Number.isFinite(qty)) continue;
      if (event.kind === 'TRANSFER') e.type = `TRANSFER_${e.direction}`;
      if (inflow) {
        if (event.kind === 'TRANSFER') {
          const restored = restoreOutboundLots(outbound,qty,'cost');
          lots.push(...restored.lots);
          for (const lot of restored.lots) if (lot.journey) {
            addEvent(lot.journey,e);
            lot.journey.returnedTokens = (lot.journey.returnedTokens || 0) + lot.tokens;
            if (!active) active = lot.journey;
          }
          if (restored.remaining > EPS) lots.push({tokens:restored.remaining,cost:null,time:e.blockTime});
        } else lots.push({tokens:qty,cost:null,time:e.blockTime});
        continue;
      }
      if (buy) {
        if (!active) {
          active = {tokenMint:mint,events:[],tokensBought:0,tokensSold:0,costSol:0,proceedsSol:0,realizedCost:0,realizedPnl:0,holdingWeighted:0,matchedTokens:0,holdComplete:true,entryTime:e.blockTime,exitTime:null,outstanding:0};
          journeys.push(active);
        }
        addEvent(active,e);active.tokensBought += qty;active.outstanding += qty;active.costSol += Number(e.solAmount);
        lots.push({tokens:qty,cost:Number(e.solAmount),time:e.blockTime,journey:active});
        continue;
      }
      let remaining = qty;
      while (remaining > EPS && lots.length) {
        const lot = lots[0],take = Math.min(remaining,lot.tokens),cost = lot.cost === null ? null : lot.cost * take / lot.tokens;
        const j = lot.journey;
        if (j) addEvent(j,e);
        if (!sell) outbound.push({...lot,tokens:take,cost});
        if (cost !== null) {
          if (sell && j) {
            const quote = Number(e.solAmount)*take/qty;
            j.tokensSold += take;j.outstanding -= take;j.proceedsSol += quote;
            j.realizedCost += cost;j.realizedPnl += quote-cost;j.matchedTokens += take;
            if (lot.time !== null && e.blockTime !== null && e.blockTime >= lot.time) j.holdingWeighted += take*(e.blockTime-lot.time);
            else j.holdComplete = false;
            j.exitTime = e.blockTime;
          }
          lot.cost -= cost;
        }
        lot.tokens -= take;remaining -= take;
        if (lot.tokens <= EPS) lots.shift();
      }
      if (active && !lots.some(lot=>lot.journey === active && lot.tokens > EPS)) active = null;
    }
    for (const j of journeys) {
      j.closed = j.outstanding <= EPS && j.matchedTokens > EPS;
      j.transferredOut = outbound.some(lot=>lot.journey === j && lot.tokens > EPS);
      if (!j.closed) j.exitTime = null;
      delete j.outstanding;finalize(j,out);
    }
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
