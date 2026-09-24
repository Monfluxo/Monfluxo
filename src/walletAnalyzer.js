import { syncWalletHistory } from "./sync.js";
import { getWalletTradePage, upsertAnalysisCache } from "./db.js";
import { buildPositions } from "./positionEngine.js";

function mapTrade(row) {
  return {
    wallet: row.wallet_address,
    signature: row.signature,
    blockTime: row.block_time ? Math.floor(new Date(row.block_time).getTime() / 1000) : null,
    type: row.type,
    tokenMint: row.token_mint,
    tokenAmount: Number(row.token_amount),
    solAmount: Number(row.sol_amount),
    estimatedPriceSol: row.estimated_price_sol == null ? null : Number(row.estimated_price_sol),
    feeSol: row.fee_sol == null ? null : Number(row.fee_sol),
    dex: row.dex,
    parser: row.parser
  };
}

export async function analyzeWallet(address, options = {}) {
  const mode = options.mode || "quick";
  const sync = await syncWalletHistory(address, { mode });

  const pageSize = 1000;
  const maxRows = mode === "quick"
    ? Number(process.env.MAX_QUICK_TRADE_ROWS || 5000)
    : Number(process.env.MAX_DEEP_TRADE_ROWS || 500000);

  const trades = [];

  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const rows = await getWalletTradePage(address, pageSize, offset);
    if (!rows.length) break;

    trades.push(...rows.map(mapTrade));

    if (rows.length < pageSize) break;
  }

  const positions = buildPositions(trades);
  let realizedPnl = 0;
  let winners = 0;
  let losers = 0;
  let best = null;
  let worst = null;

  for (const position of positions.values()) {
    realizedPnl += position.realizedPnl;

    if (position.realizedPnl > 0) winners++;
    if (position.realizedPnl < 0) losers++;

    if (!best || position.realizedPnl > best.realizedPnl) {
      best = {
        tokenMint: position.mint,
        realizedPnl: position.realizedPnl
      };
    }

    if (!worst || position.realizedPnl < worst.realizedPnl) {
      worst = {
        tokenMint: position.mint,
        realizedPnl: position.realizedPnl
      };
    }
  }

  const metrics = {
    wallet: address,
    mode,
    tradesAnalyzed: trades.length,
    uniqueTokens: positions.size,
    realizedPnlSol: realizedPnl,
    winners,
    losers,
    winRate: winners + losers > 0 ? winners / (winners + losers) : null,
    best,
    worst,
    generatedAt: new Date().toISOString()
  };

  await upsertAnalysisCache({
    wallet_address: address,
    analysis_scope: mode,
    metrics,
    generated_at: metrics.generatedAt
  });

  return { sync, metrics };
}

if (process.argv[1]?.endsWith("walletAnalyzer.js")) {
  const address = process.argv[2];
  const mode = process.argv[3] || "quick";

  if (!address) {
    console.error("Usage: npm run analyze:wallet -- <wallet_address> [quick|deep]");
    process.exit(1);
  }

  try {
    const result = await analyzeWallet(address, { mode });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("Wallet analysis failed:", error.message);
    process.exit(1);
  }
}
