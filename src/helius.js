const HELIUS_API_KEY = process.env.HELIUS_API_KEY;

if (!HELIUS_API_KEY) {
  throw new Error("HELIUS_API_KEY is not configured");
  }

  const HELIUS_RPC_URL =
    `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

    async function heliusRequest(method, params, id) {
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

                                                            if (!response.ok) {
                                                                throw new Error(`Helius request failed: ${response.status}`);
                                                                  }

                                                                    const data = await response.json();

                                                                      if (data.error) {
                                                                          throw new Error(
                                                                                data.error.message || "Helius API error"
                                                                                    );
                                                                                      }

                                                                                        return data.result;
                                                                                        }

                                                                                        export async function getTransactionsForAddress(
                                                                                          address,
                                                                                            paginationToken = null
                                                                                            ) {
                                                                                              const options = {
                                                                                                  transactionDetails: "full",
                                                                                                      limit: 100,
                                                                                                          sortOrder: "desc"
                                                                                                            };

                                                                                                              if (paginationToken) {
                                                                                                                  options.paginationToken = paginationToken;
                                                                                                                    }

                                                                                                                      return await heliusRequest(
                                                                                                                          "getTransactionsForAddress",
                                                                                                                              [
                                                                                                                                    address,
                                                                                                                                          options
                                                                                                                                              ],
                                                                                                                                                  "monfluxo-history"
                                                                                                                                                    );
                                                                                                                                                    }