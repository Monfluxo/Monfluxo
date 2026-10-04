import {createHash,randomBytes} from 'node:crypto';
import {assertWalletAllowed} from './walletPolicy.js';
export const creditsEnabled=()=>process.env.MONFLUXO_CREDITS_ENABLED==='true';
export const hashCredential=value=>createHash('sha256').update(value).digest('hex');
export function creditError(code,statusCode=400){return Object.assign(new Error(code.replaceAll('_',' ')),{code,statusCode});}
export async function creditDb(path,options={}){
 const response=await fetch(`${process.env.SUPABASE_URL?.replace(/\/$/,'')}/rest/v1/${path}`,{...options,headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(15000)});
 const body=await response.text();
 if(!response.ok){let message;try{message=JSON.parse(body).message}catch{};const code=['invalid_invitation','account_disabled','subscription_expired','insufficient_credits','wallet_restricted','wallet_analysis_in_progress','history_not_extendable','wallet_limit_reached','unlock_required','active_pro_required','pending_analysis','payment_reference_required','order_not_found','invalid_request','beta_not_started','beta_ended','beta_already_started','wallet_not_indexed','payment_reference_reused','beta_invitation_limit'].find(c=>message?.includes(c));if(code)throw creditError(code,code==='insufficient_credits'?402:code==='wallet_analysis_in_progress'?409:code==='invalid_invitation'?401:403);throw creditError('credit_storage_unavailable',503);}
 return body?JSON.parse(body):null;
}
const rpc=(name,body)=>creditDb(`rpc/${name}`,{method:'POST',body:JSON.stringify(body)});
export function bearer(req){const value=String(req.headers.authorization||'');return /^Bearer [A-Za-z0-9_-]{43}$/.test(value)?value.slice(7):null;}
export async function currentAccount(req,{active=false}={}){
 const token=bearer(req);if(!token)throw creditError('invitation_required',401);
 const sessions=await creditDb(`credit_sessions?token_hash=eq.${hashCredential(token)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=account_id&limit=1`);
 if(!sessions?.length)throw creditError('session_expired',401);
 const accounts=await creditDb(`credit_accounts?id=eq.${sessions[0].account_id}&select=*&limit=1`);const account=accounts?.[0];
 if(!account||account.disabled)throw creditError('account_disabled',403);
 if(active&&new Date(account.expires_at)<=new Date())throw creditError('subscription_expired',403);
 return account;
}
export async function creditSummary(account){
 const[requests,ledger,access,orders]=await Promise.all([
 creditDb(`credit_requests?account_id=eq.${account.id}&status=eq.pending&select=reserved,charged,wallet_address,kind`),
 creditDb(`credit_ledger?account_id=eq.${account.id}&select=delta,reason,wallet_address,created_at&order=created_at.desc&limit=20`),
 creditDb(`credit_wallet_access?account_id=eq.${account.id}&select=wallet_address,kind&order=created_at.desc&limit=100`),
 creditDb(`credit_orders?account_id=eq.${account.id}&select=id,status,credits,usd,created_at&order=created_at.desc&limit=10`)]);
 const reserved=requests.reduce((s,r)=>s+r.reserved-r.charged,0),expired=new Date(account.expires_at)<=new Date();
 return {account:{id:account.id,label:account.label,plan:account.plan,isOwner:account.is_owner===true},available:expired?0:Math.max(0,account.cycle_credits+account.bonus_credits-reserved),cycleRemaining:expired?0:account.cycle_credits,cycleTotal:50,bonus:expired?0:account.bonus_credits,reserved,periodDays:account.plan==='beta'?14:30,expiresAt:account.expires_at,cycleStartedAt:account.cycle_started_at,expired,ledger,access,orders,prices:{proUsd:29,packUsd:5,packCredits:10,analysisCredits:3,analysisTransactions:5000,unlockCredits:1,extensionCredits:1,extensionTransactions:2000},purchaseMode:'manual_confirmation'};
}
export async function loginCredits(code){
 if(typeof code!=='string'||!/^mf_[A-Za-z0-9_-]{43}$/.test(code.trim()))throw creditError('invalid_invitation',401);
 const token=randomBytes(32).toString('base64url');await rpc('credit_login',{p_code_hash:hashCredential(code.trim()),p_token_hash:hashCredential(token)});return token;
}
export async function assertCreditAccess(req,wallet){
 if(!creditsEnabled())return null;
 const account=await currentAccount(req,{active:true});
 const access=await creditDb(`credit_wallet_access?account_id=eq.${account.id}&wallet_address=eq.${encodeURIComponent(wallet)}&select=kind&limit=1`);
 if(!access.length)throw creditError('wallet_unlock_required',402);return account;
}
export async function requestCreditWallet(req,wallet,extend=0){
 if(![-1,0,2000].includes(extend))throw creditError('invalid_request');
 const account=await currentAccount(req,{active:true});await assertWalletAllowed(wallet);
 return rpc('credit_wallet_request',{p_account:account.id,p_wallet:wallet,p_extend:extend});
}
export async function createCreditInvite(label){
 if(typeof label!=='string'||!label.trim()||label.length>80)throw creditError('invalid_label');
 const code=`mf_${randomBytes(32).toString('base64url')}`;
 await rpc('credit_create_invite',{p_hash:hashCredential(code),p_label:label.trim()});return{code,label:label.trim()};
}
export async function createCreditOrder(account){
 if(account.plan!=='pro')throw creditError('active_pro_required',403);
 const rows=await creditDb('credit_orders?on_conflict=account_id',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({account_id:account.id})}).catch(async error=>{
  if(error.code!=='credit_storage_unavailable')throw error;
  return creditDb(`credit_orders?account_id=eq.${account.id}&status=eq.pending&select=id,status,credits,usd,created_at&limit=1`);
 });
 if(!rows?.length)throw creditError('credit_storage_unavailable',503);const{id,status,credits,usd,created_at}=rows[0];return{id,status,credits,usd,created_at};
}
export async function adminCreditAction(input){
 if(input.action==='beta_schedule'){const date=new Date(input.startsAt);if(!Number.isFinite(date.getTime()))throw creditError('invalid_request');return rpc('credit_schedule_beta',{p_start:date.toISOString()});}
 if(input.action==='owner_access'){const code=`mf_${randomBytes(32).toString('base64url')}`;await rpc('credit_create_owner',{p_hash:hashCredential(code)});return{code,label:'MONFLUXO Owner'};}
 if(input.action==='invite')return createCreditInvite(input.label);
 if(input.action==='confirm_order')return rpc('credit_confirm_order',{p_order:input.orderId,p_reference:input.paymentReference});
 if(input.action==='renew')return rpc('credit_renew',{p_account:input.accountId,p_reference:input.paymentReference});
 throw creditError('invalid_request');
}
export async function adminCreditAccounts(){return{usage:await rpc('credit_admin_usage',{}),beta: (await creditDb('credit_beta_config?select=starts_at&limit=1'))[0],accounts:await creditDb('credit_accounts?select=id,label,plan,cycle_credits,bonus_credits,expires_at,disabled,is_owner&order=cycle_started_at.desc&limit=100'),orders:await creditDb('credit_orders?status=eq.pending&select=id,account_id,credits,usd,created_at&order=created_at.desc&limit=100')};}
export async function logoutCredits(req){const token=bearer(req);if(token)await creditDb(`credit_sessions?token_hash=eq.${hashCredential(token)}`,{method:'DELETE'});}
