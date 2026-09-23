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
      trade.solAmount < 0
    ) {
      continue;
    }

    const mint = trade.tokenMint;

    if (!positions.has(mint)) {
      positions.set(mint, {
        mint,
        buys: 0,
        sells: 0,
        tokensBought: 0,
        tokensSold: 0,
        tokensRemaining: 0,
        solSpent: 0,
        solReceived: 0,
        realizedPnl: 0,
        lots: []
      });
    }

    const position = positions.get(mint);

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

    if (trade.type !== "SELL") continue;

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
      lot.tokens -= tokensFromLot;
      lot.costSol -= cost;
      remainingToSell -= tokensFromLot;

      if (lot.tokens <= EPSILON) {
        position.lots.shift();
      }
    }

    // If a sell exceeds the inventory reconstructed from BUYs, do not
    // manufacture cost basis. Track the unmatched quantity explicitly.
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

    delete position.lots;

    if (!position.unmatchedSoldTokens) {
      delete position.unmatchedSoldTokens;
    }
  }

  return positions;
}
