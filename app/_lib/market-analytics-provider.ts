import type { MarketCategoryMetric, MarketDataset, MarketHistoryPoint, MarketSource } from "./market-niche-types";

export type ProviderCapability = {
  categories: boolean;
  metrics: boolean;
  history: boolean;
  products: boolean;
  sellers: boolean;
  priceDistribution: boolean;
};

export interface MarketAnalyticsProvider {
  readonly id: string;
  readonly source: MarketSource;
  readonly capabilities: ProviderCapability;
  load(): Promise<MarketDataset>;
}

export const PROVIDER_CAPABILITIES = {
  wbOfficial: {
    categories: true,
    metrics: false,
    history: false,
    products: false,
    sellers: false,
    priceDistribution: false,
  },
  wbImport: {
    categories: true,
    metrics: true,
    history: true,
    products: false,
    sellers: false,
    priceDistribution: false,
  },
  thirdParty: {
    categories: false,
    metrics: false,
    history: false,
    products: false,
    sellers: false,
    priceDistribution: false,
  },
} satisfies Record<string, ProviderCapability>;

export function appendHistory(existing: MarketHistoryPoint[], categories: MarketCategoryMetric[]) {
  const byKey = new Map(existing.map((point) => [`${point.subjectId}:${point.periodDays}:${point.metricDate}`, point]));
  for (const item of categories) {
    const point: MarketHistoryPoint = {
      subjectId: item.subjectId,
      periodDays: item.periodDays,
      metricDate: item.metricDate,
      revenueRub: item.revenueRub,
      salesUnits: item.salesUnits,
      sellerCount: item.sellerCount,
      productCount: item.productCount,
      averagePriceRub: item.averagePriceRub,
      source: item.source,
    };
    byKey.set(`${point.subjectId}:${point.periodDays}:${point.metricDate}`, point);
  }
  return [...byKey.values()].sort((a, b) => a.metricDate.localeCompare(b.metricDate));
}
