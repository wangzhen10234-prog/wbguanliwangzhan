// Shared validation keeps the date picker and API on the same inclusive dates.
const DAY = 86_400_000;
export const MARKET_MAX_DAYS = 90;
export function marketToday(now = Date.now()) { return new Date(now + 8 * 3_600_000).toISOString().slice(0, 10); }
export function marketShiftDate(day: string, days: number) { return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10); }
function validDate(day: string) { return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day; }
export function marketPeriod(from: string, to: string, today = marketToday()) {
  if (!validDate(from) || !validDate(to)) throw new Error("请选择有效的开始和结束日期");
  const days = Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;
  if (days < 1) throw new Error("开始日期不能晚于结束日期");
  if (days > MARKET_MAX_DAYS) throw new Error(`单次查询最多 ${MARKET_MAX_DAYS} 天，请缩小日期范围`);
  if (to > today) throw new Error("结束日期不能晚于今天");
  if (from < marketShiftDate(today, -365)) throw new Error("WB 销售漏斗仅提供最近一年的数据，请调整开始日期");
  return { from, to, days };
}
export function marketComparisonPeriod(period: { from: string; days: number }, today = marketToday()) {
  const from = marketShiftDate(period.from, -period.days);
  const to = marketShiftDate(period.from, -1);
  return { from, to, days: period.days, available: from >= marketShiftDate(today, -365) };
}
export function marketHistoryPeriod(period: { from: string; to: string }, today = marketToday()) {
  // WB's daily endpoint only supports the last week, not any historical week.
  const from = [period.from, marketShiftDate(today, -6)].sort().at(-1)!;
  return from <= period.to ? { from, to: period.to } : null;
}
