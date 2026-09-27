import { syncWalletHistory } from "./sync.js";
import { getWalletTradePage, getWalletRewardsPage, getTradeSamples, upsertAnalysisCache } from "./db.js";
import { buildPositions } from "./positionEngine.js";

function mapTrade(row) {
  return {
    wallet: row.wallet_address,
    signature: row.signature,
    blockTime: row.block_time
      ? Math.floor(new Date(row.block_time).getTime() / 1000)
      : null,
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

function mapReward(row) {
  return {
    wallet: row.wallet_address,
    signature: row.signature,
    blockTime: row.block_time ? Math.floor(new Date(row.block_time).getTime() / 1000) : null,
    rewardType: row.reward_type,
    quoteMint: row.quote_mint,
    amount: Number(row.amount),
    decimals: Number(row.decimals || 0),
    creator: row.creator,
    instructionIndex: Number(row.instruction_index),
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
    tokensBought: position.tokensBought,
    tokensSold: position.tokensSold,
    tokensRemaining: position.tokensRemaining,
    solSpent: round(position.solSpent),
    solReceived: round(position.solReceived),
    realizedPnlSol: round(position.realizedPnl),
    realizedRoi: position.realizedRoi == null ? null : round(position.realizedRoi * 100, 2),
    unrealizedPnlSol: round(position.unrealizedPnl),
    totalPnlSol: round(position.totalPnl),
    unmatchedSoldTokens: round(position.unmatchedSoldTokens || 0),
    unmatchedSellProceedsSol: round(position.unmatchedSellProceedsSol || 0),
    open: position.open,
    avgHoldingSeconds: round(position.avgHoldingSeconds, 1),
    lastPriceSol: round(position.lastPriceSol, 12)
  };
}

export async function analyzeWallet(address, options = {}) {
  const mode = options.mode || "quick";
  const sync = await syncWalletHistory(address, { mode });

  const pageSize = 1000;
  const maxRows = mode === "quick"
    ? Number(process.env.MAX_QUICK_TRADE_ROWS || 5000)
    : Number(process.env.MAX_DEEP_TRADE_ROWS || 500000);

  const trades = [];
  const rewards = [];

  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const rows = await getWalletTradePage(address, pageSize, offset);
    if (!rows.length) break;
    trades.push(...rows.map(mapTrade));
    if (rows.length < pageSize) break;
  }


  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const rows = await getWalletRewardsPage(address, pageSize, offset);
    if (!rows.length) break;
    rewards.push(...rows.map(mapReward));
    if (rows.length < pageSize) break;
  }

  trades.sort((a, b) => (a.blockTime ?? 0) - (b.blockTime ?? 0));
  rewards.sort((a, b) => (a.blockTime ?? 0) - (b.blockTime ?? 0));
  const positions = buildPositions(trades);
  const positionList = [...positions.values()];

  let realizedPnl = 0;
  let unrealizedPnl = 0;
  let totalPnl = 0;
  let grossBuyVolumeSol = 0;
  let grossSellVolumeSol = 0;
  let feesSol = 0;
  const creatorRewardsByMint = {};
  let creatorRewardCount = 0;
  let creatorRewardTotal = 0;
  let unmatchedSellProceedsSol = 0;
  let unmatchedSoldTokens = 0;
  let openPositions = 0;
  let closedPositions = 0;
  let winningPositions = 0;
  let losingPositions = 0;

  const dexCounts = {};
  for (const reward of rewards) {
    creatorRewardCount++;
    creatorRewardTotal += reward.amount;
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

  for (const position of positionList) {
    realizedPnl += position.realizedPnl;
    unrealizedPnl += position.unrealizedPnl;
    totalPnl += position.totalPnl;
    unmatchedSellProceedsSol += position.unmatchedSellProceedsSol || 0;
    unmatchedSoldTokens += position.unmatchedSoldTokens || 0;

    if (position.open) openPositions++;
    else closedPositions++;

    if (position.realizedPnl > 0) winningPositions++;
    if (position.realizedPnl < 0) losingPositions++;
  }

  const rankedPositions = [...positionList]
    .sort((a, b) => b.totalPnl - a.totalPnl);

  const bestTrades = rankedPositions.slice(0, 3).map(summarizePosition);
  const worstTrades = rankedPositions.slice(-3).reverse().map(summarizePosition);

  const matchedPositions = winningPositions + losingPositions;
  const openTokens = positionList.filter((position) => position.open);

  const topPositions = rankedPositions
    .slice(0, 10)
    .map(summarizePosition);

  const metrics = {
    wallet: address,
    mode,
    generatedAt: new Date().toISOString(),
    tradesAnalyzed: trades.length,
    creatorRewardCount,
    creatorRewardTotal: round(creatorRewardTotal),
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
    unmatchedSoldTokens: round(unmatchedSoldTokens),
    unmatchedSellProceedsSol: round(unmatchedSellProceedsSol),
    openPositions,
    closedPositions,
    winningPositions,
    losingPositions,
    winRate: matchedPositions > 0 ? round((winningPositions / matchedPositions) * 100, 2) : null,
    openExposureCostSol: round(openTokens.reduce((sum, position) => sum + position.remainingCostSol, 0)),
    openMarkedValueSol: round(openTokens.reduce((sum, position) => sum + position.unrealizedValueSol, 0)),
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
