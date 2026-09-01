import assert from "node:assert/strict";
import test from "node:test";

import { matchPromotionCosts } from "../app/_lib/promotion-cost-trace.ts";

test("promotion trace selects a single same-day amount without claiming an API join", () => {
  const result = matchPromotionCosts([
    { advertId: 101, updSum: 515, updTime: "2026-08-31T10:00:00+03:00" },
    { advertId: 202, updSum: 28, updTime: "2026-08-31T11:00:00+03:00" },
  ], 515);
  assert.equal(result.level, "single_amount");
  assert.equal(result.candidateKeys.length, 1);
});

test("promotion trace can identify one document total containing several campaigns", () => {
  const result = matchPromotionCosts([
    { updNum: 77, advertId: 101, updSum: 300 },
    { updNum: 77, advertId: 202, updSum: 215 },
    { updNum: 88, advertId: 303, updSum: 20 },
  ], 515);
  assert.equal(result.level, "document_total");
  assert.equal(result.candidateKeys.length, 2);
});

test("promotion trace refuses to choose when duplicate same-day amounts exist", () => {
  const result = matchPromotionCosts([
    { advertId: 101, updSum: 515 },
    { advertId: 202, updSum: 515 },
  ], 515);
  assert.equal(result.level, "multiple_amounts");
  assert.equal(result.candidateKeys.length, 2);
});

test("promotion trace returns none when no official amount matches", () => {
  const result = matchPromotionCosts([{ advertId: 101, updSum: 99 }], 515);
  assert.equal(result.level, "none");
  assert.deepEqual(result.candidateKeys, []);
});
