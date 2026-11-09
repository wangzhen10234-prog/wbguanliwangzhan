import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Run the actual route with a persistent in-memory REST adapter, keeping real
// request parsing, store scoping, filters and response validation under test.
async function routeHarness() {
  const records = new Map();
  const context = vm.createContext({ Request, Response, URL, Set, JSON, Error });
  const source = await readFile(new URL("../app/api/order-notes/route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {
    "cloudflare:workers": { env: {} },
    "drizzle-orm": { inArray: () => {} },
    "../../../db": { getDb: () => { throw new Error("Unexpected D1 access"); } },
    "../../../db/schema": { wbSyncSnapshots: {} },
    "../../_lib/server-storefront": { requestedStorefront: async (request) => ({ id: request.headers.get("X-Test-Store") || "primary" }) },
    "../../_lib/server-persistence": {
      persistenceBackend: () => "supabase",
      writeSyncSnapshot: async (key, payload) => records.set(key, { payload }),
      supabaseRestRequest: async (path) => {
        const filter = new URL(`https://test.invalid/${path}`).searchParams.get("cache_key").slice(3);
        const keys = JSON.parse(`[${filter.slice(1, -1)}]`);
        return Response.json(keys.flatMap((key) => records.has(key) ? [records.get(key)] : []));
      },
    },
  };
  const route = new vm.SourceTextModule(compiled, { context });
  await route.link((specifier) => {
    const values = exports[specifier];
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, { context });
  });
  await route.evaluate();
  function request(method, store, body, query = "") {
    return new Request(`https://wbwork.duoduolink.com/api/order-notes${query}`, { method, headers: { Origin: "https://wbwork.duoduolink.com", "X-Test-Store": store, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  return { ...route.namespace, records, request };
}

test("saved notes survive reread and remain isolated by store and order", async () => {
  const api = await routeHarness();
  assert.equal((await api.PUT(api.request("PUT", "primary", { orderId: "6137900581", text: "测试备注\n第二行" }))).status, 200);
  const same = await (await api.GET(api.request("GET", "primary", null, "?ids=6137900581,6137573432"))).json();
  assert.equal(same.notes["6137900581"], "测试备注\n第二行");
  assert.equal(same.notes["6137573432"], undefined);
  const other = await (await api.GET(api.request("GET", "cl", null, "?ids=6137900581"))).json();
  assert.deepEqual(other.notes, {});
});

test("clearing a note persists an empty value without touching other notes", async () => {
  const api = await routeHarness();
  for (const id of ["1", "2"]) await api.PUT(api.request("PUT", "primary", { orderId: id, text: "保留" }));
  await api.PUT(api.request("PUT", "primary", { orderId: "1", text: " \n " }));
  const result = await (await api.GET(api.request("GET", "primary", null, "?ids=1,2"))).json();
  assert.deepEqual(result.notes, { 1: "", 2: "保留" });
});

test("invalid identifiers, oversized notes, cross-origin writes and oversized reads are rejected", async () => {
  const api = await routeHarness();
  for (const body of [{ orderId: "../bad", text: "x" }, { orderId: "1", text: "x".repeat(2001) }, { orderId: "1", text: null }]) {
    assert.equal((await api.PUT(api.request("PUT", "primary", body))).status, 400);
  }
  const crossOrigin = api.request("PUT", "primary", { orderId: "1", text: "x" });
  crossOrigin.headers.set("Origin", "https://other.invalid");
  assert.equal((await api.PUT(crossOrigin)).status, 403);
  assert.equal((await api.GET(api.request("GET", "primary", null, `?ids=${Array.from({ length: 101 }, (_, i) => i).join(",")}`))).status, 400);
  assert.equal(api.records.size, 0);
});
