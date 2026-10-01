import { parseTransaction as parseBaseTransaction } from "./parser.js";
import { parseCreatorFeeClaims } from "./rewardParser.js";

// Compatibility wrapper while Event Model v2 is being validated. The base
// parser remains the source for swaps/transfers; creator-fee claims are
// replaced with the balance-backed implementation so zero-valued inner
// instruction parsing cannot silently erase real rewards.
export function parseTransaction(transaction, wallet) {
  const parsed = parseBaseTransaction(transaction, wallet);
  const rewards = parseCreatorFeeClaims(transaction, wallet);

  if (!rewards.length) return parsed;

  return {
    ...parsed,
    type: "CREATOR_FEE_CLAIM",
    reason: "Pump creator fee claim",
    trade: null,
    trades: [],
    rewards
  };
}
