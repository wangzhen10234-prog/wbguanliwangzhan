import { DEFAULT_SCORE_WEIGHTS, type MarketCategoryMetric, type ScoreWeights } from "./market-niche-types.ts";

type Factor = keyof ScoreWeights;

function percentile(value: number, values: number[], inverse = false) {
  if (values.length <= 1) return 50;
  const sorted = [...values].sort((a, b) => a - b);
  const below = sorted.filter((item) => item < value).length;
  const equal = sorted.filter((item) => item === value).length;
  const rank = (below + Math.max(0, equal - 1) / 2) / (sorted.length - 1);
  const result = Math.max(0, Math.min(100, rank * 100));
  return inverse ? 100 - result : result;
}

const FACTORS: Array<{ key: Factor; field: keyof MarketCategoryMetric; inverse?: boolean; label: string }> = [
  { key: "marketSize", field: "revenueRub", label: "市场规模" },
  { key: "growth", field: "revenueGrowth", label: "销售额增长" },
  { key: "sellerScarcity", field: "sellerCount", inverse: true, label: "卖家相对较少" },
  { key: "productScarcity", field: "productCount", inverse: true, label: "商品卡相对较少" },
  { key: "lowConcentration", field: "concentration", inverse: true, label: "市场集中度较低" },
  { key: "buyout", field: "buyoutRate", label: "购买率" },
  { key: "turnover", field: "turnoverDays", inverse: true, label: "库存周转" },
  { key: "supplyDemand", field: "supplyDemand", label: "供需表现" },
  { key: "lowSeasonality", field: "seasonality", inverse: true, label: "季节性风险较低" },
];

export function scoreMarketCategories(rows: MarketCategoryMetric[], weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS) {
  const fields = new Map<keyof MarketCategoryMetric, number[]>();
  for (const factor of FACTORS) {
    fields.set(factor.field, rows.map((row) => row[factor.field]).filter((value): value is number => typeof value === "number" && Number.isFinite(value)));
  }
  return rows.map((row) => {
    const available = FACTORS.flatMap((factor) => {
      const value = row[factor.field];
      if (typeof value !== "number" || !Number.isFinite(value)) return [];
      const values = fields.get(factor.field) || [];
      if (!values.length) return [];
      return [{ factor, value, normalized: percentile(value, values, factor.inverse) }];
    });
    if (available.length < 3) return { ...row, opportunityScore: null, opportunityReasons: ["可评分指标少于 3 项，暂不生成机会评分"] };
    const totalWeight = available.reduce((sum, item) => sum + Math.max(0, weights[item.factor.key] || 0), 0);
    const score = totalWeight ? available.reduce((sum, item) => sum + item.normalized * Math.max(0, weights[item.factor.key] || 0), 0) / totalWeight : 0;
    const reasons = available.sort((a, b) => b.normalized - a.normalized).slice(0, 4).map((item) => `${item.factor.label}处于当前筛选结果较优区间`);
    return { ...row, opportunityScore: Math.round(score), opportunityReasons: reasons };
  });
}
