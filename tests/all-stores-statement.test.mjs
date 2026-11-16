import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as reportLib from "../app/_lib/all-stores-report.ts";

const compiled = ts.transpileModule(readFileSync(new URL("../app/api/all-stores/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture(id, overrides = {}) {
  const at = new Date().toISOString();
  return { storeId: id, storeName: id, products: [{ sellerSku: "code", internalSku: "SKU", specification: "same", nmId: 10 }], orders: [{ id: "1", sellerSku: "code", nmId: 10, supplierStatus: "complete", wbStatus: "sold", createdAt: at, rid: "" }], supplies: [{ id: "batch", name: "batch", createdAt: "2026-11-09T06:00:00Z", closedAt: at, done: true, orderIds: ["1"], loaded: true }], returns: [], ordersAt: at, returnsAt: at, suppliesAt: at, ordersState: "fresh", returnsState: "fresh", suppliesState: "fresh", catalogState: "fresh", supplyWindow: { from: "2026-11-09", to: "2026-11-09" }, warnings: [], ...overrides };
}
function harness(sources) {
  const stored = new Map(sources.map((source) => [`all-stores-source:v2:${source.storeId}`, { payload: JSON.stringify(source) }]));
  const summaries = new Map();
  const env = { AUTH_KV: { async put(key, value) { summaries.set(key, JSON.parse(value)); } } };
  const modules = {
    "cloudflare:workers": { env },
    "../../_lib/all-stores-report": reportLib,
    "../../_lib/server-storefront": { async allEnabledWbStores() { return [{ id: "a", name: "一号店" }, { id: "b", name: "二号店" }]; } },
    "../../_lib/server-persistence": {
      persistenceBackend() { return "d1"; },
      async readSyncSnapshot(key) { return stored.get(key) || null; },
      async writeSyncSnapshot(key, payload) { stored.set(key, { payload }); },
    },
  };
  const context = { exports: {}, require: (name) => modules[name] || {}, console, Response, crypto };
  runInNewContext(compiled, context);
  return { stored, summaries, async post(storeId, sourceTimes = Object.fromEntries(sources.map((source) => [source.storeId, `${source.ordersAt}|${source.returnsAt}|${source.suppliesAt}`]))) {
    const response = await context.exports.POST(new Request("https://example.test/api/all-stores", { method: "POST", body: JSON.stringify({ storeId, from: "2026-11-09", to: "2026-11-09", version: "", sourceTimes }) }));
    return { status: response.status, body: await response.json() };
  } };
}

test("single-store snapshot is server-recomputed, labeled and saved without another store's missing data", async () => {
  const app = harness([fixture("a")]);
  const result = await app.post("a");
  assert.equal(result.status, 200);
  const saved = JSON.parse(app.stored.get(`all-stores-statement:v2:${result.body.id}`).payload);
  assert.equal(saved.storeId, "a");
  assert.equal(saved.storeName, "一号店");
  assert.deepEqual(Object.keys(saved.sourceTimes), ["a"]);
  assert.equal(saved.report.complete, true);
  assert.deepEqual(saved.report.totals, [{ sku: "SKU", orders: 1, returns: 0 }]);
  assert.ok(saved.report.events.every((event) => event.storeId === "a"));
  assert.equal([...app.summaries.values()][0].storeName, "一号店");
  assert.equal((await app.post("")).status, 409);
});

test("other shops' errors do not block a complete selected shop; all-store snapshot still rejects them", async () => {
  const app = harness([fixture("a"), fixture("b", { ordersState: "cached", warnings: ["failed"] })]);
  assert.equal((await app.post("a")).status, 200);
  assert.equal((await app.post("b")).status, 409);
  assert.equal((await app.post(undefined)).status, 409);
});

test("snapshot rejects an unknown scope or changed source timestamps without saving a misleading report", async () => {
  const app = harness([fixture("a"), fixture("b")]);
  assert.equal((await app.post("deleted")).status, 400);
  assert.equal((await app.post(["a"])).status, 400);
  assert.equal((await app.post("a", { a: "old source time" })).status, 409);
  assert.equal(app.summaries.size, 0);
  const result = await app.post("");
  assert.equal(result.status, 200);
  const saved = JSON.parse(app.stored.get(`all-stores-statement:v2:${result.body.id}`).payload);
  assert.equal(saved.storeId, "");
  assert.equal(saved.report.totals[0].orders, 2);
});
