const EPSILON = 0.000000001;

export function buildPositions(trades) {
  const positions = new Map();

  for (const trade of trades) {
    if (
      !trade ||
      !trade.tokenMint ||
      !Number.isFinite(trade.tokenAmount) ||
      !Number.isFinite(trade.solAmount) ||
      trade.tokenAmount <= 0 ||
      trade.solAmount < 0 ||
      (trade.type !== "BUY" && trade.type !== "SELL")
    ) {
      continue;
    }

    const mint = trade.tokenMint;

    if (!positions.has(mint)) {
      positions.set(mint, {
        mint,
        buys: 0,
        sells: 0,
        tradeCount: 0,
        tokensBought: 0,
        tokensSold: 0,
        tokensRemaining: 0,
        solSpent: 0,
        solReceived: 0,
        realizedPnl: 0,
        realizedCostBasis: 0,
        feesSol: 0,
        matchedSoldTokens: 0,
        holdingSecondsWeighted: 0,
        firstBlockTime: trade.blockTime ?? null,
        lastBlockTime: trade.blockTime ?? null,
        lastPriceSol: null,
        lots: []
      });
    }

    const position = positions.get(mint);
    position.tradeCount++;
    position.firstBlockTime =
      position.firstBlockTime == null
        ? trade.blockTime
        : Math.min(position.firstBlockTime, trade.blockTime ?? position.firstBlockTime);
    position.lastBlockTime =
      position.lastBlockTime == null
        ? trade.blockTime
        : Math.max(position.lastBlockTime, trade.blockTime ?? position.lastBlockTime);

    if (Number.isFinite(trade.estimatedPriceSol) && trade.estimatedPriceSol > 0) {
      position.lastPriceSol = trade.estimatedPriceSol;
    }

    if (Number.isFinite(trade.feeSol) && trade.feeSol > 0) {
      position.feesSol += trade.feeSol;
    }

    if (trade.type === "BUY") {
      position.buys++;
      position.tokensBought += trade.tokenAmount;
      position.solSpent += trade.solAmount;

      position.lots.push({
        tokens: trade.tokenAmount,
        costSol: trade.solAmount,
        priceSol: trade.estimatedPriceSol,
        signature: trade.signature,
        blockTime: trade.blockTime
      });
      continue;
    }

    position.sells++;
    position.tokensSold += trade.tokenAmount;
    position.solReceived += trade.solAmount;

    let remainingToSell = trade.tokenAmount;
    let costOfSoldTokens = 0;

    while (remainingToSell > EPSILON && position.lots.length > 0) {
      const lot = position.lots[0];
      const tokensFromLot = Math.min(remainingToSell, lot.tokens);
      const costPerToken = lot.costSol / lot.tokens;
      const cost = tokensFromLot * costPerToken;

      costOfSoldTokens += cost;
      position.realizedCostBasis += cost;
      position.matchedSoldTokens += tokensFromLot;

      if (lot.blockTime != null && trade.blockTime != null && trade.blockTime >= lot.blockTime) {
        position.holdingSecondsWeighted +=
          tokensFromLot * (trade.blockTime - lot.blockTime);
      }

      lot.tokens -= tokensFromLot;
      lot.costSol -= cost;
      remainingToSell -= tokensFromLot;

      if (lot.tokens <= EPSILON) {
        position.lots.shift();
      }
    }

    if (remainingToSell > EPSILON) {
      position.unmatchedSoldTokens =
        (position.unmatchedSoldTokens || 0) + remainingToSell;
    }

    position.realizedPnl += trade.solAmount - costOfSoldTokens;
  }

  for (const position of positions.values()) {
    position.tokensRemaining = position.lots.reduce(
      (total, lot) => total + lot.tokens,
      0
    );

    position.remainingCostSol = position.lots.reduce(
      (total, lot) => total + lot.costSol,
      0
    );

    position.unrealizedValueSol =
      position.tokensRemaining > EPSILON &&
      Number.isFinite(position.lastPriceSol)
        ? position.tokensRemaining * position.lastPriceSol
        : 0;

    position.unrealizedPnl =
      position.unrealizedValueSol - position.remainingCostSol;

    position.totalPnl =
      position.realizedPnl + position.unrealizedPnl;

    position.realizedRoi =
      position.realizedCostBasis > EPSILON
        ? position.realizedPnl / position.realizedCostBasis
        : null;

    position.avgHoldingSeconds =
      position.matchedSoldTokens > EPSILON
        ? position.holdingSecondsWeighted / position.matchedSoldTokens
        : null;

    position.open =
      position.tokensRemaining > EPSILON;

    delete position.lots;

    if (!position.unmatchedSoldTokens) {
      delete position.unmatchedSoldTokens;
    }
  }

  return positions;
}
