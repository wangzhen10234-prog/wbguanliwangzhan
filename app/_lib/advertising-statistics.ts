export type AdvertisingMetricInput = {
  views?: number;
  clicks?: number;
  sum?: number;
  atbs?: number;
  orders?: number;
  shks?: number;
  sum_price?: number;
};

export type AdvertisingDailyInput = AdvertisingMetricInput & { date?: string };
export type AdvertisingBoosterInput = { avg_position?: number; date?: string; nm?: number };

function finite(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function advertisingMetricView(source: AdvertisingMetricInput) {
  const views = finite(source.views);
  const clicks = finite(source.clicks);
  const spend = finite(source.sum);
  const addToCart = finite(source.atbs);
  const orders = finite(source.orders);
  const sales = finite(source.sum_price);
  const buyouts = finite(source.shks);
  return {
    views,
    clicks,
    spend,
    addToCart,
    orders,
    sales,
    buyouts,
    ctr: views ? clicks / views * 100 : 0,
    cpc: clicks ? spend / clicks : 0,
    cr: clicks ? orders / clicks * 100 : 0,
    cpo: orders ? spend / orders : 0,
    roas: spend ? sales / spend : 0,
  };
}

export function campaignDailyStatistics(days: AdvertisingDailyInput[] = []) {
  return days
    .map((day) => ({ date: String(day.date || "").slice(0, 10), ...advertisingMetricView(day) }))
    .filter((day) => Boolean(day.date))
    .sort((left, right) => left.date.localeCompare(right.date));
}

export function averageAdvertisingPosition(rows: AdvertisingBoosterInput[] = [], nmId?: number) {
  const positions = rows
    .filter((row) => !nmId || Math.trunc(finite(row.nm)) === Math.trunc(nmId))
    .map((row) => finite(row.avg_position))
    .filter((value) => value > 0);
  if (!positions.length) return null;
  return Math.round(positions.reduce((sum, value) => sum + value, 0) / positions.length * 10) / 10;
}
