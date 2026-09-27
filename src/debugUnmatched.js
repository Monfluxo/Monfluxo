import { getTransaction, getTransactionsForAddress } from "./helius.js";
import { parseSwapTransaction } from "./swapParser.js";
import { getWalletTradePage, getTradeSamples } from "./db.js";

let address = process.argv[2];
if (!address) {
  const samples = await getTradeSamples(1);
  address = samples[0]?.wallet_address || null;
  if (!address) process.exit(1);
}

const rows = [];
for (let offset = 0; offset < 500000; offset += 1000) {
  const page = await getWalletTradePage(address, 1000, offset);
  if (!page.length) break;
  rows.push(...page);
  if (page.length < 1000) break;
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
    const missing = amount - Math.min(available, amount);
    inventory.set(mint, Math.max(0, available - amount));
    if (missing > 0) unmatched.push({ row, missing });
  }
}

const affected = [...unmatched.reduce((map, item) => {
  const mint = item.row.token_mint;
  if (!map.has(mint)) map.set(mint, []);
  map.get(mint).push(item);
  return map;
}, new Map()).entries()]
  .map(([mint, items]) => ({
    mint,
    items,
    missing: items.reduce((s, x) => s + x.missing, 0),
    proceeds: items.reduce((s, x) => {
      const a = Number(x.row.token_amount);
      return s + (a > 0 ? Number(x.row.sol_amount) * x.missing / a : 0);
    }, 0)
  }))
  .sort((a, b) => b.proceeds - a.proceeds)
  .slice(0, 3);

const targets = new Map(affected.map(x => [x.mint, x]));
const firstSellTime = Math.min(
  ...affected.map(x => new Date(x.items[0].row.block_time || 0).getTime())
);

let paginationToken = null;
let pages = 0;
const found = new Map();

while (pages < 50) {
  pages++;
  const result = await getTransactionsForAddress(address, paginationToken);
  const txs = result?.data || [];
  if (!txs.length) break;

  let reachedTargetWindow = false;

  for (const tx of txs) {
    const blockTime = Number(tx?.blockTime || 0) * 1000;

    for (const [mint, target] of targets) {
      if (blockTime > new Date(target.items[0].row.block_time || 0).getTime()) continue;

      const swap = parseSwapTransaction(tx, address);
      if (swap?.type === "BUY" && swap.outputMint === mint) {
        if (!found.has(mint)) found.set(mint, []);
        found.get(mint).push({
          signature: tx?.transaction?.signatures?.[0] || tx?.signature,
          blockTime: tx.blockTime,
          dex: swap.dex,
          amount: swap.outputAmount,
          sol: swap.inputAmount
        });
      }
    }

    if (blockTime && blockTime < firstSellTime) reachedTargetWindow = true;
  }

  if (reachedTargetWindow) break;
  paginationToken = result?.paginationToken || null;
  if (!paginationToken) break;
}

console.log(`Trades: ${rows.length} | Tokens afectados: ${targets.size} | Helius pages: ${pages}`);

for (const [mint, target] of targets) {
  const buys = found.get(mint) || [];
  const first = target.items[0].row;
  console.log(`\n${mint}`);
  console.log(`missing=${target.missing} | unmatchedSOL=${target.proceeds.toFixed(4)}`);
  console.log(`first unmatched SELL=${first.signature}`);
  console.log(
    buys.length
      ? `BUY encontrado: ${buys.map(x => `${x.dex}/${x.amount}/${x.sol}/${x.signature}`).join(" | ")}`
      : "BUY no encontrado en Helius history"
  );
}

console.log("\nDiagnóstico terminado — no modifica la DB.");
