import test from "node:test";
import assert from "node:assert/strict";
import { parseTransaction } from "../src/parser.js";

const PUMP_FUN = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const SYSTEM = "11111111111111111111111111111111";

function pumpBuyGroup(index, wallet, destination, poolSource, lamports, rawAmount) {
  return {
    index,
    instructions: [
      {
        programId: SYSTEM,
        parsed: {
          type: "transfer",
          info: { source: wallet, destination: `curve-${index}`, lamports }
        }
      },
      {
        program: "spl-token",
        parsed: {
          type: "transfer",
          info: { source: poolSource, destination, amount: String(rawAmount) }
        }
      }
    ]
  };
}

test("one Solana signature can produce multiple trade events", () => {
  const wallet = "Wallet111";
  const accountKeys = [
    wallet,
    "WalletTokenA",
    "PoolTokenA",
    "WalletTokenB",
    "PoolTokenB"
  ];
  const tokenBalance = (accountIndex, mint, owner, amount) => ({
    accountIndex,
    mint,
    owner,
    uiTokenAmount: { amount: String(amount), decimals: 6 }
  });

  const transaction = {
    blockTime: 100,
    transaction: {
      signatures: ["sig-multi"],
      message: {
        accountKeys,
        instructions: [
          { programId: PUMP_FUN, accounts: [], data: "buy-a" },
          { programId: PUMP_FUN, accounts: [], data: "buy-b" }
        ]
      }
    },
    meta: {
      fee: 5000,
      preBalances: [10_000_000_000, 0, 0, 0, 0],
      postBalances: [7_000_000_000, 0, 0, 0, 0],
      preTokenBalances: [
        tokenBalance(1, "MintA", wallet, 0),
        tokenBalance(2, "MintA", "PoolA", 1_000_000_000),
        tokenBalance(3, "MintB", wallet, 0),
        tokenBalance(4, "MintB", "PoolB", 1_000_000_000)
      ],
      postTokenBalances: [
        tokenBalance(1, "MintA", wallet, 10_000_000),
        tokenBalance(2, "MintA", "PoolA", 990_000_000),
        tokenBalance(3, "MintB", wallet, 20_000_000),
        tokenBalance(4, "MintB", "PoolB", 980_000_000)
      ],
      innerInstructions: [
        pumpBuyGroup(0, wallet, "WalletTokenA", "PoolTokenA", 1_000_000_000, 10_000_000),
        pumpBuyGroup(1, wallet, "WalletTokenB", "PoolTokenB", 2_000_000_000, 20_000_000)
      ]
    }
  };

  const parsed = parseTransaction(transaction, wallet);
  assert.equal(parsed.type, "MULTI_TRADE");
  assert.equal(parsed.trades.length, 2);
  assert.deepEqual(parsed.trades.map((x) => x.eventIndex), [0, 1]);
  assert.deepEqual(parsed.trades.map((x) => x.tokenMint), ["MintA", "MintB"]);
  assert.deepEqual(parsed.trades.map((x) => x.solAmount), [1, 2]);
  assert.equal(parsed.trade.signature, "sig-multi");
});
