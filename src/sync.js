import { getTransactionsForAddress } from "./helius.js";
import { parseTransaction } from "./parser.js";
import {
  upsertWallet,
  getSyncState,
  upsertSyncState,
  upsertTransactions,
  upsertTrades,
  upsertTransfers,
  upsertRewards
} from "./db.js";

function signatureOf(tx) {
  return tx?.transaction?.signatures?.[0] || tx?.signature || null;
}

function isoFromBlockTime(blockTime) {
  return typeof blockTime === "number" ? new Date(blockTime * 1000).toISOString() : null;
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

function normalizedTrade(wallet, trade, fallbackIndex) {
  return {
    wallet_address: wallet,
    signature: trade.signature,
    event_index: trade.eventIndex ?? fallbackIndex,
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

function normalizedTransfer(wallet, transfer, fallbackIndex) {
  return {
    wallet_address: wallet,
    signature: transfer.signature,
    event_index: transfer.eventIndex ?? fallbackIndex,
    instruction_index: transfer.instructionIndex ?? null,
    block_time: isoFromBlockTime(transfer.blockTime),
    mint: transfer.mint,
    direction: transfer.direction,
    amount: transfer.amount,
    raw_amount: transfer.rawAmount,
    decimals: transfer.decimals ?? 0,
    source_address: transfer.sourceAddress ?? null,
    destination_address: transfer.destinationAddress ?? null,
    source_token_account: transfer.sourceTokenAccount ?? null,
    destination_token_account: transfer.destinationTokenAccount ?? null,
    parser: transfer.parser ?? null
  };
}

function normalizedReward(wallet, reward) {
  return {
    wallet_address: wallet,
    signature: reward.signature,
    block_time: isoFromBlockTime(reward.blockTime),
    reward_type: "CREATOR_FEE",
    quote_mint: reward.quoteMint,
    quote_token_program: reward.quoteTokenProgram,
    amount: reward.amount,
    raw_amount: reward.rawAmount,
    decimals: reward.decimals,
    creator: reward.creator,
    creator_token_account: reward.creatorTokenAccount,
    creator_vault: reward.creatorVault,
    creator_vault_token_account: reward.creatorVaultTokenAccount,
    instruction_index: reward.instructionIndex,
    source: reward.parser
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
  if (previous?.status === "syncing") throw new Error("Wallet sync already in progress");

  await upsertWallet({ address, updated_at: new Date().toISOString() });
  await upsertSyncState({ wallet_address: address, status: "syncing", updated_at: new Date().toISOString() });

  let paginationToken = null;
  let page = 0;
  let total = 0;
  let totalTrades = 0;
  let totalTransfers = 0;
  let totalRewards = 0;
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
      const transferRows = [];
      const rewardRows = [];

      for (const tx of transactions) {
        const signature = signatureOf(tx);
        if (!signature) continue;
        const alreadyKnown = previous?.newest_signature === signature && (mode !== "deep" || previous?.history_complete === true);
        if (alreadyKnown) {
          stoppedOnExisting = true;
          break;
        }

        const analysis = parseTransaction(tx, address);
        txRows.push(normalizedTransaction(address, tx, analysis, storeRaw));

        const trades = analysis?.trades || (analysis?.trade ? [analysis.trade] : []);
        trades.forEach((trade, index) => {
          if (trade?.type === "BUY" || trade?.type === "SELL") tradeRows.push(normalizedTrade(address, trade, index));
        });
        (analysis?.transfers || []).forEach((transfer, index) => transferRows.push(normalizedTransfer(address, transfer, index)));
        (analysis?.rewards || []).forEach((reward) => rewardRows.push(normalizedReward(address, reward)));

        if (typeof tx?.blockTime === "number") {
          if (!newest || tx.blockTime > newest.blockTime) newest = { blockTime: tx.blockTime, signature };
          if (!oldest || tx.blockTime < oldest.blockTime) oldest = { blockTime: tx.blockTime, signature };
        }
      }

      await upsertTransactions(txRows);
      await upsertTrades(tradeRows);
      await upsertTransfers(transferRows);
      await upsertRewards(rewardRows);
      total += txRows.length;
      totalTrades += tradeRows.length;
      totalTransfers += transferRows.length;
      totalRewards += rewardRows.length;

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
      tradesStored: totalTrades,
      transfersStored: totalTransfers,
      rewardsStored: totalRewards,
      stoppedOnExisting,
      status: "idle"
    };
  } catch (error) {
    await upsertSyncState({ wallet_address: address, status: "error", updated_at: new Date().toISOString() });
    throw error;
  }
}
