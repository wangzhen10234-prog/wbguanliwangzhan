import assert from "node:assert/strict";
import test from "node:test";

import { matchPromotionCosts } from "../app/_lib/promotion-cost-trace.ts";

test("promotion trace selects a single independent amount without claiming an API join", () => {
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
  assert.equal(result.matchedDocumentNumber, 77);
});

test("promotion trace resolves the real 515 deduction from ten cross-day UPD rows", () => {
  const targetRows = [343, 100, 12, 10, 9, 8, 7, 6, 11, 9].map((updSum, index) => ({
    updNum: 312842268,
    advertId: [39672331, 39700884, 39639098, 39674492, 39626869][index % 5],
    updSum,
    updTime: `2026-08-${21 + (index % 5)}T10:00:00+03:00`,
  }));
  assert.equal(targetRows.reduce((sum, row) => sum + row.updSum, 0), 515);
  const result = matchPromotionCosts([
    ...targetRows,
    { updNum: 312866605, advertId: 39639098, updSum: 37, updTime: "2026-08-30T19:52:44+03:00" },
  ], 515);
  assert.equal(result.level, "document_total");
  assert.equal(result.matchedDocumentNumber, 312842268);
  assert.equal(result.candidateKeys.length, 10);
});

test("promotion trace refuses to choose between two equal document groups", () => {
  const result = matchPromotionCosts([
    { updNum: 1, advertId: 101, updSum: 300 },
    { updNum: 1, advertId: 102, updSum: 215 },
    { updNum: 2, advertId: 103, updSum: 515 },
  ], 515);
  assert.equal(result.level, "multiple_documents");
  assert.equal(result.candidateKeys.length, 3);
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
