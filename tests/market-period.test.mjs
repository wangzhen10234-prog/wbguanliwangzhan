import assert from "node:assert/strict";
import test from "node:test";
import { marketToday, marketShiftDate, marketPeriod, marketComparisonPeriod, marketHistoryPeriod } from "../app/_lib/market-period.ts";
const today = "2026-11-16";

test("custom period includes both days and compares the immediately preceding equal duration across calendar boundaries", () => {
  const selected = marketPeriod("2026-11-09", "2026-11-15", today);
  assert.deepEqual(selected, { from: "2026-11-09", to: "2026-11-15", days: 7 });
  assert.deepEqual(marketComparisonPeriod(selected, today), { from: "2026-11-02", to: "2026-11-08", days: 7, available: true });
  assert.deepEqual(marketComparisonPeriod(marketPeriod("2026-01-01", "2026-01-01", today), today), { from: "2025-12-31", to: "2025-12-31", days: 1, available: true });
  assert.equal(marketPeriod("2024-02-28", "2024-03-01", "2024-03-01").days, 3);
  assert.equal(marketPeriod(marketShiftDate(today, -89), today, today).days, 90);
});

test("rejects impossible, empty, reversed, future, overlong and unavailable historical dates", () => {
  for (const [from, to] of [["2026-02-30", "2026-03-01"], ["", today], ["2026-13-01", today], ["2026-11-16", "2026-11-15"], [today, "2026-11-17"], [marketShiftDate(today, -90), today], ["2025-01-01", "2025-01-07"]]) assert.throws(() => marketPeriod(from, to, today));
});

test("old queries keep selected totals but disable incomplete comparisons and daily charts", () => {
  const old = marketPeriod("2025-11-17", "2025-11-23", today);
  assert.equal(marketComparisonPeriod(old, today).available, false);
  assert.equal(marketHistoryPeriod(old, today), null);
  assert.equal(marketHistoryPeriod({ from: "2026-11-01", to: "2026-11-09" }, today), null);
  assert.deepEqual(marketHistoryPeriod({ from: "2026-11-09", to: "2026-11-15" }, today), { from: "2026-11-10", to: "2026-11-15" });
  assert.deepEqual(marketHistoryPeriod({ from: today, to: today }, today), { from: today, to: today });
});

test("today uses the existing Beijing calendar boundary regardless of server timezone", () => {
  assert.equal(marketToday(Date.parse("2026-11-15T15:59:59Z")), "2026-11-15");
  assert.equal(marketToday(Date.parse("2026-11-15T16:00:00Z")), "2026-11-16");
});
