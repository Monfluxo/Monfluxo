import { getTransaction } from "./helius.js";
import { parseTransaction } from "./parser.js";
import { getWalletTradePage, getTradeSamples, upsertTrades } from "./db.js";

function normalizedTrade(wallet, trade) {
  return {
    wallet_address: wallet, signature: trade.signature,
    block_time: typeof trade.blockTime === "number" ? new Date(trade.blockTime * 1000).toISOString() : null,
    type: trade.type, token_mint: trade.tokenMint, token_amount: trade.tokenAmount,
    sol_amount: trade.solAmount, estimated_price_sol: trade.estimatedPriceSol ?? null,
    fee_sol: trade.feeSol ?? null, dex: trade.dex ?? null, parser: trade.parser ?? null
  };
}

function argNumber(index, fallback) { const n = Number(process.argv[index]); return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback; }
let address = process.argv[2];
if (!address) {
  const samples = await getTradeSamples(1);
  address = samples[0]?.wallet_address || null;
  if (!address) {
    console.error("No hay ninguna wallet con trades en Supabase.");
    process.exit(1);
  }
  console.log(`Wallet seleccionada automáticamente desde Supabase: ${address}`);
}
const limit = argNumber(3, 1000);
const offset = Math.max(0, argNumber(4, 1) - 1);
console.log(`Reparsing ${address}`);
console.log(`Procesando hasta ${limit} trades desde offset ${offset}...`);
const rows = await getWalletTradePage(address, limit, offset);
if (!rows.length) { console.log("No hay trades almacenados en ese rango."); process.exit(0); }

const tradeRows = [];
const summary = { total: rows.length, updated: 0, instruction_swap: 0, legacy_balance: 0, other_parser: 0, BUY: 0, SELL: 0, errors: 0, no_trade: 0 };
const dexCounts = new Map();

for (let index = 0; index < rows.length; index++) {
  const row = rows[index];
  console.log(`[${index + 1}/${rows.length}] ${row.signature}`);
  try {
    const transaction = await getTransaction(row.signature);
    if (!transaction) { console.log("  Helius no devolvió la transacción."); summary.errors++; continue; }
    const analysis = parseTransaction(transaction, address);
    if (analysis?.trade?.type !== "BUY" && analysis?.trade?.type !== "SELL") { console.log("  No se detectó BUY/SELL."); summary.no_trade++; continue; }
    const normalized = normalizedTrade(address, analysis.trade);
    tradeRows.push(normalized); summary.updated++; summary[normalized.type]++;
    if (normalized.parser === "instruction_swap") summary.instruction_swap++;
    else if (normalized.parser === "legacy_balance") summary.legacy_balance++;
    else summary.other_parser++;
    const dex = normalized.dex || "NULL"; dexCounts.set(dex, (dexCounts.get(dex) || 0) + 1);
    console.log(`  ${normalized.type} | parser=${normalized.parser} | dex=${dex}`);
  } catch (error) { summary.errors++; console.error(`  Error: ${error.message}`); }
}

if (tradeRows.length) await upsertTrades(tradeRows);
console.log(""); console.log("========================"); console.log("REPARSE SUMMARY"); console.log("========================");
console.log("Trades read:", summary.total); console.log("Trades updated:", summary.updated);
console.log("BUY:", summary.BUY); console.log("SELL:", summary.SELL);
console.log("instruction_swap:", summary.instruction_swap); console.log("legacy_balance:", summary.legacy_balance);
console.log("other parser:", summary.other_parser); console.log("No BUY/SELL:", summary.no_trade); console.log("Errors:", summary.errors);
console.log(""); console.log("DEX COUNTS");
for (const [dex, count] of [...dexCounts.entries()].sort((a, b) => b[1] - a[1])) console.log(`${dex}: ${count}`);
console.log(""); console.log("Reparse terminado. La DB solo se actualiza con trades que el parser actual vuelve a detectar.");