import test from "node:test";
import assert from "node:assert/strict";
import { analyzeTradeJourney, buildHoldBehavior } from "../src/holdIntelligence.js";
import { candleIntervalForHold } from "../src/priceProvider.js";

test("selects candle granularity from hold duration", () => {
  assert.equal(candleIntervalForHold(30 * 60), "1m");
  assert.equal(candleIntervalForHold(6 * 60 * 60), "5m");
  assert.equal(candleIntervalForHold(2 * 24 * 60 * 60), "15m");
  assert.equal(candleIntervalForHold(10 * 24 * 60 * 60), "1H");
  assert.equal(candleIntervalForHold(30 * 24 * 60 * 60), "4H");
  assert.equal(candleIntervalForHold(120 * 24 * 60 * 60), "1D");
});

test("calculates MFE MAE capture and underwater time", () => {
  const journey = analyzeTradeJourney({
    entryPrice: 1,
    exitPrice: 3,
    entryTime: 100,
    exitTime: 400,
    candles: [
      { time: 100, high: 1.2, low: 0.8, close: 0.9 },
      { time: 200, high: 5, low: 0.7, close: 2 },
      { time: 300, high: 4, low: 2, close: 3 },
      { time: 400, high: 3.2, low: 2.8, close: 3 }
    ]
  });
  assert.equal(journey.realizedRoiPct, 200);
  assert.equal(journey.mfePct, 400);
  assert.equal(journey.maePct, -30.000000000000004);
  assert.equal(journey.profitCapturePct, 50);
  assert.equal(journey.missedUpsidePctPoints, 200);
  assert.equal(journey.timeToPeakSeconds, 100);
  assert.equal(journey.timeUnderwaterSeconds, 100);
});

test("builds wallet hold profile from closed purchased inventory", () => {
  const profile = buildHoldBehavior([
    { mint: "A", purchasedTokensRemaining: 0, realizedCostBasis: 1, avgHoldingSeconds: 60, realizedPnl: 2, realizedRoi: 2, buys: 1, sells: 1 },
    { mint: "B", purchasedTokensRemaining: 0, realizedCostBasis: 2, avgHoldingSeconds: 180, realizedPnl: -1, realizedRoi: -0.5, buys: 2, sells: 2 },
    { mint: "OPEN", purchasedTokensRemaining: 1, realizedCostBasis: 1, avgHoldingSeconds: 10, realizedPnl: 5, realizedRoi: 5, buys: 1, sells: 0 }
  ]);
  assert.equal(profile.sampleSize, 2);
  assert.equal(profile.averageHoldSeconds, 120);
  assert.equal(profile.medianHoldSeconds, 120);
  assert.equal(profile.averageWinnerHoldSeconds, 60);
  assert.equal(profile.averageLoserHoldSeconds, 180);
  assert.equal(profile.reentryRatePct, 50);
});
