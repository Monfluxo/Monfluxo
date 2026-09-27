import { getTransaction } from "./helius.js";
import { parseTransaction } from "./parser.js";
import { getWalletTradePage, upsertTrades } from "./db.js";

function normalizedTrade(wallet, trade) {
  return {
    wallet_address: wallet,
    signature: trade.signature,
    block_time:
      typeof trade.blockTime === "number"
        ? new Date(trade.blockTime * 1000).toISOString()
        : null,
    type: trade.type,
    token_mint: trade.tokenMint,
    token_amount: trade.tokenAmount,
    sol_amount: trade.solAmount,
    estimated_price_sol: trade.estimatedPriceSol ?? null,
    fee_sol: trade.feeSol ?? null,
    dex: trade.dex ?? null,
    parser: trade.parser ?? null
  };
}

const address = process.argv[2];

if (!address) {
  console.error(
    "Uso: npm run reparse:wallet -- <WALLET>"
  );
  process.exit(1);
}

const limit = 5;

console.log(`Reparsing ${address}`);
console.log(`Procesando ${limit} trades como prueba...`);

const rows = await getWalletTradePage(address, limit, 0);

if (!rows.length) {
  console.log("No hay trades almacenados.");
  process.exit(0);
}

const tradeRows = [];

for (const row of rows) {
  console.log(`\nProcesando ${row.signature}...`);

  try {
    const transaction = await getTransaction(row.signature);

    if (!transaction) {
      console.log("  Helius no devolvió la transacción.");
      continue;
    }

    const analysis = parseTransaction(transaction, address);

    if (
      analysis?.trade?.type === "BUY" ||
      analysis?.trade?.type === "SELL"
    ) {
      const normalized = normalizedTrade(address, analysis.trade);

      tradeRows.push(normalized);

      console.log(
        `  ${normalized.type} | ${normalized.token_mint} | ` +
        `parser=${normalized.parser} | dex=${normalized.dex ?? "NULL"}`
      );
    } else {
      console.log("  No se detectó trade.");
    }
  } catch (error) {
    console.error(`  Error: ${error.message}`);
  }
}

if (tradeRows.length) {
  await upsertTrades(tradeRows);
  console.log(`\nActualizados: ${tradeRows.length}`);
} else {
  console.log("\nNo hubo trades para actualizar.");
}

console.log("\nReparse de prueba terminado.");
