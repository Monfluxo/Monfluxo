import { analyzeWallet } from "../src/walletAnalyzer.js";
const BASE = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!BASE || !KEY) throw new Error("Supabase service credentials missing");
const response = await fetch(`${BASE}/rest/v1/wallet_sync_state?select=wallet_address&history_complete=eq.true&order=wallet_address.asc`, {
  headers: {apikey: KEY, Authorization: `Bearer ${KEY}`}, signal: AbortSignal.timeout(30000)
});
if (!response.ok) throw new Error(`Wallet list failed: ${response.status}`);
const states = await response.json();
let failures = 0;
for (const {wallet_address: wallet} of states) {
  try {
    const {metrics} = await analyzeWallet(wallet, {mode:"deep", readOnly:true});
    console.log(JSON.stringify({wallet, trades:metrics.tradesAnalyzed, journeys:metrics.intelligenceSnapshot.journeys.count, complete:metrics.metricsComplete}));
  } catch (error) {
    failures++;
    console.error(JSON.stringify({wallet,error:error.message}));
  }
}
if (failures) process.exitCode = 1;
