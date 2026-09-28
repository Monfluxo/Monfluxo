const HELIUS_API_KEY = process.env.HELIUS_API_KEY;

if (!HELIUS_API_KEY) {
  throw new Error("HELIUS_API_KEY is not configured");
}

const HELIUS_RPC_URL =
  `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

const MAX_RETRIES = Number(process.env.HELIUS_MAX_RETRIES || 5);
const FULL_PAGE_LIMIT = Math.min(
  Math.max(Number(process.env.HELIUS_FULL_PAGE_LIMIT || 100), 1),
  100
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function heliusRequest(method, params, id) {
  let attempt = 0;

  while (true) {
    const response = await fetch(HELIUS_RPC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params
      })
    });

    if (response.ok) {
      const data = await response.json();

      if (data.error) {
        throw new Error(data.error.message || "Helius API error");
      }

      return data.result;
    }

    const retryable = response.status === 429 || response.status === 503;
    if (!retryable || attempt >= MAX_RETRIES) {
      throw new Error(`Helius request failed: ${response.status}`);
    }

    const retryAfter = Number(response.headers.get("retry-after") || 0);
    const exponential = Math.min(30000, 1000 * 2 ** attempt);
    const jitter = Math.floor(Math.random() * 250);
    const delay = retryAfter > 0 ? retryAfter * 1000 : exponential + jitter;

    console.warn(
      `Helius rate/service limit (${response.status}). Retrying in ${delay}ms.`
    );

    await sleep(delay);
    attempt++;
  }
}

export async function getTransactionsForAddress(
  address,
  paginationToken = null,
  requestOptions = {}
) {
  const tokenAccounts =
    requestOptions.tokenAccounts ??
    process.env.HELIUS_TOKEN_ACCOUNTS_FILTER ??
    "balanceChanged";

  const filters = {
    ...(requestOptions.filters || {})
  };

  if (requestOptions.succeededOnly !== false) {
    filters.status = "succeeded";
  }

  if (tokenAccounts && tokenAccounts !== "none") {
    filters.tokenAccounts = tokenAccounts;
  }

  const options = {
    transactionDetails: "full",
    limit: Math.min(
      Math.max(Number(requestOptions.limit || FULL_PAGE_LIMIT), 1),
      100
    ),
    sortOrder: requestOptions.sortOrder || "desc",
    ...(Object.keys(filters).length ? { filters } : {})
  };

  if (paginationToken) {
    options.paginationToken = paginationToken;
  }

  return heliusRequest(
    "getTransactionsForAddress",
    [address, options],
    "monfluxo-history"
  );
}

export async function getTransfersByAddress(
  address,
  paginationToken = null,
  requestOptions = {}
) {
  const options = {
    limit: Math.min(
      Math.max(Number(requestOptions.limit || 100), 1),
      100
    ),
    ...(requestOptions.direction ? { direction: requestOptions.direction } : {}),
    ...(requestOptions.mint ? { mint: requestOptions.mint } : {}),
    ...(requestOptions.with ? { with: requestOptions.with } : {}),
    ...(requestOptions.filters ? { filters: requestOptions.filters } : {})
  };

  if (paginationToken) {
    options.paginationToken = paginationToken;
  }

  return heliusRequest(
    "getTransfersByAddress",
    [address, options],
    "monfluxo-transfers"
  );
}

export async function getTransaction(signature) {
  return heliusRequest(
    "getTransaction",
    [
      signature,
      {
        encoding: "jsonParsed",
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0
      }
    ],
    "monfluxo-debug-transaction"
  );
}
