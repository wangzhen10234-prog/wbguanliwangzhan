import assert from "node:assert/strict";
import test from "node:test";
import { calculatePromotionProfit } from "../app/_lib/promotion-evaluation.ts";

const wz310b = {
  productCostRub: 0,
  exchangeRate: 11.2,
  productCostCny: 21.5,
  handlingFeeCny: 5,
  lengthCm: 21,
  widthCm: 13,
  heightCm: 6,
  commissionRate: 19,
  adRate: 0,
  activityDiscountRate: 5,
  returnLossRate: 10,
};

test("keeps WB CNY promotion prices in CNY and evaluates wz310B as profitable", () => {
  const result = calculatePromotionProfit("CNY", 62, wz310b);
  assert.equal(result.sourceCurrency, "CNY");
  assert.equal(result.promoPriceCny, 62);
  assert.equal(result.variableRate, 34);
  assert.ok(Math.abs(result.fixedCostCny - 35.776) < 0.0001);
  assert.ok(Math.abs(result.totalCostCny - 56.856) < 0.0001);
  assert.ok(Math.abs(result.profitCny - 5.144) < 0.0001);
  assert.ok(result.profitCny > 0);
});

test("converts WB RUB promotion prices only when the API currency is RUB", () => {
  const result = calculatePromotionProfit("RUB", 620, wz310b);
  assert.ok(Math.abs(result.promoPriceCny - 620 / 11.2) < 0.0001);
});
