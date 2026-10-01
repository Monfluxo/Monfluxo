import { getTransactionsForAddress } from "./helius.js";
import { parseTransaction } from "./parserV2.js";
import { parseNativeSolFunding } from "./fundingParser.js";
import { assertEventModelV2Schema, upsertFundingEvents } from "./db.js";

const address = process.argv[2];
if (!address) {
  console.error("Usage: npm run repair:funding -- <wallet>");
  process.exit(1);
}

const maxPages = Math.max(1, Number(process.env.REPAIR_FUNDING_MAX_PAGES || 500));

function isoFromBlockTime(blockTime) {
  return typeof blockTime === "number" ? new Date(blockTime * 1000).toISOString() : null;
}

function normalizedSolFunding(wallet, funding, slot = null) {
  return {
    wallet_address: wallet,
    signature: funding.signature,
    event_index: Number.isInteger(funding.eventIndex) ? funding.eventIndex : 999999,
    slot,
    block_time: isoFromBlockTime(funding.blockTime),
    asset_type: "SOL",
    asset_id: "SOL",
    amount: funding.amount,
    raw_amount: funding.rawAmount,
    decimals: 9,
    source_address: funding.sourceAddress ?? null,
    destination_address: funding.destinationAddress ?? wallet,
    source_token_account: null,
    destination_token_account: null,
    parser: funding.parser ?? "native_balance_delta"
  };
}

await assertEventModelV2Schema();
console.log(`[funding-repair] scanning ${address}`);

let paginationToken = null;
let pages = 0;
let transactions = 0;
let solFunding = 0;

while (pages < maxPages) {
  const result = await getTransactionsForAddress(address, paginationToken, {
    tokenAccounts: "none"
  });
  const rows = result?.data || [];
  if (!rows.length) break;
  pages++;
  transactions += rows.length;

  const fundingRows = [];
  for (const tx of rows) {
    const analysis = parseTransaction(tx, address);
    const events = parseNativeSolFunding(tx, address, {
      trades: analysis?.trades || [],
      rewards: analysis?.rewards || []
    });
    for (const event of events) {
      fundingRows.push(normalizedSolFunding(address, event, tx?.slot ?? null));
    }
  }

  await upsertFundingEvents(fundingRows);
  solFunding += fundingRows.length;
  console.log(`[funding-repair] page ${pages}: ${rows.length} tx, ${fundingRows.length} SOL inflow(s)`);

  paginationToken = result?.paginationToken || null;
  if (!paginationToken) break;
}

console.log(JSON.stringify({
  wallet: address,
  pages,
  transactions,
  nativeSolFundingEvents: solFunding,
  historyComplete: !paginationToken,
  truncated: Boolean(paginationToken)
}, null, 2));
