import assert from "node:assert/strict";
import test from "node:test";
import { calculatePriceManagement } from "../app/_lib/price-management.ts";

const cost = {
  productCostRub: 0,
  exchangeRate: 0,
  productCostCny: 20,
  handlingFeeCny: 5,
  lengthCm: 10,
  widthCm: 10,
  heightCm: 20,
  commissionRate: 10,
  adRate: 0,
  activityDiscountRate: 5,
  returnLossRate: 5,
  targetMarginRate: 10,
};

function closeTo(actual, expected) {
  assert.ok(actual !== null);
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} should equal ${expected}`);
}

test("uses the WB discounted price directly without subtracting the backend discount twice", () => {
  const result = calculatePriceManagement("CNY", 100, cost);

  assert.equal(result.currentPriceCny, 100);
  closeTo(result.lastMileFeeCny, 10);
  closeTo(result.fixedCostCny, 35);
  closeTo(result.currentTotalCostCny, 55);
  closeTo(result.expectedProfitCny, 45);
  closeTo(result.profitRate, 45);
  closeTo(result.targetFinalSalePriceCny, 50);
  closeTo(result.registeredTotalCostCny, 45);
});

test("returns a negative profit when the current discounted price is below cost", () => {
  const result = calculatePriceManagement("CNY", 40, cost);

  closeTo(result.currentTotalCostCny, 43);
  closeTo(result.expectedProfitCny, -3);
  closeTo(result.profitRate, -7.5);
});

test("converts a RUB selling price using the product exchange rate", () => {
  const result = calculatePriceManagement("RUB", 1000, { ...cost, exchangeRate: 10 });

  assert.equal(result.sourceCurrency, "RUB");
  assert.equal(result.currentPriceCny, 100);
  closeTo(result.expectedProfitCny, 45);
});

test("does not invent an evaluation when product costs are missing", () => {
  const result = calculatePriceManagement("CNY", 100, null);

  assert.equal(result.ready, false);
  assert.equal(result.currentTotalCostCny, null);
  assert.equal(result.expectedProfitCny, null);
  assert.equal(result.profitRate, null);
});
