import http from "node:http";
import { requestWalletDashboard } from "./walletProductService.js";

const PORT = Number(process.env.PORT || 3000);
const ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ALLOWED_ORIGIN = process.env.MONFLUXO_WEB_ORIGIN || "http://localhost:3001";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...corsHeaders()
  });
  res.end(JSON.stringify(body));
}

function walletFromPath(pathname) {
  const match = pathname.match(/^\/api\/wallet\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

export async function handleRequest(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    return res.end();
  }

  if (req.method === "GET" && url.pathname === "/health") {
    return sendJson(res, 200, { ok: true, service: "monfluxo-api" });
  }

  const wallet = walletFromPath(url.pathname);
  if (req.method === "GET" && wallet) {
    if (!ADDRESS_RE.test(wallet)) {
      return sendJson(res, 400, {
        error: "invalid_wallet",
        message: "Invalid Solana wallet address."
      });
    }

    try {
      const priority = Number(url.searchParams.get("priority") || 100);
      const payload = await requestWalletDashboard(wallet, { priority });
      return sendJson(res, 200, payload);
    } catch (error) {
      console.error("Wallet API request failed:", error);
      return sendJson(res, 500, {
        error: "wallet_intelligence_failed",
        message: "Unable to build wallet intelligence right now."
      });
    }
  }

  return sendJson(res, 404, {
    error: "not_found",
    message: "Route not found."
  });
}

export function createServer() {
  return http.createServer((req, res) => {
    Promise.resolve(handleRequest(req, res)).catch((error) => {
      console.error("Unhandled API error:", error);
      if (!res.headersSent) {
        sendJson(res, 500, {
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
    console.log(`MONFLUXO API listening on http://localhost:${PORT}`);
    console.log(`CORS origin: ${ALLOWED_ORIGIN}`);
  });
}
