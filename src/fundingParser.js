const SYSTEM_PROGRAM = "11111111111111111111111111111111";

function keyValue(value) {
  return typeof value === "string"
    ? value
    : value?.pubkey || value?.address || value?.toString?.() || null;
}

function signatureOf(transaction) {
  return transaction?.transaction?.signatures?.[0] || transaction?.signature || null;
}

function accountKeys(transaction) {
  return [
    ...(transaction?.transaction?.message?.accountKeys || []),
    ...(transaction?.meta?.loadedAddresses?.writable || []),
    ...(transaction?.meta?.loadedAddresses?.readonly || [])
  ].map(keyValue);
}

function systemTransfer(instruction) {
  const parsed = instruction?.parsed;
  const info = parsed?.info || {};
  const program = keyValue(instruction?.programId) || instruction?.program || null;
  const isSystem = program === SYSTEM_PROGRAM || program === "system";
  const parsedType = parsed?.type;

  if (!isSystem || !["transfer", "transferWithSeed"].includes(parsedType) || !info.source || !info.destination) {
    return null;
  }

  const lamports = Number(info.lamports ?? info.amount ?? 0);
  if (!Number.isFinite(lamports) || lamports <= 0) return null;

  return {
    sourceAddress: info.source,
    destinationAddress: info.destination,
    rawAmount: String(Math.trunc(lamports)),
    amount: lamports / 1e9
  };
}

function balanceDeltaFunding(transaction, wallet) {
  const keys = accountKeys(transaction);
  const walletIndex = keys.findIndex((key) => key === wallet);
  if (walletIndex < 0) return null;

  const pre = transaction?.meta?.preBalances || [];
  const post = transaction?.meta?.postBalances || [];
  const before = Number(pre[walletIndex]);
  const after = Number(post[walletIndex]);
  if (!Number.isFinite(before) || !Number.isFinite(after)) return null;

  const walletDelta = after - before;
  if (!(walletDelta > 0)) return null;

  let sourceAddress = null;
  let largestDebit = 0;
  for (let index = 0; index < Math.min(pre.length, post.length, keys.length); index++) {
    if (index === walletIndex) continue;
    const debit = Number(pre[index]) - Number(post[index]);
    if (Number.isFinite(debit) && debit > largestDebit) {
      largestDebit = debit;
      sourceAddress = keys[index] || null;
    }
  }

  // A plain external SOL funding transaction should have a counterparty whose
  // balance decreased materially. This avoids inventing a source for rent-only
  // or bookkeeping deltas where no external funder can be identified.
  if (!(largestDebit > 0) || !sourceAddress || sourceAddress === wallet) return null;

  return {
    sourceAddress,
    destinationAddress: wallet,
    rawAmount: String(Math.trunc(walletDelta)),
    amount: walletDelta / 1e9
  };
}

export function parseNativeSolFunding(transaction, wallet, options = {}) {
  const trades = options.trades || [];
  const rewards = options.rewards || [];

  // A native SOL transfer inside a swap/creator-fee transaction is economic
  // settlement, not external funding. Funding must remain distinct from PnL.
  if (trades.length || rewards.length) return [];

  const events = [];
  const signature = signatureOf(transaction);
  const blockTime = transaction?.blockTime ?? null;

  (transaction?.transaction?.message?.instructions || []).forEach((instruction, index) => {
    const transfer = systemTransfer(instruction);
    if (!transfer) return;
    if (transfer.destinationAddress !== wallet || transfer.sourceAddress === wallet) return;

    events.push({
      ...transfer,
      wallet,
      signature,
      blockTime,
      eventIndex: index * 1000,
      instructionIndex: index,
      assetType: "SOL",
      assetId: "SOL",
      decimals: 9,
      parser: "system_transfer"
    });
  });

  for (const group of transaction?.meta?.innerInstructions || []) {
    (group.instructions || []).forEach((instruction, childIndex) => {
      const transfer = systemTransfer(instruction);
      if (!transfer) return;
      if (transfer.destinationAddress !== wallet || transfer.sourceAddress === wallet) return;

      events.push({
        ...transfer,
        wallet,
        signature,
        blockTime,
        eventIndex: Number(group.index || 0) * 1000 + childIndex + 1,
        instructionIndex: Number(group.index || 0),
        assetType: "SOL",
        assetId: "SOL",
        decimals: 9,
        parser: "system_transfer_inner"
      });
    });
  }

  // getTransactionsForAddress can return compiled/raw instructions for some
  // transactions, so the parsed SystemProgram transfer is not always present.
  // In that case use the wallet's actual lamport balance increase and the
  // largest external debit as a conservative native-funding fallback.
  if (!events.length) {
    const transfer = balanceDeltaFunding(transaction, wallet);
    if (transfer) {
      events.push({
        ...transfer,
        wallet,
        signature,
        blockTime,
        eventIndex: 999999,
        instructionIndex: null,
        assetType: "SOL",
        assetId: "SOL",
        decimals: 9,
        parser: "native_balance_delta"
      });
    }
  }

  return events;
}
