import { recordUsage, getRecentUsageCount } from "./db.js";

const FREE_DAILY_ANALYSES = Number(process.env.FREE_DAILY_ANALYSES || 5);
const PRO_DAILY_ANALYSES = Number(process.env.PRO_DAILY_ANALYSES || 100);
const MAX_QUICK_PAGES = Number(process.env.MAX_QUICK_PAGES || 5);
const MAX_DEEP_PAGES = Number(process.env.MAX_DEEP_PAGES || 500);

export function getSyncLimits(mode) {
  return {
    maxPages: mode === "deep" ? MAX_DEEP_PAGES : MAX_QUICK_PAGES
  };
}

export async function assertAnalysisAllowed({ userId, wallet, plan = "free", mode = "quick" }) {
  const dailyLimit = plan === "free" ? FREE_DAILY_ANALYSES : PRO_DAILY_ANALYSES;
  if (!userId) {
    throw new Error("userId is required for product-level rate limiting");
  }

  const count = await getRecentUsageCount(userId, "wallet_analysis");
  if (count >= dailyLimit) {
    throw new Error(`Daily wallet analysis limit reached for ${plan} plan`);
  }

  await recordUsage({
    user_id: userId,
    wallet_address: wallet,
    action: "wallet_analysis"
  });

  return { allowed: true, dailyLimit, used: count + 1 };
}
