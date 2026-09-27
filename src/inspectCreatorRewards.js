import { getTransaction } from "./helius.js";
import { parseTransaction } from "./parser.js";

const signature = process.argv[2];
const wallet = process.argv[3];

if (!signature || !wallet) {
  console.error("Usage: npm run inspect:rewards -- <signature> <wallet>");
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
  type: parsed?.type || null,
  reason: parsed?.reason || null,
  rewards: parsed?.rewards || []
}, null, 2));