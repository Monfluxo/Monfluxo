import { getWalletTradePage } from "../src/db.js";
import { buildTradeJourneys } from "../src/tradeJourneyEngine.js";
import { persistTradeJourneys } from "../src/dataTradesService.js";

const BASE = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MIN_COST = Number(process.env.MIN_RANKED_TRADE_COST_SOL || 0.005);

if (!BASE || !KEY) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");

async function rest(path) {
  const response = await fetch(`${BASE}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}

async function loadTrades(wallet) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await getWalletTradePage(wallet, 1000, offset);
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows.map((t) => ({
    wallet: t.wallet_address,
    signature: t.signature,
    slot: t.slot == null ? null : Number(t.slot),
    eventIndex: Number(t.event_index || 0),
    blockTime: t.block_time ? Math.floor(new Date(t.block_time).getTime() / 1000) : null,
    type: t.type,
    tokenMint: t.token_mint,
    tokenAmount: Number(t.token_amount),
    solAmount: Number(t.sol_amount),
    estimatedPriceSol: t.estimated_price_sol == null ? null : Number(t.estimated_price_sol),
    feeSol: t.fee_sol == null ? null : Number(t.fee_sol),
    dex: t.dex,
    parser: t.parser,
  }));
}

const states = await rest("wallet_sync_state?select=wallet_address&history_complete=eq.true&order=wallet_address.asc");
let walletsDone = 0;
let journeysWritten = 0;
let failures = 0;

console.log(`[journey-backfill] starting complete_wallets=${states.length} min_cost=${MIN_COST}`);
for (const { wallet_address: wallet } of states) {
  try {
    const trades = await loadTrades(wallet);
    const journeys = buildTradeJourneys(trades).filter(
      (j) => j.closed && j.realizedCost >= MIN_COST && Number.isFinite(j.pnlPct) && Number.isFinite(j.realizedPnl)
    );
    const saved = await persistTradeJourneys(wallet, journeys);
    walletsDone += 1;
    journeysWritten += saved;
    console.log(`[journey-backfill] ok wallet=${wallet} trades=${trades.length} journeys=${saved}`);
  } catch (error) {
    failures += 1;
    console.error(`[journey-backfill] failed wallet=${wallet} error=${error?.message || error}`);
  }
}

const countRows = await rest("wallet_trade_journeys?select=wallet_address,journey_id");
console.log(`[journey-backfill] done wallets=${walletsDone}/${states.length} failures=${failures} written=${journeysWritten} table_rows=${countRows.length}`);
if (failures) process.exitCode = 1;
