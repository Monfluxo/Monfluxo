const BACKEND_BASE = process.env.MONFLUXO_BACKEND_URL || "http://127.0.0.1:3000";

function fallbackSvg(mint) {
  const label = String(mint || "?").slice(0, 2).toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><defs><radialGradient id="g" cx="30%" cy="25%"><stop offset="0" stop-color="#3a342b"/><stop offset="1" stop-color="#0a0a09"/></radialGradient></defs><circle cx="48" cy="48" r="47" fill="url(#g)" stroke="#5f523e" stroke-width="1"/><text x="48" y="56" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" font-weight="700" fill="#d9bd91">${label}</text></svg>`;
}

export async function GET(_request, { params }) {
  const { mint } = await params;
  try {
    const response = await fetch(`${BACKEND_BASE}/api/token-image/${encodeURIComponent(mint)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(20000)
    });
    if (response.ok) {
      const bytes = await response.arrayBuffer();
      const type = response.headers.get("content-type") || "image/jpeg";
      if (type.startsWith("image/")) return new Response(bytes,{status:200,headers:{"Content-Type":type,"Cache-Control":"public, max-age=21600, stale-while-revalidate=172800"}});
    }
  } catch (error) {
    console.warn("Token image proxy fallback:", mint, error?.message || error);
  }
  return new Response(fallbackSvg(mint),{status:200,headers:{"Content-Type":"image/svg+xml; charset=utf-8","Cache-Control":"no-store, max-age=0"}});
}
