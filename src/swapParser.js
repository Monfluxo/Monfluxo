const WSOL_MINT = "So11111111111111111111111111111111111111112";
const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const RAYDIUM_AMM_V4 = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";

function toAmount(raw, decimals) {
  return Number(raw) / 10 ** decimals;
}

function getAccountKeyValue(key) {
  return typeof key === "string"
    ? key
    : key?.pubkey || key?.address || null;
}

function getSignature(transaction) {
  return (
    transaction?.transaction?.signatures?.[0] ||
    transaction?.signature ||
    null
  );
}

function buildTokenAccountMap(transaction, wallet) {
  const map = new Map();

  for (const item of [
    ...(transaction?.meta?.preTokenBalances || []),
    ...(transaction?.meta?.postTokenBalances || [])
  ]) {
    if (item?.accountIndex == null || !item.mint) continue;

    const key =
      transaction?.transaction?.message?.accountKeys?.[item.accountIndex];
    const account = getAccountKeyValue(key);

    if (account) {
      map.set(account, {
        mint: item.mint,
        owner: item.owner || null,
        decimals: item.uiTokenAmount?.decimals ?? 0
      });
    }
  }

  const instructions = transaction?.transaction?.message?.instructions || [];

  for (const instruction of instructions) {
    const parsed = instruction?.parsed;
    const info = parsed?.info;

    if (
      instruction?.program === "spl-token" &&
      (parsed?.type === "initializeAccount" ||
        parsed?.type === "initializeAccount2" ||
        parsed?.type === "initializeAccount3") &&
      info?.account &&
      info?.mint
    ) {
      map.set(info.account, {
        mint: info.mint,
        owner: info.owner || info.authority || null,
        decimals: 0
      });
    }
  }

  // Some account metadata is only visible through inner instructions.
  for (const group of transaction?.meta?.innerInstructions || []) {
    for (const instruction of group.instructions || []) {
      const parsed = instruction?.parsed;
      const info = parsed?.info;

      if (
        instruction?.program === "spl-token" &&
        (parsed?.type === "initializeAccount" ||
          parsed?.type === "initializeAccount2" ||
          parsed?.type === "initializeAccount3") &&
        info?.account &&
        info?.mint
      ) {
        map.set(info.account, {
          mint: info.mint,
          owner: info.owner || info.authority || null,
          decimals: 0
        });
      }
    }
  }

  return map;
}

function getMintDecimals(transaction, mint, tokenAccountMap) {
  for (const account of tokenAccountMap.values()) {
    if (account.mint === mint && Number.isInteger(account.decimals)) {
      if (account.decimals > 0) return account.decimals;
    }
  }

  for (const item of [
    ...(transaction?.meta?.preTokenBalances || []),
    ...(transaction?.meta?.postTokenBalances || [])
  ]) {
    if (item.mint === mint) {
      return item.uiTokenAmount?.decimals ?? 0;
    }
  }

  return 0;
}

function getSplTransfers(transaction) {
  const transfers = [];

  for (const group of transaction?.meta?.innerInstructions || []) {
    for (const instruction of group.instructions || []) {
      const parsed = instruction?.parsed;
      const info = parsed?.info;

      if (
        instruction?.programId === SPL_TOKEN_PROGRAM ||
        instruction?.program === "spl-token"
      ) {
        if (
          (parsed?.type === "transfer" ||
            parsed?.type === "transferChecked") &&
          info?.source &&
          info?.destination &&
          (info?.amount != null || info?.tokenAmount?.amount != null)
        ) {
          transfers.push({
            source: info.source,
            destination: info.destination,
            rawAmount: String(
              info.amount ?? info.tokenAmount.amount
            ),
            mint: null,
            parentIndex: group.index
          });
        }
      }
    }
  }

  return transfers;
}

function getWalletTokenChanges(transaction, wallet, tokenAccountMap) {
  const changes = new Map();

  for (const [account, info] of tokenAccountMap) {
    if (info.owner !== wallet) continue;

    const pre = (transaction?.meta?.preTokenBalances || []).find(
      (item) => item.mint === info.mint && item.accountIndex != null &&
        getAccountKeyValue(
          transaction?.transaction?.message?.accountKeys?.[item.accountIndex]
        ) === account
    );

    const post = (transaction?.meta?.postTokenBalances || []).find(
      (item) => item.mint === info.mint && item.accountIndex != null &&
        getAccountKeyValue(
          transaction?.transaction?.message?.accountKeys?.[item.accountIndex]
        ) === account
    );

    const before = BigInt(pre?.uiTokenAmount?.amount || "0");
    const after = BigInt(post?.uiTokenAmount?.amount || "0");
    const delta = after - before;

    if (delta === 0n) continue;

    changes.set(info.mint, {
      mint: info.mint,
      rawChange: delta.toString(),
      decimals: post?.uiTokenAmount?.decimals ??
        pre?.uiTokenAmount?.decimals ??
        getMintDecimals(transaction, info.mint, tokenAccountMap)
    });
  }

  return changes;
}

function enrichTransferMints(transfers, tokenAccountMap) {
  return transfers.map((transfer) => ({
    ...transfer,
    mint:
      tokenAccountMap.get(transfer.source)?.mint ||
      tokenAccountMap.get(transfer.destination)?.mint ||
      null,
    decimals:
      tokenAccountMap.get(transfer.source)?.decimals ??
      tokenAccountMap.get(transfer.destination)?.decimals ??
      0
  }));
}

function findWalletSwapLegs(transaction, wallet) {
  const tokenAccountMap = buildTokenAccountMap(transaction, wallet);
  const transfers = enrichTransferMints(
    getSplTransfers(transaction),
    tokenAccountMap
  );

  const walletAccounts = new Set(
    [...tokenAccountMap.entries()]
      .filter(([, info]) => info.owner === wallet)
      .map(([account]) => account)
  );

  const inputs = transfers.filter(
    (transfer) =>
      transfer.mint &&
      walletAccounts.has(transfer.source) &&
      !walletAccounts.has(transfer.destination)
  );

  const outputs = transfers.filter(
    (transfer) =>
      transfer.mint &&
      !walletAccounts.has(transfer.source) &&
      walletAccounts.has(transfer.destination)
  );

  const walletChanges = getWalletTokenChanges(
    transaction,
    wallet,
    tokenAccountMap
  );

  const inputByMint = new Map();
  for (const transfer of inputs) {
    const raw = BigInt(transfer.rawAmount);
    inputByMint.set(
      transfer.mint,
      (inputByMint.get(transfer.mint) || 0n) + raw
    );
  }

  const outputByMint = new Map();
  for (const transfer of outputs) {
    const raw = BigInt(transfer.rawAmount);
    outputByMint.set(
      transfer.mint,
      (outputByMint.get(transfer.mint) || 0n) + raw
    );
  }

  return {
    tokenAccountMap,
    walletChanges,
    inputs: [...inputByMint.entries()],
    outputs: [...outputByMint.entries()]
  };
}

function hasProgram(transaction, programId) {
  const instructions = transaction?.transaction?.message?.instructions || [];
  return instructions.some(
    (instruction) =>
      instruction?.programId === programId ||
      instruction?.program === programId
  );
}

export function parseSwapTransaction(transaction, wallet) {
  if (!transaction?.meta) return null;

  const debugSignature = "3Vwt45aDB9ov9fceRsnhsvkkbd8iGUzNxumAHrXYcAwj43WHx57gwQ2E4caMUDAkhWzhGCV7ZvZtRHdF5VEQVn5";
  const debug = getSignature(transaction) === debugSignature;
  const isRaydium = hasProgram(transaction, RAYDIUM_AMM_V4);

  if (debug) {
    console.log("[SWAP DEBUG] Raydium:", isRaydium);
    console.log(
      "[SWAP DEBUG] outerPrograms:",
      (transaction?.transaction?.message?.instructions || []).map((instruction) => ({
        program: instruction?.program,
        programId: instruction?.programId
      }))
    );
  }

  if (!isRaydium) return null;

  const {
    tokenAccountMap,
    walletChanges,
    inputs,
    outputs
  } = findWalletSwapLegs(transaction, wallet);

  if (debug) {
    console.log("[SWAP DEBUG] Raydium:", isRaydium);
    console.log("[SWAP DEBUG] wallet:", wallet);
    console.log("[SWAP DEBUG] inputs:", inputs);
    console.log("[SWAP DEBUG] outputs:", outputs);
    console.log("[SWAP DEBUG] walletChanges:", [...walletChanges.values()]);
    console.log(
      "[SWAP DEBUG] walletAccounts:",
      [...tokenAccountMap.entries()]
        .filter(([, info]) => info.owner === wallet)
        .map(([account, info]) => ({ account, ...info }))
    );
    console.log(
      "[SWAP DEBUG] allTokenAccounts:",
      [...tokenAccountMap.entries()].map(([account, info]) => ({ account, ...info }))
    );
    console.log("[SWAP DEBUG] rawSplTransfers:", getSplTransfers(transaction));
  }

  const wsolInput = inputs.find(([mint]) => mint === WSOL_MINT);
  const wsolOutput = outputs.find(([mint]) => mint === WSOL_MINT);

  const nonWsolInputs = inputs.filter(([mint]) => mint !== WSOL_MINT);
  const nonWsolOutputs = outputs.filter(([mint]) => mint !== WSOL_MINT);

  // For temporary WSOL accounts, account-level metadata can disappear
  // from pre/post token balances after the account is closed. When that
  // happens, use the wallet's actual token delta plus the observed SPL
  // transfer as a conservative Raydium fallback.
  const walletNonWsolChanges = [...walletChanges.values()].filter(
    (change) => change.mint !== WSOL_MINT
  );

  const fallbackTokenIn = walletNonWsolChanges.filter(
    (change) => BigInt(change.rawChange) > 0n
  );
  const fallbackTokenOut = walletNonWsolChanges.filter(
    (change) => BigInt(change.rawChange) < 0n
  );

  const fallbackWsolInput = inputs
    .filter(([mint]) => mint === WSOL_MINT)
    .reduce((sum, [, raw]) => sum + raw, 0n);

  if (
    (wsolInput && nonWsolOutputs.length === 1) ||
    (fallbackWsolInput > 0n && fallbackTokenIn.length === 1)
  ) {
    const effectiveWsolInput = wsolInput
      ? wsolInput[1]
      : fallbackWsolInput;
    const effectiveOutput = wsolInput && nonWsolOutputs.length === 1
      ? nonWsolOutputs[0]
      : [
          fallbackTokenIn[0].mint,
          BigInt(fallbackTokenIn[0].rawChange)
        ];
    const [outputMint, outputRaw] = effectiveOutput;
    const outputDecimals = getMintDecimals(
      transaction,
      outputMint,
      tokenAccountMap
    );
    const inputRaw = effectiveWsolInput;
    const inputDecimals = getMintDecimals(
      transaction,
      WSOL_MINT,
      tokenAccountMap
    );

    const inputAmount = toAmount(inputRaw.toString(), inputDecimals);
    const outputAmount = toAmount(outputRaw.toString(), outputDecimals);

    if (inputAmount > 0 && outputAmount > 0) {
      return {
        wallet,
        type: "BUY",
        dex: "raydium_amm_v4",
        inputMint: WSOL_MINT,
        inputAmount,
        outputMint,
        outputAmount,
        estimatedPriceSol: inputAmount / outputAmount,
        feeSol: Number(transaction.meta.fee || 0) / 1e9,
        signature: getSignature(transaction),
        blockTime: transaction.blockTime || null
      };
    }
  }

  if (wsolOutput && nonWsolInputs.length === 1) {
    const [inputMint, inputRaw] = nonWsolInputs[0];
    const inputDecimals = getMintDecimals(
      transaction,
      inputMint,
      tokenAccountMap
    );
    const outputRaw = wsolOutput[1];
    const outputDecimals = getMintDecimals(
      transaction,
      WSOL_MINT,
      tokenAccountMap
    );

    const inputAmount = toAmount(inputRaw.toString(), inputDecimals);
    const outputAmount = toAmount(outputRaw.toString(), outputDecimals);

    if (inputAmount > 0 && outputAmount > 0) {
      return {
        wallet,
        type: "SELL",
        dex: "raydium_amm_v4",
        inputMint,
        inputAmount,
        outputMint: WSOL_MINT,
        outputAmount,
        estimatedPriceSol: outputAmount / inputAmount,
        feeSol: Number(transaction.meta.fee || 0) / 1e9,
        signature: getSignature(transaction),
        blockTime: transaction.blockTime || null
      };
    }
  }

  return null;
}
