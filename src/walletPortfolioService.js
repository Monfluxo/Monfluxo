const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const CACHE_MS = Number(process.env.PORTFOLIO_CACHE_MS || 30_000);
const cache = new Map();

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function rpc(method, params, id) {
  if (!HELIUS_API_KEY) throw new Error("HELIUS_API_KEY is not configured");
  let attempt = 0;
  while (true) {
    const response = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: AbortSignal.timeout(8000)
    });
    if (response.ok) {
      const payload = await response.json();
      if (payload.error) throw new Error(payload.error.message || "Helius portfolio RPC error");
      return payload.result;
    }
    if ((response.status !== 429 && response.status !== 503) || attempt >= 3) {
      throw new Error(`Helius portfolio request failed: ${response.status}`);
    }
    await sleep(500 * (2 ** attempt) + Math.floor(Math.random() * 150));
    attempt++;
  }
}

function imageFromAsset(asset) {
  const files = Array.isArray(asset?.content?.files) ? asset.content.files : [];
  return asset?.content?.links?.image || asset?.content?.metadata?.image || files.find((f) => String(f?.mime || "").startsWith("image/"))?.cdn_uri || files[0]?.cdn_uri || files[0]?.uri || null;
}

function normalizeHolding(asset) {
  if (!["FungibleToken", "FungibleAsset"].includes(asset?.interface)) return null;
  const rawBalance = Number(asset?.token_info?.balance || 0);
  const decimals = Number(asset?.token_info?.decimals || 0);
  const amount = rawBalance / (10 ** decimals);
  if (!(amount > 0)) return null;
  const priceUsd = Number(asset?.token_info?.price_info?.price_per_token);
  const explicitTotal = Number(asset?.token_info?.price_info?.total_price);
  const valueUsd = Number.isFinite(explicitTotal) && explicitTotal >= 0
    ? explicitTotal
    : Number.isFinite(priceUsd) && priceUsd > 0
      ? amount * priceUsd
      : null;
  return {
    tokenMint: asset.id,
    tokenName: asset?.content?.metadata?.name || null,
    tokenSymbol: asset?.content?.metadata?.symbol || null,
    tokenImage: imageFromAsset(asset) ? `/api/token-image/${encodeURIComponent(asset.id)}` : null,
    amount,
    priceUsd: Number.isFinite(priceUsd) && priceUsd > 0 ? priceUsd : null,
    valueUsd: Number.isFinite(valueUsd) ? valueUsd : null
  };
}

export async function getWalletPortfolioSnapshot(address) {
  const hit = cache.get(address);
  if (hit && Date.now() - hit.createdAt < CACHE_MS) return hit.value;

  const assetsResult = await rpc("getAssetsByOwner", {
    ownerAddress: address,
    page: 1,
    limit: 1000,
    displayOptions: { showFungible: true, showNativeBalance: true, showZeroBalance: false }
  }, "monfluxo-wallet-assets");

  const native = assetsResult?.nativeBalance || {};
  const solBalance = Number(native.lamports || 0) / 1e9;
  const solPriceUsd = Number(native.price_per_sol ?? native.pricePerSol);
  const explicitSolValue = Number(native.total_price ?? native.totalPrice);
  const solValueUsd = Number.isFinite(explicitSolValue) && explicitSolValue >= 0
    ? explicitSolValue
    : Number.isFinite(solPriceUsd) && solPriceUsd > 0
      ? solBalance * solPriceUsd
      : null;
  const holdings = (assetsResult?.items || []).map(normalizeHolding).filter(Boolean);
  const pricedHoldings = holdings.filter((item) => Number.isFinite(item.valueUsd));
  const tokenValueUsd = pricedHoldings.reduce((sum, item) => sum + item.valueUsd, 0);
  const walletValueUsd = (Number.isFinite(solValueUsd) ? solValueUsd : 0) + tokenValueUsd;
  const result = {
    status: "ready",
    generatedAt: new Date().toISOString(),
    solBalance,
    solPriceUsd: Number.isFinite(solPriceUsd) && solPriceUsd > 0 ? solPriceUsd : null,
    solValueUsd,
    tokenValueUsd,
    walletValueUsd,
    tokenCount: holdings.length,
    pricedTokenCount: pricedHoldings.length,
    unpricedTokenCount: holdings.length - pricedHoldings.length,
    assetsTruncated: Number(assetsResult?.total || 0) > (assetsResult?.items || []).length,
    holdings,
    topHoldings: [...pricedHoldings].sort((a, b) => b.valueUsd - a.valueUsd).slice(0, 6)
  };
  cache.set(address, { createdAt: Date.now(), value: result });
  return result;
}

export function applyPortfolioPricesToDashboard(dashboard, portfolio) {
  if (!dashboard || portfolio?.status !== "ready") return dashboard;
  const solPriceUsd = Number(portfolio.solPriceUsd);
  const byMint = new Map((portfolio.holdings || []).map((item) => [item.tokenMint, item]));
  const positions = dashboard?.positions?.top || [];
  for (const position of positions) {
    const holding = byMint.get(position.tokenMint);
    const priceUsd = Number(holding?.priceUsd);
    const purchasedTokens = Number(position.purchasedTokensRemaining || 0);
    const remainingCostSol = Number(position.remainingCostSol || 0);
    if (!(priceUsd > 0) || !(solPriceUsd > 0) || !(purchasedTokens > 0)) continue;
    const currentValueUsd = purchasedTokens * priceUsd;
    const currentValueSol = currentValueUsd / solPriceUsd;
    const unrealizedPnlSol = currentValueSol - remainingCostSol;
    position.currentPriceUsd = priceUsd;
    position.currentPositionValueUsd = currentValueUsd;
    position.currentPositionValueSol = currentValueSol;
    position.unrealizedPnlSolCurrent = unrealizedPnlSol;
    position.unrealizedRoiPctCurrent = remainingCostSol > 0 ? (unrealizedPnlSol / remainingCostSol) * 100 : null;
  }
  const unrealizedPnlSol = positions.reduce((sum, position) => {
    const value = Number(position.unrealizedPnlSolCurrent);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
  dashboard.portfolio = {
    status: "ready",
    generatedAt: portfolio.generatedAt,
    solBalance: portfolio.solBalance,
    solPriceUsd: portfolio.solPriceUsd,
    solValueUsd: portfolio.solValueUsd,
    tokenValueUsd: portfolio.tokenValueUsd,
    walletValueUsd: portfolio.walletValueUsd,
    tokenCount: portfolio.tokenCount,
    pricedTokenCount: portfolio.pricedTokenCount,
    unpricedTokenCount: portfolio.unpricedTokenCount,
    assetsTruncated: portfolio.assetsTruncated,
    topHoldings: portfolio.topHoldings,
    openPositionsUnrealizedPnlSol: unrealizedPnlSol,
    openPositionsUnrealizedPnlUsd: Number(portfolio.solPriceUsd) > 0 ? unrealizedPnlSol * Number(portfolio.solPriceUsd) : null
  };
  return dashboard;
}
