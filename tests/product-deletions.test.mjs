import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  matchesProductDeletion,
  productDeletionIdentity,
} from "../app/_lib/product-deletions.ts";

test("uses the stable WB product id as the deletion identity when available", () => {
  assert.equal(productDeletionIdentity("wz810G", 1271220961), "nm:1271220961");
});

test("falls back to a normalized seller code for a manual product", () => {
  assert.equal(productDeletionIdentity("  WZ-810_G ", null), "sku:wz810g");
});

test("keeps deleted WB products hidden after a later dashboard synchronization", () => {
  const markers = [{
    identityKey: "nm:1271220961",
    sellerSkuKey: "wz810g",
    nmId: 1271220961,
  }];

  assert.equal(matchesProductDeletion({ sku: "renamed-product", nmId: 1271220961 }, markers), true);
  assert.equal(matchesProductDeletion({ sku: "WZ_810-G", nmId: null }, markers), true);
  assert.equal(matchesProductDeletion({ sku: "wz810x", nmId: 1271220962 }, markers), false);
});

test("renders each delete action only behind the selected-row condition", async () => {
  const source = await readFile(new URL("../app/details/page.tsx", import.meta.url), "utf8");
  assert.match(source, /selected\.has\(key\)\s*&&\s*<button[^>]*onClick=\{\(\) => deleteRow\(key, product, cost\)\}/s);
  assert.match(source, /window\.confirm\(`确认删除/);
});
