import assert from "node:assert/strict";
import test from "node:test";
import { classifyReturnTracking, returnStatusLabel, sortReturnsByPickupTime } from "../app/_lib/return-tracking.ts";

test("maps the real WB reverse-logistics statuses without inventing extra stages", () => {
  assert.equal(classifyReturnTracking("В пути в пвз", true, null), "transit");
  assert.equal(classifyReturnTracking("Готов к выдаче", true, null), "ready");
  assert.equal(classifyReturnTracking("Выдано", false, "2026-08-24T10:00:00"), "completed");
  assert.equal(classifyReturnTracking("Статус не определен", true, null), "unknown");
});

test("uses explicit Chinese labels while retaining an unknown fallback", () => {
  assert.equal(returnStatusLabel("В пути в пвз", "transit"), "运输至取货点");
  assert.equal(returnStatusLabel("Готов к выдаче", "ready"), "已到达，可取回");
  assert.equal(returnStatusLabel("Новый статус WB", "unknown"), "状态待确认");
});

test("sorts returns by the WB completed pickup time and keeps missing times last", () => {
  const rows = [
    { id: "1", orderDate: "2026-08-20T00:00:00Z", completedAt: "2026-08-24T01:00:00Z" },
    { id: "2", orderDate: "2026-08-22T00:00:00Z", completedAt: null },
    { id: "3", orderDate: "2026-08-21T00:00:00Z", completedAt: "2026-08-25T01:00:00Z" },
  ];
  assert.deepEqual(sortReturnsByPickupTime(rows, "desc").map((row) => row.id), ["3", "1", "2"]);
  assert.deepEqual(sortReturnsByPickupTime(rows, "asc").map((row) => row.id), ["1", "3", "2"]);
});
