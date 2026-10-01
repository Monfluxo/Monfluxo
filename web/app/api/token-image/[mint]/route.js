const BACKEND_BASE = process.env.MONFLUXO_BACKEND_URL || "http://127.0.0.1:3000";

export async function GET(_request, { params }) {
  const { mint } = await params;

  try {
    const response = await fetch(`${BACKEND_BASE}/api/token-image/${encodeURIComponent(mint)}`, {
      cache: "force-cache"
    });

    if (!response.ok) {
      return new Response(null, { status: response.status });
    }

    const bytes = await response.arrayBuffer();
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": response.headers.get("content-type") || "image/jpeg",
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400"
      }
    });
  } catch (error) {
    console.error("Token image proxy failed:", error);
    return new Response(null, { status: 502 });
  }
}
