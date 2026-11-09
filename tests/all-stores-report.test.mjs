import test from "node:test";
import assert from "node:assert/strict";
import { buildAllStoresReport, DEFAULT_GROUP_SETTINGS, dayInZone, mondayOf, reportDays, sourceSkuKey, csvCell } from "../app/_lib/all-stores-report.ts";
import { loadSupplyList, supplyOrderIds } from "../app/_lib/supply-report.ts";

const syncedAt = "2026-11-09T06:00:00Z";
const settings = { ...DEFAULT_GROUP_SETTINGS, mappings: {} };
function order(id, overrides = {}) { return { id: String(id), sellerSku: "wz810L", nmId: 10, supplierStatus: "complete", wbStatus: "waiting", createdAt: "2026-11-08T09:30:00Z", rid: "", ...overrides }; }
function supply(id, orderIds, overrides = {}) { return { id, name: id, createdAt: "2026-11-09T05:48:22Z", closedAt: syncedAt, done: true, loaded: true, orderIds: orderIds.map(String), ...overrides }; }
function store(id = "primary", overrides = {}) {
  return { storeId: id, storeName: id, orders: [order(1)], supplies: [supply("batch-1", [1])], returns: [], products: [{ sellerSku: "wz810L", internalSku: "810L", specification: "绿色5米", nmId: 10 }], ordersState: "fresh", returnsState: "fresh", catalogState: "fresh", suppliesState: "fresh", ordersAt: syncedAt, returnsAt: syncedAt, suppliesAt: syncedAt, coverageStart: "2026-08-01", supplyWindow: { from: "2026-11-01", to: "2026-11-09" }, warnings: [], ...overrides };
}
function returned(id, overrides = {}) { return { id, nmId: 10, orderId: "1", srid: "", completedAt: "2026-11-08T22:00:00", requestedAt: "2026-10-20", reason: "", status: "Выдан", barcode: "123", active: false, ...overrides }; }

test("previous-day orders belong to Monday's real 13:48 supply, not order day or a fixed cutoff", () => {
  const report = buildAllStoresReport([store()], "2026-11-08", "2026-11-09", settings);
  assert.equal(report.daily[0].total, 0);
  assert.equal(report.daily[1].total, 1);
  assert.equal(report.events[0].supplyId, "batch-1");
  assert.equal(dayInZone(report.events[0].at, "Asia/Shanghai"), "2026-11-09");
  assert.equal(report.complete, true);
});
test("combines multiple daily supplies and same SKU across stores; same numeric order ID in another store is distinct", () => {
  const a = store("a", { orders: [order(1), order(2)], supplies: [supply("one", [1]), supply("two", [2], { createdAt: "2026-11-09T06:10:00Z" })] });
  const b = store("b");
  const report = buildAllStoresReport([a, b], "2026-11-09", "2026-11-09", settings);
  assert.deepEqual(report.totals, [{ sku: "810L", orders: 3, returns: 0 }]);
  assert.equal(report.events.length, 3);
});
test("excludes invalid new cancellations and keeps unassigned valid orders separate", () => {
  const report = buildAllStoresReport([store("a", { orders: [order(1, { supplierStatus: "new", wbStatus: "declined_by_client" }), order(2, { supplierStatus: "new" }), order(3, { supplierStatus: "new", wbStatus: "canceled_by_client" })] })], "2026-11-09", "2026-11-09", settings);
  assert.equal(report.daily[0].total, 0);
  assert.equal(report.excluded, 1);
  assert.equal(report.pendingOrders.length, 1);
  assert.equal(report.pendingOrders[0].orderId, "2");
});
test("same order repeated in two supplies is counted once and flags a reconciliation issue", () => {
  const report = buildAllStoresReport([store("a", { supplies: [supply("one", [1]), supply("two", [1])] })], "2026-11-09", "2026-11-09", settings);
  assert.equal(report.daily[0].total, 1);
  assert.equal(report.complete, false);
  assert.match(report.problems.join(), /多张供货单/);
});
test("return uses actual pickup time rather than older request/order date; archived cancelled rows are not pending", () => {
  const report = buildAllStoresReport([store("a", { returns: [returned("r"), returned("r"), returned("active", { completedAt: "", active: true }), returned("cancel", { completedAt: "", status: "Отмена по задержке" })] })], "2026-11-08", "2026-11-09", settings);
  assert.equal(report.returnsDaily[0].total, 0);
  assert.equal(report.returnsDaily[1].total, 1);
  assert.equal(report.pendingReturns, 1);
  assert.equal(report.totals[0].orders, 1);
  assert.equal(report.totals[0].returns, 1);
});
test("Monday and Sunday boundaries are inclusive, and partial weeks never include outside dates", () => {
  assert.equal(mondayOf("2026-11-08"), "2026-11-02");
  assert.equal(mondayOf("2026-11-09"), "2026-11-09");
  const report = buildAllStoresReport([store("a", { orders: [order(1), order(2)], supplies: [supply("sun", [1], { createdAt: "2026-11-08T15:59:59Z" }), supply("mon", [2], { createdAt: "2026-11-08T16:00:00Z" })] })], "2026-11-08", "2026-11-09", settings);
  assert.equal(report.weeks.length, 2);
  assert.deepEqual(report.weeks.map((week) => week.rows[0].orders), [1, 1]);
  assert.ok(report.weeks.every((week) => week.partial));
  assert.equal(buildAllStoresReport([store()], "2026-11-02", "2026-11-08", settings).weeks[0].partial, false);
});
test("same internal SKU with different specifications stays separate until explicitly mapped", () => {
  const a = store("a"); const b = store("b", { products: [{ sellerSku: "wz810L", internalSku: "810L", specification: "黑色5米", nmId: 10 }] });
  const report = buildAllStoresReport([a, b], "2026-11-09", "2026-11-09", settings);
  assert.equal(report.skuList.length, 2);
  assert.ok(report.sources.every((source) => !source.automatic));
  const mapped = { ...settings, mappings: { [sourceSkuKey("a", "wz810L")]: "810", [sourceSkuKey("b", "wz810L")]: "810" } };
  assert.deepEqual(buildAllStoresReport([a, b], "2026-11-09", "2026-11-09", mapped).totals, [{ sku: "810", orders: 2, returns: 0 }]);
});
test("case-only seller code changes may match an unambiguous product, while saved user mappings take precedence", () => {
  const source = store("cl", { orders: [order(1, { sellerSku: "CL310B", nmId: 999 })], products: [{ sellerSku: "cl310b", internalSku: "310B", specification: "黑色", nmId: 1 }] });
  assert.equal(buildAllStoresReport([source], "2026-11-09", "2026-11-09", settings).skuList[0], "310B");
  const custom = { ...settings, mappings: { [sourceSkuKey("cl", "CL310B")]: "用户已确认的编号" } };
  assert.equal(buildAllStoresReport([source], "2026-11-09", "2026-11-09", custom).skuList[0], "用户已确认的编号");
});
test("failed stores, missing supply orders and malformed source time cannot produce a complete zero report", () => {
  const report = buildAllStoresReport([store("a", { ordersState: "cached", returnsState: "error", supplies: [supply("missing", [999]), supply("bad", [1], { createdAt: "2026-11-09T13:48:00" })] })], "2026-11-09", "2026-11-09", settings);
  assert.equal(report.complete, false);
  assert.equal(report.daily[0].total, 0);
  assert.ok(report.problems.length >= 4);
});
test("real empty supply is valid zero; unpaid/unshipped new orders do not fill empty processed quantities", () => {
  const report = buildAllStoresReport([store("a", { supplies: [supply("empty", [])], orders: [order(1, { supplierStatus: "new" })] })], "2026-11-09", "2026-11-09", settings);
  assert.equal(report.daily[0].total, 0);
  assert.equal(report.complete, true);
  assert.equal(report.pendingOrders.length, 1);
});
test("date validation rejects impossible/reversed/oversized ranges; CSV resists spreadsheet formulas", () => {
  assert.throws(() => reportDays("2026-02-30", "2026-03-01"));
  assert.throws(() => reportDays("2026-11-10", "2026-11-09"));
  assert.throws(() => reportDays("2024-01-01", "2026-11-09"));
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
});
test("supply pagination follows next even when WB returns only 100 or fewer for requested 1000", async () => {
  const calls = [];
  const supplies = await loadSupplyList(async (path) => {
    const next = new URL(`https://example.com${path}`).searchParams.get("next"); calls.push(next);
    return next === "0" ? { supplies: [{ id: "a", createdAt: syncedAt }], next: 12 } : next === "12" ? { supplies: [{ id: "b", createdAt: syncedAt }], next: 13 } : { supplies: [], next: 0 };
  });
  assert.deepEqual(calls, ["0", "12", "13"]);
  assert.equal(supplies.length, 2);
  assert.deepEqual(supplyOrderIds({ orderIds: [1, 1, 2] }), ["1", "2"]);
  assert.throws(() => supplyOrderIds({}));
  assert.throws(() => supplyOrderIds({ orderIds: [0] }));
  await assert.rejects(loadSupplyList(async () => ({ supplies: [{ id: "a", createdAt: syncedAt }], next: 12 })), /PAGINATION/);
});
