import { persistWalletEventPage } from "./db.js";
import { assertWalletAllowed, claimWalletSyncLease } from "./walletPolicy.js";
import { transactionAllowance, indexedWork } from "./analysisBudget.js";
import { getTransactionsForAddress } from "./helius.js";
import { parseTransaction } from "./parserV2.js";
import { parseNativeSolFunding } from "./fundingParser.js";
import {
  assertEventModelV2Schema,
  upsertWallet,
  getSyncState,
  upsertSyncState,
  upsertTransactions,
  upsertTrades,
  upsertTransfers,
  upsertRewards,
  upsertFundingEvents,
  replaceWalletEventsForSignatures
} from "./db.js";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYDCLjv5Az5p7TYE3p3w8uJ";
const MATERIAL_STABLE_INFLOW = Number(process.env.MATERIAL_STABLE_INFLOW || 5);
const TRANSFER_RECENT_GRACE_DAYS = Math.max(1, Number(process.env.TRANSFER_RECENT_GRACE_DAYS || 30));
const STABLE_MINTS = new Set([USDC_MINT, USDT_MINT]);

function signatureOf(tx) {
  return tx?.transaction?.signatures?.[0] || tx?.signature || null;
}

function accountKeyValue(key) {
  return typeof key === "string" ? key : key?.pubkey || key?.address || null;
}

function allAccountKeys(tx) {
  return [
    ...(tx?.transaction?.message?.accountKeys || []),
    ...(tx?.meta?.loadedAddresses?.writable || []),
    ...(tx?.meta?.loadedAddresses?.readonly || [])
  ];
}

function ownedTokenAccounts(tx, wallet) {
  const keys = allAccountKeys(tx);
  const result = [];
  const seen = new Set();

  for (const item of [
    ...(tx?.meta?.preTokenBalances || []),
    ...(tx?.meta?.postTokenBalances || [])
  ]) {
    if (item?.owner !== wallet || !item?.mint || item?.accountIndex == null) continue;
    const account = accountKeyValue(keys[item.accountIndex]);
    if (!account) continue;
    const id = `${item.mint}:${account}`;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push({ mint: item.mint, account });
  }

  return result;
}

function isoFromBlockTime(blockTime) {
  if (typeof blockTime !== "number" || !Number.isFinite(blockTime)) return null;
  const date = new Date(blockTime * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function secondsFromIso(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
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

function normalizedReward(wallet, reward, slot = null) {
  return {
    wallet_address: wallet,
    signature: reward.signature,
    slot,
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

function normalizedTrade(wallet, trade, slot = null) {
  return {
    wallet_address: wallet,
    signature: trade.signature,
    slot,
    event_index: Number.isInteger(trade.eventIndex) ? trade.eventIndex : 0,
    instruction_index: Number.isInteger(trade.instructionIndex)
      ? trade.instructionIndex
      : null,
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

function normalizedTransfer(wallet, transfer, slot = null) {
  return {
    wallet_address: wallet,
    signature: transfer.signature,
    slot,
    event_index: Number.isInteger(transfer.eventIndex) ? transfer.eventIndex : 0,
    instruction_index: Number.isInteger(transfer.instructionIndex)
      ? transfer.instructionIndex
      : null,
    block_time: isoFromBlockTime(transfer.blockTime),
    direction: transfer.direction,
    token_mint: transfer.mint,
    token_amount: transfer.amount,
    raw_amount: transfer.rawAmount,
    decimals: transfer.decimals,
    source_address: transfer.sourceAddress ?? null,
    destination_address: transfer.destinationAddress ?? null,
    source_token_account: transfer.sourceTokenAccount ?? null,
    destination_token_account: transfer.destinationTokenAccount ?? null,
    parser: transfer.parser ?? null
  };
}

function normalizedSolFunding(wallet, funding, slot = null) {
  return {
    wallet_address: wallet,
    signature: funding.signature,
    event_index: Number.isInteger(funding.eventIndex) ? funding.eventIndex : 0,
    slot,
    block_time: isoFromBlockTime(funding.blockTime),
    asset_type: "SOL",
    asset_id: "SOL",
    amount: funding.amount,
    raw_amount: funding.rawAmount,
    decimals: 9,
    source_address: funding.sourceAddress ?? null,
    destination_address: funding.destinationAddress ?? wallet,
    source_token_account: null,
    destination_token_account: null,
    parser: funding.parser ?? "system_transfer"
  };
}

function isRecentBlockTime(blockTime) {
  if (!Number.isFinite(Number(blockTime))) return false;
  const cutoff = Math.floor(Date.now() / 1000) - TRANSFER_RECENT_GRACE_DAYS * 86400;
  return Number(blockTime) >= cutoff;
}

function shouldPersistTransfer(transfer, relevantMints, mode) {
  if (!transfer?.mint || !["IN", "OUT"].includes(transfer?.direction)) return false;

  // Quick/incremental windows are intentionally retained in full. They are
  // small and may contain a transfer that becomes economically relevant later.
  if (mode !== "deep") return true;

  // Outbound movements can consume purchased inventory. Preserve them and mark
  // the mint relevant so an older inbound leg encountered later in the reverse
  // chronological backfill is preserved as well.
  if (transfer.direction === "OUT") {
    relevantMints.add(transfer.mint);
    return true;
  }

  if (relevantMints.has(transfer.mint)) return true;

  // Preserve recent inbound inventory so a future sale can be attributed
  // correctly without requiring a historical reindex.
  if (isRecentBlockTime(transfer.blockTime)) return true;

  // Stablecoin deposits are economically meaningful funding even when they are
  // never swapped by the indexed wallet.
  if (STABLE_MINTS.has(transfer.mint) && Number(transfer.amount || 0) >= MATERIAL_STABLE_INFLOW) {
    return true;
  }

  return false;
}

function inventoryRow(map, mint) {
  if (!map.has(mint)) {
    map.set(mint, { buys: 0, sells: 0, transferIn: 0, transferOut: 0 });
  }
  return map.get(mint);
}

function observeAnalysis(inventory, analysis) {
  for (const trade of analysis?.trades || []) {
    if (!trade?.tokenMint) continue;
    const row = inventoryRow(inventory, trade.tokenMint);
    const amount = Number(trade.tokenAmount || 0);
    if (trade.type === "BUY") row.buys += amount;
    if (trade.type === "SELL") row.sells += amount;
  }

  for (const transfer of analysis?.transfers || []) {
    if (!transfer?.mint) continue;
    const row = inventoryRow(inventory, transfer.mint);
    const amount = Number(transfer.amount || 0);
    if (transfer.direction === "IN") row.transferIn += amount;
    if (transfer.direction === "OUT") row.transferOut += amount;
  }
}

function unresolvedMints(inventory) {
  const result = [];
  for (const [mint, row] of inventory) {
    const knownIn = row.buys + row.transferIn;
    const knownOut = row.sells + row.transferOut;
    const deficit = knownOut - knownIn;
    if (deficit > 1e-9) result.push({ mint, deficit });
  }
  return result.sort((a, b) => b.deficit - a.deficit);
}

async function enrichFromTokenAccounts({
  address,
  tokenAccountsByMint,
  inventory,
  primarySignatures,
  storeRaw
}) {
  const deficits = unresolvedMints(inventory);
  const targetMints = new Set(deficits.map((item) => item.mint));
  const maxPages = Number(process.env.MAX_TOKEN_ACCOUNT_PAGES || 20);
  const supplementalSeen = new Set();
  let tokenAccountsScanned = 0;
  let tokenAccountPages = 0;
  let supplementalTransactionsStored = 0;
  let supplementalTransfersStored = 0;

  for (const mint of targetMints) {
    const accounts = [...(tokenAccountsByMint.get(mint) || [])];

    for (const account of accounts) {
      tokenAccountsScanned++;
      let paginationToken = null;
      let pages = 0;

      while (pages < maxPages) {
        pages++;
        tokenAccountPages++;
        const result = await getTransactionsForAddress(account, paginationToken, {
          tokenAccounts: "none"
        });
        const historyMs = Date.now() - pageStarted;
      const historyBytes = Buffer.byteLength(JSON.stringify(result));
      const transactions = result?.data || [];
      if (!Array.isArray(transactions) || transactions.length > requestedLimit) throw new Error("history_page_exceeds_budget");
        if (!transactions.length) break;

        const txRows = [];
        const transferRows = [];

        for (const tx of transactions) {
          const signature = signatureOf(tx);
          if (!signature) continue;
          if (primarySignatures.has(signature) || supplementalSeen.has(signature)) continue;

          const analysis = parseTransaction(tx, address);
          const relevantTransfers = (analysis?.transfers || [])
            .filter((transfer) => transfer?.mint === mint)
            .filter((transfer) => transfer?.direction === "IN" || transfer?.direction === "OUT");

          if (!relevantTransfers.length) continue;

          supplementalSeen.add(signature);
          txRows.push(normalizedTransaction(address, tx, analysis, storeRaw));
          for (const transfer of relevantTransfers) {
            transferRows.push(normalizedTransfer(address, transfer, tx?.slot ?? null));
          }
          observeAnalysis(inventory, {
            trades: [],
            transfers: relevantTransfers
          });
        }

        await Promise.all([
          upsertTransactions(txRows),
          upsertTransfers(transferRows)
        ]);
        supplementalTransactionsStored += txRows.length;
        supplementalTransfersStored += transferRows.length;

        paginationToken = result?.paginationToken || null;
        if (!paginationToken) break;
      }
    }
  }

  return {
    deficitMintCount: deficits.length,
    unresolvedAfterTokenAccountScan: unresolvedMints(inventory).length,
    tokenAccountsScanned,
    tokenAccountPages,
    supplementalTransactionsStored,
    supplementalTransfersStored
  };
}

export async function syncWalletHistory(address, options = {}) {
  const {
    mode = "incremental",
    maxPages = mode === "quick"
      ? Number(process.env.MAX_QUICK_PAGES || 5)
      : Number(process.env.MAX_DEEP_PAGES || 500),
    storeRaw = process.env.STORE_RAW_TRANSACTIONS === "true"
  } = options;

  const policy = await assertWalletAllowed(address);
  await assertEventModelV2Schema();

  let previous = await getSyncState(address);
  let allowance = transactionAllowance(previous, policy);
  if (!allowance) return { address, mode, pages: 0, transactionsStored: 0, historyComplete: false, budgetExhausted: true, backfillCursorSaved: Boolean(previous?.backfill_pagination_token), status: "paused" };
  if (previous?.status === "syncing") {
    throw new Error("Wallet sync already in progress");
  }

  await upsertWallet({
    address,
    updated_at: new Date().toISOString()
  });

  if (!await claimWalletSyncLease(address)) throw new Error("Wallet sync already in progress");
  previous = await getSyncState(address);
  allowance = transactionAllowance(previous, policy);
  if (!allowance) {
    await upsertSyncState({wallet_address:address,status:"idle",updated_at:new Date().toISOString()});
    return {address,mode,pages:0,transactionsStored:0,historyComplete:false,budgetExhausted:true,status:"paused"};
  }
  const tokenAccountsFilter = process.env.HELIUS_TOKEN_ACCOUNTS_FILTER || "balanceChanged";
  const unifiedTokenHistory = tokenAccountsFilter !== "none";
  const legacyTokenAccountFallback =
    process.env.DEEP_TOKEN_ACCOUNT_SCAN === "true" ||
    (!unifiedTokenHistory && process.env.DEEP_TOKEN_ACCOUNT_SCAN !== "false");
  const resumingBackfill =
    mode === "deep" &&
    previous?.history_complete !== true &&
    Boolean(previous?.backfill_pagination_token);

  const startedAt =
    mode === "deep"
      ? previous?.backfill_started_at || new Date().toISOString()
      : previous?.backfill_started_at || null;

  await upsertSyncState({
    wallet_address: address,
    status: "syncing",
    ...(mode === "deep" ? { backfill_started_at: startedAt } : {}),
    updated_at: new Date().toISOString()
  });

  let paginationToken = resumingBackfill
    ? previous.backfill_pagination_token
    : null;
  let page = 0;
  let total = 0;
  let work = 0;
  let tradesStored = 0;
  let transfersStored = 0;
  let transfersSkipped = 0;
  let rewardsStored = 0;
  let fundingStored = 0;
  let stoppedOnExisting = false;
  let budgetExhausted = false;
  const baseWork = indexedWork(previous);
  let newest = null;
  let oldest = null;
  const inventory = new Map();
  const tokenAccountsByMint = new Map();
  const primarySignatures = new Set();
  const relevantTransferMints = new Set(STABLE_MINTS);

  try {
    while (page < maxPages && work < allowance) {
      const currentPolicy = await assertWalletAllowed(address);
      if (currentPolicy.transaction_limit < policy.transaction_limit && work >= transactionAllowance(previous, currentPolicy)) { budgetExhausted = true; break; }
      page++;

      const pageLimit = Math.min(1000, Math.max(1, Number(process.env.HELIUS_FULL_PAGE_LIMIT || 100)));
      const requestedLimit = Math.min(pageLimit, Math.min(allowance,transactionAllowance(previous,currentPolicy))-work);
      const pageStarted = Date.now(), pageCpu = process.cpuUsage();
      const result = await getTransactionsForAddress(address, paginationToken, {
        tokenAccounts: tokenAccountsFilter,
        limit: requestedLimit
      });
      const transactions = result?.data || [];
      if (!Array.isArray(transactions) || transactions.length > requestedLimit) throw new Error("history_page_exceeds_budget");
      if (!transactions.length) {
        paginationToken = null;
        break;
      }

      const txRows = [];
      const tradeRows = [];
      const transferRows = [];
      const rewardRows = [];
      const fundingRows = [];
      const reparsedSignatures = [];

      for (const tx of transactions) {
        const signature = signatureOf(tx);
        if (!signature) continue;

        const alreadyKnown =
          previous?.newest_signature === signature &&
          mode !== "deep";

        if (alreadyKnown) {
          stoppedOnExisting = true;
          break;
        }

        primarySignatures.add(signature);
        if (legacyTokenAccountFallback) {
          for (const { mint, account } of ownedTokenAccounts(tx, address)) {
            if (!tokenAccountsByMint.has(mint)) tokenAccountsByMint.set(mint, new Set());
            tokenAccountsByMint.get(mint).add(account);
          }
        }

        const analysis = parseTransaction(tx, address);
        observeAnalysis(inventory, analysis);
        reparsedSignatures.push(signature);
        txRows.push(normalizedTransaction(address, tx, analysis, storeRaw));

        for (const trade of analysis?.trades || []) {
          if (trade?.type === "BUY" || trade?.type === "SELL") {
            tradeRows.push(normalizedTrade(address, trade, tx?.slot ?? null));
            if (trade?.tokenMint) relevantTransferMints.add(trade.tokenMint);
          }
        }

        for (const reward of analysis?.rewards || []) {
          rewardRows.push(normalizedReward(address, reward, tx?.slot ?? null));
          if (reward?.quoteMint) relevantTransferMints.add(reward.quoteMint);
        }

        for (const transfer of analysis?.transfers || []) {
          if (transfer?.direction !== "IN" && transfer?.direction !== "OUT") continue;
          if (shouldPersistTransfer(transfer, relevantTransferMints, mode)) {
            transferRows.push(normalizedTransfer(address, transfer, tx?.slot ?? null));
          } else {
            transfersSkipped++;
          }
        }

        for (const funding of parseNativeSolFunding(tx, address, {
          trades: analysis?.trades || [],
          rewards: analysis?.rewards || []
        })) {
          fundingRows.push(normalizedSolFunding(address, funding, tx?.slot ?? null));
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

      const checkpointAt = new Date().toISOString();
      const nextToken = result?.paginationToken || null;
      const checkpoint = mode === "deep" && !stoppedOnExisting ? {
        backfill_pagination_token: nextToken, backfill_started_at: startedAt,
        backfill_updated_at: checkpointAt, transactions_scanned: baseWork + work + transactions.length,
        pages_scanned: Number(previous?.pages_scanned || 0) + page, updated_at: checkpointAt
      } : null;
      const persistStarted = Date.now();
      await persistWalletEventPage(address, reparsedSignatures, {
        transactions: txRows, trades: tradeRows, transfers: transferRows,
        rewards: rewardRows, funding: fundingRows
      }, checkpoint);

      const cpu = process.cpuUsage(pageCpu);
      console.log(JSON.stringify({event:"wallet_history_page",wallet:address,from:baseWork+work+1,to:baseWork+work+transactions.length,transactions:transactions.length,historyMs,persistMs:Date.now()-persistStarted,totalMs:Date.now()-pageStarted,cpuMs:(cpu.user+cpu.system)/1000,heapBytes:process.memoryUsage().heapUsed,rssBytes:process.memoryUsage().rss,historyJsonBytes:historyBytes,estimatedHistoryCredits:Math.max(10,Math.ceil(transactions.length/100)*10)}));
      total += txRows.length;
      work += transactions.length;
      tradesStored += tradeRows.length;
      transfersStored += transferRows.length;
      rewardsStored += rewardRows.length;
      fundingStored += fundingRows.length;

      if (stoppedOnExisting) break;

      paginationToken = result?.paginationToken || null;


      if (!paginationToken) break;
    }

    budgetExhausted = budgetExhausted || (work >= allowance && Boolean(paginationToken) && !stoppedOnExisting);
    let tokenAccountEnrichment = null;
    if (mode === "deep") {
      tokenAccountEnrichment = {
        mode: "unified_gTFA",
        tokenAccountsFilter,
        legacyScanSkipped: true,
        supplementaryScanDisabledByBudget: legacyTokenAccountFallback
      };
    }

    const now = new Date().toISOString();
    const previousNewestTime = secondsFromIso(previous?.newest_block_time);
    const previousOldestTime = secondsFromIso(previous?.oldest_block_time);
    const historyComplete =
      mode === "deep"
        ? !paginationToken && !stoppedOnExisting
        : previous?.history_complete === true && (stoppedOnExisting || !paginationToken);

    const syncState = {
      wallet_address: address,
      status: "idle",
      pages_scanned: Number(previous?.pages_scanned || 0) + page,
      transactions_scanned: baseWork + work,
      last_synced_at: now,
      updated_at: now
    };

    if (newest && (previousNewestTime == null || newest.blockTime > previousNewestTime)) {
      syncState.newest_signature = newest.signature;
      syncState.newest_block_time = isoFromBlockTime(newest.blockTime);
    } else if (previous?.newest_signature) {
      syncState.newest_signature = previous.newest_signature;
      syncState.newest_block_time = previous.newest_block_time;
    }

    if (oldest && (previousOldestTime == null || oldest.blockTime < previousOldestTime)) {
      syncState.oldest_signature = oldest.signature;
      syncState.oldest_block_time = isoFromBlockTime(oldest.blockTime);
    } else if (previous?.oldest_signature) {
      syncState.oldest_signature = previous.oldest_signature;
      syncState.oldest_block_time = previous.oldest_block_time;
    }

    if (mode === "deep") {
      syncState.last_deep_scan_at = now;
      syncState.history_complete = historyComplete;
      syncState.backfill_pagination_token = historyComplete ? null : paginationToken;
      syncState.backfill_started_at = startedAt;
      syncState.backfill_updated_at = now;
    } else if (previous?.history_complete === true) {
      syncState.history_complete = historyComplete;
      if (!historyComplete) {
        syncState.backfill_pagination_token = paginationToken;
        syncState.backfill_updated_at = now;
      }
    }

    await upsertSyncState(syncState);

    return {
      address,
      mode,
      pages: page,
      transactionsStored: total,
      tradesStored,
      transfersStored,
      transfersSkipped,
      transferRetention: mode === "deep" ? "economic_v1" : "full_recent_window",
      rewardsStored,
      fundingStored,
      tokenAccountEnrichment,
      stoppedOnExisting,
      unifiedTokenHistory,
      tokenAccountsFilter,
      resumingBackfill,
      historyComplete,
      budgetExhausted,
      backfillCursorSaved: mode === "deep" && !historyComplete && Boolean(paginationToken),
      status: "idle"
    };
  } catch (error) {
    await upsertSyncState({
      wallet_address: address,
      status: "error",
      ...(mode === "deep" ? {
        backfill_pagination_token: paginationToken,
        backfill_started_at: startedAt,
        backfill_updated_at: new Date().toISOString()
      } : {}),
      updated_at: new Date().toISOString()
    });
    throw error;
  }
}

