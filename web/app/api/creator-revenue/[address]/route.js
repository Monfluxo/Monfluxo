import {creditHeaders} from "../../../../lib/creditProxy";
const BACKEND_BASE = process.env.MONFLUXO_BACKEND_URL || "http://127.0.0.1:3000";

export async function GET(_request, { params }) {
  const { address } = await params;

  try {
    const response = await fetch(`${BACKEND_BASE}/api/creator-revenue/${encodeURIComponent(address)}`, {
      headers: creditHeaders(_request), cache: "no-store"
    });

    const text = await response.text();
    const contentType = response.headers.get("content-type") || "application/json; charset=utf-8";

    return new Response(text, {
      status: response.status,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    console.error("Creator revenue proxy failed:", error);
    return Response.json(
      {
        error: "backend_unreachable",
        message: "MONFLUXO backend is not reachable from the frontend server."
      },
      { status: 502 }
    );
  }
}

