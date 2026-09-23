const HELIUS_API_KEY = process.env.HELIUS_API_KEY;

if (!HELIUS_API_KEY) {
  throw new Error("HELIUS_API_KEY is not configured");
}

const HELIUS_RPC_URL =
  `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

export async function getTransactionsForAddress(address, limit = 10) {
  const response = await fetch(HELIUS_RPC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "monfluxo",
      method: "getTransactionsForAddress",
      params: [
        {
          address,
          transactionDetails: "signatures",
          sortOrder: "desc",
          limit
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Helius request failed: ${response.status}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error.message || "Helius API error");
  }

  return data.result;
}
