import { getTradeSamples, getSyncState, upsertSyncState } from "./db.js";
import { syncWalletHistory } from "./sync.js";
import { analyzeWallet } from "./walletAnalyzer.js";

let address = process.argv[2];

if (!address) {
  const samples = await getTradeSamples(1);
  address = samples[0]?.wallet_address || null;
}

if (!address) {
  console.error("No hay ninguna wallet con trades en Supabase.");
  process.exit(1);
}

const previous = await getSyncState(address);

console.log(`Wallet: ${address}`);
console.log("Forzando escaneo histórico completo desde Helius...");

await upsertSyncState({
  wallet_address: address,
  status: "idle",
  newest_signature: null,
  newest_block_time: null,
  oldest_signature: null,
  oldest_block_time: null,
  pages_scanned: 0,
  history_complete: false,
  updated_at: new Date().toISOString()
});

try {
  const sync = await syncWalletHistory(address, {
    mode: "deep",
    maxPages: Number(process.env.MAX_DEEP_PAGES || 500),
    storeRaw: process.env.STORE_RAW_TRANSACTIONS !== "false"
  });

  console.log("DEEP SYNC");
  console.log(JSON.stringify(sync, null, 2));

  console.log("Recalculando posiciones y métricas...");
  const analysis = await analyzeWallet(address, { mode: "deep" });

  console.log("ANALYSIS");
  console.log(JSON.stringify(analysis.metrics, null, 2));
} catch (error) {
  if (previous) {
    await upsertSyncState({
      ...previous,
      status: "idle",
      updated_at: new Date().toISOString()
    });
  }
  console.error("Wallet repair failed:", error.message);
  process.exit(1);
}
