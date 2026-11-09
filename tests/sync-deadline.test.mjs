import assert from "node:assert/strict";
import test from "node:test";
import { withSyncDeadline } from "../app/_lib/sync-deadline.ts";

test("a cache operation that never settles exits with a source-specific timeout", async () => {
  await assert.rejects(withSyncDeadline(new Promise(() => {}), 15, "fbs-orders"), /SYNC_TIMEOUT:fbs-orders/);
});

test("returns successful data intact and preserves upstream errors", async () => {
  const data = { orders: [{ id: 1 }] };
  assert.equal(await withSyncDeadline(Promise.resolve(data), 100, "orders"), data);
  const error = Object.assign(new Error("WB unauthorized"), { status: 401 });
  await assert.rejects(withSyncDeadline(Promise.reject(error), 100, "orders"), (received) => received === error);
});

test("a late failure after timeout is handled and a later sync can succeed", async () => {
  let fail;
  const stalled = new Promise((_, reject) => { fail = reject; });
  await assert.rejects(withSyncDeadline(stalled, 10, "finance"), /SYNC_TIMEOUT:finance/);
  fail(new Error("late upstream failure"));
  assert.equal(await withSyncDeadline(Promise.resolve("fresh data"), 100, "finance"), "fresh data");
});
