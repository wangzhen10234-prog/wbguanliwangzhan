import assert from "node:assert/strict";
import test from "node:test";
import { reconcileProductCosts } from "../app/_lib/product-matching.ts";

const createCost = (product) => ({ sellerSku: product.sku, nmId: product.nmId, marker: "new" });

test("matches a newly uploaded WB product by its exact seller code", () => {
  const [result] = reconcileProductCosts(
    [{ sellerSku: "  New-SKU ", nmId: null, marker: "saved" }],
    [{ sellerSku: "ignored", sku: "new_sku", nmId: 701 }],
    createCost,
  );

  assert.equal(result.strategy, "sellerSku");
  assert.equal(result.product.nmId, 701);
  assert.equal(result.cost.marker, "saved");
  assert.equal(result.persistedSellerSku, "  New-SKU ");
});

test("keeps an edited seller code connected through the WB nmId", () => {
  const [result] = reconcileProductCosts(
    [{ sellerSku: "自定义新编号", nmId: 702, marker: "saved" }],
    [{ sku: "wb-original-code", nmId: 702 }],
    createCost,
  );

  assert.equal(result.strategy, "nmId");
  assert.equal(result.cost.sellerSku, "自定义新编号");
  assert.equal(result.persistedSellerSku, "自定义新编号");
});

test("exact seller-code matching wins over a stale nmId", () => {
  const results = reconcileProductCosts(
    [
      { sellerSku: "sku-b", nmId: 1, marker: "exact-b" },
      { sellerSku: "custom-a", nmId: 1, marker: "id-a" },
    ],
    [
      { sku: "sku-a", nmId: 1 },
      { sku: "sku-b", nmId: 2 },
    ],
    createCost,
  );

  assert.equal(results.find((row) => row.product?.nmId === 2)?.cost.marker, "exact-b");
  assert.equal(results.find((row) => row.product?.nmId === 1)?.cost.marker, "id-a");
});

test("clones a known shared cost alias without renaming the source record", () => {
  const [result] = reconcileProductCosts(
    [{ sellerSku: "wzK801", nmId: null, marker: "source" }],
    [{ sku: "wzK801GP", nmId: 703 }],
    createCost,
  );

  assert.equal(result.strategy, "costAlias");
  assert.equal(result.cost.sellerSku, "wzK801GP");
  assert.equal(result.cost.marker, "source");
  assert.equal(result.persistedSellerSku, "");
});

test("adds unmatched WB products and retains unmatched manual records", () => {
  const results = reconcileProductCosts(
    [{ sellerSku: "manual-only", nmId: null, marker: "saved" }],
    [{ sku: "brand-new", nmId: 704 }],
    createCost,
  );

  assert.deepEqual(results.map((row) => row.strategy).sort(), ["manual", "newProduct"]);
  assert.equal(results.find((row) => row.strategy === "newProduct")?.cost.marker, "new");
  assert.equal(results.find((row) => row.strategy === "manual")?.cost.marker, "saved");
});
