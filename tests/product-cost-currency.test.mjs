import assert from "node:assert/strict";
import test from "node:test";

import {
  inferProductCostCurrency,
  switchProductCostCurrency,
} from "../app/_lib/product-cost-currency.ts";

test("direct RMB supplier costs are detected as CNY", () => {
  assert.equal(inferProductCostCurrency({ productCostRub: 0, exchangeRate: 11.2, productCostCny: 53.57 }), "CNY");
});

test("switching a RUB supplier cost to CNY preserves the economic cost", () => {
  assert.deepEqual(
    switchProductCostCurrency({ productCostRub: 600, exchangeRate: 11.2, productCostCny: 0 }, "CNY"),
    { productCostRub: 0, exchangeRate: 11.2, productCostCny: 53.57 },
  );
});

test("switching a direct CNY supplier cost to RUB converts it using the row exchange rate", () => {
  assert.deepEqual(
    switchProductCostCurrency({ productCostRub: 0, exchangeRate: 11.2, productCostCny: 53.57 }, "RUB"),
    { productCostRub: 599.98, exchangeRate: 11.2, productCostCny: 53.57 },
  );
});
