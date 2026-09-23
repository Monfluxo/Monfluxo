import { getTransactionsForAddress, getTransaction } from "./helius.js";
import { parseTransaction } from "./parser.js";
import { buildPositions } from "./positionEngine.js";

const wallet = process.argv[2];

if (!wallet) {
  console.error("Usage: npm start <wallet_address>");
  process.exit(1);
}

function formatTimestamp(blockTime) {
  if (!blockTime) return "N/A";
  return new Date(blockTime * 1000).toISOString();
}

function shorten(value, length = 44) {
  if (!value) return value;
  return value.length > length
    ? `${value.slice(0, length)}...`
    : value;
}

function printInstruction(label, instruction, index) {
  const programId = instruction?.programId || instruction?.program || null;
  const parsedType = instruction?.parsed?.type || null;
  const program = instruction?.program || null;

  console.log(
    `${label} #${index + 1}: programId=${programId || "N/A"} program=${program || "N/A"} type=${parsedType || "N/A"}`
  );

  if (instruction?.parsed?.info) {
    console.log(
      `${label} #${index + 1} info:`,
      JSON.stringify(instruction.parsed.info)
    );
  } else if (instruction?.data) {
    console.log(
      `${label} #${index + 1} data:`,
      shorten(instruction.data, 120)
    );
  }
}

function printBalanceChanges(transaction, wallet) {
  const meta = transaction?.meta || {};
  const pre = meta.preTokenBalances || [];
  const post = meta.postTokenBalances || [];

  console.log("PRE SOL BALANCE (lamports):", JSON.stringify(meta.preBalances || []));
  console.log("POST SOL BALANCE (lamports):", JSON.stringify(meta.postBalances || []));
  console.log("FEE (lamports):", meta.fee ?? null);

  console.log("PRE TOKEN BALANCES:");
  for (const item of pre) {
    if (item.owner === wallet) {
      console.log(
        JSON.stringify({
          accountIndex: item.accountIndex,
          mint: item.mint,
          owner: item.owner,
          amount: item.uiTokenAmount?.amount,
          decimals: item.uiTokenAmount?.decimals,
          uiAmount: item.uiTokenAmount?.uiAmount
        })
      );
    }
  }

  console.log("POST TOKEN BALANCES:");
  for (const item of post) {
    if (item.owner === wallet) {
      console.log(
        JSON.stringify({
          accountIndex: item.accountIndex,
          mint: item.mint,
          owner: item.owner,
          amount: item.uiTokenAmount?.amount,
          decimals: item.uiTokenAmount?.decimals,
          uiAmount: item.uiTokenAmount?.uiAmount
        })
      );
    }
  }
}

async function debugTransaction(signature, wallet) {
  console.log("");
  console.log("============================================================");
  console.log("TRANSACTION DEBUG");
  console.log("============================================================");
  console.log("Signature:", signature);

  const transaction = await getTransaction(signature);

  if (!transaction) {
    console.log("Transaction not found.");
    return;
  }

  console.log("Block time:", formatTimestamp(transaction.blockTime));
  console.log("Slot:", transaction.slot ?? "N/A");
  console.log("Version:", transaction.transaction?.version ?? "legacy");

  const message = transaction.transaction?.message || {};
  const accountKeys = message.accountKeys || [];

  console.log("");
  console.log("ACCOUNT KEYS");
  accountKeys.forEach((key, index) => {
    const pubkey = typeof key === "string" ? key : key?.pubkey;
    console.log(
      `#${index}: ${pubkey || "N/A"} signer=${Boolean(key?.signer)} writable=${Boolean(key?.writable)}`
    );
  });

  console.log("");
  console.log("OUTER INSTRUCTIONS");
  const instructions = message.instructions || [];
  if (instructions.length === 0) {
    console.log("None");
  } else {
    instructions.forEach((instruction, index) => {
      printInstruction("OUTER", instruction, index);
    });
  }

  console.log("");
  console.log("INNER INSTRUCTIONS");
  const inner = transaction.meta?.innerInstructions || [];
  if (inner.length === 0) {
    console.log("None");
  } else {
    inner.forEach((group) => {
      console.log(`Parent instruction index: ${group.index}`);
      (group.instructions || []).forEach((instruction, index) => {
        printInstruction("INNER", instruction, index);
      });
    });
  }

  console.log("");
  console.log("LOG MESSAGES");
  const logs = transaction.meta?.logMessages || [];
  if (logs.length === 0) {
    console.log("None");
  } else {
    logs.forEach((log) => console.log(log));
  }

  console.log("");
  console.log("WALLET BALANCES");
  printBalanceChanges(transaction, wallet);
}

function formatNumber(value, digits = 9) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return String(value);
  }

  return value.toFixed(digits);
}

async function loadAllTransactions(address) {
  const allTransactions = [];
  const seenPaginationTokens = new Set();

  let paginationToken = null;
  let page = 1;

  while (true) {
    console.log(`Loading page ${page}...`);

    const result = await getTransactionsForAddress(address, paginationToken);
    const transactions = result?.data || [];
    const nextPaginationToken = result?.paginationToken || null;

    console.log(
      `Page ${page}: ${transactions.length} transactions | hasNextPage: ${Boolean(nextPaginationToken)}`
    );

    if (transactions.length === 0) {
      break;
    }

    allTransactions.push(...transactions);

    if (!nextPaginationToken) {
      break;
    }

    if (seenPaginationTokens.has(nextPaginationToken)) {
      throw new Error("Pagination loop detected");
    }

    seenPaginationTokens.add(nextPaginationToken);
    paginationToken = nextPaginationToken;
    page++;
  }

  return {
    transactions: allTransactions,
    pages: page
  };
}

try {
  console.log("");
  console.log("MONFLUXO WALLET ANALYZER");
  console.log("========================");
  console.log("Wallet:", wallet);
  console.log("");

  const { transactions: allTransactions, pages } =
    await loadAllTransactions(wallet);

  const blockTimes = allTransactions
    .map((transaction) => transaction?.blockTime)
    .filter((blockTime) => typeof blockTime === "number");

  const newestBlockTime =
    blockTimes.length > 0 ? Math.max(...blockTimes) : null;

  const oldestBlockTime =
    blockTimes.length > 0 ? Math.min(...blockTimes) : null;

  const uniqueSignatures = new Set(
    allTransactions
      .map(
        (transaction) =>
          transaction?.transaction?.signatures?.[0] ||
          transaction?.signature ||
          null
      )
      .filter(Boolean)
  );

  console.log("");
  console.log("========================");
  console.log("HISTORY LOADED");
  console.log("========================");
  console.log("Pages loaded:", pages);
  console.log("Transactions loaded:", allTransactions.length);
  console.log("Unique signatures:", uniqueSignatures.size);
  console.log("Newest transaction:", formatTimestamp(newestBlockTime));
  console.log("Oldest transaction:", formatTimestamp(oldestBlockTime));

  const typeCounts = {
    BUY: 0,
    SELL: 0,
    TRANSFER_IN: 0,
    TRANSFER_OUT: 0,
    SOL_TRANSFER: 0,
    OTHER: 0
  };

  const trades = [];
  const parsedTradeDiagnostics = [];

  for (const transaction of allTransactions) {
    const analysis = parseTransaction(transaction, wallet);

    if (typeCounts[analysis.type] !== undefined) {
      typeCounts[analysis.type]++;
    } else {
      typeCounts.OTHER++;
    }

    if (analysis.type !== "BUY" && analysis.type !== "SELL") {
      continue;
    }

    if (!analysis.trade) {
      continue;
    }

    const signature =
      transaction?.transaction?.signatures?.[0] ||
      transaction?.signature ||
      null;

    const trade = {
      ...analysis.trade,
      signature,
      blockTime: transaction?.blockTime || null
    };

    trades.push(trade);

    parsedTradeDiagnostics.push({
      signature,
      blockTime: transaction?.blockTime || null,
      type: analysis.type,
      tokenMint: analysis.trade.tokenMint,
      tokenAmount: analysis.trade.tokenAmount,
      solAmount: analysis.trade.solAmount,
      estimatedPriceSol: analysis.trade.estimatedPriceSol,
      parser: analysis.trade.parser || "unknown",
      dex: analysis.trade.dex || null,
      tokenChanges: analysis.tokenChanges,
      solChange: analysis.solChange
    });
  }

  console.log("");
  console.log("========================");
  console.log("PARSER SUMMARY");
  console.log("========================");
  console.log("BUY:", typeCounts.BUY);
  console.log("SELL:", typeCounts.SELL);
  console.log("TRANSFER_IN:", typeCounts.TRANSFER_IN);
  console.log("TRANSFER_OUT:", typeCounts.TRANSFER_OUT);
  console.log("SOL_TRANSFER:", typeCounts.SOL_TRANSFER);
  console.log("OTHER:", typeCounts.OTHER);
  console.log("Trades created:", trades.length);

  console.log("");
  console.log("========================");
  console.log("PARSED TRADE DIAGNOSTICS");
  console.log("========================");

  const diagnosticTrades = [...parsedTradeDiagnostics]
    .sort((a, b) => (a.blockTime ?? 0) - (b.blockTime ?? 0))
    .slice(0, 10);

  if (diagnosticTrades.length === 0) {
    console.log("No BUY/SELL trades were created.");
  } else {
    diagnosticTrades.forEach((trade, index) => {
      console.log("");
      console.log(`#${index + 1}`);
      console.log("Signature:", trade.signature);
      console.log("Time:", formatTimestamp(trade.blockTime));
      console.log("Type:", trade.type);
      console.log("Token mint:", trade.tokenMint);
      console.log("Token amount:", formatNumber(trade.tokenAmount));
      console.log("SOL amount:", formatNumber(trade.solAmount));
      console.log("Parser:", trade.parser || "unknown");
      console.log("DEX:", trade.dex || "unknown");
      console.log(
        "Estimated price:",
        formatNumber(trade.estimatedPriceSol)
      );
      console.log("Token changes:", JSON.stringify(trade.tokenChanges));
      console.log("SOL change:", JSON.stringify(trade.solChange));
    });
  }

  // Debug a few real swaps before trusting the trade parser. This inspects
  // the actual instructions, inner instructions, logs and balance movements.
  const debugSignatures = diagnosticTrades
    .slice(0, 3)
    .map((trade) => trade.signature)
    .filter(Boolean);

  for (const signature of debugSignatures) {
    await debugTransaction(signature, wallet);
  }

  // Helius returns history newest -> oldest. The position engine must
  // process trades oldest -> newest so sells consume previously acquired lots.
  trades.sort((a, b) => {
    const timeA = a.blockTime ?? 0;
    const timeB = b.blockTime ?? 0;
    return timeA - timeB;
  });

  const positions = buildPositions(trades);

  let totalRealizedPnl = 0;
  let openPositions = 0;

  for (const position of positions.values()) {
    totalRealizedPnl += position.realizedPnl;

    if (position.tokensRemaining > 0.000000001) {
      openPositions++;
    }
  }

  console.log("");
  console.log("========================");
  console.log("POSITION ENGINE");
  console.log("========================");

  console.log("");
  console.log("Trades analyzed:", trades.length);
  console.log("Unique tokens:", positions.size);
  console.log("Open positions:", openPositions);

  console.log("");
  console.log("REALIZED PNL");
  console.log("------------");

  console.log(
    "Realized PnL:",
    totalRealizedPnl.toFixed(6),
    "SOL"
  );

  console.log("");
  console.log("POSITIONS");
  console.log("---------");

  const sortedPositions = [...positions.values()].sort(
    (a, b) => Math.abs(b.realizedPnl) - Math.abs(a.realizedPnl)
  );

  sortedPositions.slice(0, 10).forEach((position, index) => {
    console.log("");
    console.log(`#${index + 1}`);
    console.log("Token:", position.mint);
    console.log("Buys:", position.buys);
    console.log("Sells:", position.sells);
    console.log("Tokens bought:", position.tokensBought);
    console.log("Tokens sold:", position.tokensSold);
    console.log("Tokens remaining:", position.tokensRemaining);
    console.log("SOL spent:", position.solSpent.toFixed(6));
    console.log("SOL received:", position.solReceived.toFixed(6));
    console.log(
      "Realized PnL:",
      position.realizedPnl.toFixed(6),
      "SOL"
    );
  });

  console.log("");
  console.log("========================");
  console.log("MONFLUXO ANALYSIS COMPLETE");
  console.log("========================");
} catch (error) {
  console.error("Error:", error.message);
  process.exit(1);
}
