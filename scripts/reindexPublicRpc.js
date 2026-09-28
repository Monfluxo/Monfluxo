import fs from "node:fs";
import { parseTransaction } from "../src/parser.js";

const WALLET = process.argv[2] || "CjfLyafnK76qJyfTnBF8wb2H15D3bnMVNbRESmByDtmX";
const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const OUT = process.env.REINDEX_OUTPUT || "reindex-events.json";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rpc(method, params, attempts = 6) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
      return data.result;
    } catch (error) {
      lastError = error;
      await sleep(Math.min(10000, 500 * 2 ** attempt));
    }
  }
  throw lastError;
}

async function rpcBatch(signatures, attempts = 6) {
  const requests = signatures.map((signature, index) => ({
    jsonrpc: "2.0",
    id: index + 1,
    method: "getTransaction",
    params: [signature, {
      encoding: "jsonParsed",
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0
    }]
  }));

  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requests)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (!Array.isArray(body)) throw new Error("RPC batch response was not an array");
      const byId = new Map(body.map((item) => [item.id, item]));
      return signatures.map((signature, index) => ({
        signature,
        result: byId.get(index + 1)?.result ?? null,
        error: byId.get(index + 1)?.error ?? null
      }));
    } catch (error) {
      lastError = error;
      await sleep(Math.min(10000, 750 * 2 ** attempt));
    }
  }
  throw lastError;
}

async function getAllSignatures() {
  const all = [];
  let before = null;
  while (true) {
    const options = { limit: 1000 };
    if (before) options.before = before;
    const page = await rpc("getSignaturesForAddress", [WALLET, options]);
    if (!page?.length) break;
    all.push(...page);
    before = page.at(-1).signature;
    console.log(`signatures: ${all.length}`);
    if (page.length < 1000) break;
    await sleep(350);
  }
  return all;
}

function normalizeTrade(trade) {
  return {
    wallet_address: WALLET,
    signature: trade.signature,
    event_index: Number.isInteger(trade.eventIndex) ? trade.eventIndex : 0,
    instruction_index: Number.isInteger(trade.instructionIndex) ? trade.instructionIndex : null,
    block_time: typeof trade.blockTime === "number" ? new Date(trade.blockTime * 1000).toISOString() : null,
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

function normalizeTransfer(transfer) {
  return {
    wallet_address: WALLET,
    signature: transfer.signature,
    event_index: Number.isInteger(transfer.eventIndex) ? transfer.eventIndex : 0,
    instruction_index: Number.isInteger(transfer.instructionIndex) ? transfer.instructionIndex : null,
    block_time: typeof transfer.blockTime === "number" ? new Date(transfer.blockTime * 1000).toISOString() : null,
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

function normalizeReward(reward) {
  return {
    wallet_address: WALLET,
    signature: reward.signature,
    block_time: typeof reward.blockTime === "number" ? new Date(reward.blockTime * 1000).toISOString() : null,
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

const signatureRows = await getAllSignatures();
const signatures = signatureRows.map((row) => row.signature);
const output = {
  wallet: WALLET,
  generated_at: new Date().toISOString(),
  signature_count: signatures.length,
  transactions: [],
  trades: [],
  transfers: [],
  rewards: [],
  rpc_failures: [],
  parse_failures: []
};

for (let i = 0; i < signatures.length; i += 10) {
  const chunk = signatures.slice(i, i + 10);
  let batch;
  try {
    batch = await rpcBatch(chunk);
  } catch (error) {
    for (const signature of chunk) {
      output.rpc_failures.push({ signature, error: error?.message || String(error) });
    }
    continue;
  }

  for (const item of batch) {
    if (!item.result) {
      output.rpc_failures.push({ signature: item.signature, error: item.error || "null transaction" });
      continue;
    }
    try {
      const analysis = parseTransaction(item.result, WALLET);
      output.transactions.push({
        wallet_address: WALLET,
        signature: item.signature,
        parsed_type: analysis.type,
        parser_reason: analysis.reason
      });
      output.trades.push(...(analysis.trades || []).map(normalizeTrade));
      output.transfers.push(...(analysis.transfers || []).map(normalizeTransfer));
      output.rewards.push(...(analysis.rewards || []).map(normalizeReward));
    } catch (error) {
      output.parse_failures.push({ signature: item.signature, error: error?.message || String(error) });
    }
  }

  if ((i + 10) % 100 === 0 || i + 10 >= signatures.length) {
    console.log(JSON.stringify({
      processed: Math.min(i + 10, signatures.length),
      trades: output.trades.length,
      transfers: output.transfers.length,
      rewards: output.rewards.length,
      rpc_failures: output.rpc_failures.length,
      parse_failures: output.parse_failures.length
    }));
  }
  await sleep(180);
}

fs.writeFileSync(OUT, JSON.stringify(output));
console.log(`wrote ${OUT}`);
