import { getTransaction } from "./helius.js";
import { parseTransaction } from "./parser.js";

const signature = process.argv[2];
const wallet = process.argv[3];

if (!signature || !wallet) {
  console.error("Usage: npm run inspect:events -- <signature> <wallet>");
  process.exit(1);
}

const tx = await getTransaction(signature);
if (!tx) {
  console.error("Transaction not found.");
  process.exit(1);
}

const parsed = parseTransaction(tx, wallet);
console.log(JSON.stringify({
  signature,
  type: parsed.type,
  reason: parsed.reason,
  trades: parsed.trades || [],
  transfers: parsed.transfers || [],
  rewards: parsed.rewards || [],
  tokenChanges: parsed.tokenChanges || [],
  solChange: parsed.solChange || null
}, null, 2));
