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
}

const rows = [];
for (let offset = 0; offset < 500000; offset += pageSize) {
  const page = await getWalletTradePage(address, pageSize, offset);
  if (!page.length) break;
  rows.push(...page);
  if (page.length < pageSize) break;
}

rows.sort((a, b) => new Date(a.block_time || 0) - new Date(b.block_time || 0));

const inventory = new Map();
const unmatched = [];

for (const row of rows) {
  const mint = row.token_mint;
  const amount = Number(row.token_amount);
  if (!mint || !Number.isFinite(amount) || amount <= 0) continue;

  const available = inventory.get(mint) || 0;

  if (row.type === "BUY") {
    inventory.set(mint, available + amount);
  } else if (row.type === "SELL") {
    const matched = Math.min(available, amount);
    const missing = amount - matched;
    inventory.set(mint, Math.max(0, available - amount));
    if (missing > 0) unmatched.push({ row, missing });
  }
}

const byMint = new Map();
for (const item of unmatched) {
  if (!byMint.has(item.row.token_mint)) byMint.set(item.row.token_mint, []);
  byMint.get(item.row.token_mint).push(item);
}

const affected = [...byMint.entries()]
  .map(([mint, items]) => ({
    mint,
    items,
    missing: items.reduce((s, x) => s + x.missing, 0),
    proceeds: items.reduce((s, x) => {
      const amount = Number(x.row.token_amount);
      return s + (amount > 0 ? Number(x.row.sol_amount) * x.missing / amount : 0);
    }, 0)
  }))
  .sort((a, b) => b.proceeds - a.proceeds)
  .slice(0, 10);

console.log(`Trades: ${rows.length} | Tokens afectados: ${byMint.size}`);

for (const item of affected) {
  const first = item.items[0].row;
  const tx = await getTransaction(first.signature);
  const swap = parseSwapTransaction(tx, address);

  const previous = rows
    .filter((r) =>
      r.token_mint === item.mint &&
      new Date(r.block_time || 0) < new Date(first.block_time || 0)
    )
    .slice(-1)[0];

  let previousParse = null;
  if (previous) {
    const previousTx = await getTransaction(previous.signature);
    const previousSwap = parseSwapTransaction(previousTx, address);
    previousParse = previousSwap
      ? `${previousSwap.type}/${previousSwap.dex}`
      : "NULL";
  }

  console.log(
    `\n${item.mint} | missing=${item.missing} | unmatchedSOL=${item.proceeds.toFixed(4)}`
  );
  console.log(
    `first unmatched SELL: ${first.signature} | stored=${first.dex || "NULL"} | reparse=${swap ? swap.type + "/" + swap.dex : "NULL"}`
  );
  console.log(
    `previous recorded trade: ${previous ? previous.type + "/" + (previous.dex || "NULL") : "NONE"} | reparse=${previousParse || "NONE"}`
  );
}

console.log("\nDiagnóstico terminado — no modifica la DB.");
