import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  matchesProductDeletion,
  productDeletionIdentity,
} from "../app/_lib/product-deletions.ts";

test("WB deletion markers only match the same immutable WB product id", () => {
  const markers = [{ identityKey: "nm:1489356182", sellerSkuKey: "wzcwysj", nmId: 1489356182 }];

  assert.equal(matchesProductDeletion({ sku: "wzcwysj", nmId: 1489356182 }, markers), true);
  assert.equal(matchesProductDeletion({ sku: "wzcwysj", nmId: null }, markers), false);
  assert.equal(matchesProductDeletion({ sku: "wzcwysj", nmId: 999 }, markers), false);
});

test("manual deletion markers continue to match normalized seller codes", () => {
  const markers = [{ identityKey: "sku:wzcwysj", sellerSkuKey: "wzcwysj", nmId: null }];

  assert.equal(matchesProductDeletion({ sku: "WZ-CWY_SJ", nmId: null }, markers), true);
  assert.equal(matchesProductDeletion({ sku: "wzcwysj-2", nmId: null }, markers), false);
});

test("deletion identity prefers WB id and otherwise uses normalized seller code", () => {
  assert.equal(productDeletionIdentity("wzcwysj", 1489356182), "nm:1489356182");
  assert.equal(productDeletionIdentity("WZ-CWY_SJ", null), "sku:wzcwysj");
});

test("renders each delete action only behind the selected-row condition", async () => {
  const source = await readFile(new URL("../app/details/page.tsx", import.meta.url), "utf8");
  assert.match(source, /selected\.has\(key\)\s*&&\s*<button[^>]*onClick=\{\(\) => deleteRow\(key, product, cost\)\}/s);
  assert.match(source, /window\.confirm\(`确认删除/);
});
