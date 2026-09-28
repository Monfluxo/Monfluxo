import { parseCreatorFeeClaims } from "./swapParser.js";
import { parseSwapTransactions, parseTokenMovements } from "./eventParser.js";

const WSOL_MINT = "So11111111111111111111111111111111111111112";
const SOL_TRADE_EPSILON = 0.00001;

const RAYDIUM_AMM_V4 = "675kPX9MHTjS2zt1qfr1NYHuZeLXfQM9H24yFSUt1Mp8";
const JUPITER_ROUTER = "proVF4pMXVaYqmy4NjniPh4pqKNfMmsihgd4wdkCX3u";
const JUPITER_V6 = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const PUMP_FUN = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const PUMP_AMM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";

function result(type, extra = {}) {
  return {
    type,
    tokenChanges: [],
    solChange: null,
    trade: null,
    trades: [],
    transfers: [],
    rewards: [],
    ...extra
  };
}

function getSignature(transaction) {
  return (
    transaction?.transaction?.signatures?.[0] ||
    transaction?.signature ||
    null
  );
}

function getAccountKeyValue(key) {
  return typeof key === "string"
    ? key
    : key?.pubkey || key?.address || null;
}

function getTokenChanges(transaction, wallet) {
  const preBalances = transaction?.meta?.preTokenBalances || [];
  const postBalances = transaction?.meta?.postTokenBalances || [];

  const allMints = new Set([
    ...preBalances.map((x) => x.mint).filter(Boolean),
    ...postBalances.map((x) => x.mint).filter(Boolean)
  ]);

  const changes = [];

  for (const mint of allMints) {
    const pre = preBalances.filter(
      (x) => x.mint === mint && x.owner === wallet
    );
    const post = postBalances.filter(
      (x) => x.mint === mint && x.owner === wallet
    );

    const before = pre.reduce(
      (total, item) =>
        total + BigInt(item.uiTokenAmount?.amount || "0"),
      0n
    );

    const after = post.reduce(
      (total, item) =>
        total + BigInt(item.uiTokenAmount?.amount || "0"),
      0n
    );

    const change = after - before;

    if (change === 0n) continue;

    const decimals =
      post[0]?.uiTokenAmount?.decimals ??
      pre[0]?.uiTokenAmount?.decimals ??
      0;

    changes.push({
      mint,
      rawChange: change.toString(),
      decimals,
      amount: Number(change < 0n ? -change : change) / 10 ** decimals,
      direction: change > 0n ? "IN" : "OUT"
    });
  }

  return changes;
}

function getSolChange(transaction, wallet) {
  const meta = transaction?.meta;
  const accountKeys = [
    ...(transaction?.transaction?.message?.accountKeys || []),
    ...(transaction?.meta?.loadedAddresses?.writable || []),
    ...(transaction?.meta?.loadedAddresses?.readonly || [])
  ];

  const walletIndex = accountKeys.findIndex(
    (key) => getAccountKeyValue(key) === wallet
  );

  if (
    walletIndex < 0 ||
    !Array.isArray(meta?.preBalances) ||
    !Array.isArray(meta?.postBalances)
  ) {
    return null;
  }

  const before = BigInt(meta.preBalances[walletIndex] || 0);
  const after = BigInt(meta.postBalances[walletIndex] || 0);
  const rawChange = after - before;

  return {
    rawChange: rawChange.toString(),
    solChange: Number(rawChange) / 1e9,
    direction: rawChange > 0n ? "IN" : rawChange < 0n ? "OUT" : "NONE"
  };
}

function detectDex(transaction) {
  const programs = new Set([
    RAYDIUM_AMM_V4,
    JUPITER_ROUTER,
    JUPITER_V6,
    PUMP_FUN,
    PUMP_AMM
  ]);

  const accountKeys = [
    ...(transaction?.transaction?.message?.accountKeys || []),
    ...(transaction?.meta?.loadedAddresses?.writable || []),
    ...(transaction?.meta?.loadedAddresses?.readonly || [])
  ];

  const keyValue = (key) =>
    typeof key === "string" ? key : key?.pubkey || key?.address || null;

  const matches = (instruction) => {
    const id =
      instruction?.programId ||
      instruction?.program ||
      keyValue(accountKeys[instruction?.programIdIndex]);
    return programs.has(id) ? id : null;
  };

  const ids = [
    ...(transaction?.transaction?.message?.instructions || []),
    ...(transaction?.meta?.innerInstructions || []).flatMap(
      (group) => group.instructions || []
    )
  ].map(matches).filter(Boolean);

  if (ids.includes(JUPITER_ROUTER) || ids.includes(JUPITER_V6)) return "jupiter";
  if (ids.includes(RAYDIUM_AMM_V4)) return "raydium_amm_v4";
  if (ids.includes(PUMP_AMM)) return "pump_amm";
  if (ids.includes(PUMP_FUN)) return "pump_fun";
  return null;
}

function buildLegacyTrade(transaction, wallet, type, tokenChange, solChange) {
  const dex = detectDex(transaction);
  const feeSol = Number(transaction?.meta?.fee || 0) / 1e9;
  const netSol = Math.abs(solChange.solChange);
  const grossSol = netSol + feeSol;

  if (!Number.isFinite(grossSol) || grossSol <= SOL_TRADE_EPSILON) {
    return null;
  }

  return {
    wallet,
    type,
    tokenMint: tokenChange.mint,
    tokenAmount: tokenChange.amount,
    solAmount: grossSol,
    feeSol,
    estimatedPriceSol: grossSol / tokenChange.amount,
    signature: getSignature(transaction),
    blockTime: transaction?.blockTime || null,
    parser: "legacy_balance",
    dex: dex || null,
    eventIndex: 0,
    instructionIndex: null
  };
}

function tradeFromSwap(wallet, swap) {
  const tokenMint = swap.type === "BUY" ? swap.outputMint : swap.inputMint;
  const tokenAmount = swap.type === "BUY" ? swap.outputAmount : swap.inputAmount;
  const solAmount = swap.type === "BUY" ? swap.inputAmount : swap.outputAmount;

  return {
    wallet,
    type: swap.type,
    tokenMint,
    tokenAmount,
    solAmount,
    feeSol: swap.feeSol,
    estimatedPriceSol: swap.estimatedPriceSol,
    signature: swap.signature,
    blockTime: swap.blockTime,
    dex: swap.dex,
    parser: "instruction_swap",
    eventIndex: Number.isInteger(swap.eventIndex) ? swap.eventIndex : 0,
    instructionIndex: Number.isInteger(swap.instructionIndex)
      ? swap.instructionIndex
      : null
  };
}

export function parseTransaction(transaction, wallet) {
  if (!transaction?.meta) {
    return result("OTHER", { reason: "Missing transaction metadata" });
  }

  const tokenChanges = getTokenChanges(transaction, wallet);
  const solChange = getSolChange(transaction, wallet);
  const rewards = parseCreatorFeeClaims(transaction, wallet);
  let trades = [];

  // Creator-fee withdrawals are independent economic events. The old parser
  // intentionally excluded them from BUY/SELL heuristics; preserve that rule
  // while still exposing them through rewards[].
  if (rewards.length === 0) {
    trades = parseSwapTransactions(transaction, wallet).map((swap) =>
      tradeFromSwap(wallet, swap)
    );
  }

  // Temporary fallback for transaction types that still cannot be reconstructed
  // from instruction-level swap legs. It remains explicitly marked so analytics
  // can distinguish it from deterministic instruction parsing.
  if (trades.length === 0 && rewards.length === 0) {
    const nonWsolChanges = tokenChanges.filter(
      (change) => change.mint !== WSOL_MINT
    );
    const tokenIn = nonWsolChanges.filter((x) => x.direction === "IN");
    const tokenOut = nonWsolChanges.filter((x) => x.direction === "OUT");
    const meaningfulSol =
      solChange && Math.abs(solChange.solChange) > SOL_TRADE_EPSILON;

    if (tokenIn.length === 1 && meaningfulSol && solChange.direction === "OUT") {
      const trade = buildLegacyTrade(
        transaction,
        wallet,
        "BUY",
        tokenIn[0],
        solChange
      );
      if (trade) trades.push(trade);
    } else if (
      tokenOut.length === 1 &&
      meaningfulSol &&
      solChange.direction === "IN"
    ) {
      const trade = buildLegacyTrade(
        transaction,
        wallet,
        "SELL",
        tokenOut[0],
        solChange
      );
      if (trade) trades.push(trade);
    }
  }

  const transfers = parseTokenMovements(transaction, wallet, {
    trades,
    rewards
  });

  let type = "OTHER";
  let reason = "Balance movement classification";

  if (rewards.length > 0) {
    type = "CREATOR_FEE_CLAIM";
    reason = "Pump creator fee claim";
  } else if (trades.length > 1) {
    type = "MULTI_TRADE";
    reason = "Multiple instruction-level DEX swaps";
  } else if (trades.length === 1) {
    type = trades[0].type;
    reason = trades[0].parser === "instruction_swap"
      ? "Instruction-level DEX swap"
      : "Legacy balance-based classification";
  } else if (transfers.some((x) => x.direction === "IN")) {
    type = "TRANSFER_IN";
  } else if (transfers.some((x) => x.direction === "OUT")) {
    type = "TRANSFER_OUT";
  } else if (
    solChange &&
    Math.abs(solChange.solChange) > SOL_TRADE_EPSILON &&
    tokenChanges.length === 0
  ) {
    type = "SOL_TRANSFER";
  }

  return {
    type,
    reason,
    tokenChanges,
    solChange,
    // Backward compatibility for diagnostics/scripts that still expect one
    // trade. New code must consume trades[].
    trade: trades[0] || null,
    trades,
    transfers,
    rewards
  };
}
