import {excludedWallets} from './walletPolicy.js';
import {createResultCache} from './resultCache.js';
import {buildTelemetrySnapshot,publicTelemetry} from './telemetrySnapshot.js';
const base=String(process.env.SUPABASE_URL||'').replace(/\/$/,''),key=process.env.SUPABASE_SERVICE_ROLE_KEY;
const cache=createResultCache({ttlMs:5000,maxEntries:1});let previous=null;
async function q(path){const rows=[];for(let offset=0;;offset+=1000){const r=await fetch(`${base}/rest/v1/${path}&limit=1000&offset=${offset}`,{headers:{apikey:key,Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error(`telemetry ${r.status}`);const page=await r.json();rows.push(...page);if(page.length<1000)return rows;}}
async function collect(){const[jobs,states,smartScores,excluded]=await Promise.all([q('wallet_index_jobs?select=wallet_address,status,attempts,requested_at,started_at,updated_at&order=wallet_address.asc'),q('wallet_sync_state?select=wallet_address,pages_scanned,transactions_scanned,history_complete,oldest_block_time,backfill_updated_at,updated_at&order=wallet_address.asc'),q('wallet_smart_scores?select=wallet_address,score,classification,eligible,journeys_analyzed,win_rate,profit_factor,median_roi,consistency,risk_score,tags,methodology_version,calculated_at&order=wallet_address.asc'),excludedWallets()]);const now=Date.now(),snapshot=buildTelemetrySnapshot({jobs,states,smartScores,excluded,now,staleMs:Number(process.env.INDEX_JOB_STALE_MS||300000),workerCapacity:Math.max(1,Number(process.env.INDEX_WORKER_CAPACITY||1))});
 if(previous&&now-previous.at>=5000){let delta=0;for(const s of states){if(!excluded.has(s.wallet_address))delta+=Math.max(0,Number(s.pages_scanned||0)-Number(previous.pages.get(s.wallet_address)||0));}snapshot.pagesPerMinute=Number((delta*60000/(now-previous.at)).toFixed(1));}
 previous={at:now,pages:new Map(states.map(s=>[s.wallet_address,Number(s.pages_scanned||0)]))};return snapshot;
}
export const getIndexerTelemetry=()=>cache.get('network',collect);
export async function getPublicIndexerTelemetry(){return publicTelemetry(await getIndexerTelemetry());}
