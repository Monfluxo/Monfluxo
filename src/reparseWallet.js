import { getTransaction } from "./helius.js";
import { parseTransaction } from "./parser.js";
import {
  getWalletTradePage,
  getTradeSamples,
  replaceWalletEventsForSignatures,
  upsertTrades,
  upsertTransfers,
  upsertRewards
} from "./db.js";

function isoFromBlockTime(blockTime) {
  return typeof blockTime === "number"
    ? new Date(blockTime * 1000).toISOString()
    : null;
}

function normalizedTrade(wallet, trade) {
  return {
    wallet_address: wallet,
    signature: trade.signature,
    event_index: Number.isInteger(trade.eventIndex) ? trade.eventIndex : 0,
    instruction_index: Number.isInteger(trade.instructionIndex) ? trade.instructionIndex : null,
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

function normalizedTransfer(wallet, transfer) {
  return {
    wallet_address: wallet,
    signature: transfer.signature,
    event_index: Number.isInteger(transfer.eventIndex) ? transfer.eventIndex : 0,
    instruction_index: Number.isInteger(transfer.instructionIndex) ? transfer.instructionIndex : null,
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

function argNumber(index, fallback) {
  const n = Number(process.argv[index]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

let address = process.argv[2];
if (!address) {
  const samples = await getTradeSamples(1);
  address = samples[0]?.wallet_address || null;
  if (!address) {
    console.error("No hay ninguna wallet con trades en Supabase.");
    process.exit(1);
  }
  console.log(`Wallet seleccionada automáticamente desde Supabase: ${address}`);
}

const limit = argNumber(3, 1000);
const offset = Math.max(0, argNumber(4, 1) - 1);
console.log(`Reparsing ${address}`);
console.log(`Procesando hasta ${limit} firmas desde offset ${offset}...`);

const rows = await getWalletTradePage(address, limit, offset);
if (!rows.length) {
  console.log("No hay trades almacenados en ese rango.");
  process.exit(0);
}

const signatures = [...new Set(rows.map((row) => row.signature).filter(Boolean))];
const tradeRows = [];
const transferRows = [];
const rewardRows = [];
const summary = {
  signatures: signatures.length,
  trades: 0,
  transfers: 0,
  rewards: 0,
  multiTradeTransactions: 0,
  instruction_swap: 0,
  legacy_balance: 0,
  BUY: 0,
  SELL: 0,
  errors: 0
};
const dexCounts = new Map();

for (let index = 0; index < signatures.length; index++) {
  const signature = signatures[index];
  console.log(`[${index + 1}/${signatures.length}] ${signature}`);

  try {
    const transaction = await getTransaction(signature);
    if (!transaction) {
      console.log("  Helius no devolvió la transacción.");
      summary.errors++;
      continue;
    }

    const analysis = parseTransaction(transaction, address);
    const parsedTrades = analysis?.trades || [];
    const parsedTransfers = analysis?.transfers || [];
    const parsedRewards = analysis?.rewards || [];

    if (parsedTrades.length > 1) summary.multiTradeTransactions++;

    for (const trade of parsedTrades) {
      const normalized = normalizedTrade(address, trade);
      tradeRows.push(normalized);
      summary.trades++;
      summary[normalized.type]++;
      if (normalized.parser === "instruction_swap") summary.instruction_swap++;
      else if (normalized.parser === "legacy_balance") summary.legacy_balance++;
      const dex = normalized.dex || "NULL";
      dexCounts.set(dex, (dexCounts.get(dex) || 0) + 1);
    }

    for (const transfer of parsedTransfers) {
      transferRows.push(normalizedTransfer(address, transfer));
      summary.transfers++;
    }
    for (const reward of parsedRewards) {
      rewardRows.push(normalizedReward(address, reward));
      summary.rewards++;
    }

    await replaceWalletEventsForSignatures(address, [signature]);
  } catch (error) {
    summary.errors++;
    console.error(`  Error: ${error.message}`);
  }
}

if (tradeRows.length) await upsertTrades(tradeRows);
if (transferRows.length) await upsertTransfers(transferRows);
if (rewardRows.length) await upsertRewards(rewardRows);

console.log("");
console.log("========================");
console.log("EVENT MODEL V2 REPARSE");
console.log("========================");
console.log("Signatures:", summary.signatures);
console.log("Trades:", summary.trades);
console.log("Transfers:", summary.transfers);
console.log("Rewards:", summary.rewards);
console.log("Multi-trade tx:", summary.multiTradeTransactions);
console.log("BUY:", summary.BUY);
console.log("SELL:", summary.SELL);
console.log("instruction_swap:", summary.instruction_swap);
console.log("legacy_balance:", summary.legacy_balance);
console.log("Errors:", summary.errors);
console.log("");
console.log("DEX COUNTS");
for (const [dex, count] of [...dexCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${dex}: ${count}`);
}
