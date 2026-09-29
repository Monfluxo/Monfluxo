const EPSILON = 0.000000001;

function finitePositive(value) {
  return Number.isFinite(value) && value > 0;
}

function ensurePosition(positions, mint, blockTime = null) {
  if (!positions.has(mint)) {
    positions.set(mint, {
      mint,
      buys: 0,
      sells: 0,
      tradeCount: 0,
      transferIns: 0,
      transferOuts: 0,
      transferCount: 0,
      rewardIns: 0,
      rewardCount: 0,
      tokensBought: 0,
      tokensSold: 0,
      tokensTransferredIn: 0,
      tokensTransferredOut: 0,
      tokensRewarded: 0,
      tokensRemaining: 0,
      solSpent: 0,
      solReceived: 0,
      realizedPnl: 0,
      realizedCostBasis: 0,
      feesSol: 0,
      matchedSoldTokens: 0,
      knownCostSoldTokens: 0,
      unknownCostSoldTokens: 0,
      unknownCostSellProceedsSol: 0,
      unmatchedSoldTokens: 0,
      unmatchedSellProceedsSol: 0,
      unmatchedTransferredOutTokens: 0,
      transferredOutKnownCostSol: 0,
      holdingSecondsWeighted: 0,
      firstBlockTime: blockTime,
      lastBlockTime: blockTime,
      lastPriceSol: null,
      lots: []
    });
  }
  return positions.get(mint);
}

function touchTime(position, blockTime) {
  if (blockTime == null) return;
  position.firstBlockTime = position.firstBlockTime == null
    ? blockTime
    : Math.min(position.firstBlockTime, blockTime);
  position.lastBlockTime = position.lastBlockTime == null
    ? blockTime
    : Math.max(position.lastBlockTime, blockTime);
}

function consumeLots(position, tokenAmount, blockTime, purpose) {
  let remaining = tokenAmount;
  let knownCost = 0;
  let knownTokens = 0;
  let unknownTokens = 0;
  let totalMatched = 0;

  while (remaining > EPSILON && position.lots.length > 0) {
    const lot = position.lots[0];
    const tokensFromLot = Math.min(remaining, lot.tokens);
    const ratio = lot.tokens > EPSILON ? tokensFromLot / lot.tokens : 0;

    if (lot.costSol == null) {
      unknownTokens += tokensFromLot;
    } else {
      const cost = lot.costSol * ratio;
      knownCost += cost;
      knownTokens += tokensFromLot;
      lot.costSol -= cost;
    }

    if (lot.blockTime != null && blockTime != null && blockTime >= lot.blockTime) {
      position.holdingSecondsWeighted += tokensFromLot * (blockTime - lot.blockTime);
    }

    lot.tokens -= tokensFromLot;
    remaining -= tokensFromLot;
    totalMatched += tokensFromLot;

    if (lot.tokens <= EPSILON) position.lots.shift();
  }

  if (purpose === "SELL") {
    position.matchedSoldTokens += totalMatched;
    position.knownCostSoldTokens += knownTokens;
    position.unknownCostSoldTokens += unknownTokens;
    position.realizedCostBasis += knownCost;
  }

  if (purpose === "TRANSFER_OUT") {
    position.transferredOutKnownCostSol += knownCost;
  }

  return { remaining, knownCost, knownTokens, unknownTokens, totalMatched };
}

function eventSlot(value) {
  const slot = Number(value);
  return Number.isFinite(slot) ? slot : null;
}

export function buildPositions(trades, transfers = [], rewards = []) {
  const positions = new Map();
  const events = [];

  for (const trade of trades || []) {
    if (!trade || !trade.tokenMint || !finitePositive(trade.tokenAmount) || !Number.isFinite(trade.solAmount) || trade.solAmount < 0 || (trade.type !== "BUY" && trade.type !== "SELL")) continue;
    events.push({
      kind: "TRADE",
      blockTime: trade.blockTime ?? null,
      slot: eventSlot(trade.slot),
      eventIndex: Number.isInteger(trade.eventIndex) ? trade.eventIndex : 0,
      signature: trade.signature || "",
      data: trade
    });
  }

  for (const transfer of transfers || []) {
    if (!transfer || !transfer.mint || !finitePositive(transfer.amount) || !["IN", "OUT"].includes(transfer.direction)) continue;
    events.push({
      kind: "TRANSFER",
      blockTime: transfer.blockTime ?? null,
      slot: eventSlot(transfer.slot),
      eventIndex: Number.isInteger(transfer.eventIndex) ? transfer.eventIndex : 0,
      signature: transfer.signature || "",
      data: transfer
    });
  }

  for (const reward of rewards || []) {
    if (!reward || !reward.quoteMint || !finitePositive(reward.amount)) continue;
    events.push({
      kind: "REWARD",
      blockTime: reward.blockTime ?? null,
      slot: eventSlot(reward.slot),
      eventIndex: Number.isInteger(reward.instructionIndex) ? reward.instructionIndex : 0,
      signature: reward.signature || "",
      data: reward
    });
  }

  const priority = { TRANSFER: 0, REWARD: 1, TRADE: 2 };
  events.sort((a, b) => {
    const timeDiff = (a.blockTime ?? 0) - (b.blockTime ?? 0);
    if (timeDiff !== 0) return timeDiff;

    // blockTime is second-resolution. Use Solana slot only to resolve events
    // that share the same second; never let a missing slot move an event
    // to the beginning or end of the entire wallet history.
    if (a.slot != null && b.slot != null && a.slot !== b.slot) return a.slot - b.slot;
    if (a.kind !== b.kind) return priority[a.kind] - priority[b.kind];
    if (a.eventIndex !== b.eventIndex) return a.eventIndex - b.eventIndex;
    return a.signature.localeCompare(b.signature);
  });

  for (const event of events) {
    if (event.kind === "TRANSFER") {
      const transfer = event.data;
      const position = ensurePosition(positions, transfer.mint, transfer.blockTime ?? null);
      touchTime(position, transfer.blockTime);
      position.transferCount++;

      if (transfer.direction === "IN") {
        position.transferIns++;
        position.tokensTransferredIn += transfer.amount;
        position.lots.push({ tokens: transfer.amount, costSol: null, origin: "TRANSFER_IN", signature: transfer.signature, blockTime: transfer.blockTime });
      } else {
        position.transferOuts++;
        position.tokensTransferredOut += transfer.amount;
        const consumed = consumeLots(position, transfer.amount, transfer.blockTime, "TRANSFER_OUT");
        if (consumed.remaining > EPSILON) position.unmatchedTransferredOutTokens += consumed.remaining;
      }
      continue;
    }

    if (event.kind === "REWARD") {
      const reward = event.data;
      const position = ensurePosition(positions, reward.quoteMint, reward.blockTime ?? null);
      touchTime(position, reward.blockTime);
      position.rewardCount++;
      position.rewardIns++;
      position.tokensRewarded += reward.amount;
      position.lots.push({ tokens: reward.amount, costSol: null, origin: "REWARD", signature: reward.signature, blockTime: reward.blockTime });
      continue;
    }

    const trade = event.data;
    const position = ensurePosition(positions, trade.tokenMint, trade.blockTime ?? null);
    touchTime(position, trade.blockTime);
    position.tradeCount++;

    if (finitePositive(trade.estimatedPriceSol)) position.lastPriceSol = trade.estimatedPriceSol;
    if (finitePositive(trade.feeSol)) position.feesSol += trade.feeSol;

    if (trade.type === "BUY") {
      position.buys++;
      position.tokensBought += trade.tokenAmount;
      position.solSpent += trade.solAmount;
      position.lots.push({ tokens: trade.tokenAmount, costSol: trade.solAmount, origin: "BUY", priceSol: trade.estimatedPriceSol, signature: trade.signature, blockTime: trade.blockTime });
      continue;
    }

    position.sells++;
    position.tokensSold += trade.tokenAmount;
    position.solReceived += trade.solAmount;

    const consumed = consumeLots(position, trade.tokenAmount, trade.blockTime, "SELL");
    const knownProceeds = trade.tokenAmount > EPSILON ? trade.solAmount * (consumed.knownTokens / trade.tokenAmount) : 0;
    const unknownProceeds = trade.tokenAmount > EPSILON ? trade.solAmount * (consumed.unknownTokens / trade.tokenAmount) : 0;
    const unmatchedProceeds = Math.max(0, trade.solAmount - knownProceeds - unknownProceeds);

    position.realizedPnl += knownProceeds - consumed.knownCost;
    position.unknownCostSellProceedsSol += unknownProceeds;

    if (consumed.remaining > EPSILON) {
      position.unmatchedSoldTokens += consumed.remaining;
      position.unmatchedSellProceedsSol += unmatchedProceeds;
    }
  }

  for (const position of positions.values()) {
    position.tokensRemaining = position.lots.reduce((total, lot) => total + lot.tokens, 0);
    position.remainingCostSol = position.lots.reduce((total, lot) => total + (lot.costSol == null ? 0 : lot.costSol), 0);
    position.unknownCostRemainingTokens = position.lots.reduce((total, lot) => total + (lot.costSol == null ? lot.tokens : 0), 0);
    position.knownCostRemainingTokens = Math.max(0, position.tokensRemaining - position.unknownCostRemainingTokens);
    position.unrealizedValueSol = position.knownCostRemainingTokens > EPSILON && finitePositive(position.lastPriceSol) ? position.knownCostRemainingTokens * position.lastPriceSol : 0;
    position.unknownCostMarkedValueSol = position.unknownCostRemainingTokens > EPSILON && finitePositive(position.lastPriceSol) ? position.unknownCostRemainingTokens * position.lastPriceSol : 0;
    position.unrealizedPnl = position.unrealizedValueSol - position.remainingCostSol;
    position.totalPnl = position.realizedPnl + position.unrealizedPnl;
    position.realizedRoi = position.realizedCostBasis > EPSILON ? position.realizedPnl / position.realizedCostBasis : null;
    position.avgHoldingSeconds = position.matchedSoldTokens > EPSILON ? position.holdingSecondsWeighted / position.matchedSoldTokens : null;
    position.open = position.tokensRemaining > EPSILON;
    position.pnlComplete = position.unknownCostSoldTokens <= EPSILON && position.unknownCostRemainingTokens <= EPSILON && position.unmatchedSoldTokens <= EPSILON;

    delete position.lots;

    for (const field of ["unmatchedSoldTokens", "unmatchedSellProceedsSol", "unknownCostSoldTokens", "unknownCostSellProceedsSol", "unmatchedTransferredOutTokens"]) {
      if (position[field] <= EPSILON) delete position[field];
    }
  }

  return positions;
}
