import {getTransactionSignaturesForAddress} from './helius.js';
const base=String(process.env.SUPABASE_URL||'').replace(/\/$/,''),key=process.env.SUPABASE_SERVICE_ROLE_KEY;
async function rest(path,options={}) {
 const r=await fetch(`${base}/rest/v1/${path}`,{...options,headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',...(options.headers||{})},signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error(`counter_recount_${r.status}: ${await r.text()}`);
 const body=await r.text();return body?JSON.parse(body):null;
}
export async function processCounterRecountSlice(maxPages=50) {
 const [job]=await rest('rpc/claim_wallet_counter_recount',{method:'POST',body:'{}'});
 if(!job)return false;
 const wallet=job.wallet_address,snapshot=job.snapshot;
 let cursor=job.pagination_token,count=Number(job.transactions_counted),pages=Number(job.pages_counted),lastSignature=job.last_signature;
 const save=async patch=>rest(`wallet_counter_recounts?wallet_address=eq.${wallet}&lease_token=eq.${job.lease_token}`,{method:'PATCH',body:JSON.stringify({...patch,updated_at:new Date().toISOString()})});
 try {
  if(!snapshot.newest || !snapshot.oldest)throw Error('indexed_history_boundaries_missing');
  let filters=job.count_filters;
  if(!filters) {
   const [state]=await rest(`wallet_sync_state?wallet_address=eq.${wallet}&select=history_complete`);
   filters={signature:{lte:snapshot.newest}};
   if(snapshot.cursor) {
    // Resolve the FIRST UNINDEXED transaction using the exact saved pagination token.
    // Its exclusive signature bound handles multiple transactions in the same slot.
    const boundary=await getTransactionSignaturesForAddress(wallet,snapshot.cursor,{limit:1,filters});
    if(!Array.isArray(boundary?.data))throw Error('invalid_counter_boundary');
    if(boundary.data.length) {
     const signature=boundary.data[0].signature || boundary.data[0];
     if(typeof signature!=='string')throw Error('invalid_counter_boundary_signature');
     filters.signature.gt=signature;
    }
   } else if(state?.history_complete!==true) filters.signature.gte=snapshot.oldest;
   await save({count_filters:filters});
  }
  for(let i=0;i<maxPages;i++) {
   const result=await getTransactionSignaturesForAddress(wallet,cursor,{limit:1000,filters});
   if(!Array.isArray(result?.data)||result.data.length>1000)throw Error('invalid_signature_page');
   const signatures=result.data.map(t=>typeof t==='string'?t:t.signature);
   if(signatures.some(s=>typeof s!=='string'||!s))throw Error('invalid_history_signature');
   if(new Set(signatures).size!==signatures.length)throw Error('duplicate_signature_page');
   const next=result.paginationToken||null;
   if(next&&next===cursor)throw Error('counter_cursor_did_not_advance');
   if(signatures[0]===lastSignature)signatures.shift();
   count+=signatures.length;pages++;cursor=next;
   lastSignature=signatures.at(-1)||lastSignature;
   if(!cursor || !result.data.length) {
    if(count===0)throw Error("empty_indexed_counter_recount");
    await save({transactions_counted:count,pages_counted:pages,pagination_token:cursor,last_signature:lastSignature});
    const complete=await rest('rpc/finish_wallet_counter_recount',{method:'POST',body:JSON.stringify({p_wallet:wallet,p_lease:job.lease_token,p_total:count})});
    console.log(JSON.stringify({event:'wallet_counter_recount',wallet,count,pages,complete}));return true;
   }
   if((i+1)%10===0)await save({transactions_counted:count,pages_counted:pages,pagination_token:cursor,last_signature:lastSignature,lease_until:new Date(Date.now()+300000).toISOString()});
  }
  await save({status:'queued',transactions_counted:count,pages_counted:pages,pagination_token:cursor,last_signature:lastSignature,lease_until:null});
  console.log(JSON.stringify({event:'wallet_counter_recount_progress',wallet,count,pages}));
 } catch(e) {
  // Last saved cursor/count survive failures; retry is possible without redoing full history.
  await save({status:'error',last_error:String(e.message||e).slice(0,1000),lease_until:null});
  console.error(JSON.stringify({event:'wallet_counter_recount_error',wallet,error:e.message}));
 }
 return true;
}
