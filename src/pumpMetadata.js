function normalizeMediaUri(uri) {
  if (typeof uri !== "string" || !uri.trim()) return null;
  const value = uri.trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (/^ipfs:\/\//i.test(value)) return `https://ipfs.io/ipfs/${value.replace(/^ipfs:\/\//i, "").replace(/^ipfs\//i, "")}`;
  if (/^ar:\/\//i.test(value)) return `https://arweave.net/${value.replace(/^ar:\/\//i, "")}`;
  return null;
}

async function resolveMetadataImage(metadataUri) {
  const uri = normalizeMediaUri(metadataUri);
  if (!uri) return null;
  try {
    const response = await fetch(uri, {
      redirect: "follow",
      headers: { Accept: "application/json,text/plain,*/*", "User-Agent": "Mozilla/5.0 MONFLUXO/1.0" },
      signal: AbortSignal.timeout(6000)
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return normalizeMediaUri(payload?.image || payload?.image_uri || payload?.imageUri || payload?.properties?.files?.[0]?.uri || null);
  } catch {
    return null;
  }
}

export async function getPumpTokenMetadata(mint) {
  if (!mint) return null;
  try {
    const response = await fetch(`https://frontend-api-v3.pump.fun/coins-v2/${encodeURIComponent(mint)}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 MONFLUXO/1.0"
      },
      signal: AbortSignal.timeout(6000)
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const coin = Array.isArray(payload) ? payload[0] : payload?.coin || payload?.data || payload;
    if (!coin || typeof coin !== "object") return null;
    const metadataUri = normalizeMediaUri(coin.metadata_uri || coin.metadataUri || coin.uri || null);
    const directImage = normalizeMediaUri(coin.image_uri || coin.imageUri || coin.image || null);
    const image = directImage || await resolveMetadataImage(metadataUri);
    return {
      name: typeof coin.name === "string" ? coin.name.trim() : null,
      symbol: typeof coin.symbol === "string" ? coin.symbol.trim() : null,
      image,
      creator: coin.creator || null,
      metadataUri
    };
  } catch {
    return null;
  }
}
