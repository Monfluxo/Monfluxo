import {
  getWalletTradePage,
  getWalletTransferPage,
  getWalletRewardsPage,
  getTradeSamples
} from "./db.js";
import { buildPositions } from "./positionEngine.js";

let address = process.argv[2];
if (!address) {
  const samples = await getTradeSamples(1);
  address = samples[0]?.wallet_address || null;
  if (!address) process.exit(1);
}

const PAGE_SIZE = 1000;
const MAX_ROWS = Number(process.env.DEBUG_MAX_ROWS || 500000);
const TOP = Number(process.env.DEBUG_TOP_UNMATCHED || 20);

function toSeconds(value) {
  return value ? Math.floor(new Date(value).getTime() / 1000) : null;
}

function mapTrade(row) {
  return {
    wallet: row.wallet_address,
    signature: row.signature,
    slot: row.slot == null ? null : Number(row.slot),
    eventIndex: Number(row.event_index || 0),
    instructionIndex: row.instruction_index == null ? null : Number(row.instruction_index),
    blockTime: toSeconds(row.block_time),
    type: row.type,
    tokenMint: row.token_mint,
    tokenAmount: Number(row.token_amount),
    solAmount: Number(row.sol_amount),
    estimatedPriceSol: row.estimated_price_sol == null ? null : Number(row.estimated_price_sol),
    feeSol: row.fee_sol == null ? null : Number(row.fee_sol),
    dex: row.dex,
    parser: row.parser
  };
}

function mapTransfer(row) {
  return {
    wallet: row.wallet_address,
    signature: row.signature,
    slot: row.slot == null ? null : Number(row.slot),
    eventIndex: Number(row.event_index || 0),
    instructionIndex: row.instruction_index == null ? null : Number(row.instruction_index),
    blockTime: toSeconds(row.block_time),
    direction: row.direction,
    mint: row.token_mint,
    amount: Number(row.token_amount),
    rawAmount: row.raw_amount,
    decimals: Number(row.decimals || 0),
    sourceAddress: row.source_address,
    destinationAddress: row.destination_address,
    parser: row.parser
  };
}

function mapReward(row) {
  return {
    wallet: row.wallet_address,
    signature: row.signature,
    slot: row.slot == null ? null : Number(row.slot),
    blockTime: toSeconds(row.block_time),
    rewardType: row.reward_type,
    quoteMint: row.quote_mint,
    amount: Number(row.amount),
    decimals: Number(row.decimals || 0),
    creator: row.creator,
    instructionIndex: Number(row.instruction_index || 0)
  };
}

async function loadAll(getPage, mapper) {
  const rows = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const page = await getPage(address, PAGE_SIZE, offset);
    if (!page.length) break;
    rows.push(...page.map(mapper));
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

const [trades, transfers, rewards] = await Promise.all([
  loadAll(getWalletTradePage, mapTrade),
  loadAll(getWalletTransferPage, mapTransfer),
  loadAll(getWalletRewardsPage, mapReward)
]);

const positions = buildPositions(trades, transfers, rewards);
const affected = [...positions.values()]
  .filter((p) => Number(p.unmatchedSoldTokens || 0) > 1e-9)
  .map((p) => ({
    mint: p.mint,
    unmatchedSoldTokens: Number(p.unmatchedSoldTokens || 0),
    unmatchedSellProceedsSol: Number(p.unmatchedSellProceedsSol || 0),
    unknownCostSoldTokens: Number(p.unknownCostSoldTokens || 0),
    unknownCostSellProceedsSol: Number(p.unknownCostSellProceedsSol || 0),
    buys: p.buys,
    sells: p.sells,
    transferIns: p.transferIns,
    transferOuts: p.transferOuts,
    rewardIns: p.rewardIns,
    pnlComplete: p.pnlComplete
  }))
  .sort((a, b) => b.unmatchedSellProceedsSol - a.unmatchedSellProceedsSol);

const totalUnmatchedTokens = affected.reduce((s, x) => s + x.unmatchedSoldTokens, 0);
const totalUnmatchedSol = affected.reduce((s, x) => s + x.unmatchedSellProceedsSol, 0);

console.log(`Wallet: ${address}`);
console.log(
  `Trades=${trades.length} Transfers=${transfers.length} Rewards=${rewards.length} ` +
  `Positions=${positions.size}`
);
console.log(
  `Unmatched positions=${affected.length} | ` +
  `Unmatched tokens=${totalUnmatchedTokens} | ` +
  `Unmatched proceeds=${totalUnmatchedSol.toFixed(6)} SOL`
);

for (const item of affected.slice(0, TOP)) {
  console.log("\n---");
  console.log(`mint=${item.mint}`);
  console.log(`unmatchedTokens=${item.unmatchedSoldTokens}`);
  console.log(`unmatchedSOL=${item.unmatchedSellProceedsSol.toFixed(6)}`);
  console.log(
    `buys=${item.buys} sells=${item.sells} ` +
    `transferIns=${item.transferIns} transferOuts=${item.transferOuts} ` +
    `rewardIns=${item.rewardIns}`
  );
  console.log(
    `unknownCostSoldTokens=${item.unknownCostSoldTokens} ` +
    `unknownCostSellProceedsSOL=${item.unknownCostSellProceedsSol.toFixed(6)} ` +
    `pnlComplete=${item.pnlComplete}`
  );
}

console.log("\nDiagnóstico terminado — usa exactamente buildPositions() y no modifica la DB.");
