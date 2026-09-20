import type { MarketAnalyticsProvider } from "../market-analytics-provider";
import { PROVIDER_CAPABILITIES } from "../market-analytics-provider";
import { EMPTY_MARKET_DATASET, type MarketCategoryMetric, type MarketDataset } from "../market-niche-types";

type ParentCategory = { id?: number; name?: string };

/**
 * Official provider is intentionally limited to the documented Content API.
 * It provides hierarchy metadata only; it never labels store funnel data as
 * marketplace-wide revenue or demand.
 */
export class WbOfficialProvider implements MarketAnalyticsProvider {
  readonly id = "wb-official-content";
  readonly source = "WB_OFFICIAL" as const;
  readonly capabilities = PROVIDER_CAPABILITIES.wbOfficial;

  constructor(private token: string, private request: typeof fetch = fetch) {}

  async load(): Promise<MarketDataset> {
    const response = await this.request("https://content-api.wildberries.ru/content/v2/object/parent/all", {
      headers: { Authorization: this.token },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`WB_OFFICIAL_${response.status}`);
    const body = await response.json() as { data?: ParentCategory[] } | ParentCategory[];
    const values = Array.isArray(body) ? body : Array.isArray(body.data) ? body.data : [];
    const now = new Date().toISOString();
    const categories: MarketCategoryMetric[] = values.flatMap((item) => item.id && item.name ? [{
      id: `parent:${item.id}:metadata`, subjectId: `parent:${item.id}`, nameRu: item.name, nameZh: "", parentId: "", parentName: "", level: 1,
      periodDays: 30, metricDate: now.slice(0, 10), revenueRub: null, salesUnits: null, revenueGrowth: null, salesGrowth: null,
      sellerCount: null, productCount: null, averagePriceRub: null, medianPriceRub: null, buyoutRate: null, cancelRate: null,
      averageStock: null, turnoverDays: null, concentration: null, top10ProductShare: null, top10SellerShare: null,
      seasonality: null, supplyDemand: null, source: "WB_OFFICIAL", confidence: "OFFICIAL_API", updatedAt: now,
    }] : []);
    return { ...EMPTY_MARKET_DATASET, categories, history: [], watchedIds: [], importedAt: now, sourceFile: "WB Content API /content/v2/object/parent/all" };
  }
}
