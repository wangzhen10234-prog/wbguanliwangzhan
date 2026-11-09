import assert from "node:assert/strict";
import test from "node:test";
import { loadReturnsReport } from "../app/_lib/returns-report.ts";
import { classifyReturnTracking, returnStatusLabel } from "../app/_lib/return-tracking.ts";

const window = { from: "2026-05-07", to: "2026-11-02" };
test("new loaded-truck status is in transit and cancelled archive without pickup time is not marked collected", () => {
  assert.equal(classifyReturnTracking("Погружен в машину до СЦ/РЦ", true, null), "transit");
  assert.equal(returnStatusLabel("Погружен в машину до СЦ/РЦ", "transit"), "已装车，运往分拣/配送中心");
  assert.equal(classifyReturnTracking("Отмена по задержке", false, null), "unknown");
  assert.equal(returnStatusLabel("Отмена по задержке", "unknown"), "因延迟取消");
});
function item(id, status = "В пути в пвз") {
  return { sku: `barcode-${id}`, nmId: 123, orderId: id, returnStatus: status, returnReason: "Цвет", completedDt: null };
}

test("new official endpoint fetches both statuses and maps renamed fields without losing pickup time", async () => {
  const urls = [];
  const rows = await loadReturnsReport(window, async (url) => {
    urls.push(new URL(url));
    return new URL(url).searchParams.get("status") === "active"
      ? { count: 1, report: [item(1)] }
      : { count: 1, report: [{ ...item(2, "Выдано"), completedDt: "2026-11-01T12:00:00", readyToReturnDt: "2026-10-30T12:00:00" }] };
  });
  assert.equal(urls.length, 2);
  assert.ok(urls.every((url) => url.pathname === "/api/analytics/v1/item-returns" && url.searchParams.get("dateFrom") === window.from && url.searchParams.get("dateTo") === window.to));
  assert.equal(rows[0].isStatusActive, 1);
  assert.equal(rows[0].barcode, "barcode-1");
  assert.equal(rows[0].status, "В пути в пвз");
  assert.equal(rows[0].reason, "Цвет");
  assert.equal(rows[1].isStatusActive, 0);
  assert.equal(rows[1].completedDt, "2026-11-01T12:00:00");
  assert.equal(rows[1].readyToReturnDt, "2026-10-30T12:00:00");
});

test("follows count/offset until all pages are loaded, even if a page is short", async () => {
  const offsets = [];
  const rows = await loadReturnsReport(window, async (url) => {
    const params = new URL(url).searchParams;
    if (params.get("status") === "archive") return null;
    const offset = Number(params.get("offset"));
    offsets.push(offset);
    return { count: 1001, report: Array.from({ length: offset === 0 ? 500 : offset === 500 ? 500 : 1 }, (_, index) => item(offset + index)) };
  });
  assert.deepEqual(offsets, [0, 500, 1000]);
  assert.equal(rows.length, 1001);
  assert.equal(rows[1000].orderId, 1000);
});

test("HTTP 204 for both status lists is a valid empty report", async () => {
  assert.deepEqual(await loadReturnsReport(window, async () => null), []);
});

test("partial pagination, malformed payloads and upstream failures cannot become successful empty reports", async () => {
  for (const badPage of [null, { count: 2, report: [] }, { count: 2 }, { count: -1, report: [] }]) {
    await assert.rejects(() => loadReturnsReport(window, async (url) => {
      const params = new URL(url).searchParams;
      if (params.get("status") === "archive") return null;
      return params.get("offset") === "0" ? { count: 2, report: [item(1)] } : badPage;
    }));
  }
  await assert.rejects(() => loadReturnsReport(window, async () => { throw new Error("WB 429"); }), /WB 429/);
  await assert.rejects(() => loadReturnsReport(window, async () => ({ count: 1, report: [{}] })), /INVALID_ROW/);
});
