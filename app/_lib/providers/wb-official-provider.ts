import type { MarketAnalyticsProvider } from "../market-analytics-provider.ts";
import { PROVIDER_CAPABILITIES } from "../market-analytics-provider.ts";
import { EMPTY_MARKET_DATASET, type MarketCategoryMetric, type MarketDataset } from "../market-niche-types.ts";

type SubjectCategory = { subjectID?: number; parentID?: number; subjectName?: string; parentName?: string };
type SubjectResponse = { data?: SubjectCategory[] } | SubjectCategory[];

const PAGE_SIZE = 1000;

function rowsFromSubjects(values: SubjectCategory[], now = new Date().toISOString()): MarketCategoryMetric[] {
  return values.flatMap((item) => item.subjectID && item.subjectName ? [{
    id: `subject:${item.subjectID}:api`, subjectId: String(item.subjectID), nameRu: item.subjectName, nameZh: "",
    parentId: item.parentID ? String(item.parentID) : "", parentName: item.parentName || "", level: 2,
    periodDays: 30, metricDate: now.slice(0, 10), revenueRub: null, salesUnits: null, revenueGrowth: null, salesGrowth: null,
    sellerCount: null, productCount: null, averagePriceRub: null, medianPriceRub: null, buyoutRate: null, cancelRate: null,
    averageStock: null, turnoverDays: null, concentration: null, top10ProductShare: null, top10SellerShare: null,
    seasonality: null, supplyDemand: null, source: "WB_OFFICIAL" as const, confidence: "OFFICIAL_API" as const, updatedAt: now,
  }] : []);
}

/**
 * Official provider is intentionally limited to the documented Content API.
 * It automatically reads the complete WB subject hierarchy, but never labels
 * seller-only funnel data as marketplace-wide revenue or demand.
 */
export class WbOfficialProvider implements MarketAnalyticsProvider {
  readonly id = "wb-official-content";
  readonly source = "WB_OFFICIAL" as const;
  readonly capabilities = PROVIDER_CAPABILITIES.wbOfficial;
  private token: string;
  private request: typeof fetch;

  constructor(token: string, request: typeof fetch = fetch) {
    this.token = token;
    this.request = request;
  }

  async load(): Promise<MarketDataset> {
    const values: SubjectCategory[] = [];
    for (let offset = 0; offset < 20_000; offset += PAGE_SIZE) {
      const url = new URL("https://content-api.wildberries.ru/content/v2/object/all");
      url.searchParams.set("locale", "ru");
      url.searchParams.set("limit", String(PAGE_SIZE));
      url.searchParams.set("offset", String(offset));
      const response = await this.request(url.toString(), { headers: { Authorization: this.token }, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`WB_OFFICIAL_${response.status}`);
      const body = await response.json() as SubjectResponse;
      const page = Array.isArray(body) ? body : Array.isArray(body.data) ? body.data : [];
      values.push(...page);
      if (page.length < PAGE_SIZE) break;
      await new Promise((resolve) => setTimeout(resolve, 650));
    }
    const now = new Date().toISOString();
    return { ...EMPTY_MARKET_DATASET, categories: rowsFromSubjects(values, now), history: [], watchedIds: [], importedAt: now, sourceFile: "WB Content API /content/v2/object/all" };
  }
}
