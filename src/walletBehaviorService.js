import { getWalletTradePage, getWalletTransferPage, getWalletRewardsPage } from "./db.js";
import { buildPositions, isLowConfidenceDustTrade } from "./positionEngine.js";
import { buildHoldBehavior } from "./holdIntelligence.js";

const PAGE_SIZE = 1000;
const MAX_ROWS = Number(process.env.MAX_DEEP_TRADE_ROWS || 500000);

function blockTime(value) {
  return value ? Math.floor(new Date(value).getTime() / 1000) : null;
}

function mapTrade(row) {
  return {
    signature: row.signature,
    slot: row.slot == null ? null : Number(row.slot),
    eventIndex: Number(row.event_index || 0),
    blockTime: blockTime(row.block_time),
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
    signature: row.signature,
    slot: row.slot == null ? null : Number(row.slot),
    eventIndex: Number(row.event_index || 0),
    blockTime: blockTime(row.block_time),
    direction: row.direction,
    mint: row.token_mint,
    amount: Number(row.token_amount),
    sourceAddress: row.source_address,
    destinationAddress: row.destination_address,
    parser: row.parser
  };
}

function mapReward(row) {
  return {
    signature: row.signature,
    slot: row.slot == null ? null : Number(row.slot),
    blockTime: blockTime(row.block_time),
    rewardType: row.reward_type,
    quoteMint: row.quote_mint,
    amount: Number(row.amount),
    creator: row.creator,
    instructionIndex: Number(row.instruction_index || 0)
  };
}

async function collect(fetchPage, mapper, filter = null) {
  const out = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const rows = await fetchPage(PAGE_SIZE, offset);
    if (!rows.length) break;
    for (const row of rows) {
      const item = mapper(row);
      if (!filter || filter(item)) out.push(item);
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

export async function buildWalletHoldBehavior(address) {
  const [trades, transfers, rewards] = await Promise.all([
    collect(
      (limit, offset) => getWalletTradePage(address, limit, offset),
      mapTrade,
      (trade) => !isLowConfidenceDustTrade(trade)
    ),
    collect((limit, offset) => getWalletTransferPage(address, limit, offset), mapTransfer),
    collect((limit, offset) => getWalletRewardsPage(address, limit, offset), mapReward)
  ]);

  const positions = buildPositions(trades, transfers, rewards);
  return buildHoldBehavior([...positions.values()]);
}
