import assert from "node:assert/strict";
import test from "node:test";
import { matchesWbStatusFilter, wbLogisticsStage, wbStatusLabel } from "../app/_lib/wb-order-status.ts";

test("interprets waiting by the accompanying supplier status", () => {
  assert.equal(wbLogisticsStage("waiting", "new"), "new");
  assert.equal(wbLogisticsStage("waiting", "confirm"), "preparing");
  assert.equal(wbLogisticsStage("waiting", "complete"), "carrier");
  assert.equal(wbStatusLabel("waiting", "complete"), "运输处理中");
});

test("maps WB logistics milestones without inventing history", () => {
  assert.equal(wbLogisticsStage("accepted_by_carrier", "complete"), "carrier");
  assert.equal(wbLogisticsStage("sorted", "complete"), "sorted");
  assert.equal(wbLogisticsStage("ready_for_pickup", "complete"), "pickup");
  assert.equal(wbLogisticsStage("sold", "complete"), "delivered");
});

test("groups every cancellation status in the WB filter", () => {
  assert.equal(matchesWbStatusFilter("declined_by_client", "__canceled__"), true);
  assert.equal(matchesWbStatusFilter("defect", "__canceled__"), true);
  assert.equal(matchesWbStatusFilter("sorted", "__canceled__"), false);
  assert.equal(wbLogisticsStage("canceled_by_client", "complete"), "canceled");
});
