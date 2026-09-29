const SYSTEM_PROGRAM = "11111111111111111111111111111111";

function keyValue(value) {
  return typeof value === "string"
    ? value
    : value?.pubkey || value?.address || value?.toString?.() || null;
}

function signatureOf(transaction) {
  return transaction?.transaction?.signatures?.[0] || transaction?.signature || null;
}

function systemTransfer(instruction) {
  const parsed = instruction?.parsed;
  const info = parsed?.info || {};
  const program = keyValue(instruction?.programId) || instruction?.program || null;
  const isSystem = program === SYSTEM_PROGRAM || program === "system";

  if (!isSystem || parsed?.type !== "transfer" || !info.source || !info.destination) {
    return null;
  }

  const lamports = Number(info.lamports || 0);
  if (!Number.isFinite(lamports) || lamports <= 0) return null;

  return {
    sourceAddress: info.source,
    destinationAddress: info.destination,
    rawAmount: String(Math.trunc(lamports)),
    amount: lamports / 1e9
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

  return events;
}
