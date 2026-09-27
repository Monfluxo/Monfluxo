import { getTransactionsForAddress } from "./helius.js";
import { parseSwapTransaction } from "./swapParser.js";
import { getWalletTradePage, getTradeSamples } from "./db.js";

const WSOL_MINT = "So11111111111111111111111111111111111111112";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJnbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPXxuEb";

let address = process.argv[2];
if (!address) {
  const samples = await getTradeSamples(1);
  address = samples[0]?.wallet_address || null;
  if (!address) process.exit(1);
}

function signatureOf(tx) {
  return tx?.transaction?.signatures?.[0] || tx?.signature || null;
}

function balanceKey(balance) {
  return `${balance?.accountIndex ?? balance?.account ?? "?"}:${balance?.mint || ""}`;
}

function tokenAmount(balance) {
  return Number(balance?.uiTokenAmount?.uiAmountString ?? balance?.uiTokenAmount?.uiAmount ?? 0);
}

function tokenDeltaForWallet(tx, mint, wallet) {
  const pre = new Map();
  const post = new Map();

  for (const balance of tx?.meta?.preTokenBalances || []) {
    if (balance?.owner === wallet && balance?.mint === mint) {
      pre.set(balanceKey(balance), tokenAmount(balance));
    }
  }

  for (const balance of tx?.meta?.postTokenBalances || []) {
    if (balance?.owner === wallet && balance?.mint === mint) {
      post.set(balanceKey(balance), tokenAmount(balance));
    }
  }

  const keys = new Set([...pre.keys(), ...post.keys()]);
  let delta = 0;
  for (const key of keys) delta += (post.get(key) || 0) - (pre.get(key) || 0);
  return delta;
}

function allProgramIds(tx) {
  const keys = [
    ...(tx?.transaction?.message?.accountKeys || []),
    ...(tx?.meta?.loadedAddresses?.writable || []),
    ...(tx?.meta?.loadedAddresses?.readonly || [])
  ];

  return [...new Set(keys.map((x) => typeof x === "string" ? x : x?.pubkey).filter(Boolean))];
}

function classifyPrograms(ids) {
  const known = [];
  if (ids.includes("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P")) known.push("Pump.fun");
  if (ids.includes("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA")) known.push("Pump AMM");
  if (ids.includes("675kPX9MHTjS2zt1qfr1NYHuZeLXfQM9H24yFSUt1Mp8")) known.push("Raydium");
  if (ids.includes("proVF4pMXVaYqmy4NjniPh4pqKNfMmsihgd4wdkCX3u") ||
      ids.includes("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4")) known.push("Jupiter");
  if (ids.includes(SYSTEM_PROGRAM)) known.push("System");
  if (ids.includes(TOKEN_PROGRAM)) known.push("SPL Token");
  if (ids.includes(TOKEN_2022_PROGRAM)) known.push("Token-2022");
  return known;
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
  .sort((a, b) => b.proceeds - a.proceeds);

const targets = new Map(affected.slice(0, 10).map(x => [x.mint, x]));
const firstSellByMint = new Map(
  [...targets].map(([mint, target]) => [
    mint,
    new Date(target.items[0].row.block_time || 0).getTime()
  ])
);

const found = new Map();
let paginationToken = null;
let pages = 0;
let scannedTransactions = 0;
let reachedAllTargets = false;

while (pages < Number(process.env.MAX_DEEP_PAGES || 500) && !reachedAllTargets) {
  pages++;
  const result = await getTransactionsForAddress(address, paginationToken);
  const txs = result?.data || [];
  if (!txs.length) break;

  for (const tx of txs) {
    scannedTransactions++;
    const blockTime = Number(tx?.blockTime || 0) * 1000;
    const signature = signatureOf(tx);
    if (!signature) continue;

    for (const [mint, target] of targets) {
      const firstSellTime = firstSellByMint.get(mint);
      if (blockTime > firstSellTime) continue;

      const delta = tokenDeltaForWallet(tx, mint, address);
      if (delta <= 0) continue;

      const swap = parseSwapTransaction(tx, address);
      const programs = classifyPrograms(allProgramIds(tx));

      if (!found.has(mint)) found.set(mint, []);
      found.get(mint).push({
        signature,
        blockTime: tx.blockTime,
        tokenDelta: delta,
        parserType: swap?.type || "OTHER",
        parserDex: swap?.dex || null,
        parserOutputMint: swap?.outputMint || null,
        parserOutputAmount: swap?.outputAmount || null,
        parserInputAmount: swap?.inputAmount || null,
        programs
      });
    }
  }

  const oldestTimes = [...targets].map(([mint]) => {
    const items = found.get(mint) || [];
    return items.length ? Math.min(...items.map(x => Number(x.blockTime || 0) * 1000)) : Infinity;
  });

  const earliestNeeded = Math.min(...firstSellByMint.values());
  const oldestTxTime = Math.max(...oldestTimes);
  if (oldestTxTime < earliestNeeded) reachedAllTargets = true;

  paginationToken = result?.paginationToken || null;
  if (!paginationToken) break;
}

console.log(`Wallet: ${address}`);
console.log(`Trades: ${rows.length} | Unmatched tokens: ${unmatched.reduce((s, x) => s + x.missing, 0)} | Unmatched proceeds: ${unmatched.reduce((s, x) => s + Number(x.row.sol_amount) * x.missing / Number(x.row.token_amount), 0).toFixed(4)} SOL`);
console.log(`Affected tokens: ${affected.length} | Top targets: ${targets.size} | Helius pages: ${pages} | Transactions scanned: ${scannedTransactions}`);

for (const [mint, target] of targets) {
  const matches = found.get(mint) || [];
  const first = target.items[0].row;

  console.log(`\n=== ${mint} ===`);
  console.log(`missing=${target.missing} | unmatchedSOL=${target.proceeds.toFixed(4)}`);
  console.log(`first unmatched SELL=${first.signature}`);
  console.log(`token inflows before first unmatched SELL: ${matches.length}`);

  if (!matches.length) {
    console.log("NO WALLET TOKEN INFLOW FOUND IN HELIUS HISTORY");
    continue;
  }

  for (const match of matches.slice(0, 15)) {
    const time = match.blockTime ? new Date(Number(match.blockTime) * 1000).toISOString() : "unknown";
    console.log(
      [
        `INFLOW ${time}`,
        `delta=${match.tokenDelta}`,
        `parser=${match.parserType}`,
        `dex=${match.parserDex || "-"}`,
        `parsedOut=${match.parserOutputAmount || "-"}`,
        `programs=${match.programs.join(",") || "-"}`,
        `sig=${match.signature}`
      ].join(" | ")
    );
  }
}

console.log("\nDiagnóstico terminado — no modifica la DB.");
