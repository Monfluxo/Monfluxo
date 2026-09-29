const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
}

const baseUrl = SUPABASE_URL.replace(/\/$/, "");
const headers = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json"
};

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase request failed (${response.status}): ${body}`);
  }

  if (response.status === 204) return null;

  const body = await response.text();
  if (!body.trim()) return null;

  return JSON.parse(body);
}

function queryEncode(value) {
  return encodeURIComponent(value);
}

export async function assertEventModelV2Schema() {
  try {
    await request("wallet_trades?select=wallet_address,signature,event_index,instruction_index,slot&limit=1");
    await request("wallet_transfers?select=wallet_address,signature,event_index,instruction_index,token_mint,token_amount,slot&limit=1");
    await request("wallet_rewards?select=wallet_address,signature,instruction_index,slot&limit=1");
    await request("wallet_funding_events?select=wallet_address,signature,event_index,asset_type,asset_id,amount&limit=1");
  } catch (error) {
    throw new Error(
      `Event Model v2 schema is not ready. Apply the latest migrations in Supabase before reindexing. ${error.message}`
    );
  }
  return true;
}

export async function walletExists(address) {
  const rows = await request(
    `wallets?address=eq.${queryEncode(address)}&select=address&limit=1`
  );
  return rows.length > 0;
}

export async function upsertWallet(wallet) {
  return request("wallets?on_conflict=address", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(wallet)
  });
}

export async function getSyncState(address) {
  const rows = await request(
    `wallet_sync_state?wallet_address=eq.${queryEncode(address)}&select=*&limit=1`
  );
  return rows[0] || null;
}

export async function upsertSyncState(state) {
  return request("wallet_sync_state?on_conflict=wallet_address", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(state)
  });
}

export async function transactionExists(address, signature) {
  const rows = await request(
    `wallet_transactions?wallet_address=eq.${queryEncode(address)}&signature=eq.${queryEncode(signature)}&select=signature&limit=1`
  );
  return rows.length > 0;
}

export async function upsertTransactions(rows) {
  if (!rows.length) return;
  return request("wallet_transactions?on_conflict=wallet_address,signature", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows)
  });
}

export async function upsertTrades(rows) {
  if (!rows.length) return;
  return request("wallet_trades?on_conflict=wallet_address,signature,event_index", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows)
  });
}

export async function upsertTransfers(rows) {
  if (!rows.length) return;
  return request("wallet_transfers?on_conflict=wallet_address,signature,event_index", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows)
  });
}

export async function upsertRewards(rows) {
  if (!rows.length) return;
  return request("wallet_rewards?on_conflict=wallet_address,signature,quote_mint,instruction_index", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows)
  });
}

export async function upsertFundingEvents(rows) {
  if (!rows.length) return;
  return request("wallet_funding_events?on_conflict=wallet_address,signature,event_index,asset_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows)
  });
}

async function deleteBySignatures(table, address, signatures) {
  if (!signatures.length) return;
  const encoded = signatures.map(queryEncode).join(",");
  return request(
    `${table}?wallet_address=eq.${queryEncode(address)}&signature=in.(${encoded})`,
    { method: "DELETE", headers: { Prefer: "return=minimal" } }
  );
}

export async function replaceWalletEventsForSignatures(address, signatures) {
  const unique = [...new Set(signatures.filter(Boolean))];
  if (!unique.length) return;
  await Promise.all([
    deleteBySignatures("wallet_trades", address, unique),
    deleteBySignatures("wallet_transfers", address, unique),
    deleteBySignatures("wallet_rewards", address, unique),
    deleteBySignatures("wallet_funding_events", address, unique)
  ]);
}

export async function getWalletRewardsPage(address, limit = 1000, offset = 0) {
  const safeLimit = Math.min(Math.max(Number(limit) || 1000, 1), 1000);
  return request(
    `wallet_rewards?wallet_address=eq.${queryEncode(address)}&select=*&order=block_time.asc,slot.asc.nullslast,instruction_index.asc,signature.asc&limit=${safeLimit}&offset=${Math.max(0, offset)}`
  );
}

export async function getWalletTransferPage(address, limit = 1000, offset = 0) {
  const safeLimit = Math.min(Math.max(Number(limit) || 1000, 1), 1000);
  return request(
    `wallet_transfers?wallet_address=eq.${queryEncode(address)}&select=*&order=block_time.asc,slot.asc.nullslast,event_index.asc,signature.asc&limit=${safeLimit}&offset=${Math.max(0, offset)}`
  );
}

export async function getWalletFundingPage(address, limit = 100, offset = 0) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  return request(
    `wallet_funding_events?wallet_address=eq.${queryEncode(address)}&select=*&order=block_time.desc,slot.desc.nullslast,event_index.desc,signature.desc&limit=${safeLimit}&offset=${Math.max(0, offset)}`
  );
}

export async function upsertAnalysisCache(row) {
  return request("wallet_analysis_cache?on_conflict=wallet_address", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(row)
  });
}

export async function recordUsage(event) {
  return request("usage_events", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(event)
  });
}

export async function getRecentUsageCount(userId, action) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const query =
    `usage_events?user_id=eq.${queryEncode(userId)}&action=eq.${queryEncode(action)}&created_at=gte.${queryEncode(since)}&select=id`;
  const rows = await request(query);
  return rows.length;
}

export async function getTradeSamples(limit = 10) {
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 100);
  return request(
    `wallet_trades?select=wallet_address,signature,event_index,parser,type,token_mint,block_time,slot&order=block_time.desc,slot.desc.nullslast,event_index.desc&limit=${safeLimit}`
  );
}

export async function getWalletTradePage(address, limit = 1000, offset = 0) {
  const safeLimit = Math.min(Math.max(Number(limit) || 1000, 1), 1000);
  return request(
    `wallet_trades?wallet_address=eq.${queryEncode(address)}&select=*&order=block_time.asc,slot.asc.nullslast,event_index.asc,signature.asc&limit=${safeLimit}&offset=${Math.max(0, offset)}`
  );
}
