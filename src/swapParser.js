const WSOL_MINT = "So11111111111111111111111111111111111111112";
const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPXxuEb";
const RAYDIUM_AMM_V4 = "675kPX9MHTjS2zt1qfr1NYHuZeLXfQM9H24yFSUt1Mp8";
const JUPITER_ROUTER = "proVF4pMXVaYqmy4NjniPh4pqKNfMmsihgd4wdkCX3u";
const JUPITER_V6 = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const PUMP_FUN = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const PUMP_AMM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";

function toAmount(raw, decimals) {
  return Number(raw) / 10 ** decimals;
}

function getAccountKeyValue(key) {
  return typeof key === "string"
    ? key
    : key?.pubkey || key?.address || null;
}

function getAllAccountKeys(transaction) {
  const message = transaction?.transaction?.message;
  const staticKeys = message?.accountKeys || [];
  const loaded = transaction?.meta?.loadedAddresses || {};

  return [
    ...staticKeys,
    ...(loaded.writable || []),
    ...(loaded.readonly || [])
  ];
}

function getSignature(transaction) {
  return (
    transaction?.transaction?.signatures?.[0] ||
    transaction?.signature ||
    null
  );
}

function isTokenAccountInitialization(instruction) {
  const parsed = instruction?.parsed;
  const program = instruction?.program || instruction?.programId;

  return (
    (program === "spl-token" ||
      program === "spl-token-2022" ||
      program === TOKEN_2022_PROGRAM ||
      program === SPL_TOKEN_PROGRAM) &&
    [
      "initializeAccount",
      "initializeAccount2",
      "initializeAccount3"
    ].includes(parsed?.type) &&
    parsed?.info?.account &&
    parsed?.info?.mint
  );
}

function addInitializedTokenAccount(map, instruction) {
  const info = instruction.parsed.info;

  map.set(info.account, {
    mint: info.mint,
    owner: info.owner || info.authority || null,
    decimals: 0
  });
}

function buildTokenAccountMap(transaction) {
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

  for (const instruction of transaction?.transaction?.message?.instructions || []) {
    if (isTokenAccountInitialization(instruction)) {
      addInitializedTokenAccount(map, instruction);
    }
  }

  // Some account metadata is only visible through inner instructions.
  for (const group of transaction?.meta?.innerInstructions || []) {
    for (const instruction of group.instructions || []) {
      if (isTokenAccountInitialization(instruction)) {
        addInitializedTokenAccount(map, instruction);
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

  const allInstructions = [
    ...(transaction?.transaction?.message?.instructions || []).map((instruction) => ({
      instruction,
      parentIndex: null
    })),
    ...(transaction?.meta?.innerInstructions || []).flatMap((group) =>
      (group.instructions || []).map((instruction) => ({
        instruction,
        parentIndex: group.index
      }))
    )
  ];

  for (const { instruction, parentIndex } of allInstructions) {
    const parsed = instruction?.parsed;
    const info = parsed?.info;
    const program = instruction?.program || instruction?.programId;

    if (
      (program === "spl-token" ||
        program === "spl-token-2022" ||
        program === SPL_TOKEN_PROGRAM ||
        program === TOKEN_2022_PROGRAM) &&
      (parsed?.type === "transfer" ||
        parsed?.type === "transferChecked") &&
      info?.source &&
      info?.destination &&
      (info?.amount != null || info?.tokenAmount?.amount != null)
    ) {
      transfers.push({
        source: info.source,
        destination: info.destination,
        rawAmount: String(info.amount ?? info.tokenAmount.amount),
        mint: info.mint || info.tokenAmount?.mint || null,
        parentIndex
      });
    }
  }

  return transfers;
}

function getWalletTokenChanges(transaction, wallet, tokenAccountMap) {
  const changes = new Map();
  const preBalances = transaction?.meta?.preTokenBalances || [];
  const postBalances = transaction?.meta?.postTokenBalances || [];
  const accountKeys = transaction?.transaction?.message?.accountKeys || [];

  for (const [account, info] of tokenAccountMap) {
    if (info.owner !== wallet) continue;

    const findBalance = (balances) =>
      balances.find(
        (item) =>
          item.mint === info.mint &&
          item.accountIndex != null &&
          getAccountKeyValue(accountKeys[item.accountIndex]) === account
      );

    const pre = findBalance(preBalances);
    const post = findBalance(postBalances);

    const before = BigInt(pre?.uiTokenAmount?.amount || "0");
    const after = BigInt(post?.uiTokenAmount?.amount || "0");
    const delta = after - before;

    if (delta === 0n) continue;

    changes.set(info.mint, {
      mint: info.mint,
      rawChange: delta.toString(),
      decimals:
        post?.uiTokenAmount?.decimals ??
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


function getNativeSolTransfers(transaction, wallet, relevantPrograms = []) {
  const transfers = [];
  const relevant = new Set(relevantPrograms);

  const processInstruction = (instruction) => {
    const program =
      instruction?.programId ||
      instruction?.program;

    const info = instruction?.parsed?.info;

    if (
      program !== "11111111111111111111111111111111" ||
      instruction?.parsed?.type !== "transfer" ||
      !info
    ) {
      return;
    }

    if (info.source !== wallet && info.destination !== wallet) {
      return;
    }

    const lamports = BigInt(info.lamports || 0);
    if (lamports <= 0n) return;

    transfers.push({
      source: info.source,
      destination: info.destination,
      lamports,
      relevant:
        relevant.size === 0 ||
        relevant.has(info.source) ||
        relevant.has(info.destination)
    });
  };

  for (const instruction of
    transaction?.transaction?.message?.instructions || []) {
    processInstruction(instruction);
  }

  for (const group of transaction?.meta?.innerInstructions || []) {
    for (const instruction of group.instructions || []) {
      processInstruction(instruction);
    }
  }

  return transfers;
}

function findWalletSwapLegs(transaction, wallet) {
  const tokenAccountMap = buildTokenAccountMap(transaction);
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
  const accountKeys = getAllAccountKeys(transaction);

  const outerInstructions =
    transaction?.transaction?.message?.instructions || [];

  const innerInstructions =
    transaction?.meta?.innerInstructions || [];

  const matches = (instruction) => {
    const resolvedProgramId =
      instruction?.programId ||
      instruction?.program ||
      getAccountKeyValue(accountKeys[instruction?.programIdIndex]);

    return resolvedProgramId === programId;
  };

  if (outerInstructions.some(matches)) {
    return true;
  }

  return innerInstructions.some((group) =>
    (group.instructions || []).some(matches)
  );
}

export function parseSwapTransaction(transaction, wallet) {
  if (!transaction?.meta) return null;

  const isRaydium = hasProgram(transaction, RAYDIUM_AMM_V4);
  const isJupiter = hasProgram(transaction, JUPITER_ROUTER);
  const isJupiterV6 = hasProgram(transaction, JUPITER_V6);
  const isPumpFun = hasProgram(transaction, PUMP_FUN);
  const isPumpAmm = hasProgram(transaction, PUMP_AMM);


  if (
    !isRaydium &&
    !isJupiter &&
    !isJupiterV6 &&
    !isPumpFun &&
    !isPumpAmm
  ) {
    return null;
  }

  const detectedDex =
    isJupiter || isJupiterV6
      ? "jupiter"
      : isRaydium
        ? "raydium_amm_v4"
        : isPumpAmm
          ? "pump_amm"
          : "pump_fun";

  const {
    tokenAccountMap,
    walletChanges,
    inputs,
    outputs
  } = findWalletSwapLegs(transaction, wallet);


  const wsolInput = inputs.find(([mint]) => mint === WSOL_MINT);
  const wsolOutput = outputs.find(([mint]) => mint === WSOL_MINT);

  const nonWsolInputs = inputs.filter(([mint]) => mint !== WSOL_MINT);
  const nonWsolOutputs = outputs.filter(([mint]) => mint !== WSOL_MINT);

  // Jupiter/Orca SELL fallback:
  // internal routing transfers can contain several token legs.
  // Use the wallet-level token delta plus the wallet WSOL output.
  const walletTokenOut = [...walletChanges.values()].filter(
    (change) =>
      change.mint !== WSOL_MINT &&
      BigInt(change.rawChange) < 0n
  );

  if (walletTokenOut.length === 1 && wsolOutput) {
    const change = walletTokenOut[0];

    const inputMint = change.mint;
    const inputRaw = -BigInt(change.rawChange);

    const inputDecimals = getMintDecimals(
      transaction,
      inputMint,
      tokenAccountMap
    );

    const outputDecimals = getMintDecimals(
      transaction,
      WSOL_MINT,
      tokenAccountMap
    );

    const inputAmount = toAmount(
      inputRaw.toString(),
      inputDecimals
    );

    const outputAmount = toAmount(
      wsolOutput[1].toString(),
      outputDecimals
    );

    if (inputAmount > 0 && outputAmount > 0) {
      return {
        wallet,
        type: "SELL",
        dex: detectedDex,
        inputMint,
        inputAmount,
        outputMint: WSOL_MINT,
        outputAmount,
        estimatedPriceSol: outputAmount / inputAmount,
        feeSol: Number(transaction.meta?.fee || 0) / 1e9,
        signature: getSignature(transaction),
        blockTime: transaction.blockTime ?? null
      };
    }
  }


  // Native SOL fallback for protocols that do not use WSOL.
  // We only consider transfers involving the wallet and choose the
  // largest native-SOL movement in the swap direction.
  const nativeSolTransfers = getNativeSolTransfers(
    transaction,
    wallet
  );

  const nativeSolInput = nativeSolTransfers
    .filter(
      (transfer) =>
        transfer.source === wallet &&
        transfer.destination !== wallet
    )
    .sort((a, b) => (a.lamports > b.lamports ? -1 : 1))[0];

  const nativeSolOutput = nativeSolTransfers
    .filter(
      (transfer) =>
        transfer.destination === wallet &&
        transfer.source !== wallet
    )
    .sort((a, b) => (a.lamports > b.lamports ? -1 : 1))[0];

  const nativeTokenOutput =
    nonWsolOutputs.length === 1
      ? nonWsolOutputs[0]
      : null;

  const nativeTokenInput =
    nonWsolInputs.length === 1
      ? nonWsolInputs[0]
      : null;

  // Native SOL -> token BUY
  if (
    !wsolInput &&
    nativeSolInput &&
    nativeTokenOutput
  ) {
    const [outputMint, outputRaw] = nativeTokenOutput;

    const outputDecimals = getMintDecimals(
      transaction,
      outputMint,
      tokenAccountMap
    );

    const inputAmount = Number(nativeSolInput.lamports) / 1e9;
    const outputAmount = toAmount(
      outputRaw.toString(),
      outputDecimals
    );

    if (inputAmount > 0 && outputAmount > 0) {
      return {
        wallet,
        type: "BUY",
        dex: detectedDex,
        inputMint: WSOL_MINT,
        inputAmount,
        outputMint,
        outputAmount,
        estimatedPriceSol: inputAmount / outputAmount,
        feeSol: Number(transaction.meta.fee || 0) / 1e9,
        signature: getSignature(transaction),
        blockTime: transaction.blockTime ?? null
      };
    }
  }

  // token -> native SOL SELL
  if (
    !wsolOutput &&
    nativeSolOutput &&
    nativeTokenInput
  ) {
    const [inputMint, inputRaw] = nativeTokenInput;

    const inputDecimals = getMintDecimals(
      transaction,
      inputMint,
      tokenAccountMap
    );

    const inputAmount = toAmount(
      inputRaw.toString(),
      inputDecimals
    );

    const outputAmount = Number(nativeSolOutput.lamports) / 1e9;

    if (inputAmount > 0 && outputAmount > 0) {
      return {
        wallet,
        type: "SELL",
        dex: detectedDex,
        inputMint,
        inputAmount,
        outputMint: WSOL_MINT,
        outputAmount,
        estimatedPriceSol: outputAmount / inputAmount,
        feeSol: Number(transaction.meta.fee || 0) / 1e9,
        signature: getSignature(transaction),
        blockTime: transaction.blockTime ?? null
      };
    }
  }

  // Temporary WSOL accounts may disappear from pre/post token balances
  // after being closed. Use the wallet token delta as a conservative fallback.
  const walletNonWsolChanges = [...walletChanges.values()].filter(
    (change) => change.mint !== WSOL_MINT
  );

  const fallbackTokenIn = walletNonWsolChanges.filter(
    (change) => BigInt(change.rawChange) > 0n
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

    const effectiveOutput =
      wsolInput && nonWsolOutputs.length === 1
        ? nonWsolOutputs[0]
        : [
            fallbackTokenIn[0].mint,
            BigInt(fallbackTokenIn[0].rawChange)
          ];

    const fallbackTokenOut = walletNonWsolChanges.filter(
  (change) => BigInt(change.rawChange) < 0n
);

// Jupiter/Orca may route the SOL through a temporary WSOL account.
// In that case there may be no directly detectable WSOL/native-SOL
// transfer involving the wallet. Use the wallet's native balance delta.
const accountKeys = getAllAccountKeys(transaction);
const walletIndex = accountKeys.findIndex(
  (key) => getAccountKeyValue(key) === wallet
);

let fallbackSolOutput = null;

if (
  fallbackTokenOut.length === 1 &&
  walletIndex >= 0 &&
  transaction?.meta?.preBalances?.[walletIndex] != null &&
  transaction?.meta?.postBalances?.[walletIndex] != null
) {
  const preLamports = BigInt(transaction.meta.preBalances[walletIndex]);
  const postLamports = BigInt(transaction.meta.postBalances[walletIndex]);
  const feeLamports = BigInt(transaction.meta?.fee || 0);

  const netChange = postLamports - preLamports;

  // Restore the transaction fee because the balance delta is net of fee.
  const grossOutput = netChange + feeLamports;

  if (grossOutput > 0n) {
    fallbackSolOutput = grossOutput;
  }
}

if (fallbackTokenOut.length === 1 && fallbackSolOutput) {
  const change = fallbackTokenOut[0];

  const inputMint = change.mint;
  const inputRaw = -BigInt(change.rawChange);

  const inputDecimals = getMintDecimals(
    transaction,
    inputMint,
    tokenAccountMap
  );

  const inputAmount = toAmount(
    inputRaw.toString(),
    inputDecimals
  );

  const outputAmount = Number(fallbackSolOutput) / 1e9;

  if (inputAmount > 0 && outputAmount > 0) {
    return {
      wallet,
      type: "SELL",
      dex: detectedDex,
      inputMint,
      inputAmount,
      outputMint: WSOL_MINT,
      outputAmount,
      estimatedPriceSol: outputAmount / inputAmount,
      feeSol: Number(transaction.meta?.fee || 0) / 1e9,
      signature: getSignature(transaction),
      blockTime: transaction.blockTime ?? null
    };
  }
}

const [outputMint, outputRaw] = effectiveOutput;

const outputDecimals = getMintDecimals(
      transaction,
      outputMint,
      tokenAccountMap
    );

    const inputDecimals = getMintDecimals(
      transaction,
      WSOL_MINT,
      tokenAccountMap
    );

    const inputAmount = toAmount(
      effectiveWsolInput.toString(),
      inputDecimals
    );

    const outputAmount = toAmount(
      outputRaw.toString(),
      outputDecimals
    );

    if (inputAmount > 0 && outputAmount > 0) {
      return {
        wallet,
        type: "BUY",
        dex: detectedDex,
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

    const outputDecimals = getMintDecimals(
      transaction,
      WSOL_MINT,
      tokenAccountMap
    );

    const inputAmount = toAmount(
      inputRaw.toString(),
      inputDecimals
    );

    const outputAmount = toAmount(
      wsolOutput[1].toString(),
      outputDecimals
    );

    if (inputAmount > 0 && outputAmount > 0) {
      return {
        wallet,
        type: "SELL",
        dex: detectedDex,
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
