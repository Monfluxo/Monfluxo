const WSOL_MINT = "So11111111111111111111111111111111111111112";
const SOL_EPSILON = 0.000000001;
const SOL_TRADE_EPSILON = 0.00001;

function result(type, extra = {}) {
  return {
    type,
    tokenChanges: [],
    solChange: null,
    trade: null,
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
  const accountKeys = transaction?.transaction?.message?.accountKeys || [];

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

function buildTrade(transaction, wallet, type, tokenChange, solChange) {
  const feeLamports = Number(transaction?.meta?.fee || 0);
  const feeSol = feeLamports / 1e9;
  const netSol = Math.abs(solChange.solChange);

  // The wallet's native SOL balance includes transaction fees.
  // For a SOL -> token buy, gross SOL spent = net balance decrease + fee.
  // For a token -> SOL sell, gross SOL received = net balance increase + fee.
  const grossSol =
    type === "BUY"
      ? netSol + feeSol
      : netSol + feeSol;

  if (!Number.isFinite(grossSol) || grossSol <= SOL_TRADE_EPSILON) {
    return null;
  }

  const estimatedPriceSol = grossSol / tokenChange.amount;

  return {
    wallet,
    type,
    tokenMint: tokenChange.mint,
    tokenAmount: tokenChange.amount,
    solAmount: grossSol,
    feeSol,
    estimatedPriceSol,
    signature: getSignature(transaction),
    blockTime: transaction?.blockTime || null
  };
}

export function parseTransaction(transaction, wallet) {
  if (!transaction?.meta) {
    return result("OTHER", { reason: "Missing transaction metadata" });
  }

  const tokenChanges = getTokenChanges(transaction, wallet);
  const solChange = getSolChange(transaction, wallet);

  const nonWsolChanges = tokenChanges.filter(
    (change) => change.mint !== WSOL_MINT
  );

  const tokenIn = nonWsolChanges.filter((x) => x.direction === "IN");
  const tokenOut = nonWsolChanges.filter((x) => x.direction === "OUT");

  const meaningfulSol =
    solChange && Math.abs(solChange.solChange) > SOL_TRADE_EPSILON;

  let type = "OTHER";
  let trade = null;

  // Prototype scope: SOL-paired swaps. Ignore WSOL as the traded memecoin.
  // A future USDC/USDT quote extractor will use token-token movements.
  if (tokenIn.length === 1 && meaningfulSol && solChange.direction === "OUT") {
    type = "BUY";
    trade = buildTrade(transaction, wallet, type, tokenIn[0], solChange);
  } else if (
    tokenOut.length === 1 &&
    meaningfulSol &&
    solChange.direction === "IN"
  ) {
    type = "SELL";
    trade = buildTrade(transaction, wallet, type, tokenOut[0], solChange);
  } else if (tokenIn.length > 0 && !meaningfulSol) {
    type = "TRANSFER_IN";
  } else if (tokenOut.length > 0 && !meaningfulSol) {
    type = "TRANSFER_OUT";
  } else if (meaningfulSol && tokenIn.length === 0 && tokenOut.length === 0) {
    type = "SOL_TRANSFER";
  }

  return {
    type,
    reason: trade ? "SOL-paired token swap candidate" : "Balance movement classification",
    tokenChanges,
    solChange,
    trade
  };
}
