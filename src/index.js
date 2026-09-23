import { getTransactionsForAddress } from "./helius.js";

const wallet = "11111111111111111111111111111111";

try {
  const transactions = await getTransactionsForAddress(wallet, 5);

    console.log("MONFLUXO → HELIUS");
      console.log(JSON.stringify(transactions, null, 2));
      } catch (error) {
        console.error("Error:", error.message);
        }