const EPSILON = 0.000000001;
const LOW_CONFIDENCE_DUST_TOKEN_MAX = 0.00001;
const LOW_CONFIDENCE_RENT_SOL_MAX = 0.003;

function finitePositive(value) {
  return Number.isFinite(value) && value > 0;
}

export function isLowConfidenceDustTrade(trade) {
  return Boolean(
    trade &&
    trade.type === "SELL" &&
    trade.parser === "instruction_swap" &&
    trade.dex === "unknown" &&
    Number.isFinite(trade.tokenAmount) &&
    trade.tokenAmount > 0 &&
    trade.tokenAmount <= LOW_CONFIDENCE_DUST_TOKEN_MAX &&
    Number.isFinite(trade.solAmount) &&
    trade.solAmount > 0 &&
    trade.solAmount <= LOW_CONFIDENCE_RENT_SOL_MAX
  );
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
      purchasedTokensRemaining: 0,
      externalTokensRemaining: 0,
      solSpent: 0,
      solReceived: 0,
      realizedPnl: 0,
      realizedCostBasis: 0,
      externalSaleProceedsSol: 0,
      externalTokensSold: 0,
      transferTokensSold: 0,
      rewardTokensSold: 0,
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
      lots: [],
      realizedTrades: [],
      externalSales: []
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
  let purchasedCost = 0;
  let purchasedTokens = 0;
  let transferTokens = 0;
  let rewardTokens = 0;
  let otherExternalTokens = 0;
  let totalMatched = 0;

  while (remaining > EPSILON && position.lots.length > 0) {
    const lot = position.lots[0];
    const tokensFromLot = Math.min(remaining, lot.tokens);
    const ratio = lot.tokens > EPSILON ? tokensFromLot / lot.tokens : 0;

    if (lot.origin === "BUY" && lot.costSol != null) {
      const cost = lot.costSol * ratio;
      purchasedCost += cost;
      purchasedTokens += tokensFromLot;
      lot.costSol -= cost;
      if (purpose === "SELL" && lot.blockTime != null && blockTime != null && blockTime >= lot.blockTime) {
        position.holdingSecondsWeighted += tokensFromLot * (blockTime - lot.blockTime);
      }
    } else if (lot.origin === "TRANSFER_IN") {
      transferTokens += tokensFromLot;
    } else if (lot.origin === "REWARD") {
      rewardTokens += tokensFromLot;
    } else {
      otherExternalTokens += tokensFromLot;
    }

    lot.tokens -= tokensFromLot;
    remaining -= tokensFromLot;
    totalMatched += tokensFromLot;

    if (lot.tokens <= EPSILON) position.lots.shift();
  }

  const externalTokens = transferTokens + rewardTokens + otherExternalTokens;

  if (purpose === "SELL") {
    position.matchedSoldTokens += purchasedTokens;
    position.knownCostSoldTokens += purchasedTokens;
    position.unknownCostSoldTokens += externalTokens;
    position.realizedCostBasis += purchasedCost;
    position.externalTokensSold += externalTokens;
    position.transferTokensSold += transferTokens;
    position.rewardTokensSold += rewardTokens;
  }

  if (purpose === "TRANSFER_OUT") {
    position.transferredOutKnownCostSol += purchasedCost;
  }

  return {
    remaining,
    purchasedCost,
    purchasedTokens,
    transferTokens,
    rewardTokens,
    otherExternalTokens,
    externalTokens,
    totalMatched
  };
}

function eventSlot(value) {
  const slot = Number(value);
  return Number.isFinite(slot) ? slot : null;
}

function transferTradeKey(signature, mint, direction) {
  if (!signature || !mint || !direction) return null;
  return `${signature}|${mint}|${direction}`;
}

export function buildPositions(trades, transfers = [], rewards = []) {
  const positions = new Map();
  const events = [];
  const swapTransferKeys = new Set();
  const rewardTransferKeys = new Set();

  for (const trade of trades || []) {
    if (!trade || !trade.tokenMint || !finitePositive(trade.tokenAmount) || !Number.isFinite(trade.solAmount) || trade.solAmount < 0 || (trade.type !== "BUY" && trade.type !== "SELL")) continue;
    if (isLowConfidenceDustTrade(trade)) continue;
    const direction = trade.type === "BUY" ? "IN" : "OUT";
    const key = transferTradeKey(trade.signature, trade.tokenMint, direction);
    if (key) swapTransferKeys.add(key);
    events.push({
      kind: "TRADE",
      blockTime: trade.blockTime ?? null,
      slot: eventSlot(trade.slot),
      eventIndex: Number.isInteger(trade.eventIndex) ? trade.eventIndex : 0,
      signature: trade.signature || "",
      data: trade
    });
  }

  for (const reward of rewards || []) {
    if (!reward || !reward.quoteMint || !finitePositive(reward.amount)) continue;
    const key = transferTradeKey(reward.signature, reward.quoteMint, "IN");
    if (key) rewardTransferKeys.add(key);
    events.push({
      kind: "REWARD",
      blockTime: reward.blockTime ?? null,
      slot: eventSlot(reward.slot),
      eventIndex: Number.isInteger(reward.instructionIndex) ? reward.instructionIndex : 0,
      signature: reward.signature || "",
      data: reward
    });
  }

  for (const transfer of transfers || []) {
    if (!transfer || !transfer.mint || !finitePositive(transfer.amount) || !["IN", "OUT"].includes(transfer.direction)) continue;
    const key = transferTradeKey(transfer.signature, transfer.mint, transfer.direction);
    if (key && (swapTransferKeys.has(key) || rewardTransferKeys.has(key))) continue;
    events.push({
      kind: "TRANSFER",
      blockTime: transfer.blockTime ?? null,
      slot: eventSlot(transfer.slot),
      eventIndex: Number.isInteger(transfer.eventIndex) ? transfer.eventIndex : 0,
      signature: transfer.signature || "",
      data: transfer
    });
  }

  const priority = { REWARD: 0, TRADE: 1, TRANSFER: 2 };
  events.sort((a, b) => {
    const timeDiff = (a.blockTime ?? 0) - (b.blockTime ?? 0);
    if (timeDiff !== 0) return timeDiff;
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
    const purchasedProceeds = trade.tokenAmount > EPSILON
      ? trade.solAmount * (consumed.purchasedTokens / trade.tokenAmount)
      : 0;
    const externalProceeds = trade.tokenAmount > EPSILON
      ? trade.solAmount * (consumed.externalTokens / trade.tokenAmount)
      : 0;
    const unmatchedProceeds = Math.max(0, trade.solAmount - purchasedProceeds - externalProceeds);
    const tradePnl = purchasedProceeds - consumed.purchasedCost;

    position.realizedPnl += tradePnl;
    position.externalSaleProceedsSol += externalProceeds;
    position.unknownCostSellProceedsSol += externalProceeds;

    if (consumed.purchasedTokens > EPSILON && consumed.purchasedCost > EPSILON) {
      position.realizedTrades.push({
        tokenMint: trade.tokenMint,
        signature: trade.signature || null,
        blockTime: trade.blockTime ?? null,
        dex: trade.dex || null,
        tokensSold: consumed.purchasedTokens,
        purchasedTokensSold: consumed.purchasedTokens,
        externalTokensSold: consumed.externalTokens,
        transferTokensSold: consumed.transferTokens,
        rewardTokensSold: consumed.rewardTokens,
        costSol: consumed.purchasedCost,
        proceedsSol: purchasedProceeds,
        pnlSol: tradePnl,
        roiPct: (tradePnl / consumed.purchasedCost) * 100,
        mixedOrigins: consumed.externalTokens > EPSILON || consumed.remaining > EPSILON,
        pnlComplete: consumed.remaining <= EPSILON
      });
    }

    if (consumed.externalTokens > EPSILON) {
      position.externalSales.push({
        tokenMint: trade.tokenMint,
        signature: trade.signature || null,
        blockTime: trade.blockTime ?? null,
        dex: trade.dex || null,
        tokensSold: consumed.externalTokens,
        transferTokensSold: consumed.transferTokens,
        rewardTokensSold: consumed.rewardTokens,
        proceedsSol: externalProceeds,
        origin: consumed.rewardTokens > EPSILON && consumed.transferTokens <= EPSILON
          ? "REWARD"
          : consumed.transferTokens > EPSILON && consumed.rewardTokens <= EPSILON
            ? "TRANSFER_IN"
            : "MIXED_EXTERNAL"
      });
    }

    if (consumed.remaining > EPSILON) {
      position.unmatchedSoldTokens += consumed.remaining;
      position.unmatchedSellProceedsSol += unmatchedProceeds;
    }
  }

  for (const position of positions.values()) {
    position.tokensRemaining = position.lots.reduce((total, lot) => total + lot.tokens, 0);
    position.purchasedTokensRemaining = position.lots.reduce((total, lot) => total + (lot.origin === "BUY" ? lot.tokens : 0), 0);
    position.externalTokensRemaining = Math.max(0, position.tokensRemaining - position.purchasedTokensRemaining);
    position.remainingCostSol = position.lots.reduce((total, lot) => total + (lot.origin === "BUY" && lot.costSol != null ? lot.costSol : 0), 0);
    position.unknownCostRemainingTokens = position.externalTokensRemaining;
    position.knownCostRemainingTokens = position.purchasedTokensRemaining;
    position.unrealizedValueSol = position.purchasedTokensRemaining > EPSILON && finitePositive(position.lastPriceSol) ? position.purchasedTokensRemaining * position.lastPriceSol : 0;
    position.unknownCostMarkedValueSol = position.externalTokensRemaining > EPSILON && finitePositive(position.lastPriceSol) ? position.externalTokensRemaining * position.lastPriceSol : 0;
    position.unrealizedPnl = position.unrealizedValueSol - position.remainingCostSol;
    position.totalPnl = position.realizedPnl + position.unrealizedPnl;
    position.realizedRoi = position.realizedCostBasis > EPSILON ? position.realizedPnl / position.realizedCostBasis : null;
    position.avgHoldingSeconds = position.matchedSoldTokens > EPSILON ? position.holdingSecondsWeighted / position.matchedSoldTokens : null;
    position.open = position.purchasedTokensRemaining > EPSILON;
    position.pnlComplete = position.unmatchedSoldTokens <= EPSILON;

    delete position.lots;

    for (const field of ["unmatchedSoldTokens", "unmatchedSellProceedsSol", "unknownCostSoldTokens", "unknownCostSellProceedsSol", "unmatchedTransferredOutTokens"]) {
      if (position[field] <= EPSILON) delete position[field];
    }
  }

  return positions;
}
