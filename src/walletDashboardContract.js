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
      reason: "Historical indexing is still in progress. Metrics may change as older activity is indexed."
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

function normalizePosition(position) {
  if (!position) return null;
  return {
    tokenMint: position.tokenMint || null,
    state: position.open ? "open" : "closed",
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

export function buildWalletDashboardResponse(productResult) {
  const metrics = productResult?.metrics || {};
  const coverage = productResult?.coverage || {};
  const topPositions = Array.isArray(metrics.topPositions)
    ? metrics.topPositions.map(normalizePosition).filter(Boolean)
    : [];

  return {
    schemaVersion: "wallet-intelligence.v1",
    wallet: productResult?.wallet || null,
    status: productResult?.status || "indexing",
    metricsStatus: productResult?.metricsStatus || "partial",

    overview: {
      uniqueTokens: n(metrics.uniqueTokens),
      tradesAnalyzed: n(metrics.tradesAnalyzed),
      transfersAnalyzed: n(metrics.transfersAnalyzed),
      buyCount: n(metrics.buyCount),
      sellCount: n(metrics.sellCount),
      totalVolumeSol: n(metrics.totalVolumeSol),
      feesSol: n(metrics.feesSol),
      openPositions: n(metrics.openPositions),
      closedPositions: n(metrics.closedPositions),
      winRatePct: nullableNumber(metrics.winRate)
    },

    coverage: {
      status: coverage.status || "indexing",
      historyComplete: coverage.historyComplete === true,
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
      byMint: metrics.creatorRewardsByMint || {}
    },

    positions: {
      top: topPositions,
      best: normalizePosition(metrics.best),
      worst: normalizePosition(metrics.worst)
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
      refreshRecommended: coverage.historyComplete !== true
    },

    generatedAt: metrics.generatedAt || new Date().toISOString()
  };
}
