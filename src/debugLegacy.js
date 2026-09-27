import { getTransaction } from "./helius.js";
import { parseTransaction } from "./parser.js";
import { parseSwapTransaction } from "./swapParser.js";
import { getWalletTradePage, getTradeSamples } from "./db.js";

let address = process.argv[2];
const limit = Number(process.argv[3] || 396);
const samples = Number(process.argv[4] || 12);

if (!address) {
  const samples = await getTradeSamples(10);
  console.log(`Trades visibles en Supabase: ${samples.length}`);
  for (const row of samples) {
    console.log(`${row.wallet_address} | ${row.type} | ${row.parser} | ${row.signature}`);
  }
  address = samples[0]?.wallet_address || null;
  if (!address) {
    console.log("No hay trades visibles en Supabase.");
    process.exit(0);
  }
  console.log(`\nUsando automáticamente la wallet del primer registro: ${address}`);
}

const rows = await getWalletTradePage(address, limit, 0);
const legacyRows = rows.filter((row) => row.parser === "legacy_balance");

console.log(`Trades: ${rows.length} | legacy_balance: ${legacyRows.length}`);
console.log(`Inspeccionando ${Math.min(samples, legacyRows.length)} ejemplos...\n`);

function keyValue(key) {
  return typeof key === "string" ? key : key?.pubkey || key?.address || null;
}

function programIds(tx) {
  const keys = [
    ...(tx?.transaction?.message?.accountKeys || []),
    ...(tx?.meta?.loadedAddresses?.writable || []),
    ...(tx?.meta?.loadedAddresses?.readonly || [])
  ];

  const ids = new Set();

  const add = (ix) => {
    const id =
      ix?.programId ||
      ix?.program ||
      keyValue(keys[ix?.programIdIndex]);
    if (id) ids.add(id);
  };

  for (const ix of tx?.transaction?.message?.instructions || []) add(ix);
  for (const group of tx?.meta?.innerInstructions || []) {
    for (const ix of group.instructions || []) add(ix);
  }

  return [...ids];
}

function tokenSummary(tx, wallet) {
  const mints = new Map();
  for (const item of [
    ...(tx?.meta?.preTokenBalances || []),
    ...(tx?.meta?.postTokenBalances || [])
  ]) {
    if (item?.owner !== wallet || !item?.mint) continue;
    if (!mints.has(item.mint)) mints.set(item.mint, { pre: 0n, post: 0n, decimals: item.uiTokenAmount?.decimals ?? 0 });
  }

  for (const item of tx?.meta?.preTokenBalances || []) {
    if (item?.owner === wallet && mints.has(item.mint)) {
      mints.get(item.mint).pre += BigInt(item.uiTokenAmount?.amount || "0");
    }
  }

  for (const item of tx?.meta?.postTokenBalances || []) {
    if (item?.owner === wallet && mints.has(item.mint)) {
      mints.get(item.mint).post += BigInt(item.uiTokenAmount?.amount || "0");
    }
  }

  return [...mints.entries()]
    .map(([mint, x]) => ({ mint, delta: (x.post - x.pre).toString(), decimals: x.decimals }))
    .filter((x) => x.delta !== "0");
}

for (const row of legacyRows.slice(0, samples)) {
  try {
    const tx = await getTransaction(row.signature);
    const analysis = parseTransaction(tx, address);
    const swap = parseSwapTransaction(tx, address);
    const allKeys = [
      ...(tx?.transaction?.message?.accountKeys || []),
      ...(tx?.meta?.loadedAddresses?.writable || []),
      ...(tx?.meta?.loadedAddresses?.readonly || [])
    ];
    const walletIndex = allKeys.findIndex((k) => keyValue(k) === address);
    const walletTokenBalances = [
      ...(tx?.meta?.preTokenBalances || []),
      ...(tx?.meta?.postTokenBalances || [])
    ].filter((x) => x.owner === address);
    const programs = programIds(tx);
    const tokens = tokenSummary(tx, address);

    const keys = [
      ...(tx?.transaction?.message?.accountKeys || []),
      ...(tx?.meta?.loadedAddresses?.writable || []),
      ...(tx?.meta?.loadedAddresses?.readonly || [])
    ];

    const walletIndex = keys.findIndex((k) => keyValue(k) === address);
    const preSol = walletIndex >= 0 ? tx?.meta?.preBalances?.[walletIndex] : null;
    const postSol = walletIndex >= 0 ? tx?.meta?.postBalances?.[walletIndex] : null;
    const solDelta = preSol != null && postSol != null ? Number(postSol - preSol) / 1e9 : null;

    console.log("========================================");
    console.log(row.signature);
    console.log(`stored: ${row.type} | ${row.token_mint} | ${row.dex || "NULL"}`);
    console.log(`reparse: ${analysis?.trade ? `${analysis.trade.type} | ${analysis.trade.tokenMint} | ${analysis.trade.parser} | ${analysis.trade.dex || "NULL"}` : "NO TRADE"}`);
    console.log(`swapParser: ${swap ? `${swap.type} | ${swap.inputMint} -> ${swap.outputMint} | ${swap.dex}` : "NULL"} | walletIndex=${walletIndex} | walletTokenBalances=${walletTokenBalances.length}`);
    console.log(`SOL delta: ${solDelta}`);
    console.log("wallet token deltas:", JSON.stringify(tokens));
    console.log("programs:", programs.join(", "));
  } catch (error) {
    console.log("ERROR:", row.signature, error.message);
  }
}

console.log("\nDIAGNOSTICO TERMINADO — no se modifica la DB.");
