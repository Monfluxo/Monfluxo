function normalizeMediaUri(uri) {
  if (typeof uri !== "string" || !uri.trim()) return null;
  const value = uri.trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (/^ipfs:\/\//i.test(value)) return `https://ipfs.io/ipfs/${value.replace(/^ipfs:\/\//i, "").replace(/^ipfs\//i, "")}`;
  if (/^ar:\/\//i.test(value)) return `https://arweave.net/${value.replace(/^ar:\/\//i, "")}`;
  return null;
}

export async function getPumpTokenMetadata(mint) {
  if (!mint) return null;
  try {
    const response = await fetch(`https://frontend-api-v3.pump.fun/coins-v2/${encodeURIComponent(mint)}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "MONFLUXO/1.0"
      },
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const coin = Array.isArray(payload) ? payload[0] : payload?.coin || payload?.data || payload;
    if (!coin || typeof coin !== "object") return null;
    return {
      name: typeof coin.name === "string" ? coin.name.trim() : null,
      symbol: typeof coin.symbol === "string" ? coin.symbol.trim() : null,
      image: normalizeMediaUri(coin.image_uri || coin.imageUri || coin.image || null),
      creator: coin.creator || null,
      metadataUri: normalizeMediaUri(coin.metadata_uri || coin.metadataUri || null)
    };
  } catch {
    return null;
  }
}
