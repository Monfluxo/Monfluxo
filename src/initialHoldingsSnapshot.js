import {creditDb} from './creditService.js';
import {getFreshWalletHoldings} from './walletPortfolioService.js';
export function compactHoldingsSnapshot(wallet, snapshot, kind) {
 return {wallet_address:wallet,captured_at:snapshot.generatedAt,snapshot_kind:kind,slot_from:snapshot.slotFrom,slot_to:snapshot.slotTo,
 native_lamports:snapshot.nativeBalanceLamports,token_count:snapshot.holdings.length,
 balances:snapshot.holdings.map(p=>[p.tokenMint,p.rawBalance,p.decimals])};
}
export async function prepareInitialHoldings(wallet) {
 const rows=await creditDb(`wallet_initial_holdings?wallet_address=eq.${encodeURIComponent(wallet)}&select=wallet_address&limit=1`);
 if(rows.length)return null;
 const states=await creditDb(`wallet_sync_state?wallet_address=eq.${encodeURIComponent(wallet)}&select=transactions_scanned,pages_scanned&limit=1`);
 const state=states[0];
 const kind=Number(state?.transactions_scanned||state?.pages_scanned||0)>0?'first_recorded':'scan_start';
 return compactHoldingsSnapshot(wallet,await getFreshWalletHoldings(wallet),kind);
}
export async function saveInitialHoldings(snapshot) {
 if(!snapshot)return;
 await creditDb('wallet_initial_holdings?on_conflict=wallet_address',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify(snapshot)});
}
export async function initialHoldingsSummary(wallet) {
 const rows=await creditDb(`wallet_initial_holdings?wallet_address=eq.${encodeURIComponent(wallet)}&select=captured_at,snapshot_kind,token_count&limit=1`);
 const s=rows[0];return s?{capturedAt:s.captured_at,kind:s.snapshot_kind,tokenCount:s.token_count}:null;
}
