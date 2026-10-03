// Wallet-local accounting convention: incoming units of the same mint first
// restore outstanding outbound FIFO lots. This does not assert shared ownership.
const EPS = 1e-9;
export function restoreOutboundLots(outbound, amount, costKey) {
  let remaining = amount;
  const lots = [];
  while (remaining > EPS && outbound.length) {
    const lot = outbound[0], take = Math.min(remaining, lot.tokens);
    const cost = lot[costKey] == null ? null : lot[costKey] * take / lot.tokens;
    lots.push({...lot, tokens:take, [costKey]:cost, returned:true});
    if (cost != null) lot[costKey] -= cost;
    lot.tokens -= take; remaining -= take;
    if (lot.tokens <= EPS) outbound.shift();
  }
  return {lots, remaining};
}
