import { getTransactionsForAddress } from "./helius.js";
import { parseTransaction } from "./parser.js";
import {
  upsertWallet,
  getSyncState,
  upsertSyncState,
  upsertTransactions,
  upsertTrades
} from "./db.js";

function signatureOf(tx) {
  return tx?.transaction?.signatures?.[0] || tx?.signature || null;
}

function isoFromBlockTime(blockTime) {
  return typeof blockTime === "number"
    ? new Date(blockTime * 1000).toISOString()
    : null;
}

function normalizedTransaction(wallet, tx, analysis, storeRaw) {
  return {
    wallet_address: wallet,
    signature: signatureOf(tx),
    slot: tx?.slot ?? null,
    block_time: isoFromBlockTime(tx?.blockTime),
    tx_version: String(tx?.transaction?.version ?? "legacy"),
    parsed_type: analysis?.type ?? "OTHER",
    parser_reason: analysis?.reason ?? null,
    raw_transaction: storeRaw ? tx : null
  };
}

function normalizedTrade(wallet, trade) {
  return {
    wallet_address: wallet,
    signature: trade.signature,
    block_time: isoFromBlockTime(trade.blockTime),
    type: trade.type,
    token_mint: trade.tokenMint,
    token_amount: trade.tokenAmount,
    sol_amount: trade.solAmount,
    estimated_price_sol: trade.estimatedPriceSol ?? null,
    fee_sol: trade.feeSol ?? null,
    dex: trade.dex ?? null,
    parser: trade.parser ?? null
  };
}

export async function syncWalletHistory(address, options = {}) {
  const {
    mode = "incremental",
    maxPages = mode === "quick"
      ? Number(process.env.MAX_QUICK_PAGES || 5)
      : Number(process.env.MAX_DEEP_PAGES || 500),
    storeRaw = process.env.STORE_RAW_TRANSACTIONS !== "false"
  } = options;

  const previous = await getSyncState(address);

  if (previous?.status === "syncing") {
    throw new Error("Wallet sync already in progress");
  }

  await upsertWallet({
    address,
    updated_at: new Date().toISOString()
  });

  await upsertSyncState({
    wallet_address: address,
    status: "syncing",
    updated_at: new Date().toISOString()
  });

  let paginationToken = null;
  let page = 0;
  let total = 0;
  let stoppedOnExisting = false;
  let newest = null;
  let oldest = null;

  try {
    while (page < maxPages) {
      page++;

      const result = await getTransactionsForAddress(address, paginationToken);
      const transactions = result?.data || [];

      if (!transactions.length) break;

      const txRows = [];
      const tradeRows = [];

      for (const tx of transactions) {
        const signature = signatureOf(tx);
        if (!signature) continue;

        // Helius returns newest -> oldest. Once we hit the last
        // transaction already indexed, everything after it is known.
        const alreadyKnown =
          previous?.newest_signature === signature &&
          (mode !== "deep" || previous?.history_complete === true);

        if (alreadyKnown) {
          stoppedOnExisting = true;
          break;
        }

        const analysis = parseTransaction(tx, address);
        txRows.push(normalizedTransaction(address, tx, analysis, storeRaw));

        if (analysis?.trade?.type === "BUY" || analysis?.trade?.type === "SELL") {
          tradeRows.push(normalizedTrade(address, analysis.trade));
        }

        if (typeof tx?.blockTime === "number") {
          if (!newest || tx.blockTime > newest.blockTime) {
            newest = { blockTime: tx.blockTime, signature };
          }
          if (!oldest || tx.blockTime < oldest.blockTime) {
            oldest = { blockTime: tx.blockTime, signature };
          }
        }
      }

      await upsertTransactions(txRows);
      await upsertTrades(tradeRows);
      total += txRows.length;

      if (stoppedOnExisting) break;

      paginationToken = result?.paginationToken || null;
      if (!paginationToken) break;
    }

    const now = new Date().toISOString();
    const syncState = {
      wallet_address: address,
      status: "idle",
      pages_scanned: (previous?.pages_scanned || 0) + page,
      last_synced_at: now,
      updated_at: now
    };

    if (newest) {
      syncState.newest_signature = newest.signature;
      syncState.newest_block_time = isoFromBlockTime(newest.blockTime);
    } else if (previous?.newest_signature) {
      syncState.newest_signature = previous.newest_signature;
      syncState.newest_block_time = previous.newest_block_time;
    }

    if (oldest) {
      syncState.oldest_signature = oldest.signature;
      syncState.oldest_block_time = isoFromBlockTime(oldest.blockTime);
    } else if (previous?.oldest_signature) {
      syncState.oldest_signature = previous.oldest_signature;
      syncState.oldest_block_time = previous.oldest_block_time;
    }

    if (mode === "deep") {
      syncState.last_deep_scan_at = now;
      syncState.history_complete = !paginationToken && !stoppedOnExisting;
    } else if (previous?.history_complete === true) {
      syncState.history_complete = true;
    }

    await upsertSyncState(syncState);

    return {
      address,
      mode,
      pages: page,
      transactionsStored: total,
      stoppedOnExisting,
      status: "idle"
    };
  } catch (error) {
    await upsertSyncState({
      wallet_address: address,
      status: "error",
      updated_at: new Date().toISOString()
    });
    throw error;
  }
}
