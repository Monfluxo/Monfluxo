function n(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function nullableNumber(value) {
  return value == null || !Number.isFinite(Number(value)) ? null : Number(value);
}

function confidenceFromMetrics(metrics, coverage) {
  const unmatchedSol = n(metrics?.unmatchedSellProceedsSol);
  const lowConfidenceExcluded = n(metrics?.lowConfidenceTradesExcluded);
  const historyComplete = coverage?.historyComplete === true && metrics?.rowsTruncated !== true;

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
  const unmatched = n(metrics?.unmatchedSellProceedsSol);
  const complete = metrics?.pnlComplete === true;

  return {
    status: complete ? "complete" : "partial",
    complete,
    unmatchedSellProceedsSol: unmatched,
    message: complete
      ? "Trading PnL uses purchased inventory only. External tokens are accounted for separately."
      : "Purchased-token PnL is deterministic for matched FIFO lots; some sale proceeds remain unmatched."
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
    purchasedTokensRemaining: n(position.purchasedTokensRemaining),
    externalTokensRemaining: n(position.externalTokensRemaining),
    externalTokensSold: n(position.externalTokensSold),
    externalSaleProceedsSol: n(position.externalSaleProceedsSol),
    transferTokensSold: n(position.transferTokensSold),
    rewardTokensSold: n(position.rewardTokensSold),
    remainingCostSol: n(position.remainingCostSol),
    positionValueSol: n(position.positionValueSol),
    solSpent: n(position.solSpent),
    solReceived: n(position.solReceived),
    realizedPnlSol: n(position.realizedPnlSol),
    unrealizedPnlSol: n(position.unrealizedPnlSol),
    totalPnlSol: n(position.totalPnlSol),
    realizedRoiPct: nullableNumber(position.realizedRoi),
    avgHoldingSeconds: nullableNumber(position.avgHoldingSeconds),
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
    realizationCount: n(trade.realizationCount),
    tokensSold: n(trade.tokensSold),
    purchasedTokensSold: n(trade.purchasedTokensSold),
    externalTokensSoldInSameTx: n(trade.externalTokensSoldInSameTx),
    costSol: n(trade.costSol),
    proceedsSol: n(trade.proceedsSol),
    pnlSol: n(trade.pnlSol),
    roiPct: nullableNumber(trade.roiPct),
    mixedOrigins: trade.mixedOrigins === true,
    pnlComplete: trade.pnlComplete === true
  };
}

function normalizeExternalSale(sale) {
  if (!sale) return null;
  return {
    tokenMint: sale.tokenMint || null,
    signature: sale.signature || null,
    blockTime: sale.blockTime ?? null,
    dex: sale.dex || null,
    tokensSold: n(sale.tokensSold),
    transferTokensSold: n(sale.transferTokensSold),
    rewardTokensSold: n(sale.rewardTokensSold),
    proceedsSol: n(sale.proceedsSol),
    origin: sale.origin || "EXTERNAL"
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
  const historyComplete = coverage.historyComplete === true && metrics.rowsTruncated !== true;
  const topPositions = Array.isArray(metrics.topPositions)
    ? metrics.topPositions.map((position) => normalizePosition(position, historyComplete)).filter(Boolean)
    : [];
  const bestTrades = Array.isArray(metrics.bestTrades)
    ? metrics.bestTrades.map(normalizeTrade).filter(Boolean)
    : [];
  const worstTrades = Array.isArray(metrics.worstTrades)
    ? metrics.worstTrades.map(normalizeTrade).filter(Boolean)
    : [];
  const externalSales = Array.isArray(metrics.topExternalSales)
    ? metrics.topExternalSales.map(normalizeExternalSale).filter(Boolean)
    : [];
  const fundingEvents = Array.isArray(metrics.fundingEvents)
    ? metrics.fundingEvents.map(normalizeFunding).filter(Boolean)
    : [];
  const rewardEvents = Array.isArray(metrics.creatorRewardEvents)
    ? metrics.creatorRewardEvents.map(normalizeRewardEvent).filter(Boolean)
    : [];

  return {
    schemaVersion: "wallet-intelligence.v6",
    wallet: productResult?.wallet || null,
    status: productResult?.status || "indexing",
    metricsStatus: productResult?.metricsStatus || "partial",

    overview: {
      uniqueTokens: n(metrics.uniqueTokens),
      tradesAnalyzed: n(metrics.tradesAnalyzed),
      realizedTradesAnalyzed: n(metrics.realizedTradesAnalyzed),
      realizedTokensAnalyzed: n(metrics.realizedTokensAnalyzed),
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
      budgetExhausted: coverage.budgetExhausted === true,
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
      minRankedCostSol: n(metrics.rankingMinCostSol),
      rankingUnit: metrics.rankingUnit || "TOKEN_LIFETIME_NET",
      methodology: "Each mint appears once. All purchased-inventory realizations across every buy/sell cycle are aggregated before ranking. External transfers and rewards are excluded from trading ROI."
    },

    externalTokens: {
      salesCount: n(metrics.externalSalesAnalyzed),
      tokensSold: n(metrics.externalTokensSold),
      tokensRemaining: n(metrics.externalTokensRemaining),
      saleProceedsSol: n(metrics.externalTokenSaleProceedsSol),
      topSales: externalSales,
      methodology: "Tokens received by transfer or reward are tracked separately and never assigned trading ROI."
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
      worst: normalizePosition(metrics.worst, historyComplete),
      minValueSol: n(metrics.openPositionMinValueSol),
      suppressedDustCount: n(metrics.suppressedDustOpenPositions)
    },

    accounting: {
      unmatchedSoldTokens: n(metrics.unmatchedSoldTokens),
      unmatchedSellProceedsSol: n(metrics.unmatchedSellProceedsSol),
      externalTokensSold: n(metrics.externalTokensSold),
      externalTokenSaleProceedsSol: n(metrics.externalTokenSaleProceedsSol),
      externalTokensRemaining: n(metrics.externalTokensRemaining)
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

