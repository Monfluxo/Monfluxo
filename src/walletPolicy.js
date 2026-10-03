import { classifyIdentity, highActivitySample, CREDIT_PLAN } from './analysisBudget.js';
const ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
let identityDisabledUntil = 0;
const pending = new Map();
async function db(path, options = {}) {
  const r = await fetch(`${String(process.env.SUPABASE_URL).replace(/\/$/, '')}/rest/v1/${path}`, {
    ...options, headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', ...options.headers }, signal: AbortSignal.timeout(10000)
  });
  if (!r.ok) throw new Error(`wallet_policy_storage_${r.status}`);
  const text = await r.text(); return text ? JSON.parse(text) : null;
}
export async function getWalletPolicy(wallet) {
  const rows = await db(`wallet_analysis_policies?wallet_address=eq.${encodeURIComponent(wallet)}&limit=1`);
  return rows?.[0] || null;
}
export async function saveWalletPolicy(wallet, patch) {
  const record = { wallet_address: wallet, ...patch, updated_at: new Date().toISOString() };
  let rows;
  if (patch.source === 'helius_preflight') {
    // Provider results must never overwrite a manual policy saved during lookup.
    await db('wallet_analysis_policies?on_conflict=wallet_address', {method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify(record)});
    rows = await db(`wallet_analysis_policies?wallet_address=eq.${encodeURIComponent(wallet)}&source=eq.helius_preflight`, {method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(record)});
    if (!rows.length) return getWalletPolicy(wallet);
  } else {
    rows = await db('wallet_analysis_policies?on_conflict=wallet_address', {method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify(record)});
  }
  if (patch.source === 'manual') {
    if (['allow','exclude'].includes(patch.action)) await db(`wallet_index_jobs?wallet_address=eq.${encodeURIComponent(wallet)}&status=eq.paused`, {method:'PATCH',body:JSON.stringify({status:'queued',last_error:null,requested_at:new Date().toISOString(),updated_at:new Date().toISOString()})});
    else await db(`wallet_index_jobs?wallet_address=eq.${encodeURIComponent(wallet)}&status=eq.queued`, {method:'PATCH',body:JSON.stringify({status:'paused',last_error:'wallet_'+patch.action,updated_at:new Date().toISOString()})});
  }
  return rows[0];
}
export function validatePolicyInput(input) {
  if (!input || !ADDRESS_RE.test(input.wallet || '') || !['allow', 'block', 'exclude', 'review'].includes(input.action)) throw new Error('invalid_wallet_policy');
  const limit = input.transactionLimit ?? 5000;
  if (!Number.isSafeInteger(limit) || limit < 5000 || limit > 50000) throw new Error('invalid_transaction_limit');
  if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 300) throw new Error('policy_reason_required');
  return { action: input.action, transaction_limit: limit, reason: input.reason.trim(), name: String(input.name || '').slice(0,120), category: String(input.category || 'Manual').slice(0,80), source: 'manual', checked_at: new Date().toISOString() };
}
async function lookupIdentity(wallet) {
  if (Date.now() < identityDisabledUntil) return null;
  try {
    const r = await fetch(`https://api.helius.xyz/v1/wallet/${encodeURIComponent(wallet)}/identity`, { headers: { 'X-Api-Key': process.env.HELIUS_API_KEY }, signal: AbortSignal.timeout(4000) });
    if (r.status === 403) { identityDisabledUntil = Date.now() + 3600000; console.warn('Helius Identity unavailable on this plan; bounded analysis remains enabled.'); }
    if (!r.ok) return null;
    const value = await r.json();
    return value?.address === wallet ? value : null;
  } catch { return null; }
}
async function inspectPolicy(wallet) {
  const stored = await getWalletPolicy(wallet);
  if (stored?.source === 'manual' || (stored?.checked_at && Date.now() - Date.parse(stored.checked_at) < 86400000)) return stored;
  const identity = await lookupIdentity(wallet);
  let action = classifyIdentity(identity), reason = identity ? `Known entity: ${identity.category || identity.type || 'wallet'}.` : 'Bounded analysis; wallet identity is unconfirmed.';
  let activity = null;
  if (!identity && !stored) {
    try {
      const r = await fetch(`https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(4000), body: JSON.stringify({ jsonrpc: '2.0', id: 'wallet-preflight', method: 'getSignaturesForAddress', params: [wallet, { limit: 1000 }] }) });
      if (r.ok) { const p = await r.json(); activity = highActivitySample(p.result); }
    } catch {}
    if (activity) { action = 'review'; reason = 'At least 1,000 recent signatures within 24 hours. Automatic analysis requires review; this is not a bot classification.'; }
  }
  // Retain a previous institutional restriction if the provider temporarily fails.
  if (!identity && stored && stored.action !== 'allow') return stored;
  return saveWalletPolicy(wallet, { action, transaction_limit: stored?.transaction_limit || 5000, name: identity?.name || null, category: identity?.category || (activity ? 'High activity' : 'Unknown'), reason, source: 'helius_preflight', checked_at: new Date().toISOString() });
}
export async function preflightWallet(wallet) {
  if (!ADDRESS_RE.test(wallet)) throw new Error('invalid_wallet');
  if (!pending.has(wallet)) pending.set(wallet, inspectPolicy(wallet).finally(() => pending.delete(wallet)));
  return pending.get(wallet);
}
export function policyError(policy) {
  if (!['block', 'review'].includes(policy?.action)) return null;
  const error = new Error(policy.reason || 'Wallet analysis restricted.');
  error.code = policy.action === 'block' ? 'wallet_blocked' : 'wallet_review_required'; error.statusCode = 403;
  return error;
}
export async function assertWalletAllowed(wallet) { const policy = await preflightWallet(wallet); const error = policyError(policy); if (error) throw error; return policy; }
export async function excludedWallets() {
  const rows = await db('wallet_analysis_policies?select=wallet_address&action=in.(block,exclude,review)&limit=10000');
  if (rows.length === 10000) throw new Error('wallet_policy_list_limit');
  return new Set(rows.map(r => r.wallet_address));
}
export function publicAnalysisPolicy(policy) { return { action: policy?.action || 'allow', category: policy?.category || 'Unknown', name: policy?.name || null, transactionLimit: policy?.transaction_limit || 5000, creditPlan: CREDIT_PLAN }; }

export async function claimWalletSyncLease(wallet) { return await db("rpc/try_wallet_sync_lease", {method:"POST",body:JSON.stringify({p_wallet:wallet})}) === true; }
