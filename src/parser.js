import { parseCreatorFeeClaims } from "./swapParser.js";
import { parseSwapTransactions, parseTokenMovements } from "./eventParser.js";

const WSOL_MINT = "So11111111111111111111111111111111111111112";
const SOL_TRADE_EPSILON = 0.00001;

function result(type, extra = {}) {
  return {
    type,
    tokenChanges: [],
    solChange: null,
    trades: [],
    transfers: [],
    rewards: [],
    trade: null,
    ...extra
  };
}

function getSignature(transaction) {
  return transaction?.transaction?.signatures?.[0] || transaction?.signature || null;
}

function getAccountKeyValue(key) {
  return typeof key === "string" ? key : key?.pubkey || key?.address || null;
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
    const pre = preBalances.filter((x) => x.mint === mint && x.owner === wallet);
    const post = postBalances.filter((x) => x.mint === mint && x.owner === wallet);
    const before = pre.reduce((total, item) => total + BigInt(item.uiTokenAmount?.amount || "0"), 0n);
    const after = post.reduce((total, item) => total + BigInt(item.uiTokenAmount?.amount || "0"), 0n);
    const change = after - before;
    if (change === 0n) continue;
    const decimals = post[0]?.uiTokenAmount?.decimals ?? pre[0]?.uiTokenAmount?.decimals ?? 0;
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
  const walletIndex = accountKeys.findIndex((key) => getAccountKeyValue(key) === wallet);
  if (walletIndex < 0 || !Array.isArray(meta?.preBalances) || !Array.isArray(meta?.postBalances)) return null;
  const before = BigInt(meta.preBalances[walletIndex] || 0);
  const after = BigInt(meta.postBalances[walletIndex] || 0);
  const rawChange = after - before;
  return {
    rawChange: rawChange.toString(),
    solChange: Number(rawChange) / 1e9,
    direction: rawChange > 0n ? "IN" : rawChange < 0n ? "OUT" : "NONE"
  };
}

function normalizeSwap(wallet, swap, fallbackIndex = 0) {
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
    eventIndex: swap.eventIndex ?? fallbackIndex,
    instructionIndex: swap.instructionIndex ?? null,
    dex: swap.dex,
    parser: "instruction_swap_v2"
  };
}

export function parseTransaction(transaction, wallet) {
  if (!transaction?.meta) return result("OTHER", { reason: "Missing transaction metadata" });

  const tokenChanges = getTokenChanges(transaction, wallet);
  const solChange = getSolChange(transaction, wallet);
  const rewards = parseCreatorFeeClaims(transaction, wallet);

  if (rewards.length > 0) {
    return result("CREATOR_FEE_CLAIM", {
      reason: "Pump creator fee claim",
      tokenChanges,
      solChange,
      rewards,
      transfers: parseTokenMovements(transaction, wallet, { rewards })
    });
  }

  const swaps = parseSwapTransactions(transaction, wallet);
  const trades = swaps.map((swap, index) => normalizeSwap(wallet, swap, index));
  const transfers = parseTokenMovements(transaction, wallet, { trades, rewards: [] });

  if (trades.length > 0) {
    const type = trades.length === 1 ? trades[0].type : "MULTI_TRADE";
    return {
      type,
      reason: trades.length === 1
        ? "Instruction-level DEX swap"
        : "Multiple instruction-level DEX swaps",
      tokenChanges,
      solChange,
      trades,
      transfers,
      rewards: [],
      trade: trades[0] || null
    };
  }

  const nonWsolChanges = tokenChanges.filter((change) => change.mint !== WSOL_MINT);
  const tokenIn = nonWsolChanges.filter((x) => x.direction === "IN");
  const tokenOut = nonWsolChanges.filter((x) => x.direction === "OUT");
  const meaningfulSol = solChange && Math.abs(solChange.solChange) > SOL_TRADE_EPSILON;

  let type = "OTHER";
  if (tokenIn.length > 0 && !meaningfulSol) type = "TRANSFER_IN";
  else if (tokenOut.length > 0 && !meaningfulSol) type = "TRANSFER_OUT";
  else if (meaningfulSol && tokenIn.length === 0 && tokenOut.length === 0) type = "SOL_TRANSFER";

  return {
    type,
    reason: "Event-model balance movement classification",
    tokenChanges,
    solChange,
    trades: [],
    transfers,
    rewards: [],
    trade: null,
    signature: getSignature(transaction)
  };
}
