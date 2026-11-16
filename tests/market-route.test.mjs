import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as metrics from "../app/_lib/market-analytics.ts";
import * as periods from "../app/_lib/market-period.ts";

const today = "2026-11-16";
const compiled = ts.transpileModule(readFileSync(new URL("../app/api/wb/market/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function harness() {
  const calls = [];
  const selected = { openCount: 2780, cartCount: 20, orderCount: 2, orderSum: 180 };
  const modules = {
    "cloudflare:workers": { env: {} },
    "../../../_lib/market-period": { ...periods, marketToday: () => today, marketPeriod: (from, to) => periods.marketPeriod(from, to, today), marketComparisonPeriod: (period) => periods.marketComparisonPeriod(period, today), marketHistoryPeriod: (period) => periods.marketHistoryPeriod(period, today) },
    "../../../_lib/market-analytics": metrics,
    "../../../_lib/server-persistence": { async readSyncSnapshot() { return null; }, async writeSyncSnapshot() {} },
    "../../../_lib/server-storefront": { async resolveWbStore() { return { id: "shop-2", token: "test-only" }; }, scopedStoreKey: (id, key) => `${id}:${key}` },
  };
  const context = { exports: {}, require: (name) => modules[name] || {}, console, Response, Request, URL, AbortSignal, fetch: async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url, body });
    if (url.endsWith("/sales-funnel/products")) return Response.json({ data: { currency: "CNY", products: [{ product: { nmId: 123, vendorCode: "wz8006" }, statistic: { selected, past: { openCount: 2189, cartCount: 0, orderCount: 0, orderSum: 0 }, comparison: { openCountDynamic: 27, cartCountDynamic: 0, orderCountDynamic: null } } }] } });
    if (url.endsWith("/grouped/history")) return Response.json({ data: [] });
    if (url.endsWith("/brand-share/brands")) return Response.json({ data: [] });
    throw new Error(`Unexpected URL ${url}`);
  } };
  runInNewContext(compiled, context);
  return { calls, async get(query) { const response = await context.exports.GET(new Request(`https://example.test/api/wb/market?${query}`)); return { status: response.status, body: await response.json() }; } };
}

test("custom query sends exact inclusive selected and prior dates to WB and retains official comparison values", async () => {
  const app = harness();
  const result = await app.get("from=2026-11-09&to=2026-11-15");
  assert.equal(result.status, 200);
  const products = app.calls.find((call) => call.url.endsWith("/sales-funnel/products")).body;
  assert.deepEqual(products.selectedPeriod, { start: "2026-11-09", end: "2026-11-15" });
  assert.deepEqual(products.pastPeriod, { start: "2026-11-02", end: "2026-11-08" });
  assert.deepEqual(app.calls.find((call) => call.url.endsWith("/grouped/history")).body.selectedPeriod, { start: "2026-11-10", end: "2026-11-15" });
  assert.equal(result.body.summary.orderCount, 2);
  assert.equal(result.body.products[0].openDynamic, 27);
  assert.equal(result.body.products[0].orderDynamic, null);
  assert.equal(metrics.formatMarketChange(result.body.products[0].cartDynamic, result.body.products[0].cartCount, result.body.products[0].past.cartCount), "新增");
});

test("historical custom queries fetch their totals without requesting an unsupported daily window", async () => {
  const app = harness();
  const result = await app.get("from=2026-10-01&to=2026-10-14");
  assert.equal(result.status, 200);
  assert.equal(result.body.period.days, 14);
  assert.equal(result.body.comparisonPeriod.from, "2026-09-17");
  assert.equal(result.body.summary.openCount, 2780);
  assert.equal(result.body.historyPeriod, null);
  assert.deepEqual(result.body.daily, []);
  assert.match(result.body.dataAvailability.groupedHistoryReason, /最近 7 天/);
  assert.equal(app.calls.some((call) => call.url.includes("/grouped/history")), false);
});

test("never presents shortened prior-period data as an equal-length comparison", async () => {
  const app = harness();
  const result = await app.get("from=2025-11-17&to=2025-11-23");
  assert.equal(result.status, 200);
  assert.equal(result.body.comparisonPeriod.available, false);
  assert.equal(result.body.products[0].openDynamic, null);
  assert.equal(result.body.products[0].past, null);
  assert.equal("pastPeriod" in app.calls[0].body, false);
});

test("invalid dates are rejected before any WB requests", async () => {
  const app = harness();
  for (const query of ["from=2026-02-30&to=2026-03-01", "to=invalid", "from=&to=2026-11-15", "from=2026-11-17&to=2026-11-18", "from=2026-01-01&to=2026-11-16"]) assert.equal((await app.get(query)).status, 400);
  assert.equal(app.calls.length, 0);
});
