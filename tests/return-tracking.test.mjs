import assert from "node:assert/strict";
import test from "node:test";
import { classifyReturnTracking, returnStatusLabel } from "../app/_lib/return-tracking.ts";

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
