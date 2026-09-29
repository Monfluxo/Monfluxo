import { syncWalletHistory } from "./sync.js";
import {
  getWalletTradePage,
  getWalletTransferPage,
  getWalletRewardsPage,
  getTradeSamples,
  upsertAnalysisCache
} from "./db.js";
import { buildPositions, isLowConfidenceDustTrade } from "./positionEngine.js";

function mapTrade(row) {
  return {
    wallet: row.wallet_address,
    signature: row.signature,
    slot: row.slot == null ? null : Number(row.slot),
    eventIndex: Number(row.event_index || 0),
    instructionIndex: row.instruction_index == null ? null : Number(row.instruction_index),
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
    instructionIndex: row.instruction_index == null ? null : Number(row.instruction_index),
    blockTime: row.block_time ? Math.floor(new Date(row.block_time).getTime() / 1000) : null,
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
    blockTime: row.block_time ? Math.floor(new Date(row.block_time).getTime() / 1000) : null,
    rewardType: row.reward_type,
    quoteMint: row.quote_mint,
    amount: Number(row.amount),
    decimals: Number(row.decimals || 0),
    creator: row.creator,
    instructionIndex: Number(row.instruction_index)
  };
}

function round(value, decimals = 6) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function summarizePosition(position) {
  return {
    tokenMint: position.mint,
    trades: position.tradeCount,
    buys: position.buys,
    sells: position.sells,
    transferIns: position.transferIns,
    transferOuts: position.transferOuts,
    rewardIns: position.rewardIns,
    rewardCount: position.rewardCount,
    tokensBought: position.tokensBought,
    tokensSold: position.tokensSold,
    tokensTransferredIn: position.tokensTransferredIn,
    tokensTransferredOut: position.tokensTransferredOut,
    tokensRewarded: position.tokensRewarded,
    tokensRemaining: position.tokensRemaining,
    knownCostRemainingTokens: position.knownCostRemainingTokens,
    unknownCostRemainingTokens: position.unknownCostRemainingTokens,
    solSpent: round(position.solSpent),
    solReceived: round(position.solReceived),
    realizedPnlSol: round(position.realizedPnl),
    realizedRoi: position.realizedRoi == null ? null : round(position.realizedRoi * 100, 2),
    unrealizedPnlSol: round(position.unrealizedPnl),
    totalPnlSol: round(position.totalPnl),
    unknownCostSoldTokens: round(position.unknownCostSoldTokens || 0),
    unknownCostSellProceedsSol: round(position.unknownCostSellProceedsSol || 0),
    unmatchedSoldTokens: round(position.unmatchedSoldTokens || 0),
    unmatchedSellProceedsSol: round(position.unmatchedSellProceedsSol || 0),
    unmatchedTransferredOutTokens: round(position.unmatchedTransferredOutTokens || 0),
    pnlComplete: position.pnlComplete,
    open: position.open,
    avgHoldingSeconds: round(position.avgHoldingSeconds, 1),
    lastPriceSol: round(position.lastPriceSol, 12)
  };
}

function eventOrder(a, b, indexField) {
  const time = (a.blockTime ?? 0) - (b.blockTime ?? 0);
  if (time !== 0) return time;
  if (a.slot != null && b.slot != null && a.slot !== b.slot) return a.slot - b.slot;
  const index = Number(a[indexField] || 0) - Number(b[indexField] || 0);
  if (index !== 0) return index;
  return String(a.signature || "").localeCompare(String(b.signature || ""));
}

export async function analyzeWallet(address, options = {}) {
  const mode = options.mode || "quick";
  const sync = await syncWalletHistory(address, { mode });
  const pageSize = 1000;
  const maxRows = mode === "quick"
    ? Number(process.env.MAX_QUICK_TRADE_ROWS || 5000)
    : Number(process.env.MAX_DEEP_TRADE_ROWS || 500000);

  const trades = [];
  const transfers = [];
  const rewards = [];
  let lowConfidenceTradesExcluded = 0;
  let lowConfidenceVolumeSolExcluded = 0;

  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const rows = await getWalletTradePage(address, pageSize, offset);
    if (!rows.length) break;
    for (const row of rows) {
      const trade = mapTrade(row);
      if (isLowConfidenceDustTrade(trade)) {
        lowConfidenceTradesExcluded++;
        lowConfidenceVolumeSolExcluded += trade.solAmount;
        continue;
      }
      trades.push(trade);
    }
    if (rows.length < pageSize) break;
  }

  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const rows = await getWalletTransferPage(address, pageSize, offset);
    if (!rows.length) break;
    transfers.push(...rows.map(mapTransfer));
    if (rows.length < pageSize) break;
  }

  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const rows = await getWalletRewardsPage(address, pageSize, offset);
    if (!rows.length) break;
    rewards.push(...rows.map(mapReward));
    if (rows.length < pageSize) break;
  }

  trades.sort((a, b) => eventOrder(a, b, "eventIndex"));
  transfers.sort((a, b) => eventOrder(a, b, "eventIndex"));
  rewards.sort((a, b) => eventOrder(a, b, "instructionIndex"));

  const positions = buildPositions(trades, transfers, rewards);
  const positionList = [...positions.values()];

  let realizedPnl = 0;
  let unrealizedPnl = 0;
  let totalPnl = 0;
  let grossBuyVolumeSol = 0;
  let grossSellVolumeSol = 0;
  let feesSol = 0;
  const creatorRewardsByMint = {};
  let creatorRewardCount = 0;
  let creatorRewardTokenAmount = 0;
  let unmatchedSellProceedsSol = 0;
  let unmatchedSoldTokens = 0;
  let unknownCostSellProceedsSol = 0;
  let unknownCostSoldTokens = 0;
  let unknownCostRemainingTokens = 0;
  let openPositions = 0;
  let closedPositions = 0;
  let winningPositions = 0;
  let losingPositions = 0;
  let incompletePnlPositions = 0;

  const dexCounts = {};
  for (const reward of rewards) {
    creatorRewardCount++;
    creatorRewardTokenAmount += reward.amount;
    creatorRewardsByMint[reward.quoteMint] = (creatorRewardsByMint[reward.quoteMint] || 0) + reward.amount;
  }

  const tradeTypeCounts = { BUY: 0, SELL: 0 };
  for (const trade of trades) {
    tradeTypeCounts[trade.type] = (tradeTypeCounts[trade.type] || 0) + 1;
    if (trade.type === "BUY") grossBuyVolumeSol += trade.solAmount;
    if (trade.type === "SELL") grossSellVolumeSol += trade.solAmount;
    feesSol += trade.feeSol || 0;
    if (trade.dex) dexCounts[trade.dex] = (dexCounts[trade.dex] || 0) + 1;
  }

  const transferCounts = { IN: 0, OUT: 0 };
  const transferMints = new Set();
  for (const transfer of transfers) {
    transferCounts[transfer.direction] = (transferCounts[transfer.direction] || 0) + 1;
    transferMints.add(transfer.mint);
  }

  for (const position of positionList) {
    realizedPnl += position.realizedPnl;
    unrealizedPnl += position.unrealizedPnl;
    totalPnl += position.totalPnl;
    unmatchedSellProceedsSol += position.unmatchedSellProceedsSol || 0;
    unmatchedSoldTokens += position.unmatchedSoldTokens || 0;
    unknownCostSellProceedsSol += position.unknownCostSellProceedsSol || 0;
    unknownCostSoldTokens += position.unknownCostSoldTokens || 0;
    unknownCostRemainingTokens += position.unknownCostRemainingTokens || 0;

    if (!position.pnlComplete) incompletePnlPositions++;
    if (position.open) openPositions++;
    else closedPositions++;
    if (position.realizedPnl > 0) winningPositions++;
    if (position.realizedPnl < 0) losingPositions++;
  }

  const rankedPositions = [...positionList].sort((a, b) => b.totalPnl - a.totalPnl);
  const bestTrades = rankedPositions.slice(0, 3).map(summarizePosition);
  const worstTrades = rankedPositions.slice(-3).reverse().map(summarizePosition);
  const matchedPositions = winningPositions + losingPositions;
  const openTokens = positionList.filter((position) => position.open);
  const topPositions = rankedPositions.slice(0, 10).map(summarizePosition);

  const metrics = {
    wallet: address,
    mode,
    generatedAt: new Date().toISOString(),
    tradesAnalyzed: trades.length,
    lowConfidenceTradesExcluded,
    lowConfidenceVolumeSolExcluded: round(lowConfidenceVolumeSolExcluded),
    transfersAnalyzed: transfers.length,
    transferInCount: transferCounts.IN,
    transferOutCount: transferCounts.OUT,
    transferTokenCount: transferMints.size,
    creatorRewardCount,
    creatorRewardTokenAmount: round(creatorRewardTokenAmount),
    creatorRewardsByMint,
    buyCount: tradeTypeCounts.BUY,
    sellCount: tradeTypeCounts.SELL,
    uniqueTokens: positions.size,
    grossBuyVolumeSol: round(grossBuyVolumeSol),
    grossSellVolumeSol: round(grossSellVolumeSol),
    totalVolumeSol: round(grossBuyVolumeSol + grossSellVolumeSol),
    feesSol: round(feesSol),
    realizedPnlSol: round(realizedPnl),
    unrealizedPnlSol: round(unrealizedPnl),
    totalPnlSol: round(totalPnl),
    pnlComplete: incompletePnlPositions === 0,
    incompletePnlPositions,
    unknownCostSoldTokens: round(unknownCostSoldTokens),
    unknownCostSellProceedsSol: round(unknownCostSellProceedsSol),
    unknownCostRemainingTokens: round(unknownCostRemainingTokens),
    unmatchedSoldTokens: round(unmatchedSoldTokens),
    unmatchedSellProceedsSol: round(unmatchedSellProceedsSol),
    openPositions,
    closedPositions,
    winningPositions,
    losingPositions,
    winRate: matchedPositions > 0 ? round((winningPositions / matchedPositions) * 100, 2) : null,
    openExposureCostSol: round(openTokens.reduce((sum, position) => sum + position.remainingCostSol, 0)),
    openMarkedValueSol: round(openTokens.reduce((sum, position) => sum + position.unrealizedValueSol, 0)),
    unknownCostMarkedValueSol: round(openTokens.reduce((sum, position) => sum + position.unknownCostMarkedValueSol, 0)),
    best: bestTrades[0] || null,
    worst: worstTrades[0] || null,
    bestTrades,
    worstTrades,
    dexCounts,
    topPositions
  };

  await upsertAnalysisCache({
    wallet_address: address,
    analysis_scope: mode,
    metrics,
    generated_at: metrics.generatedAt
  });

  return { sync, metrics };
}

if (process.argv[1]?.endsWith("walletAnalyzer.js")) {
  let address = process.argv[2];
  const mode = process.argv[3] || "quick";

  if (!address) {
    const samples = await getTradeSamples(1);
    address = samples[0]?.wallet_address || null;
    if (!address) {
      console.error("No hay ninguna wallet con trades en Supabase.");
      process.exit(1);
    }
    console.log(`Wallet seleccionada automáticamente desde Supabase: ${address}`);
  }

  try {
    const result = await analyzeWallet(address, { mode });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("Wallet analysis failed:", error.message);
    process.exit(1);
  }
}
