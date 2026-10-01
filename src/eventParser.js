import { parseSwapTransaction } from "./swapParser.js";

const WSOL_MINT = "So11111111111111111111111111111111111111112";
const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPXxuEb";
const RAYDIUM_AMM_V4 = "675kPX9MHTjS2zt1qfr1NYHuZeLXfQM9H24yFSUt1Mp8";
const JUPITER_ROUTER = "proVF4pMXVaYqmy4NjniPh4pqKNfMmsihgd4wdkCX3u";
const JUPITER_V6 = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const PUMP_FUN = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const PUMP_AMM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";

function keyValue(key) {
  return typeof key === "string" ? key : key?.pubkey || key?.address || null;
}

function allAccountKeys(transaction) {
  return [
    ...(transaction?.transaction?.message?.accountKeys || []),
    ...(transaction?.meta?.loadedAddresses?.writable || []),
    ...(transaction?.meta?.loadedAddresses?.readonly || [])
  ];
}

function signatureOf(transaction) {
  return transaction?.transaction?.signatures?.[0] || transaction?.signature || null;
}

function resolveProgramId(instruction, accountKeys) {
  return (
    instruction?.programId ||
    instruction?.program ||
    keyValue(accountKeys[instruction?.programIdIndex])
  );
}

function dexForProgram(programId) {
  if (programId === JUPITER_ROUTER || programId === JUPITER_V6) return "jupiter";
  if (programId === RAYDIUM_AMM_V4) return "raydium_amm_v4";
  if (programId === PUMP_AMM) return "pump_amm";
  if (programId === PUMP_FUN) return "pump_fun";
  return null;
}

function isTokenProgram(program) {
  return (
    program === "spl-token" ||
    program === "spl-token-2022" ||
    program === SPL_TOKEN_PROGRAM ||
    program === TOKEN_2022_PROGRAM
  );
}

function buildTokenAccountMap(transaction) {
  const map = new Map();
  const accountKeys = allAccountKeys(transaction);

  for (const item of [
    ...(transaction?.meta?.preTokenBalances || []),
    ...(transaction?.meta?.postTokenBalances || [])
  ]) {
    if (item?.accountIndex == null || !item?.mint) continue;
    const account = keyValue(accountKeys[item.accountIndex]);
    if (!account) continue;

    map.set(account, {
      mint: item.mint,
      owner: item.owner || map.get(account)?.owner || null,
      decimals: item.uiTokenAmount?.decimals ?? map.get(account)?.decimals ?? 0
    });
  }

  const inspectInitialization = (instruction) => {
    const parsed = instruction?.parsed;
    const program = instruction?.program || instruction?.programId;
    if (
      !isTokenProgram(program) ||
      !["initializeAccount", "initializeAccount2", "initializeAccount3"].includes(parsed?.type)
    ) {
      return;
    }

    const info = parsed?.info || {};
    if (!info.account || !info.mint) return;
    map.set(info.account, {
      mint: info.mint,
      owner: info.owner || info.authority || null,
      decimals: map.get(info.account)?.decimals || 0
    });
  };

  for (const instruction of transaction?.transaction?.message?.instructions || []) {
    inspectInitialization(instruction);
  }
  for (const group of transaction?.meta?.innerInstructions || []) {
    for (const instruction of group.instructions || []) inspectInitialization(instruction);
  }

  return map;
}

function mintDecimals(transaction, mint, tokenAccountMap) {
  if (mint === WSOL_MINT) return 9;
  for (const info of tokenAccountMap.values()) {
    if (info.mint === mint && Number.isInteger(info.decimals)) return info.decimals;
  }
  for (const item of [
    ...(transaction?.meta?.preTokenBalances || []),
    ...(transaction?.meta?.postTokenBalances || [])
  ]) {
    if (item.mint === mint) return item.uiTokenAmount?.decimals ?? 0;
  }
  return 0;
}

function tokenTransfers(transaction, tokenAccountMap) {
  const result = [];
  const visit = (instruction, parentIndex) => {
    const parsed = instruction?.parsed;
    const info = parsed?.info || {};
    const program = instruction?.program || instruction?.programId;
    if (
      !isTokenProgram(program) ||
      !["transfer", "transferChecked"].includes(parsed?.type) ||
      !info.source ||
      !info.destination
    ) {
      return;
    }

    const raw = info.amount ?? info.tokenAmount?.amount;
    if (raw == null) return;
    const mint =
      info.mint ||
      info.tokenAmount?.mint ||
      tokenAccountMap.get(info.source)?.mint ||
      tokenAccountMap.get(info.destination)?.mint ||
      null;
    if (!mint) return;

    result.push({
      parentIndex,
      source: info.source,
      destination: info.destination,
      mint,
      rawAmount: BigInt(String(raw)),
      decimals:
        Number(info.decimals ?? info.tokenAmount?.decimals) ||
        tokenAccountMap.get(info.source)?.decimals ||
        tokenAccountMap.get(info.destination)?.decimals ||
        0
    });
  };

  (transaction?.transaction?.message?.instructions || []).forEach((instruction, index) =>
    visit(instruction, index)
  );
  for (const group of transaction?.meta?.innerInstructions || []) {
    for (const instruction of group.instructions || []) visit(instruction, group.index);
  }
  return result;
}

function nativeSolTransfers(transaction) {
  const result = [];
  const visit = (instruction, parentIndex) => {
    const program = instruction?.programId || instruction?.program;
    const parsed = instruction?.parsed;
    const info = parsed?.info || {};
    if (
      program !== "11111111111111111111111111111111" ||
      parsed?.type !== "transfer" ||
      !info.source ||
      !info.destination
    ) {
      return;
    }
    const lamports = BigInt(info.lamports || 0);
    if (lamports <= 0n) return;
    result.push({ parentIndex, source: info.source, destination: info.destination, lamports });
  };

  (transaction?.transaction?.message?.instructions || []).forEach((instruction, index) =>
    visit(instruction, index)
  );
  for (const group of transaction?.meta?.innerInstructions || []) {
    for (const instruction of group.instructions || []) visit(instruction, group.index);
  }
  return result;
}

function aggregateByMint(items) {
  const map = new Map();
  for (const item of items) {
    map.set(item.mint, (map.get(item.mint) || 0n) + item.rawAmount);
  }
  return map;
}

function toAmount(raw, decimals) {
  return Number(raw) / 10 ** decimals;
}

function groupedSwapTransactions(transaction, wallet) {
  const accountKeys = allAccountKeys(transaction);
  const outer = transaction?.transaction?.message?.instructions || [];
  const tokenAccountMap = buildTokenAccountMap(transaction);
  const transfers = tokenTransfers(transaction, tokenAccountMap);
  const solTransfers = nativeSolTransfers(transaction);
  const walletTokenAccounts = new Set(
    [...tokenAccountMap.entries()]
      .filter(([, info]) => info.owner === wallet)
      .map(([account]) => account)
  );

  const parentIndexes = new Set([
    ...transfers.map((x) => x.parentIndex),
    ...solTransfers.map((x) => x.parentIndex)
  ]);
  const swaps = [];

  for (const parentIndex of [...parentIndexes].filter(Number.isInteger).sort((a, b) => a - b)) {
    const programId = resolveProgramId(outer[parentIndex], accountKeys);
    const dex = dexForProgram(programId);
    if (!dex) continue;

    const groupTransfers = transfers.filter((x) => x.parentIndex === parentIndex);
    const inputs = aggregateByMint(
      groupTransfers.filter(
        (x) => walletTokenAccounts.has(x.source) && !walletTokenAccounts.has(x.destination)
      )
    );
    const outputs = aggregateByMint(
      groupTransfers.filter(
        (x) => !walletTokenAccounts.has(x.source) && walletTokenAccounts.has(x.destination)
      )
    );

    const nonWsolInputs = [...inputs.entries()].filter(([mint]) => mint !== WSOL_MINT);
    const nonWsolOutputs = [...outputs.entries()].filter(([mint]) => mint !== WSOL_MINT);
    const wsolInput = inputs.get(WSOL_MINT) || 0n;
    const wsolOutput = outputs.get(WSOL_MINT) || 0n;

    const groupSol = solTransfers.filter((x) => x.parentIndex === parentIndex);
    const nativeInput = groupSol
      .filter((x) => x.source === wallet && x.destination !== wallet)
      .reduce((sum, x) => sum + x.lamports, 0n);
    const nativeOutput = groupSol
      .filter((x) => x.destination === wallet && x.source !== wallet)
      .reduce((sum, x) => sum + x.lamports, 0n);

    if (nonWsolOutputs.length === 1 && (wsolInput > 0n || nativeInput > 0n)) {
      const [outputMint, outputRaw] = nonWsolOutputs[0];
      const quoteRaw = wsolInput > 0n ? wsolInput : nativeInput;
      const inputAmount = toAmount(quoteRaw, 9);
      const outputAmount = toAmount(
        outputRaw,
        mintDecimals(transaction, outputMint, tokenAccountMap)
      );
      if (inputAmount > 0 && outputAmount > 0) {
        swaps.push({
          wallet,
          type: "BUY",
          dex,
          inputMint: WSOL_MINT,
          inputAmount,
          outputMint,
          outputAmount,
          estimatedPriceSol: inputAmount / outputAmount,
          feeSol: Number(transaction?.meta?.fee || 0) / 1e9,
          signature: signatureOf(transaction),
          blockTime: transaction?.blockTime ?? null,
          eventIndex: parentIndex,
          instructionIndex: parentIndex
        });
      }
      continue;
    }

    if (nonWsolInputs.length === 1 && (wsolOutput > 0n || nativeOutput > 0n)) {
      const [inputMint, inputRaw] = nonWsolInputs[0];
      const quoteRaw = wsolOutput > 0n ? wsolOutput : nativeOutput;
      const inputAmount = toAmount(
        inputRaw,
        mintDecimals(transaction, inputMint, tokenAccountMap)
      );
      const outputAmount = toAmount(quoteRaw, 9);
      if (inputAmount > 0 && outputAmount > 0) {
        swaps.push({
          wallet,
          type: "SELL",
          dex,
          inputMint,
          inputAmount,
          outputMint: WSOL_MINT,
          outputAmount,
          estimatedPriceSol: outputAmount / inputAmount,
          feeSol: Number(transaction?.meta?.fee || 0) / 1e9,
          signature: signatureOf(transaction),
          blockTime: transaction?.blockTime ?? null,
          eventIndex: parentIndex,
          instructionIndex: parentIndex
        });
      }
    }
  }

  return swaps;
}

export function parseSwapTransactions(transaction, wallet) {
  const grouped = groupedSwapTransactions(transaction, wallet);

  // Multiple independently observable DEX instruction groups are preserved as
  // separate events. This is the core event-model-v2 behavior.
  if (grouped.length > 1) return grouped;

  // For ordinary one-swap transactions keep the battle-tested parser as the
  // source of amounts and use the grouped parser only to recover its index.
  const single = parseSwapTransaction(transaction, wallet);
  if (single) {
    return [{
      ...single,
      eventIndex: grouped[0]?.eventIndex ?? 0,
      instructionIndex: grouped[0]?.instructionIndex ?? null
    }];
  }

  return grouped;
}

function walletTokenChanges(transaction, wallet, tokenAccountMap) {
  const aggregate = (balances) => {
    const map = new Map();
    for (const item of balances || []) {
      if (item?.owner !== wallet || !item?.mint) continue;
      const prev = map.get(item.mint) || {
        raw: 0n,
        decimals: item.uiTokenAmount?.decimals ?? 0
      };
      map.set(item.mint, {
        raw: prev.raw + BigInt(item.uiTokenAmount?.amount || "0"),
        decimals: item.uiTokenAmount?.decimals ?? prev.decimals
      });
    }
    return map;
  };

  const pre = aggregate(transaction?.meta?.preTokenBalances);
  const post = aggregate(transaction?.meta?.postTokenBalances);
  const result = [];
  for (const mint of new Set([...pre.keys(), ...post.keys()])) {
    const before = pre.get(mint)?.raw || 0n;
    const after = post.get(mint)?.raw || 0n;
    const delta = after - before;
    if (delta === 0n) continue;
    result.push({
      mint,
      rawChange: delta,
      decimals:
        post.get(mint)?.decimals ??
        pre.get(mint)?.decimals ??
        mintDecimals(transaction, mint, tokenAccountMap)
    });
  }
  return result;
}

export function parseTokenMovements(transaction, wallet, options = {}) {
  const trades = options.trades || [];
  const rewards = options.rewards || [];
  const excludedMints = new Set([
    WSOL_MINT,
    ...trades.map((trade) => trade.tokenMint).filter(Boolean),
    ...rewards.map((reward) => reward.quoteMint).filter(Boolean)
  ]);

  const tokenAccountMap = buildTokenAccountMap(transaction);
  const transfers = tokenTransfers(transaction, tokenAccountMap);
  const walletAccounts = new Set(
    [...tokenAccountMap.entries()]
      .filter(([, info]) => info.owner === wallet)
      .map(([account]) => account)
  );

  const changes = walletTokenChanges(transaction, wallet, tokenAccountMap)
    .filter((change) => !excludedMints.has(change.mint));

  return changes.map((change, index) => {
    const direction = change.rawChange > 0n ? "IN" : "OUT";
    const candidates = transfers.filter((transfer) => {
      if (transfer.mint !== change.mint) return false;
      return direction === "IN"
        ? walletAccounts.has(transfer.destination)
        : walletAccounts.has(transfer.source);
    });
    const candidate = candidates.sort((a, b) =>
      a.rawAmount === b.rawAmount ? 0 : a.rawAmount > b.rawAmount ? -1 : 1
    )[0] || null;

    const sourceTokenAccount = candidate?.source || null;
    const destinationTokenAccount = candidate?.destination || null;
    const sourceAddress = sourceTokenAccount
      ? tokenAccountMap.get(sourceTokenAccount)?.owner || null
      : null;
    const destinationAddress = destinationTokenAccount
      ? tokenAccountMap.get(destinationTokenAccount)?.owner || null
      : null;
    const rawAmount = change.rawChange < 0n ? -change.rawChange : change.rawChange;

    return {
      wallet,
      type: direction === "IN" ? "TRANSFER_IN" : "TRANSFER_OUT",
      direction,
      mint: change.mint,
      amount: toAmount(rawAmount, change.decimals),
      rawAmount: rawAmount.toString(),
      decimals: change.decimals,
      sourceAddress,
      destinationAddress,
      sourceTokenAccount,
      destinationTokenAccount,
      signature: signatureOf(transaction),
      blockTime: transaction?.blockTime ?? null,
      eventIndex: index,
      instructionIndex: candidate?.parentIndex ?? null,
      parser: "wallet_balance_movement"
    };
  });
}
