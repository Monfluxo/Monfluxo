export function exactTransactionBase(state) {
  if (state?.transactions_scanned != null) return Number(state.transactions_scanned);
  return Number(state?.pages_scanned || 0) === 0 ? 0 : null;
}
export function acceptedHistoryPage(transactions, previousSignature, incremental) {
  const accepted=[],seen=new Set();let stoppedOnExisting=false;
  for (const tx of transactions) {
    const signature=tx?.transaction?.signatures?.[0] || tx?.signature;
    if (!signature) throw new Error('history_transaction_missing_signature');
    if (incremental && signature === previousSignature) { stoppedOnExisting=true;break; }
    if (!seen.has(signature)) {seen.add(signature);accepted.push(tx);}
  }
  return {transactions:accepted,stoppedOnExisting};
}
