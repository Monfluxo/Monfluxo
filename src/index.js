import { getTransactionsForAddress } from "./helius.js";
import { parseTransaction } from "./parser.js";
import { buildPositions } from "./positionEngine.js";

const wallet = process.argv[2];

if (!wallet) {
  console.error("Usage: npm start <wallet_address>");
  process.exit(1);
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

    console.log(`Page ${page}: ${transactions.length} transactions`);

    if (transactions.length === 0) {
      break;
    }

    allTransactions.push(...transactions);

    const nextPaginationToken = result?.paginationToken || null;

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

  return allTransactions;
}

try {
  console.log("");
  console.log("MONFLUXO WALLET ANALYZER");
  console.log("========================");
  console.log("Wallet:", wallet);
  console.log("");

  const allTransactions = await loadAllTransactions(wallet);

  console.log("");
  console.log("========================");
  console.log("HISTORY LOADED");
  console.log("========================");
  console.log("Pages loaded:", allTransactions.length === 0 ? 0 : "complete");
  console.log("Transactions loaded:", allTransactions.length);

  const trades = [];

  for (const transaction of allTransactions) {
    const analysis = parseTransaction(transaction, wallet);

    if (analysis.type !== "BUY" && analysis.type !== "SELL") {
      continue;
    }

    if (!analysis.trade) {
      continue;
    }

    trades.push({
      ...analysis.trade,
      signature:
        transaction?.transaction?.signatures?.[0] ||
        transaction?.signature ||
        null,
      blockTime: transaction?.blockTime || null
    });
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
    console.log("Trades:", position.trades);
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
