function normalizeMediaUri(uri) {
  if (typeof uri !== "string" || !uri.trim()) return null;
  const value = uri.trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (/^ipfs:\/\//i.test(value)) return `https://ipfs.io/ipfs/${value.replace(/^ipfs:\/\//i, "").replace(/^ipfs\//i, "")}`;
  if (/^ar:\/\//i.test(value)) return `https://arweave.net/${value.replace(/^ar:\/\//i, "")}`;
  return null;
}

const cache = new Map();
const CACHE_MS = Number(process.env.JUPITER_METADATA_CACHE_MS || 30 * 60 * 1000);
let nextKeylessRequestAt = 0;

async function waitForKeylessSlot() {
  if (process.env.JUPITER_API_KEY) return;
  const wait = Math.max(0, nextKeylessRequestAt - Date.now());
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  nextKeylessRequestAt = Date.now() + 2100;
}

export async function getJupiterTokenMetadata(mint) {
  if (!mint) return null;
  const hit = cache.get(mint);
  if (hit && Date.now() - hit.createdAt < CACHE_MS) return hit.value;

  await waitForKeylessSlot();
  try {
    const headers = { Accept: "application/json", "User-Agent": "MONFLUXO/1.0" };
    if (process.env.JUPITER_API_KEY) headers["x-api-key"] = process.env.JUPITER_API_KEY;
    const response = await fetch(`https://api.jup.ag/tokens/v2/search?query=${encodeURIComponent(mint)}`, {
      headers,
      signal: AbortSignal.timeout(6000)
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.tokens) ? payload.tokens : [];
    const token = rows.find((row) => row?.id === mint || row?.address === mint || row?.mint === mint) || null;
    if (!token) return null;
    const value = {
      name: typeof token.name === "string" ? token.name.trim() : null,
      symbol: typeof token.symbol === "string" ? token.symbol.trim() : null,
      image: normalizeMediaUri(token.icon || token.logoURI || token.logoUri || token.image || null),
      source: "jupiter"
    };
    cache.set(mint, { createdAt: Date.now(), value });
    return value;
  } catch {
    return null;
  }
}
