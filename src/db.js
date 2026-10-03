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
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYDCLjv5Az5p7TYE3p3w8uJ";
const MATERIAL_STABLE_INFLOW = Number(process.env.MATERIAL_STABLE_INFLOW || 5);
const MIN_NATIVE_SOL_FUNDING = Number(process.env.MIN_NATIVE_SOL_FUNDING || process.env.MIN_WALLET_ORIGIN_SOL || 0.001);
const TRANSACTION_SUMMARY_RETENTION = String(process.env.TRANSACTION_SUMMARY_RETENTION || "economic").toLowerCase();
const STABLE_MINTS = new Set([USDC_MINT, USDT_MINT]);
const ECONOMIC_TRANSACTION_TYPES = new Set(["BUY","SELL","TRANSFER_OUT","CREATOR_FEE_CLAIM"]);
let eventModelV2SchemaPromise = null;
async function request(path, options = {}) {const response=await fetch(`${baseUrl}/rest/v1/${path}`,{signal:AbortSignal.timeout(30000),...options,headers:{...headers,...(options.headers||{})}});if(!response.ok){const body=await response.text();throw new Error(`Supabase request failed (${response.status}): ${body}`)}if(response.status===204)return null;const body=await response.text();if(!body.trim())return null;return JSON.parse(body)}
function queryEncode(value){return encodeURIComponent(value)}
export async function assertEventModelV2Schema(){if(!eventModelV2SchemaPromise){eventModelV2SchemaPromise=Promise.all([request("wallet_trades?select=wallet_address,signature,event_index,instruction_index,slot&limit=1"),request("wallet_transfers?select=wallet_address,signature,event_index,instruction_index,token_mint,token_amount,slot&limit=1"),request("wallet_rewards?select=wallet_address,signature,instruction_index,slot&limit=1"),request("wallet_funding_events?select=wallet_address,signature,event_index,asset_type,asset_id,amount&limit=1")]).then(()=>true).catch(error=>{eventModelV2SchemaPromise=null;throw new Error(`Event Model v2 schema is not ready. Apply the latest migrations in Supabase before reindexing. ${error.message}`)})}return eventModelV2SchemaPromise}
export async function walletExists(address){const rows=await request(`wallets?address=eq.${queryEncode(address)}&select=address&limit=1`);return rows.length>0}
export async function upsertWallet(wallet){return request("wallets?on_conflict=address",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(wallet)})}
export async function getSyncState(address){const rows=await request(`wallet_sync_state?wallet_address=eq.${queryEncode(address)}&select=*&limit=1`);return rows[0]||null}
export async function upsertSyncState(state){return request("wallet_sync_state?on_conflict=wallet_address",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(state)})}
export async function transactionExists(address,signature){const rows=await request(`wallet_transactions?wallet_address=eq.${queryEncode(address)}&signature=eq.${queryEncode(signature)}&select=signature&limit=1`);return rows.length>0}
function retainTransactionSummary(row){if(TRANSACTION_SUMMARY_RETENTION==="all")return true;if(TRANSACTION_SUMMARY_RETENTION==="none")return false;return ECONOMIC_TRANSACTION_TYPES.has(String(row?.parsed_type||"").toUpperCase())}
function uniqueRows(rows,keyFn){const seen=new Set(),result=[];for(const row of rows||[]){const key=keyFn(row);if(!key||seen.has(key))continue;seen.add(key);result.push(row)}return result}
export async function upsertTransactions(rows){const retained=uniqueRows((rows||[]).filter(retainTransactionSummary),row=>row?.wallet_address&&row?.signature?`${row.wallet_address}:${row.signature}`:null);if(!retained.length)return;return request("wallet_transactions?on_conflict=wallet_address,signature",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(retained)})}
export async function upsertTrades(rows){if(!rows.length)return;return request("wallet_trades?on_conflict=wallet_address,signature,event_index",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows)})}
function retainTransfer(row){if(!row?.wallet_address||!row?.signature||!row?.token_mint)return false;if(!["IN","OUT"].includes(row.direction))return false;const amount=Number(row.token_amount);if(!Number.isFinite(amount)||amount<=0)return false;return true}
export async function upsertTransfers(rows){const retained=uniqueRows((rows||[]).filter(retainTransfer),row=>row?.wallet_address&&row?.signature&&Number.isInteger(row?.event_index)?`${row.wallet_address}:${row.signature}:${row.event_index}`:null);if(!retained.length)return;return request("wallet_transfers?on_conflict=wallet_address,signature,event_index",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(retained)})}
export async function upsertRewards(rows){if(!rows.length)return;return request("wallet_rewards?on_conflict=wallet_address,signature,quote_mint,instruction_index",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows)})}
function retainSolFunding(row){if(row?.asset_type!=="SOL")return false;if(!row?.wallet_address||!row?.signature)return false;const amount=Number(row.amount);return Number.isFinite(amount)&&amount>=MIN_NATIVE_SOL_FUNDING}
export async function upsertFundingEvents(rows){const solRows=uniqueRows((rows||[]).filter(retainSolFunding),row=>row?.wallet_address&&row?.signature&&Number.isInteger(row?.event_index)?`${row.wallet_address}:${row.signature}:${row.event_index}:SOL`:null);if(!solRows.length)return;return request("wallet_funding_events?on_conflict=wallet_address,signature,event_index,asset_id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(solRows)})}
async function deleteBySignatures(table,address,signatures){if(!signatures.length)return;const encoded=signatures.map(queryEncode).join(",");return request(`${table}?wallet_address=eq.${queryEncode(address)}&signature=in.(${encoded})`,{method:"DELETE",headers:{Prefer:"return=minimal"}})}
export async function replaceWalletEventsForSignatures(address,signatures){const unique=[...new Set(signatures.filter(Boolean))];if(!unique.length)return;await Promise.all([deleteBySignatures("wallet_trades",address,unique),deleteBySignatures("wallet_transfers",address,unique),deleteBySignatures("wallet_rewards",address,unique),deleteBySignatures("wallet_funding_events",address,unique)])}
export async function getWalletRewardsPage(address,limit=1000,offset=0,mint=null){const safeLimit=Math.min(Math.max(Number(limit)||1000,1),1000);return request(`wallet_rewards?wallet_address=eq.${queryEncode(address)}${mint?`&quote_mint=eq.${queryEncode(mint)}`:""}&select=*&order=block_time.asc,slot.asc.nullslast,instruction_index.asc,signature.asc&limit=${safeLimit}&offset=${Math.max(0,offset)}`)}
export async function getWalletTransferPage(address,limit=1000,offset=0,mint=null){const safeLimit=Math.min(Math.max(Number(limit)||1000,1),1000);return request(`wallet_transfers?wallet_address=eq.${queryEncode(address)}${mint?`&token_mint=eq.${queryEncode(mint)}`:""}&select=*&order=block_time.asc,slot.asc.nullslast,event_index.asc,signature.asc&limit=${safeLimit}&offset=${Math.max(0,offset)}`)}
export async function getWalletInboundTransferPage(address,limit=1000,offset=0){const safeLimit=Math.min(Math.max(Number(limit)||1000,1),1000);return request(`wallet_transfers?wallet_address=eq.${queryEncode(address)}&direction=eq.IN&select=*&order=block_time.desc,slot.desc.nullslast,event_index.desc,signature.desc&limit=${safeLimit}&offset=${Math.max(0,offset)}`)}
export async function getWalletFundingPage(address,limit=100,offset=0){const safeLimit=Math.min(Math.max(Number(limit)||100,1),500);return request(`wallet_funding_events?wallet_address=eq.${queryEncode(address)}&asset_type=eq.SOL&amount=gte.${queryEncode(MIN_NATIVE_SOL_FUNDING)}&select=*&order=block_time.desc,slot.desc.nullslast,event_index.desc,signature.desc&limit=${safeLimit}&offset=${Math.max(0,offset)}`)}
export async function getAnalysisCache(address){const rows=await request(`wallet_analysis_cache?wallet_address=eq.${queryEncode(address)}&select=*&limit=1`);return rows[0]||null}
export async function upsertAnalysisCache(row){return request("wallet_analysis_cache?on_conflict=wallet_address",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(row)})}
export async function recordUsage(event){return request("usage_events",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify(event)})}
export async function getRecentUsageCount(userId,action){const since=new Date(Date.now()-24*60*60*1000).toISOString();const query=`usage_events?user_id=eq.${queryEncode(userId)}&action=eq.${queryEncode(action)}&created_at=gte.${queryEncode(since)}&select=id`;const rows=await request(query);return rows.length}
export async function getTradeSamples(limit=10){const safeLimit=Math.min(Math.max(Number(limit)||10,1),100);return request(`wallet_trades?select=wallet_address,signature,event_index,parser,type,token_mint,block_time,slot&order=block_time.desc,slot.desc.nullslast,event_index.desc&limit=${safeLimit}`)}
export async function getWalletTradePage(address,limit=1000,offset=0,mint=null){const safeLimit=Math.min(Math.max(Number(limit)||1000,1),1000);return request(`wallet_trades?wallet_address=eq.${queryEncode(address)}${mint?`&token_mint=eq.${queryEncode(mint)}`:""}&select=*&order=block_time.asc,slot.asc.nullslast,event_index.asc,signature.asc&limit=${safeLimit}&offset=${Math.max(0,offset)}`)}


export async function persistWalletEventPage(address,signatures,data,checkpoint=null){
  const retained={
    transactions:uniqueRows(data.transactions.filter(retainTransactionSummary),r=>`${r.wallet_address}:${r.signature}`),
    trades:data.trades,
    transfers:uniqueRows(data.transfers.filter(retainTransfer),r=>`${r.wallet_address}:${r.signature}:${r.event_index}`),
    rewards:data.rewards,
    funding:uniqueRows(data.funding.filter(retainSolFunding),r=>`${r.wallet_address}:${r.signature}:${r.event_index}:SOL`)
  };
  return request("rpc/persist_wallet_event_page",{method:"POST",body:JSON.stringify({
    p_wallet:address,p_signatures:[...new Set(signatures)],p_data:retained,p_checkpoint:checkpoint
  })});
}
