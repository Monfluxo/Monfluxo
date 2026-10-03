export const CREDIT_PLAN = Object.freeze({ initialTransactions: 5000, initialCredits: 3, additionalTransactions: 2000, additionalCredits: 1, proMonthlyCredits: 50, billingEnabled: process.env.MONFLUXO_CREDITS_ENABLED === "true" });
export function analysisCredits(transactions, { incremental = false } = {}) {
  if (!Number.isSafeInteger(transactions) || transactions < 0) throw new Error('invalid_transaction_count');
  if (!transactions) return 0;
  return incremental ? Math.ceil(transactions / 2000) : 3 + Math.ceil(Math.max(0, transactions - 5000) / 2000);
}
export function indexedWork(state) {
  // Legacy page counters are a conservative work estimate, never a billable count.
  return state?.transactions_scanned == null ? Math.max(0, Number(state?.pages_scanned || 0) * 100) : Math.max(0, Number(state.transactions_scanned) || 0);
}
export function transactionAllowance(state, policy) {
  const limit = policy?.transaction_limit || 5000;
  return state?.history_complete === true ? Math.min(limit, 5000) : Math.max(0, limit - indexedWork(state));
}
export function classifyIdentity(identity) {
  const category = String(identity?.category || '').toLowerCase();
  if (identity?.type === 'exchange' || ['centralized exchange', 'validator', 'cross-chain bridge', 'stake pool'].includes(category) || identity?.type === 'program') return 'block';
  if (['market maker', 'trading firm'].includes(category)) return 'exclude';
  return 'allow';
}
export function highActivitySample(rows) {
  if (!Array.isArray(rows) || rows.length < 1000) return false;
  const times = rows.map(r => r?.blockTime).filter(t => Number.isFinite(t) && t > 0);
  return times.length === rows.length && Math.max(...times) - Math.min(...times) < 86400;
}
