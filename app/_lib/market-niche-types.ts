export type MarketSource = "WB_OFFICIAL" | "WB_EXPORT" | "THIRD_PARTY" | "ESTIMATED";
export type MarketConfidence = "OFFICIAL_API" | "OFFICIAL_EXPORT" | "VERIFIED_THIRD_PARTY" | "ESTIMATED";

export type MarketMetricKey =
  | "revenueRub" | "salesUnits" | "revenueGrowth" | "salesGrowth"
  | "sellerCount" | "productCount" | "averagePriceRub" | "medianPriceRub"
  | "buyoutRate" | "cancelRate" | "averageStock" | "turnoverDays"
  | "concentration" | "top10ProductShare" | "top10SellerShare"
  | "seasonality" | "supplyDemand";

export type MarketCategoryMetric = {
  id: string;
  subjectId: string;
  nameRu: string;
  nameZh: string;
  parentId: string;
  parentName: string;
  level: number;
  periodDays: number;
  metricDate: string;
  revenueRub: number | null;
  salesUnits: number | null;
  revenueGrowth: number | null;
  salesGrowth: number | null;
  sellerCount: number | null;
  productCount: number | null;
  averagePriceRub: number | null;
  medianPriceRub: number | null;
  buyoutRate: number | null;
  cancelRate: number | null;
  averageStock: number | null;
  turnoverDays: number | null;
  concentration: number | null;
  top10ProductShare: number | null;
  top10SellerShare: number | null;
  seasonality: number | null;
  supplyDemand: number | null;
  source: MarketSource;
  confidence: MarketConfidence;
  updatedAt: string;
  opportunityScore?: number | null;
  opportunityReasons?: string[];
};

export type MarketHistoryPoint = {
  subjectId: string;
  periodDays: number;
  metricDate: string;
  revenueRub: number | null;
  salesUnits: number | null;
  sellerCount: number | null;
  productCount: number | null;
  averagePriceRub: number | null;
  source: MarketSource;
};

export type MarketDataset = {
  version: 1;
  categories: MarketCategoryMetric[];
  history: MarketHistoryPoint[];
  watchedIds: string[];
  importedAt: string;
  sourceFile: string;
};

export type ScoreWeights = Record<
  "marketSize" | "growth" | "sellerScarcity" | "productScarcity" | "lowConcentration" | "buyout" | "turnover" | "supplyDemand" | "lowSeasonality",
  number
>;

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  marketSize: 18,
  growth: 16,
  sellerScarcity: 12,
  productScarcity: 10,
  lowConcentration: 12,
  buyout: 12,
  turnover: 8,
  supplyDemand: 7,
  lowSeasonality: 5,
};

export const EMPTY_MARKET_DATASET: MarketDataset = {
  version: 1,
  categories: [],
  history: [],
  watchedIds: [],
  importedAt: "",
  sourceFile: "",
};
