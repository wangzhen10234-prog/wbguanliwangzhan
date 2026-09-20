import assert from "node:assert/strict";
import test from "node:test";
import { parseMarketCsv } from "../app/_lib/market-import.ts";
import { scoreMarketCategories } from "../app/_lib/market-niche-score.ts";

const base = {
  id: "", nameZh: "", parentId: "", parentName: "", level: 1, periodDays: 30, metricDate: "2026-09-20",
  revenueRub: null, salesUnits: null, revenueGrowth: null, salesGrowth: null, sellerCount: null, productCount: null,
  averagePriceRub: null, medianPriceRub: null, buyoutRate: null, cancelRate: null, averageStock: null, turnoverDays: null,
  concentration: null, top10ProductShare: null, top10SellerShare: null, seasonality: null, supplyDemand: null,
  source: "WB_EXPORT", confidence: "OFFICIAL_EXPORT", updatedAt: "2026-09-20T00:00:00.000Z",
};

test("imports only explicit official export values and preserves absent fields as null", () => {
  const csv = "ID предмета;Предмет;Выручка;Количество продавцов;Выкуп, %\n123;Поводки;12 500 000;42;82,5";
  const { rows } = parseMarketCsv(csv, "niches.csv", 30);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].subjectId, "123");
  assert.equal(rows[0].revenueRub, 12500000);
  assert.equal(rows[0].sellerCount, 42);
  assert.equal(rows[0].buyoutRate, 82.5);
  assert.equal(rows[0].medianPriceRub, null);
  assert.equal(rows[0].source, "WB_EXPORT");
  assert.equal(rows[0].confidence, "OFFICIAL_EXPORT");
});

test("rejects unrelated spreadsheets instead of guessing market fields", () => {
  assert.throws(() => parseMarketCsv("name;value\nfoo;123", "random.csv", 30), /未识别为 WB/);
});

test("normalizes opportunity score within the current data set", () => {
  const rows = scoreMarketCategories([
    { ...base, id: "a", subjectId: "a", nameRu: "A", revenueRub: 100, revenueGrowth: 5, sellerCount: 100, productCount: 100, buyoutRate: 60 },
    { ...base, id: "b", subjectId: "b", nameRu: "B", revenueRub: 1000, revenueGrowth: 40, sellerCount: 20, productCount: 30, buyoutRate: 90 },
  ]);
  assert.ok(rows[1].opportunityScore > rows[0].opportunityScore);
  assert.ok(rows[1].opportunityScore >= 0 && rows[1].opportunityScore <= 100);
  assert.ok(rows[1].opportunityReasons.length > 0);
});

test("does not invent a score when fewer than three real factors exist", () => {
  const [row] = scoreMarketCategories([{ ...base, id: "a", subjectId: "a", nameRu: "A", revenueRub: 100, sellerCount: 10 }]);
  assert.equal(row.opportunityScore, null);
  assert.match(row.opportunityReasons[0], /少于 3 项/);
});
