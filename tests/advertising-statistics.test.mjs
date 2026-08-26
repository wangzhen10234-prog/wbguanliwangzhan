import assert from "node:assert/strict";
import test from "node:test";
import { advertisingMetricView, averageAdvertisingPosition, campaignDailyStatistics } from "../app/_lib/advertising-statistics.ts";

test("derives promotion ratios only from WB metric fields", () => {
  const result = advertisingMetricView({ views: 5224, clicks: 391, atbs: 122, orders: 24, sum: 291.82, sum_price: 1481, shks: 20 });
  assert.equal(result.views, 5224);
  assert.equal(result.addToCart, 122);
  assert.equal(result.orders, 24);
  assert.equal(Number(result.ctr.toFixed(2)), 7.48);
  assert.equal(Number(result.cr.toFixed(2)), 6.14);
  assert.equal(Number(result.roas.toFixed(2)), 5.08);
});

test("keeps campaign days ordered and does not synthesize missing dates", () => {
  const rows = campaignDailyStatistics([
    { date: "2026-08-26T00:00:00+03:00", views: 100, clicks: 5, orders: 1, sum: 2, sum_price: 10 },
    { date: "2026-08-24T00:00:00+03:00", views: 50, clicks: 2, orders: 0, sum: 1, sum_price: 0 },
  ]);
  assert.deepEqual(rows.map((row) => row.date), ["2026-08-24", "2026-08-26"]);
  assert.equal(rows.length, 2);
});

test("calculates average ranking for the requested WB product only", () => {
  const rows = [
    { nm: 1001, avg_position: 20 },
    { nm: 1001, avg_position: 24 },
    { nm: 2002, avg_position: 4 },
    { nm: 1001, avg_position: 0 },
  ];
  assert.equal(averageAdvertisingPosition(rows, 1001), 22);
  assert.equal(averageAdvertisingPosition(rows, 3003), null);
});
