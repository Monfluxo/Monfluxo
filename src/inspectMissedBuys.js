import { getTransactionsForAddress } from "./helius.js";
import { parseSwapTransaction } from "./swapParser.js";
import { getTradeSamples } from "./db.js";

const WSOL_MINT = "So11111111111111111111111111111111111111112";
const TARGET_COUNT = 10;

let address = process.argv[2];
if (!address) {
  const samples = await getTradeSamples(1);
  address = samples[0]?.wallet_address || null;
}
if (!address) process.exit(1);

function signatureOf(tx) {
  return tx?.transaction?.signatures?.[0] || tx?.signature || null;
}
function keyValue(key) {
  return typeof key === "string" ? key : key?.pubkey || key?.address || null;
}
function tokenInflows(tx, wallet) {
  const pre = new Map();
  const post = new Map();
  for (const b of tx?.meta?.preTokenBalances || []) {
    if (b?.owner === wallet && b?.mint) pre.set(b.mint, (pre.get(b.mint) || 0n) + BigInt(b.uiTokenAmount?.amount || "0"));
  }
  for (const b of tx?.meta?.postTokenBalances || []) {
    if (b?.owner === wallet && b?.mint) post.set(b.mint, (post.get(b.mint) || 0n) + BigInt(b.uiTokenAmount?.amount || "0"));
  }
  const result = [];
  for (const mint of new Set([...pre.keys(), ...post.keys()])) {
    if (mint === WSOL_MINT) continue;
    const delta = (post.get(mint) || 0n) - (pre.get(mint) || 0n);
    if (delta > 0n) {
      const balances = [...(tx?.meta?.postTokenBalances || []), ...(tx?.meta?.preTokenBalances || [])];
      const decimals = balances.find(x => x?.owner === wallet && x?.mint === mint)?.uiTokenAmount?.decimals ?? 0;
      result.push({ mint, raw: delta.toString(), amount: Number(delta) / 10 ** decimals, decimals });
    }
  }
  return result;
}
function programIds(tx) {
  const keys = [
    ...(tx?.transaction?.message?.accountKeys || []),
    ...(tx?.meta?.loadedAddresses?.writable || []),
    ...(tx?.meta?.loadedAddresses?.readonly || [])
  ].map(keyValue);
  const ids = new Set();
  const add = ix => {
    const id = ix?.programId || ix?.program || keyValue(keys[ix?.programIdIndex]);
    if (id) ids.add(id);
  };
  (tx?.transaction?.message?.instructions || []).forEach(add);
  for (const group of tx?.meta?.innerInstructions || []) (group.instructions || []).forEach(add);
  return [...ids];
}
function instructionSummary(tx) {
  const out = [];
  const visit = (ix, where, index) => {
    const parsed = ix?.parsed;
    const info = parsed?.info;
    out.push({
      where, index,
      program: ix?.program || ix?.programId || null,
      programIdIndex: ix?.programIdIndex ?? null,
      type: parsed?.type || null,
      source: info?.source || null,
      destination: info?.destination || null,
      mint: info?.mint || info?.tokenAmount?.mint || null,
      amount: info?.amount || info?.tokenAmount?.amount || null,
      lamports: info?.lamports || null
    });
  };
  (tx?.transaction?.message?.instructions || []).forEach((ix, i) => visit(ix, "outer", i));
  for (const group of tx?.meta?.innerInstructions || []) {
    (group.instructions || []).forEach((ix, i) => visit(ix, "inner:" + group.index, i));
  }
  return out;
}

const rows = [];
let paginationToken = null;
let pages = 0;

while (pages < Number(process.env.MAX_DEEP_PAGES || 500) && rows.length < TARGET_COUNT) {
  pages++;
  const result = await getTransactionsForAddress(address, paginationToken);
  const txs = result?.data || [];
  if (!txs.length) break;

  for (const tx of txs) {
    const inflows = tokenInflows(tx, address);
    const parsed = parseSwapTransaction(tx, address);
    if (!inflows.length || parsed?.type === "BUY") continue;
    rows.push({ tx, inflows, parsed });
    if (rows.length >= TARGET_COUNT) break;
  }

  paginationToken = result?.paginationToken || null;
  if (!paginationToken) break;
}

console.log("Wallet: " + address);
console.log("Missed token-inflow candidates found: " + rows.length + " | Helius pages: " + pages);

for (const [i, row] of rows.entries()) {
  const tx = row.tx;
  console.log("\n=== CANDIDATE " + (i + 1) + " ===");
  console.log("signature=" + signatureOf(tx));
  console.log("blockTime=" + (tx?.blockTime ? new Date(tx.blockTime * 1000).toISOString() : "unknown"));
  console.log("inflows=" + JSON.stringify(row.inflows));
  console.log("parser=" + JSON.stringify(row.parsed));
  console.log("programIds=" + JSON.stringify(programIds(tx)));
  console.log("preBalances=" + JSON.stringify(tx?.meta?.preBalances || []));
  console.log("postBalances=" + JSON.stringify(tx?.meta?.postBalances || []));
  console.log("instructions=");
  console.log(JSON.stringify(instructionSummary(tx), null, 2));
}
console.log("\nDiagnóstico terminado — no modifica la DB.");
