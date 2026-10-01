const SWAP_API = "https://swap-api.pump.fun";
const FRONTEND_API = "https://frontend-api-v3.pump.fun";
const CACHE_MS = Number(process.env.CREATOR_REVENUE_CACHE_MS || 300_000);
const MAX_SHARE_PAGES = Number(process.env.CREATOR_REVENUE_MAX_SHARE_PAGES || 20);
const MAX_TIMELINE_PAGES = Number(process.env.CREATOR_REVENUE_MAX_TIMELINE_PAGES || 30);
const CONCURRENCY = Math.max(1, Number(process.env.CREATOR_REVENUE_CONCURRENCY || 6));
const TOP_COINS = 6;
const cache = new Map();

const HEADERS = {
  Accept: "application/json",
  "User-Agent": "MONFLUXO/1.0",
  Origin: "https://pump.fun",
  Referer: "https://pump.fun/"
};

async function getJson(url, { allow404 = false } = {}) {
  const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
  if (allow404 && response.status === 404) return null;
  if (!response.ok) throw new Error(`Pump API ${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function mapLimit(items, limit, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return output;
}

async function fetchAllShares(wallet) {
  const items = [];
  let cursor = null;
  for (let page = 0; page < MAX_SHARE_PAGES; page++) {
    const url = new URL(`${SWAP_API}/v1/fee-sharing/account/${encodeURIComponent(wallet)}/shares`);
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const payload = await getJson(url.toString());
    items.push(...(payload?.items || []));
    if (!payload?.pagination?.hasMore) return { items, truncated: false };
    cursor = payload.pagination.nextCursor;
  }
  return { items, truncated: true };
}

async function fetchCoinMetadata(mint) {
  const payload = await getJson(`${FRONTEND_API}/coins-v2/${encodeURIComponent(mint)}`, { allow404: true });
  const coin = Array.isArray(payload) ? payload[0] : payload?.coin || payload?.data || payload;
  if (!coin || typeof coin !== "object") return null;
  return {
    mint,
    name: coin.name || null,
    symbol: coin.symbol || null,
    image: coin.image_uri || coin.imageUri || coin.image || null,
    marketCapUsd: Number.isFinite(Number(coin.usd_market_cap)) ? Number(coin.usd_market_cap) : null,
    createdTimestamp: coin.created_timestamp ?? null
  };
}

async function fetchCoinEarnings(mint, wallet) {
  let cursor = null;
  let amount = 0n;
  let distributions = 0;
  let firstEarnedAt = null;
  let lastEarnedAt = null;
  const thirtyDaysAgo = Date.now() - 30 * 86400000;
  let last30 = 0n;

  for (let page = 0; page < MAX_TIMELINE_PAGES; page++) {
    const url = new URL(`${SWAP_API}/v1/coins/${encodeURIComponent(mint)}/timeline`);
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const payload = await getJson(url.toString(), { allow404: true });
    if (!payload) break;

    for (const event of payload.items || []) {
      if (event?.eventType !== "distribution") continue;
      for (const recipient of event?.recipients || []) {
        if (recipient?.address !== wallet) continue;
        const paid = BigInt(recipient?.amount || "0");
        if (paid <= 0n) continue;
        amount += paid;
        distributions += 1;
        const stamp = event.timestamp || null;
        if (stamp) {
          const ms = new Date(stamp).getTime();
          if (Number.isFinite(ms) && ms >= thirtyDaysAgo) last30 += paid;
          if (!firstEarnedAt || stamp < firstEarnedAt) firstEarnedAt = stamp;
          if (!lastEarnedAt || stamp > lastEarnedAt) lastEarnedAt = stamp;
        }
      }
    }

    if (!payload?.pagination?.hasMore) break;
    cursor = payload.pagination.nextCursor;
  }

  return { mint, amount, last30, distributions, firstEarnedAt, lastEarnedAt };
}

function deriveSolPriceUsd(totals) {
  for (const key of ["shareholderTotalEarned", "shareholderClaimed", "shareholderUnclaimed"]) {
    const sol = Number(totals?.[key]?.sol);
    const usd = Number(totals?.[key]?.usd);
    if (sol > 0 && usd > 0) return usd / sol;
  }
  return null;
}

function money(baseUnits, solPriceUsd) {
  const sol = Number(baseUnits) / 1e9;
  return { sol, usd: solPriceUsd == null ? null : sol * solPriceUsd };
}

export async function buildCreatorRevenueIntelligence(wallet) {
  const hit = cache.get(wallet);
  if (hit && Date.now() - hit.createdAt < CACHE_MS) return hit.value;

  try {
    const [totals, shares] = await Promise.all([
      getJson(`${SWAP_API}/v1/fee-sharing/account/${encodeURIComponent(wallet)}/totals`),
      fetchAllShares(wallet)
    ]);
    const solPriceUsd = deriveSolPriceUsd(totals);
    const entries = shares.items || [];
    if (!entries.length) {
      const value = {
        status: "none",
        methodology: "pump_fee_distribution_timeline_v1",
        source: "pump_fun_public_api",
        totalCoins: 0,
        earningCoins: 0,
        topCoins: [],
        totals: { claimed: totals?.shareholderClaimed || null, unclaimed: totals?.shareholderUnclaimed || null, totalEarned: totals?.shareholderTotalEarned || null }
      };
      cache.set(wallet, { createdAt: Date.now(), value });
      return value;
    }

    const [earnings, metadata] = await Promise.all([
      mapLimit(entries, CONCURRENCY, (entry) => fetchCoinEarnings(entry.mint, wallet).catch(() => ({ mint: entry.mint, amount: 0n, last30: 0n, distributions: 0, firstEarnedAt: null, lastEarnedAt: null }))),
      mapLimit(entries, CONCURRENCY, (entry) => fetchCoinMetadata(entry.mint).catch(() => null))
    ]);

    const distributed = earnings.reduce((sum, row) => sum + row.amount, 0n);
    const rows = entries.map((entry, index) => {
      const earned = earnings[index];
      const meta = metadata[index];
      return {
        tokenMint: entry.mint,
        tokenName: meta?.name || null,
        tokenSymbol: meta?.symbol || null,
        tokenImage: meta?.image ? `/api/token-image/${encodeURIComponent(entry.mint)}` : null,
        sharePct: Number.isFinite(Number(entry.bps)) ? Number(entry.bps) / 100 : null,
        earned: money(earned.amount, solPriceUsd),
        earnedLast30d: money(earned.last30, solPriceUsd),
        shareOfCreatorRevenuePct: distributed > 0n ? (Number(earned.amount) / Number(distributed)) * 100 : 0,
        distributions: earned.distributions,
        firstEarnedAt: earned.firstEarnedAt,
        lastEarnedAt: earned.lastEarnedAt,
        marketCapUsd: meta?.marketCapUsd ?? null
      };
    }).sort((a, b) => Number(b.earned?.sol || 0) - Number(a.earned?.sol || 0));

    const earners = rows.filter((row) => Number(row.earned?.sol || 0) > 0);
    const last30Sol = rows.reduce((sum, row) => sum + Number(row.earnedLast30d?.sol || 0), 0);
    const value = {
      status: "ready",
      methodology: "pump_fee_distribution_timeline_v1",
      source: "pump_fun_public_api",
      attribution: "distributed_per_coin",
      note: "Per-token revenue is reconstructed from Pump fee-distribution timelines. Wallet-level unclaimed fees cannot be attributed to an individual token until distributed.",
      totalCoins: rows.length,
      earningCoins: earners.length,
      silentCoins: rows.length - earners.length,
      coinsTruncated: shares.truncated,
      solPriceUsd,
      distributed: money(distributed, solPriceUsd),
      last30d: { sol: last30Sol, usd: solPriceUsd == null ? null : last30Sol * solPriceUsd },
      totals: {
        claimed: totals?.shareholderClaimed || null,
        unclaimed: totals?.shareholderUnclaimed || null,
        totalEarned: totals?.shareholderTotalEarned || null
      },
      topCoins: rows.slice(0, TOP_COINS),
      topCoinSharePct: rows[0]?.shareOfCreatorRevenuePct || 0
    };
    cache.set(wallet, { createdAt: Date.now(), value });
    return value;
  } catch (error) {
    return {
      status: "unavailable",
      methodology: "pump_fee_distribution_timeline_v1",
      source: "pump_fun_public_api",
      error: error.message,
      totalCoins: 0,
      earningCoins: 0,
      topCoins: []
    };
  }
}
