import { requestWalletDashboard } from "./walletProductService.js";
import { getWalletTradePage, getWalletTransferPage, getWalletRewardsPage } from "./db.js";
import { buildPositions, isLowConfidenceDustTrade } from "./positionEngine.js";
import { buildHoldBehavior } from "./holdIntelligence.js";
import { buildWalletIntelligenceSummary } from "./intelligenceSummary.js";

function mapTrade(row) {
  return {
    wallet: row.wallet_address,
    signature: row.signature,
    slot: row.slot == null ? null : Number(row.slot),
    eventIndex: Number(row.event_index || 0),
    blockTime: row.block_time ? Math.floor(new Date(row.block_time).getTime() / 1000) : null,
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
    blockTime: row.block_time ? Math.floor(new Date(row.block_time).getTime() / 1000) : null,
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
    wallet: row.wallet_address,
    signature: row.signature,
    slot: row.slot == null ? null : Number(row.slot),
    blockTime: row.block_time ? Math.floor(new Date(row.block_time).getTime() / 1000) : null,
    rewardType: row.reward_type,
    quoteMint: row.quote_mint,
    amount: Number(row.amount),
    creator: row.creator,
    instructionIndex: Number(row.instruction_index)
  };
}

async function readAll(pageFn, address, mapper, maxRows) {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const page = await pageFn(address, pageSize, offset);
    if (!page.length) break;
    rows.push(...page.map(mapper));
    if (page.length < pageSize) break;
  }
  return rows;
}

async function buildBehavioralIntelligence(address, historyComplete) {
  const maxRows = Number(process.env.MAX_DEEP_TRADE_ROWS || 500000);
  const [tradesRaw, transfers, rewards] = await Promise.all([
    readAll(getWalletTradePage, address, mapTrade, maxRows),
    readAll(getWalletTransferPage, address, mapTransfer, maxRows),
    readAll(getWalletRewardsPage, address, mapReward, maxRows)
  ]);
  const trades = tradesRaw.filter((trade) => !isLowConfidenceDustTrade(trade));
  const positions = [...buildPositions(trades, transfers, rewards).values()];
  const holdBehavior = buildHoldBehavior(positions);
  const providerReady = Boolean(process.env.BIRDEYE_API_KEY);
  const summary = buildWalletIntelligenceSummary(positions, holdBehavior, { historyComplete });

  return {
    holdBehavior: {
      ...holdBehavior,
      status: historyComplete ? "ready" : "provisional",
      marketJourney: {
        status: providerReady ? "provider_ready" : "provider_pending",
        provider: "birdeye"
      }
    },
    intelligence: {
      ...summary,
      marketIntelligence: {
        status: providerReady ? "provider_configured" : "provider_pending",
        provider: "birdeye",
        features: ["TRADE_JOURNEY", "MFE_MAE", "MISSED_MILLIONS", "DIAMOND_HANDS", "ELITE_EXITS"]
      }
    }
  };
}

export async function requestWalletDashboardWithIntelligence(address, options = {}) {
  const dashboard = await requestWalletDashboard(address, options);
  try {
    const extra = await buildBehavioralIntelligence(address, dashboard?.coverage?.historyComplete === true);
    dashboard.behavior = extra.holdBehavior;
    dashboard.intelligence = extra.intelligence;
  } catch (error) {
    console.warn(`Unable to build behavioral intelligence for ${address}: ${error.message}`);
    dashboard.behavior = {
      methodology: "purchased_inventory_closed_tokens_v2",
      status: "unavailable",
      sampleSize: 0,
      marketJourney: {
        status: process.env.BIRDEYE_API_KEY ? "provider_ready" : "provider_pending",
        provider: "birdeye"
      }
    };
    dashboard.intelligence = {
      methodology: "explainable_behavior_summary_v1",
      confidence: "unavailable",
      strengths: [],
      weaknesses: [],
      observations: ["Behavioral intelligence is temporarily unavailable."],
      risk: {},
      marketIntelligence: {
        status: process.env.BIRDEYE_API_KEY ? "provider_configured" : "provider_pending",
        provider: "birdeye"
      }
    };
  }
  return dashboard;
}
