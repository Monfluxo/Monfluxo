import { spawn } from "node:child_process";

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

async function request(path) {
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, { headers });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase bulk repair query failed (${response.status}): ${body}`);
  }
  return response.json();
}

function q(value) {
  return encodeURIComponent(value);
}

async function listCandidateWallets() {
  const wallets = await request("wallets?select=address&order=updated_at.desc&limit=10000");
  const candidates = [];

  for (const row of wallets) {
    const address = row.address;
    if (!address) continue;

    const [txRows, solRows] = await Promise.all([
      request(`wallet_transactions?wallet_address=eq.${q(address)}&select=signature&limit=1`),
      request(`wallet_funding_events?wallet_address=eq.${q(address)}&asset_type=eq.SOL&select=signature&limit=1`)
    ]);

    if (txRows.length > 0 && solRows.length === 0) candidates.push(address);
  }

  return candidates;
}

function runRepair(address) {
  return new Promise((resolve, reject) => {
    console.log(`\n[funding-repair-all] repairing ${address}`);
    const child = spawn(process.execPath, ["src/repairNativeFunding.js", address], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`repairNativeFunding exited with code ${code} for ${address}`));
    });
  });
}

const candidates = await listCandidateWallets();
console.log(`[funding-repair-all] ${candidates.length} wallet(s) need native SOL funding repair`);

let repaired = 0;
let failed = 0;

for (let index = 0; index < candidates.length; index++) {
  const address = candidates[index];
  console.log(`[funding-repair-all] ${index + 1}/${candidates.length} ${address}`);
  try {
    await runRepair(address);
    repaired++;
  } catch (error) {
    failed++;
    console.error(`[funding-repair-all] failed ${address}: ${error.message}`);
  }
}

console.log(JSON.stringify({
  candidates: candidates.length,
  repaired,
  failed,
  completedAt: new Date().toISOString()
}, null, 2));

if (failed > 0) process.exitCode = 1;
