import assert from "node:assert/strict";
import test from "node:test";
import { beijingDateKey, updateFbsCompletionObservations } from "../app/_lib/fbs-completion-observations.ts";

const detectedAt = "2026-08-27T04:00:00.000Z"; // Beijing 2026-08-27 12:00

test("records a pending order immediately when WB changes it to sold", () => {
  const previous = [{ id: 1, createdAt: "2026-08-20T00:00:00Z", supplierStatus: "complete", wbStatus: "waiting" }];
  const current = [{ ...previous[0], wbStatus: "sold" }];
  const result = updateFbsCompletionObservations(previous, current, {}, detectedAt);

  assert.deepEqual(result["id:1"], {
    outcome: "success",
    detectedAt,
    supplierStatus: "complete",
    wbStatus: "sold",
  });
});

test("records a pending order immediately when WB changes it to an abnormal result", () => {
  const previous = [{ id: 2, createdAt: "2026-08-20T00:00:00Z", supplierStatus: "complete", wbStatus: "waiting" }];
  const current = [{ ...previous[0], wbStatus: "canceled_by_client" }];
  const result = updateFbsCompletionObservations(previous, current, {}, detectedAt);

  assert.equal(result["id:2"].outcome, "abnormal");
  assert.equal(result["id:2"].detectedAt, detectedAt);
});

test("does not falsely backfill an old already-completed order as completed today", () => {
  const current = [{ id: 3, createdAt: "2026-08-20T00:00:00Z", supplierStatus: "complete", wbStatus: "sold" }];
  assert.deepEqual(updateFbsCompletionObservations([], current, {}, detectedAt), {});
});

test("captures a same-Beijing-day order first seen already completed", () => {
  const current = [{ id: 4, createdAt: "2026-08-26T20:30:00Z", supplierStatus: "complete", wbStatus: "sold" }];
  const result = updateFbsCompletionObservations([], current, {}, detectedAt);
  assert.equal(result["id:4"].outcome, "success");
  assert.equal(beijingDateKey(current[0].createdAt), "2026-08-27");
});

test("preserves an existing detection time while the outcome is unchanged", () => {
  const order = { id: 5, createdAt: "2026-08-20T00:00:00Z", supplierStatus: "complete", wbStatus: "sold" };
  const existing = {
    "id:5": { outcome: "success", detectedAt: "2026-08-26T01:00:00.000Z", supplierStatus: "complete", wbStatus: "sold" },
  };
  assert.deepEqual(updateFbsCompletionObservations([order], [order], existing, detectedAt), existing);
});

test("updates the observation if WB changes a success into an abnormal result", () => {
  const previous = [{ id: 6, createdAt: "2026-08-20T00:00:00Z", supplierStatus: "complete", wbStatus: "sold" }];
  const current = [{ ...previous[0], wbStatus: "defect" }];
  const existing = {
    "id:6": { outcome: "success", detectedAt: "2026-08-26T01:00:00.000Z", supplierStatus: "complete", wbStatus: "sold" },
  };
  const result = updateFbsCompletionObservations(previous, current, existing, detectedAt);
  assert.equal(result["id:6"].outcome, "abnormal");
  assert.equal(result["id:6"].detectedAt, detectedAt);
});
