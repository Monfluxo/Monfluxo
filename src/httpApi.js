import http from "node:http";
import { requestWalletDashboardWithIntelligence, requestCreatorRevenue } from "./walletDashboardIntelligenceService.js";
import { getTokenMetadata } from "./helius.js";
import { getPumpTokenMetadata } from "./pumpMetadata.js";
import { getJupiterTokenMetadata } from "./jupiterMetadata.js";
import { buildIncomingFlowIntelligence } from "./incomingFlowService.js";

const PORT = Number(process.env.PORT || 3000);
const ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ALLOWED_ORIGINS = new Set(
  String(process.env.MONFLUXO_WEB_ORIGIN || "http://localhost:3001")
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean)
);

function resolveCorsOrigin(req) {
  const origin = String(req?.headers?.origin || "").replace(/\/$/, "");
  if (!origin) return [...ALLOWED_ORIGINS][0] || "http://localhost:3001";
  return ALLOWED_ORIGINS.has(origin) ? origin : null;
}

function corsHeaders(req) {
  const origin = resolveCorsOrigin(req);
  return {
    ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}

function securityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY"
  };
}

function sendJson(req, res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...securityHeaders(),
    ...corsHeaders(req)
  });
  res.end(JSON.stringify(body));
}

function walletFromPath(pathname) {
  const match = pathname.match(/^\/api\/wallet\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function creatorRevenueWalletFromPath(pathname) {
  const match = pathname.match(/^\/api\/creator-revenue\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function incomingFlowsWalletFromPath(pathname) {
  const match = pathname.match(/^\/api\/incoming-flows\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function tokenImageMintFromPath(pathname) {
  const match = pathname.match(/^\/api\/token-image\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function resolveArtwork(mint) {
  const pump = await getPumpTokenMetadata(mint).catch(() => null);
  if (pump?.image) return pump.image;
  const jupiter = await getJupiterTokenMetadata(mint).catch(() => null);
  if (jupiter?.image) return jupiter.image;
  const metadata = await getTokenMetadata(mint);
  return metadata?.image || null;
}

async function proxyTokenImage(req, mint, res) {
  if (!ADDRESS_RE.test(mint)) {
    return sendJson(req, res, 400, { error: "invalid_mint", message: "Invalid Solana token mint." });
  }

  try {
    const image = await resolveArtwork(mint);
    if (!image) {
      return sendJson(req, res, 404, { error: "image_not_found", message: "No token artwork was resolved." });
    }

    const response = await fetch(image, {
      redirect: "follow",
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0 MONFLUXO/1.0"
      },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) {
      return sendJson(req, res, 502, { error: "image_fetch_failed", message: `Artwork source returned ${response.status}.` });
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    const bytes = Buffer.from(await response.arrayBuffer());
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": bytes.length,
      "Cache-Control": "public, max-age=21600, stale-while-revalidate=86400",
      ...securityHeaders(),
      ...corsHeaders(req)
    });
    return res.end(bytes);
  } catch (error) {
    console.warn(`Token image proxy failed for ${mint}: ${error.message}`);
    return sendJson(req, res, 502, { error: "image_proxy_failed", message: "Unable to load token artwork." });
  }
}

export async function handleRequest(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, { ...securityHeaders(), ...corsHeaders(req) });
    return res.end();
  }

  if (req.method === "GET" && url.pathname === "/health") {
    return sendJson(req, res, 200, { ok: true, service: "monfluxo-api" });
  }

  const imageMint = tokenImageMintFromPath(url.pathname);
  if (req.method === "GET" && imageMint) return proxyTokenImage(req, imageMint, res);

  const incomingWallet = incomingFlowsWalletFromPath(url.pathname);
  if (req.method === "GET" && incomingWallet) {
    if (!ADDRESS_RE.test(incomingWallet)) {
      return sendJson(req, res, 400, { error: "invalid_wallet", message: "Invalid Solana wallet address." });
    }
    try {
      return sendJson(req, res, 200, await buildIncomingFlowIntelligence(incomingWallet));
    } catch (error) {
      console.error("Incoming flows request failed:", error);
      return sendJson(req, res, 500, { error: "incoming_flows_failed", message: "Unable to load incoming flows right now." });
    }
  }

  const creatorRevenueWallet = creatorRevenueWalletFromPath(url.pathname);
  if (req.method === "GET" && creatorRevenueWallet) {
    if (!ADDRESS_RE.test(creatorRevenueWallet)) {
      return sendJson(req, res, 400, { error: "invalid_wallet", message: "Invalid Solana wallet address." });
    }
    try {
      const payload = await requestCreatorRevenue(creatorRevenueWallet);
      return sendJson(req, res, 200, payload);
    } catch (error) {
      console.error("Creator revenue request failed:", error);
      return sendJson(req, res, 500, { error: "creator_revenue_failed", message: "Unable to load creator revenue right now." });
    }
  }

  const wallet = walletFromPath(url.pathname);
  if (req.method === "GET" && wallet) {
    if (!ADDRESS_RE.test(wallet)) {
      return sendJson(req, res, 400, {
        error: "invalid_wallet",
        message: "Invalid Solana wallet address."
      });
    }

    try {
      const priority = Number(url.searchParams.get("priority") || 1000);
      const payload = await requestWalletDashboardWithIntelligence(wallet, { priority });
      return sendJson(req, res, 200, payload);
    } catch (error) {
      console.error("Wallet API request failed:", error);
      return sendJson(req, res, 500, {
        error: "wallet_intelligence_failed",
        message: "Unable to build wallet intelligence right now."
      });
    }
  }

  return sendJson(req, res, 404, {
    error: "not_found",
    message: "Route not found."
  });
}

export function createServer() {
  return http.createServer((req, res) => {
    Promise.resolve(handleRequest(req, res)).catch((error) => {
      console.error("Unhandled API error:", error);
      if (!res.headersSent) {
        sendJson(req, res, 500, {
          error: "internal_error",
          message: "Internal server error."
        });
      } else {
        res.end();
      }
    });
  });
}

if (process.argv[1]?.endsWith("httpApi.js")) {
  const server = createServer();
  server.listen(PORT, () => {
    console.log(`MONFLUXO API listening on port ${PORT}`);
    console.log(`CORS origins: ${[...ALLOWED_ORIGINS].join(", ")}`);
  });
}
