import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { findCurrentSellingPrice } from "../app/_lib/current-selling-price.ts";

const products = [
  {
    nmId: 1001,
    vendorCode: "wz-ABC",
    currency: "CNY",
    sizes: [
      { discountedPrice: 62 },
      { discountedPrice: 68 },
      { discountedPrice: 62 },
    ],
  },
  {
    nmId: 1002,
    vendorCode: "wz-rub",
    currency: "RUB",
    sizes: [{ discountedPrice: 620 }],
  },
];

test("matches the WB product by nmId and preserves a multi-size discounted price range", () => {
  const result = findCurrentSellingPrice(products, { nmId: 1001, sellerSku: "unrelated" }, 10);
  assert.deepEqual(result, { min: 62, max: 68, currency: "CNY", convertedToCny: false, priceCount: 2 });
});

test("falls back to normalized seller code and converts RUB with the row exchange rate", () => {
  const result = findCurrentSellingPrice(products, { sellerSku: " WZ RUB " }, 10);
  assert.deepEqual(result, { min: 62, max: 62, currency: "CNY", convertedToCny: true, priceCount: 1 });
});

test("does not invent a current selling price when WB has no positive discounted price", () => {
  const result = findCurrentSellingPrice([{ nmId: 1003, vendorCode: "empty", currency: "CNY", sizes: [{ discountedPrice: 0 }] }], { nmId: 1003 }, 10);
  assert.equal(result, null);
});

test("product details places the WB API selling price immediately after the calculated final price", async () => {
  const source = await readFile(new URL("../app/details/page.tsx", import.meta.url), "utf8");
  assert.match(source, /fetch\(`\/api\/wb\/prices/);
  assert.match(source, /WB API 折扣后价格/);
  const calculatedPrice = source.indexOf("最终售价<br />");
  const currentPrice = source.indexOf("当前在售价<br />");
  const grossProfit = source.indexOf("毛利<br />");
  assert.ok(calculatedPrice >= 0 && calculatedPrice < currentPrice && currentPrice < grossProfit);
});
