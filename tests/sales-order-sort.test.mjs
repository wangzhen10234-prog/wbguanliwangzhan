import assert from "node:assert/strict";
import test from "node:test";
import { sortSalesOrders } from "../app/_lib/sales-order-sort.ts";

const orders = [
  { id: "1", createdAt: "2026-08-20T02:00:00Z", completionAt: "2026-08-23T01:00:00Z" },
  { id: "2", createdAt: "2026-08-22T02:00:00Z", completionAt: null },
  { id: "3", createdAt: "2026-08-21T02:00:00Z", completionAt: "2026-08-24T01:00:00Z" },
];

test("sorts all filtered orders by order time before pagination", () => {
  assert.deepEqual(sortSalesOrders(orders, "createdAt", "desc").map((order) => order.id), ["2", "3", "1"]);
  assert.deepEqual(sortSalesOrders(orders, "createdAt", "asc").map((order) => order.id), ["1", "3", "2"]);
});

test("sorts by completion time and keeps pending timestamps at the bottom", () => {
  assert.deepEqual(sortSalesOrders(orders, "completionAt", "desc").map((order) => order.id), ["3", "1", "2"]);
  assert.deepEqual(sortSalesOrders(orders, "completionAt", "asc").map((order) => order.id), ["1", "3", "2"]);
});
