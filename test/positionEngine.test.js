import test from "node:test";
import assert from "node:assert/strict";
import { buildPositions } from "../src/positionEngine.js";

test("external transfer inventory never becomes zero-cost realized PnL", () => {
  const transfers = [{
    signature: "transfer-in",
    eventIndex: 0,
    blockTime: 10,
    direction: "IN",
    mint: "TOKEN",
    amount: 100
  }];
  const trades = [{
    signature: "sell",
    eventIndex: 0,
    blockTime: 20,
    type: "SELL",
    tokenMint: "TOKEN",
    tokenAmount: 40,
    solAmount: 4,
    estimatedPriceSol: 0.1,
    feeSol: 0
  }];

  const position = buildPositions(trades, transfers).get("TOKEN");
  assert.equal(position.realizedPnl, 0);
  assert.equal(position.unknownCostSoldTokens, 40);
  assert.equal(position.unknownCostSellProceedsSol, 4);
  assert.equal(position.unknownCostRemainingTokens, 60);
  assert.equal(position.pnlComplete, false);
});

test("multiple trades sharing one signature remain independent events", () => {
  const trades = [
    {
      signature: "same-signature",
      eventIndex: 2,
      blockTime: 10,
      type: "BUY",
      tokenMint: "TOKEN",
      tokenAmount: 10,
      solAmount: 1,
      estimatedPriceSol: 0.1,
      feeSol: 0
    },
    {
      signature: "same-signature",
      eventIndex: 5,
      blockTime: 10,
      type: "BUY",
      tokenMint: "TOKEN",
      tokenAmount: 20,
      solAmount: 2,
      estimatedPriceSol: 0.1,
      feeSol: 0
    }
  ];

  const position = buildPositions(trades).get("TOKEN");
  assert.equal(position.buys, 2);
  assert.equal(position.tradeCount, 2);
  assert.equal(position.tokensBought, 30);
  assert.equal(position.solSpent, 3);
});

test("transfer out removes inventory without realizing a sale", () => {
  const trades = [{
    signature: "buy",
    eventIndex: 0,
    blockTime: 10,
    type: "BUY",
    tokenMint: "TOKEN",
    tokenAmount: 100,
    solAmount: 10,
    estimatedPriceSol: 0.1,
    feeSol: 0
  }];
  const transfers = [{
    signature: "transfer-out",
    eventIndex: 0,
    blockTime: 20,
    direction: "OUT",
    mint: "TOKEN",
    amount: 25
  }];

  const position = buildPositions(trades, transfers).get("TOKEN");
  assert.equal(position.tokensRemaining, 75);
  assert.equal(position.remainingCostSol, 7.5);
  assert.equal(position.realizedPnl, 0);
  assert.equal(position.tokensTransferredOut, 25);
});
