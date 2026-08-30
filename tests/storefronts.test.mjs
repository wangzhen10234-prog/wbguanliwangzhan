import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  requestedStorefront,
  resolveWbStore,
  scopedStoreKey,
} from "../app/_lib/server-storefront.ts";

test("store cookie selects the connected CL storefront", () => {
  const request = new Request("https://example.test/api", {
    headers: { cookie: "unrelated=1; wb-insight-active-store=cl" },
  });
  const store = requestedStorefront(request);
  assert.equal(store.id, "cl");
  assert.equal(store.name, "王振2号店（CL）");
  assert.equal(store.connected, true);
});

test("missing or invalid store cookies safely fall back to the primary store", () => {
  assert.equal(requestedStorefront(new Request("https://example.test/api")).id, "primary");
  assert.equal(requestedStorefront(new Request("https://example.test/api", {
    headers: { cookie: "wb-insight-active-store=unknown" },
  })).id, "primary");
});

test("WB credentials are selected only on the server for the active store", () => {
  const runtime = { WB_API_TOKEN: "primary-secret", WB_API_TOKEN_CL: "cl-secret" };
  const primary = resolveWbStore(new Request("https://example.test/api"), runtime);
  const cl = resolveWbStore(new Request("https://example.test/api", {
    headers: { cookie: "wb-insight-active-store=cl" },
  }), runtime);
  assert.equal(primary.token, "primary-secret");
  assert.equal(cl.token, "cl-secret");
});

test("primary cache keys stay backward compatible and secondary keys are isolated", () => {
  assert.equal(scopedStoreKey("primary", "cards"), "cards");
  assert.equal(scopedStoreKey("cl", "cards"), "cl:cards");
  assert.notEqual(scopedStoreKey("primary", "finance"), scopedStoreKey("cl", "finance"));
});

test("every WB route resolves the active store and never reads a token directly", async () => {
  const routes = ["dashboard", "prices", "reviews", "audit", "promotions", "advertising", "returns", "order-status"];
  for (const route of routes) {
    const source = await readFile(new URL(`../app/api/wb/${route}/route.ts`, import.meta.url), "utf8");
    assert.match(source, /resolveWbStore\(/, `${route} must resolve the active store`);
    assert.doesNotMatch(source, /(?:process\.env|env)\.WB_API_TOKEN\b/, `${route} must not bypass store selection`);
  }
});

test("product and deletion rows are always scoped to the selected store", async () => {
  const source = await readFile(new URL("../app/api/product-costs/route.ts", import.meta.url), "utf8");
  assert.match(source, /requestedStorefront\(request\)/);
  assert.match(source, /eq\(productCosts\.storeId, store\.id\)/);
  assert.match(source, /eq\(productCostDeletions\.storeId, store\.id\)/);
  assert.match(source, /target:\s*\[productCosts\.storeId, productCosts\.sellerSku\]/);
  assert.match(source, /target:\s*\[productCostDeletions\.storeId, productCostDeletions\.identityKey\]/);
});
