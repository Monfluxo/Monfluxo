const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
const baseUrl=SUPABASE_URL.replace(/\/$/,"");const headers={apikey:SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,"Content-Type":"application/json"};
async function request(path,options={}){const response=await fetch(`${baseUrl}/rest/v1/${path}`,{...options,headers:{...headers,...(options.headers||{})}});if(!response.ok){const body=await response.text();throw new Error(`Supabase request failed (${response.status}): ${body}`)}if(response.status===204)return null;return response.json()}
export async function getSyncState(wallet){const rows=await request(`wallet_sync_state?wallet_address=eq.${encodeURIComponent(wallet)}&select=*`);return rows?.[0]||null}
export async function getIndexerTelemetry(){const [jobs,states]=await Promise.all([request(`wallet_index_jobs?select=wallet_address,status,attempts,requested_at,started_at,updated_at&order=updated_at.desc`),request(`wallet_sync_state?select=wallet_address,pages_scanned,history_complete,oldest_block_time,backfill_updated_at`)]);const stateMap=new Map((states||[]).map(x=>[x.wallet_address,x]));return (jobs||[]).map(j=>({...j,...(stateMap.get(j.wallet_address)||{})}))}
export async function getWallet(wallet){const rows=await request(`wallets?address=eq.${encodeURIComponent(wallet)}&select=*`);return rows?.[0]||null}
export async function upsertWallet(wallet){return request("wallets?on_conflict=address",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify({address:wallet})})}
export {request};
