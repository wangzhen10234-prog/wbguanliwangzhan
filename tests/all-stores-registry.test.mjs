import test from "node:test";
import assert from "node:assert/strict";
import { allEnabledWbStores } from "../app/_lib/server-storefront.ts";

test("all-store discovery follows KV cursors and includes later stores without using active-store cookie", async () => {
  const values = {
    "site-config:store:primary": { id: "primary", enabled: false },
    "site-config:store:cl": { id: "cl", enabled: true, name: "二号店", badge: "2", description: "店铺", tokenDisabled: false },
    "site-config:store:later": { id: "later", enabled: true, name: "未来新增店铺", badge: "4", description: "店铺", tokenDisabled: true },
  };
  const calls = [];
  const stores = await allEnabledWbStores({ AUTH_KV: {
    async list(options) { calls.push(options.cursor); return options.cursor ? { keys: [{ name: "site-config:store:later" }], list_complete: true } : { keys: [{ name: "site-config:store:primary" }, { name: "site-config:store:cl" }], list_complete: false, cursor: "page2" }; },
    async get(key) { return values[key]; },
  } });
  assert.deepEqual(calls, [undefined, "page2"]);
  assert.deepEqual(stores.map((store) => store.id), ["cl", "later"]);
  // A store without an API is still listed so missing data cannot silently
  // disappear from what the user believes is the all-store grand total.
  assert.equal(stores.find((store) => store.id === "later").connected, false);
});
