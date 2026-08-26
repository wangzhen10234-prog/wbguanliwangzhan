import assert from "node:assert/strict";
import test from "node:test";
import { buildOrderCompletionIndex, completionForOrder, normalizeWbStatisticsTime } from "../app/_lib/order-completion.ts";

test("matches WB sale and cancellation events to the same FBS order", () => {
  const sold = { nmId: 101, rid: "RID-SOLD", orderUid: "ORDER-SOLD" };
  const canceled = { nmId: 202, rid: "RID-CANCEL", orderUid: "ORDER-CANCEL" };
  const index = buildOrderCompletionIndex(
    [{ nmId: 101, srid: "rid-sold", date: "2026-08-25T21:30:00", saleID: "S123" }],
    [{ nmId: 202, srid: "rid-cancel", cancelDate: "2026-08-25T23:30:00", isCancel: true }],
  );

  assert.equal(completionForOrder(sold, "success", index)?.source, "sale");
  assert.equal(completionForOrder(canceled, "abnormal", index)?.source, "cancel");
  assert.equal(completionForOrder(sold, "pending", index), null);
});

test("converts offset-free WB Statistics timestamps from Moscow to Beijing", () => {
  const normalized = normalizeWbStatisticsTime("2026-08-25T21:30:00");
  assert.equal(normalized, "2026-08-25T18:30:00.000Z");
  const beijingDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(normalized));
  assert.equal(beijingDate, "2026-08-26");
});

test("keeps abnormal return time separate from an earlier successful sale", () => {
  const order = { nmId: 303, rid: "RID-RETURN" };
  const index = buildOrderCompletionIndex([
    { nmId: 303, srid: "rid-return", date: "2026-08-20T10:00:00", saleID: "S1" },
    { nmId: 303, srid: "rid-return", date: "2026-08-24T11:00:00", saleID: "R1" },
  ], []);

  assert.equal(completionForOrder(order, "success", index)?.source, "sale");
  assert.equal(completionForOrder(order, "abnormal", index)?.source, "return");
});
