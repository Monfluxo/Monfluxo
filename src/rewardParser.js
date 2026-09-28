const WSOL_MINT = "So11111111111111111111111111111111111111112";
const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPXxuEb";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const PUMP_FUN = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const PUMP_AMM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const PUMP_COLLECT_CREATOR_FEE_V2_PREFIX = "bdpoExJbbLb";
const PUMP_AMM_COLLECT_COIN_CREATOR_FEE_PREFIX = "ToNg27JNfmT";

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

function programIdOf(instruction, accountKeys) {
  return keyValue(instruction?.programId) ||
    instruction?.program ||
    keyValue(accountKeys[instruction?.programIdIndex]);
}

function amount(raw, decimals) {
  return Number(raw) / 10 ** decimals;
}

function tokenBalance(transaction, accountAddress, mint, side) {
  const keys = allAccountKeys(transaction);
  const balances = side === "pre"
    ? transaction?.meta?.preTokenBalances || []
    : transaction?.meta?.postTokenBalances || [];

  for (const item of balances) {
    if (item?.mint !== mint || item?.accountIndex == null) continue;
    if (keyValue(keys[item.accountIndex]) !== accountAddress) continue;
    return {
      raw: BigInt(item?.uiTokenAmount?.amount || "0"),
      decimals: Number(item?.uiTokenAmount?.decimals || 0)
    };
  }
  return null;
}

function destinationTokenDelta(transaction, accountAddress, mint) {
  const pre = tokenBalance(transaction, accountAddress, mint, "pre");
  const post = tokenBalance(transaction, accountAddress, mint, "post");
  const raw = (post?.raw || 0n) - (pre?.raw || 0n);
  return {
    raw: raw > 0n ? raw : 0n,
    decimals: post?.decimals ?? pre?.decimals ?? 0
  };
}

function nativeVaultDecrease(transaction, vaultAddress) {
  const keys = allAccountKeys(transaction);
  const index = keys.findIndex((key) => keyValue(key) === vaultAddress);
  if (index < 0) return 0n;
  const pre = BigInt(transaction?.meta?.preBalances?.[index] || 0);
  const post = BigInt(transaction?.meta?.postBalances?.[index] || 0);
  return pre > post ? pre - post : 0n;
}

function parsedTransferAmount(transaction, outerIndex, source, destination) {
  const group = (transaction?.meta?.innerInstructions || [])
    .find((item) => item.index === outerIndex);
  let total = 0n;
  let decimals = null;

  for (const instruction of group?.instructions || []) {
    const parsed = instruction?.parsed;
    const info = parsed?.info;
    const program = keyValue(instruction?.programId) || instruction?.program;
    const tokenProgram =
      program === "spl-token" ||
      program === "spl-token-2022" ||
      program === SPL_TOKEN_PROGRAM ||
      program === TOKEN_2022_PROGRAM;

    if (
      tokenProgram &&
      (parsed?.type === "transfer" || parsed?.type === "transferChecked") &&
      info?.source === source &&
      info?.destination === destination
    ) {
      total += BigInt(info?.amount ?? info?.tokenAmount?.amount ?? "0");
      const parsedDecimals = info?.decimals ?? info?.tokenAmount?.decimals;
      if (parsedDecimals != null) decimals = Number(parsedDecimals);
    }
  }

  return { raw: total, decimals };
}

function parsedNativeTransferAmount(transaction, outerIndex, source, destination) {
  const group = (transaction?.meta?.innerInstructions || [])
    .find((item) => item.index === outerIndex);
  let total = 0n;

  for (const instruction of group?.instructions || []) {
    const info = instruction?.parsed?.info;
    const program = keyValue(instruction?.programId) || instruction?.program;
    if (
      program === SYSTEM_PROGRAM &&
      instruction?.parsed?.type === "transfer" &&
      info?.source === source &&
      info?.destination === destination
    ) {
      total += BigInt(info?.lamports || 0);
    }
  }
  return total;
}

export function parseCreatorFeeClaims(transaction, wallet) {
  const accountKeys = allAccountKeys(transaction);
  const outerInstructions = transaction?.transaction?.message?.instructions || [];
  const claims = [];

  outerInstructions.forEach((instruction, outerIndex) => {
    const programId = programIdOf(instruction, accountKeys);
    const data = instruction?.data || "";
    const isPumpV2 =
      programId === PUMP_FUN &&
      data.startsWith(PUMP_COLLECT_CREATOR_FEE_V2_PREFIX) &&
      Array.isArray(instruction?.accounts) &&
      instruction.accounts.length >= 10;
    const isPumpAmm =
      programId === PUMP_AMM &&
      data.startsWith(PUMP_AMM_COLLECT_COIN_CREATOR_FEE_PREFIX) &&
      Array.isArray(instruction?.accounts) &&
      instruction.accounts.length >= 8;

    if (!isPumpV2 && !isPumpAmm) return;

    const accounts = instruction.accounts.map((account) =>
      typeof account === "number" ? keyValue(accountKeys[account]) : keyValue(account) || account
    );

    const creator = isPumpV2 ? accounts[0] : accounts[2];
    if (creator !== wallet) return;

    const creatorTokenAccount = isPumpV2 ? accounts[1] : accounts[5];
    const creatorVault = isPumpV2 ? accounts[2] : accounts[3];
    const creatorVaultTokenAccount = isPumpV2 ? accounts[3] : accounts[4];
    const quoteMint = isPumpV2 ? accounts[4] : accounts[0];
    const quoteTokenProgram = isPumpV2 ? accounts[5] : accounts[1];

    let rawAmount = 0n;
    let decimals = quoteMint === WSOL_MINT ? 9 : 0;
    let amountSource = "inner_instruction";

    // Pump AMM always pays from the vault ATA. Pump bonding-curve V2 pays
    // native lamports when the quote mint is WSOL and SPL tokens otherwise.
    if (isPumpAmm || quoteMint !== WSOL_MINT) {
      const parsed = parsedTransferAmount(
        transaction,
        outerIndex,
        creatorVaultTokenAccount,
        creatorTokenAccount
      );
      rawAmount = parsed.raw;
      if (parsed.decimals != null) decimals = parsed.decimals;

      if (rawAmount === 0n) {
        const delta = destinationTokenDelta(transaction, creatorTokenAccount, quoteMint);
        rawAmount = delta.raw;
        decimals = delta.decimals;
        amountSource = "destination_balance_delta";
      }
    } else {
      rawAmount = parsedNativeTransferAmount(
        transaction,
        outerIndex,
        creatorVault,
        creator
      );
      if (rawAmount === 0n) {
        rawAmount = nativeVaultDecrease(transaction, creatorVault);
        amountSource = "creator_vault_balance_delta";
      }
      decimals = 9;
    }

    claims.push({
      wallet,
      type: "CREATOR_FEE_CLAIM",
      dex: isPumpV2 ? "pump_fun" : "pump_amm",
      quoteMint,
      quoteTokenProgram,
      amount: amount(rawAmount.toString(), decimals),
      rawAmount: rawAmount.toString(),
      decimals,
      creator,
      creatorTokenAccount,
      creatorVault,
      creatorVaultTokenAccount,
      signature: signatureOf(transaction),
      blockTime: transaction?.blockTime ?? null,
      instructionIndex: outerIndex,
      parser: isPumpV2
        ? `pump_collect_creator_fee_v2:${amountSource}`
        : `pump_collect_coin_creator_fee:${amountSource}`
    });
  });

  return claims;
}
