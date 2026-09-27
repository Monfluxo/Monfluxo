import { getTransaction } from "./helius.js";
import { parseSwapTransaction } from "./swapParser.js";
import { getWalletTradePage, getTradeSamples } from "./db.js";

let address = process.argv[2];
const pageSize = 1000;

if (!address) {
  const samples = await getTradeSamples(1);
  address = samples[0]?.wallet_address || null;
  if (!address) {
    console.error("No hay ninguna wallet con trades en Supabase.");
    process.exit(1);
  }
  console.log(`Wallet seleccionada automáticamente desde Supabase: ${address}`);
}

const rows = [];
for (let offset = 0; offset < 500000; offset += pageSize) {
  const page = await getWalletTradePage(address, pageSize, offset);
  if (!page.length) break;
  rows.push(...page);
  if (page.length < pageSize) break;
}

rows.sort((a, b) => {
  const ta = a.block_time ? new Date(a.block_time).getTime() : 0;
  const tb = b.block_time ? new Date(b.block_time).getTime() : 0;
  return ta - tb;
});

const inventory = new Map();
const unmatched = [];

for (const row of rows) {
  const mint = row.token_mint;
  const amount = Number(row.token_amount);
  if (!mint || !Number.isFinite(amount) || amount <= 0) continue;

  const available = inventory.get(mint) || 0;

  if (row.type === "BUY") {
    inventory.set(mint, available + amount);
    continue;
  }

  if (row.type === "SELL") {
    const matched = Math.min(available, amount);
    const missing = amount - matched;

    inventory.set(mint, Math.max(0, available - amount));

    if (missing > 0) {
      unmatched.push({
        row,
        missing,
        availableBeforeSell: available
      });
    }
  }
}

const byMint = new Map();
for (const item of unmatched) {
  const mint = item.row.token_mint;
  if (!byMint.has(mint)) byMint.set(mint, []);
  byMint.get(mint).push(item);
}

console.log(`Trades analizados: ${rows.length}`);
console.log(`SELLs con inventario insuficiente: ${unmatched.length}`);
console.log(`Tokens afectados: ${byMint.size}`);
console.log("");

const affected = [...byMint.entries()]
  .map(([mint, items]) => ({
    mint,
    missing: items.reduce((sum, item) => sum + item.missing, 0),
    proceeds: items.reduce((sum, item) => {
      const amount = Number(item.row.token_amount);
      const sol = Number(item.row.sol_amount);
      return sum + (amount > 0 ? sol * (item.missing / amount) : 0);
    }, 0),
    sells: items.length
  }))
  .sort((a, b) => b.proceeds - a.proceeds);

for (const item of affected.slice(0, 20)) {
  console.log("========================================");
  console.log(`MINT: ${item.mint}`);
  console.log(`missingTokens: ${item.missing}`);
  console.log(`estimatedUnmatchedProceedsSol: ${item.proceeds}`);
  console.log(`unmatchedSELLs: ${item.sells}`);

  const tokenRows = rows
    .filter((row) => row.token_mint === item.mint)
    .slice(-20);

  console.log("Últimas operaciones registradas:");
  for (const row of tokenRows) {
    console.log(
      `${row.block_time || "NO_TIME"} | ${row.type} | tokens=${row.token_amount} | SOL=${row.sol_amount} | dex=${row.dex || "NULL"} | parser=${row.parser} | sig=${row.signature}`
    );
  }

  for (const unmatchedItem of byMint.get(item.mint).slice(0, 3)) {
    const row = unmatchedItem.row;
    try {
      const tx = await getTransaction(row.signature);
      const swap = parseSwapTransaction(tx, address);
      console.log("");
      console.log(`SELL sin BUY suficiente: ${row.signature}`);
      console.log(
        `stored=${row.type} | ${row.token_mint} | dex=${row.dex || "NULL"} | missing=${unmatchedItem.missing}`
      );
      console.log(
        `reparse=${swap ? `${swap.type} | ${swap.inputMint} -> ${swap.outputMint} | dex=${swap.dex}` : "NULL"}`
      );
    } catch (error) {
      console.log(`ERROR fetching ${row.signature}: ${error.message}`);
    }
  }
}

console.log("");
console.log("DIAGNOSTICO TERMINADO — no se modifica la DB.");
