import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAdvertisingBid } from "../app/_lib/advertising-evaluation.ts";

const wz310b = {
  productCostRub: 0,
  exchangeRate: 0,
  productCostCny: 21.5,
  handlingFeeCny: 5,
  lengthCm: 21,
  widthCm: 13,
  heightCm: 6,
  commissionRate: 19,
  activityDiscountRate: 5,
  returnLossRate: 10,
};

test("derives a transparent CPC ceiling from actual attributed sales and product cost", () => {
  const result = evaluateAdvertisingBid({
    paymentType: "cpc",
    currency: "CNY",
    currentBid: 0.5,
    minimumBid: 0.22,
    officialCompetitiveBid: null,
    averageProductPriceCny: 62,
    stats: { views: 514, clicks: 17, spend: 16.32, orders: 3, sales: 184 },
    cost: wz310b,
  });

  assert.equal(result.currency, "CNY");
  assert.equal(result.priceSource, "attributed-sales");
  assert.ok(Math.abs(result.sellingPriceCny - 184 / 3) < 0.0001);
  assert.ok(Math.abs(result.fixedCostCny - 35.776) < 0.0001);
  assert.equal(result.nonAdvertisingRate, 34);
  assert.ok(Math.abs(result.preAdProfitPerOrderCny - 4.704) < 0.0001);
  assert.ok(Math.abs(result.breakEvenBid - (4.704 * 3 / 17)) < 0.0001);
  assert.ok(Math.abs(result.safeBidCeiling - (4.704 * 3 / 17 * 0.8)) < 0.0001);
  assert.ok(Math.abs(result.estimatedNetProfit - (4.704 * 3 - 16.32)) < 0.0001);
  assert.equal(result.decision, "loss");
});

test("does not invent a recommendation when the WB minimum exceeds the safety ceiling", () => {
  const result = evaluateAdvertisingBid({
    paymentType: "cpc",
    currency: "CNY",
    currentBid: 1,
    minimumBid: 1,
    officialCompetitiveBid: null,
    averageProductPriceCny: 62,
    stats: { views: 514, clicks: 17, spend: 10, orders: 3, sales: 184 },
    cost: wz310b,
  });

  assert.equal(result.minimumExceedsSafety, true);
  assert.equal(result.suggestedBid, null);
  assert.equal(result.decision, "unviable");
});

test("keeps RUB bid calculations in RUB only when an exchange rate is present", () => {
  const result = evaluateAdvertisingBid({
    paymentType: "cpc",
    currency: "RUB",
    currentBid: 10,
    minimumBid: 5,
    officialCompetitiveBid: null,
    averageProductPriceCny: 62,
    stats: { views: 500, clicks: 20, spend: 120, orders: 2, sales: 1240 },
    cost: { ...wz310b, exchangeRate: 10 },
  });

  assert.equal(result.currencyPerCny, 10);
  assert.ok(result.breakEvenBid > 0);
});

test("uses cost per thousand impressions for CPM campaigns", () => {
  const result = evaluateAdvertisingBid({
    paymentType: "cpm",
    currency: "CNY",
    currentBid: 32,
    minimumBid: 20,
    officialCompetitiveBid: 30,
    averageProductPriceCny: 62,
    stats: { views: 2_000, clicks: 40, spend: 50, orders: 8, sales: 496 },
    cost: wz310b,
  });

  assert.equal(result.statsReady, true);
  assert.equal(result.actualUnitCost, 25);
  assert.ok(Math.abs(result.breakEvenBid - result.preAdProfitPerOrderCurrency * 4) < 0.0001);
});
