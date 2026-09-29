function n(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function nullableNumber(value) {
  return value == null || !Number.isFinite(Number(value)) ? null : Number(value);
}

function confidenceFromMetrics(metrics, coverage) {
  const unmatchedSol = n(metrics?.unmatchedSellProceedsSol);
  const lowConfidenceExcluded = n(metrics?.lowConfidenceTradesExcluded);
  const historyComplete = coverage?.historyComplete === true;

  if (!historyComplete) {
    return {
      level: "partial",
      label: "Partial coverage",
      reason: "Historical indexing is still in progress. Metrics and inventory state are provisional until coverage is complete."
    };
  }

  if (unmatchedSol > 0.001) {
    return {
      level: "review",
      label: "Needs review",
      reason: "Material unmatched sell proceeds remain in the reconstructed history."
    };
  }

  return {
    level: "high",
    label: "High confidence",
    reason: lowConfidenceExcluded > 0
      ? "Historical coverage is complete and low-confidence dust-like events were excluded from accounting."
      : "Historical coverage is complete and no material unmatched inventory remains."
  };
}

function pnlCoverage(metrics) {
  const unknownSoldTokens = n(metrics?.unknownCostSoldTokens);
  const unknownProceeds = n(metrics?.unknownCostSellProceedsSol);
  const unknownRemaining = n(metrics?.unknownCostRemainingTokens);
  const complete = metrics?.pnlComplete === true;

  return {
    status: complete ? "complete" : "partial",
    complete,
    unknownCostSoldTokens: unknownSoldTokens,
    unknownCostSellProceedsSol: unknownProceeds,
    unknownCostRemainingTokens: unknownRemaining,
    message: complete
      ? "All analyzed inventory has known cost basis."
      : "Known-cost PnL is deterministic, but part of the wallet inventory has unknown acquisition cost."
  };
}

function normalizePosition(position, historyComplete) {
  if (!position) return null;
  return {
    tokenMint: position.tokenMint || null,
    state: historyComplete ? (position.open ? "open" : "closed") : "provisional",
    inferredState: position.open ? "open" : "closed",
    stateFinal: historyComplete,
    pnlComplete: position.pnlComplete === true,
    trades: n(position.trades),
    buys: n(position.buys),
    sells: n(position.sells),
    transferIns: n(position.transferIns),
    transferOuts: n(position.transferOuts),
    rewardIns: n(position.rewardIns),
    tokensBought: n(position.tokensBought),
    tokensSold: n(position.tokensSold),
    tokensRemaining: n(position.tokensRemaining),
    solSpent: n(position.solSpent),
    solReceived: n(position.solReceived),
    realizedPnlSol: n(position.realizedPnlSol),
    unrealizedPnlSol: n(position.unrealizedPnlSol),
    totalPnlSol: n(position.totalPnlSol),
    realizedRoiPct: nullableNumber(position.realizedRoi),
    avgHoldingSeconds: nullableNumber(position.avgHoldingSeconds),
    unknownCostSoldTokens: n(position.unknownCostSoldTokens),
    unknownCostSellProceedsSol: n(position.unknownCostSellProceedsSol),
    unmatchedSoldTokens: n(position.unmatchedSoldTokens),
    unmatchedSellProceedsSol: n(position.unmatchedSellProceedsSol)
  };
}

function normalizeTrade(trade) {
  if (!trade) return null;
  return {
    tokenMint: trade.tokenMint || null,
    signature: trade.signature || null,
    blockTime: trade.blockTime ?? null,
    dex: trade.dex || null,
    tokensSold: n(trade.tokensSold),
    costSol: n(trade.costSol),
    proceedsSol: n(trade.proceedsSol),
    pnlSol: n(trade.pnlSol),
    roiPct: nullableNumber(trade.roiPct),
    pnlComplete: trade.pnlComplete === true
  };
}

function normalizeFunding(event) {
  if (!event) return null;
  return {
    signature: event.signature || null,
    blockTime: event.blockTime ?? null,
    assetType: event.assetType === "SOL" ? "SOL" : "TOKEN",
    assetId: event.assetId || null,
    amount: n(event.amount),
    sourceAddress: event.sourceAddress || null,
    destinationAddress: event.destinationAddress || null,
    parser: event.parser || null,
    classification: "TRANSFER"
  };
}

function normalizeRewardEvent(event) {
  if (!event) return null;
  return {
    signature: event.signature || null,
    blockTime: event.blockTime ?? null,
    assetType: "TOKEN",
    assetId: event.tokenMint || null,
    tokenMint: event.tokenMint || null,
    amount: n(event.amount),
    sourceAddress: null,
    destinationAddress: event.creator || null,
    rewardType: event.rewardType || "CREATOR_FEE",
    classification: "CREATOR_REWARD"
  };
}

export function buildWalletDashboardResponse(productResult) {
  const metrics = productResult?.metrics || {};
  const coverage = productResult?.coverage || {};
  const historyComplete = coverage.historyComplete === true;
  const topPositions = Array.isArray(metrics.topPositions)
    ? metrics.topPositions.map((position) => normalizePosition(position, historyComplete)).filter(Boolean)
    : [];
  const bestTrades = Array.isArray(metrics.bestTrades)
    ? metrics.bestTrades.map(normalizeTrade).filter(Boolean)
    : [];
  const worstTrades = Array.isArray(metrics.worstTrades)
    ? metrics.worstTrades.map(normalizeTrade).filter(Boolean)
    : [];
  const fundingEvents = Array.isArray(metrics.fundingEvents)
    ? metrics.fundingEvents.map(normalizeFunding).filter(Boolean)
    : [];
  const rewardEvents = Array.isArray(metrics.creatorRewardEvents)
    ? metrics.creatorRewardEvents.map(normalizeRewardEvent).filter(Boolean)
    : [];

  return {
    schemaVersion: "wallet-intelligence.v4",
    wallet: productResult?.wallet || null,
    status: productResult?.status || "indexing",
    metricsStatus: productResult?.metricsStatus || "partial",

    overview: {
      uniqueTokens: n(metrics.uniqueTokens),
      tradesAnalyzed: n(metrics.tradesAnalyzed),
      realizedTradesAnalyzed: n(metrics.realizedTradesAnalyzed),
      transfersAnalyzed: n(metrics.transfersAnalyzed),
      buyCount: n(metrics.buyCount),
      sellCount: n(metrics.sellCount),
      totalVolumeSol: n(metrics.totalVolumeSol),
      feesSol: n(metrics.feesSol),
      openPositions: historyComplete ? n(metrics.openPositions) : null,
      closedPositions: historyComplete ? n(metrics.closedPositions) : null,
      provisionalOpenPositions: n(metrics.openPositions),
      provisionalClosedPositions: n(metrics.closedPositions),
      winRatePct: nullableNumber(metrics.winRate)
    },

    coverage: {
      status: coverage.status || "indexing",
      historyComplete,
      backfillPending: coverage.backfillPending === true,
      pagesScanned: n(coverage.pagesScanned),
      oldestIndexedAt: coverage.oldestIndexedAt || null,
      newestIndexedAt: coverage.newestIndexedAt || null,
      lastSyncedAt: coverage.lastSyncedAt || null,
      backfillUpdatedAt: coverage.backfillUpdatedAt || null
    },

    performance: {
      realizedPnlSol: n(metrics.realizedPnlSol),
      unrealizedPnlSol: n(metrics.unrealizedPnlSol),
      totalPnlSol: n(metrics.totalPnlSol),
      grossBuyVolumeSol: n(metrics.grossBuyVolumeSol),
      grossSellVolumeSol: n(metrics.grossSellVolumeSol),
      pnlCoverage: pnlCoverage(metrics)
    },

    trades: {
      best: bestTrades,
      worst: worstTrades,
      rankedCount: n(metrics.rankedRealizedTradesAnalyzed),
      excludedFromRanking: n(metrics.rankingTradesExcluded),
      minRankedCostSol: n(metrics.rankingMinCostSol)
    },

    funding: {
      count: n(metrics.fundingEventCount),
      rawCount: n(metrics.fundingEventCount),
      solTotal: n(metrics.solFundingTotal),
      tokenCount: n(metrics.tokenFundingCount),
      minUsd: 5,
      events: fundingEvents
    },

    activity: {
      transferInCount: n(metrics.transferInCount),
      transferOutCount: n(metrics.transferOutCount),
      transferTokenCount: n(metrics.transferTokenCount),
      dexCounts: metrics.dexCounts || {},
      lowConfidenceTradesExcluded: n(metrics.lowConfidenceTradesExcluded),
      lowConfidenceVolumeSolExcluded: n(metrics.lowConfidenceVolumeSolExcluded)
    },

    rewards: {
      creatorRewardCount: n(metrics.creatorRewardCount),
      creatorRewardTokenAmount: n(metrics.creatorRewardTokenAmount),
      byMint: metrics.creatorRewardsByMint || {},
      events: rewardEvents
    },

    positions: {
      top: topPositions,
      best: normalizePosition(metrics.best, historyComplete),
      worst: normalizePosition(metrics.worst, historyComplete)
    },

    accounting: {
      unmatchedSoldTokens: n(metrics.unmatchedSoldTokens),
      unmatchedSellProceedsSol: n(metrics.unmatchedSellProceedsSol),
      unknownCostSoldTokens: n(metrics.unknownCostSoldTokens),
      unknownCostSellProceedsSol: n(metrics.unknownCostSellProceedsSol),
      unknownCostRemainingTokens: n(metrics.unknownCostRemainingTokens)
    },

    confidence: confidenceFromMetrics(metrics, coverage),

    indexing: {
      job: productResult?.indexJob || null,
      state: coverage.status || (historyComplete ? "complete" : "indexing"),
      pagesScanned: n(coverage.pagesScanned),
      lastProgressAt: coverage.backfillUpdatedAt || coverage.lastSyncedAt || null,
      refreshRecommended: !historyComplete
    },

    generatedAt: metrics.generatedAt || new Date().toISOString()
  };
}
