import { getPumpTokenMetadata } from "./pumpMetadata.js";
import { getJupiterTokenMetadata } from "./jupiterMetadata.js";

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;

if (!HELIUS_API_KEY) throw new Error("HELIUS_API_KEY is not configured");

const HELIUS_RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const MAX_RETRIES = Number(process.env.HELIUS_MAX_RETRIES || 5);
const FULL_PAGE_LIMIT = Math.min(Math.max(Number(process.env.HELIUS_FULL_PAGE_LIMIT || 100), 1), 100);
const TOKEN_METADATA_CACHE_MS = Number(process.env.TOKEN_METADATA_CACHE_MS || 10 * 60 * 1000);
const tokenMetadataCache = new Map();

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function heliusRequest(method, params, id) {
  let attempt = 0;
  while (true) {
    const response = await fetch(HELIUS_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params })
    });
    if (response.ok) {
      const data = await response.json();
      if (data.error) throw new Error(data.error.message || "Helius API error");
      return data.result;
    }
    const retryable = response.status === 429 || response.status === 503;
    if (!retryable || attempt >= MAX_RETRIES) throw new Error(`Helius request failed: ${response.status}`);
    const retryAfter = Number(response.headers.get("retry-after") || 0);
    const exponential = Math.min(30000, 1000 * 2 ** attempt);
    const jitter = Math.floor(Math.random() * 250);
    const delay = retryAfter > 0 ? retryAfter * 1000 : exponential + jitter;
    console.warn(`Helius rate/service limit (${response.status}). Retrying in ${delay}ms.`);
    await sleep(delay);
    attempt++;
  }
}

export async function getTransactionsForAddress(address, paginationToken = null, requestOptions = {}) {
  const tokenAccounts = requestOptions.tokenAccounts ?? process.env.HELIUS_TOKEN_ACCOUNTS_FILTER ?? "balanceChanged";
  const filters = { ...(requestOptions.filters || {}) };
  if (requestOptions.succeededOnly !== false) filters.status = "succeeded";
  if (tokenAccounts && tokenAccounts !== "none") filters.tokenAccounts = tokenAccounts;
  const options = {
    transactionDetails: "full",
    limit: Math.min(Math.max(Number(requestOptions.limit || FULL_PAGE_LIMIT), 1), 100),
    sortOrder: requestOptions.sortOrder || "desc",
    ...(Object.keys(filters).length ? { filters } : {})
  };
  if (paginationToken) options.paginationToken = paginationToken;
  return heliusRequest("getTransactionsForAddress", [address, options], "monfluxo-history");
}

export async function getTransfersByAddress(address, paginationToken = null, requestOptions = {}) {
  const options = {
    limit: Math.min(Math.max(Number(requestOptions.limit || 100), 1), 100),
    ...(requestOptions.direction ? { direction: requestOptions.direction } : {}),
    ...(requestOptions.mint ? { mint: requestOptions.mint } : {}),
    ...(requestOptions.with ? { with: requestOptions.with } : {}),
    ...(requestOptions.filters ? { filters: requestOptions.filters } : {})
  };
  if (paginationToken) options.paginationToken = paginationToken;
  return heliusRequest("getTransfersByAddress", [address, options], "monfluxo-transfers");
}

export async function getTransaction(signature) {
  return heliusRequest("getTransaction", [signature, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 }], "monfluxo-debug-transaction");
}

function normalizeMediaUri(uri) {
  if (typeof uri !== "string" || !uri.trim()) return null;
  const value = uri.trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (/^ipfs:\/\//i.test(value)) return `https://ipfs.io/ipfs/${value.replace(/^ipfs:\/\//i, "").replace(/^ipfs\//i, "")}`;
  if (/^ar:\/\//i.test(value)) return `https://arweave.net/${value.replace(/^ar:\/\//i, "")}`;
  return null;
}

async function fetchJsonMetadata(uri) {
  const resolved = normalizeMediaUri(uri);
  if (!resolved) return null;
  try {
    const response = await fetch(resolved, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    return await response.json();
  } catch { return null; }
}

function fileImageCandidate(file) {
  if (!file || typeof file !== "object") return null;
  return normalizeMediaUri(file.cdn_uri || file.cdnUri || file.uri || file.url || file.src);
}

function firstImageCandidate(asset, remote) {
  const assetFiles = Array.isArray(asset?.content?.files) ? asset.content.files : [];
  const remoteFiles = Array.isArray(remote?.properties?.files) ? remote.properties.files : Array.isArray(remote?.files) ? remote.files : [];
  const preferredAssetFile = assetFiles.find((file) => String(file?.mime || file?.type || "").startsWith("image/"));
  const preferredRemoteFile = remoteFiles.find((file) => String(file?.mime || file?.type || "").startsWith("image/"));
  const candidates = [
    asset?.content?.links?.image,
    asset?.content?.metadata?.image,
    fileImageCandidate(preferredAssetFile),
    fileImageCandidate(assetFiles[0]),
    remote?.image,
    remote?.image_url,
    remote?.imageUrl,
    remote?.properties?.image,
    fileImageCandidate(preferredRemoteFile),
    fileImageCandidate(remoteFiles[0])
  ];
  for (const candidate of candidates) {
    const normalized = normalizeMediaUri(candidate) || (typeof candidate === "string" && /^https?:\/\//i.test(candidate) ? candidate : null);
    if (normalized) return normalized;
  }
  return null;
}

function selectDexPair(pairs, mint) {
  return [...pairs]
    .filter((pair) => pair?.baseToken?.address === mint || pair?.quoteToken?.address === mint)
    .sort((a, b) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0))[0] || null;
}

function dexMetadataFromPair(pair, mint) {
  if (!pair) return null;
  const token = pair?.baseToken?.address === mint ? pair.baseToken : pair?.quoteToken?.address === mint ? pair.quoteToken : null;
  if (!token) return null;
  return {
    name: typeof token.name === "string" ? token.name.trim() : null,
    symbol: typeof token.symbol === "string" ? token.symbol.trim() : null,
    image: normalizeMediaUri(pair?.info?.imageUrl || pair?.info?.image || pair?.info?.header)
  };
}

async function fetchDexJson(url) {
  try {
    const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "MONFLUXO/1.0" }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    return await response.json();
  } catch { return null; }
}

async function getDexScreenerMetadata(mint) {
  const encoded = encodeURIComponent(mint);
  const tokenPayload = await fetchDexJson(`https://api.dexscreener.com/latest/dex/tokens/${encoded}`);
  const tokenRows = Array.isArray(tokenPayload?.pairs)
    ? tokenPayload.pairs.filter((pair) => !pair?.chainId || pair.chainId === "solana")
    : [];
  let result = dexMetadataFromPair(selectDexPair(tokenRows, mint), mint);
  if (result?.image) return result;

  const pairPayload = await fetchDexJson(`https://api.dexscreener.com/token-pairs/v1/solana/${encoded}`);
  const pairRows = Array.isArray(pairPayload) ? pairPayload : Array.isArray(pairPayload?.pairs) ? pairPayload.pairs : [];
  const pairResult = dexMetadataFromPair(selectDexPair(pairRows, mint), mint);
  result = result || pairResult;
  if (pairResult?.image) return pairResult;

  const searchPayload = await fetchDexJson(`https://api.dexscreener.com/latest/dex/search?q=${encoded}`);
  const searchRows = Array.isArray(searchPayload?.pairs) ? searchPayload.pairs.filter((pair) => pair?.chainId === "solana") : [];
  const searched = dexMetadataFromPair(selectDexPair(searchRows, mint), mint);
  if (searched?.image) return searched;
  return result || searched || null;
}

export async function getTokenMetadata(mint) {
  const cached = tokenMetadataCache.get(mint);
  if (cached && Date.now() - cached.createdAt < TOKEN_METADATA_CACHE_MS) return cached.value;

  let asset = null;
  try {
    asset = await heliusRequest("getAsset", { id: mint, displayOptions: { showFungible: true } }, "monfluxo-token-metadata");
  } catch (error) {
    console.warn(`Helius metadata unavailable for ${mint}: ${error.message}. Falling back to public token metadata sources.`);
  }

  let name = asset?.content?.metadata?.name?.trim() || asset?.token_info?.name?.trim() || null;
  let symbol = asset?.content?.metadata?.symbol?.trim() || asset?.token_info?.symbol?.trim() || null;
  const jsonUri = asset?.content?.json_uri || asset?.content?.links?.json || asset?.content?.metadata?.uri || null;
  const rawPriceUsd = Number(asset?.token_info?.price_info?.price_per_token);
  let image = firstImageCandidate(asset, null);
  let imageSource = image ? "helius" : null;

  let remote = null;
  if (jsonUri && (!name || !symbol || !image)) remote = await fetchJsonMetadata(jsonUri);
  name = name || (typeof remote?.name === "string" ? remote.name.trim() : null);
  symbol = symbol || (typeof remote?.symbol === "string" ? remote.symbol.trim() : null);
  if (!image) {
    image = firstImageCandidate(asset, remote);
    if (image) imageSource = "offchain_metadata";
  }

  if (!image || !name || !symbol) {
    const pump = await getPumpTokenMetadata(mint);
    name = name || pump?.name || null;
    symbol = symbol || pump?.symbol || null;
    if (!image && pump?.image) {
      image = pump.image;
      imageSource = "pump";
    }
  }

  if (!image || !name || !symbol) {
    const dex = await getDexScreenerMetadata(mint);
    name = name || dex?.name || null;
    symbol = symbol || dex?.symbol || null;
    if (!image && dex?.image) {
      image = dex.image;
      imageSource = "dexscreener";
    }
  }

  if (!image || !name || !symbol) {
    const jupiter = await getJupiterTokenMetadata(mint);
    name = name || jupiter?.name || null;
    symbol = symbol || jupiter?.symbol || null;
    if (!image && jupiter?.image) {
      image = jupiter.image;
      imageSource = "jupiter";
    }
  }

  const value = { mint, name, symbol, image, imageSource, priceUsd: Number.isFinite(rawPriceUsd) && rawPriceUsd > 0 ? rawPriceUsd : null };
  tokenMetadataCache.set(mint, { createdAt: Date.now(), value });
  return value;
}
