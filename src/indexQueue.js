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
    throw new Error(`Supabase queue request failed (${response.status}): ${body}`);
  }

  if (response.status === 204) return null;
  const body = await response.text();
  return body.trim() ? JSON.parse(body) : null;
}

export async function enqueueWalletIndexJob(walletAddress, priority = 100) {
  const rows = await request("rpc/enqueue_wallet_index_job", {
    method: "POST",
    body: JSON.stringify({
      p_wallet_address: walletAddress,
      p_priority: Number(priority) || 100
    })
  });

  return Array.isArray(rows) ? rows[0] || null : rows;
}

export async function claimWalletIndexJob() {
  const rows = await request("rpc/claim_wallet_index_job", {
    method: "POST",
    body: "{}"
  });

  return Array.isArray(rows) ? rows[0] || null : rows;
}

export async function updateWalletIndexJob(walletAddress, patch) {
  const encoded = encodeURIComponent(walletAddress);
  return request(`wallet_index_jobs?wallet_address=eq.${encoded}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() })
  });
}
