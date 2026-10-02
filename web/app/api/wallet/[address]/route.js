const BACKEND_BASE = process.env.MONFLUXO_BACKEND_URL || "http://127.0.0.1:3000";
const FINAL_CACHE_MS = Number(process.env.WALLET_WEB_CACHE_MS || 30_000);
const finalWalletCache = new Map();

function cachedResponse(address) {
  const cached = finalWalletCache.get(address);
  if (!cached) return null;
  if (Date.now() - cached.createdAt > FINAL_CACHE_MS) {
    finalWalletCache.delete(address);
    return null;
  }
  return new Response(cached.text, {
    status: 200,
    headers: {
      "Content-Type": cached.contentType,
      "Cache-Control": "private, max-age=0",
      "X-Monfluxo-Cache": "HIT"
    }
  });
}

export async function GET(_request, { params }) {
  const { address } = await params;
  const hit = cachedResponse(address);
  if (hit) return hit;

  try {
    const response = await fetch(`${BACKEND_BASE}/api/wallet/${encodeURIComponent(address)}`, {
      cache: "no-store"
    });

    const text = await response.text();
    const contentType = response.headers.get("content-type") || "application/json; charset=utf-8";

    if (response.ok) {
      try {
        const payload = JSON.parse(text);
        const complete = payload?.coverage?.historyComplete === true || payload?.indexing?.refreshRecommended === false;
        if (complete) finalWalletCache.set(address, { createdAt: Date.now(), text, contentType });
      } catch {
        // Keep proxy behavior unchanged if an upstream success is not JSON.
      }
    }

    return new Response(text, {
      status: response.status,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
        "X-Monfluxo-Cache": "MISS"
      }
    });
  } catch (error) {
    console.error("Wallet proxy failed:", error);
    return Response.json(
      {
        error: "backend_unreachable",
        message: "MONFLUXO backend is not reachable from the frontend server."
      },
      { status: 502 }
    );
  }
}
