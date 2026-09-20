import { readMarketDataset } from "../../../_lib/market-niche-repository";
import { scoreMarketCategories } from "../../../_lib/market-niche-score";
import { PROVIDER_CAPABILITIES } from "../../../_lib/market-analytics-provider";

const HEADERS = { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const period = Math.max(7, Math.min(365, Number(url.searchParams.get("period") || 30)));
    const q = (url.searchParams.get("q") || "").trim().toLocaleLowerCase("ru-RU");
    const parent = (url.searchParams.get("parent") || "").trim();
    const level = Number(url.searchParams.get("level") || 0);
    const dataset = await readMarketDataset();
    const selected = dataset.categories.filter((item) => item.periodDays === period);
    const bySubject = new Map(selected.map((item) => [item.subjectId, item]));
    for (const item of dataset.categories.filter((row) => row.source === "WB_OFFICIAL")) {
      if (!bySubject.has(item.subjectId)) bySubject.set(item.subjectId, { ...item, id: `${item.id}:${period}`, periodDays: period });
    }
    const periodRows = scoreMarketCategories([...bySubject.values()]);
    const rows = periodRows
      .filter((item) => !q || `${item.nameZh} ${item.nameRu} ${item.subjectId}`.toLocaleLowerCase("ru-RU").includes(q))
      .filter((item) => !parent || item.parentId === parent || item.parentName === parent)
      .filter((item) => !level || item.level === level);
    const watchlist = periodRows.filter((item) => dataset.watchedIds.includes(item.subjectId)).map((current) => {
      const previous = dataset.history
        .filter((point) => point.subjectId === current.subjectId && point.periodDays === current.periodDays && point.metricDate < current.metricDate)
        .sort((a, b) => b.metricDate.localeCompare(a.metricDate))[0] || null;
      return { current, previous };
    });
    return json({
      rows,
      watchedIds: dataset.watchedIds,
      watchlist,
      importedAt: dataset.importedAt,
      sourceFile: dataset.sourceFile,
      availablePeriods: [...new Set(dataset.categories.map((item) => item.periodDays))].sort((a, b) => a - b),
      capabilities: PROVIDER_CAPABILITIES,
      sourceBoundary: {
        directlyAvailable: ["WB 官方 Content API 的类目、subject 层级与标识（系统自动同步）"],
        requiresExport: ["全市场销售额与销量", "卖家数与商品卡数", "购买率与库存周转", "市场集中度/垄断度", "历史趋势与季节性"],
        unavailable: ["全市场 TOP50 商品（当前公开 API 未提供）", "TOP 卖家明细（当前公开 API 未提供）", "价格分布（导入报表未包含时）"],
      },
    });
  } catch (error) {
    console.error("market categories failed", error);
    return json({ error: "全市场品类数据暂时无法读取" }, 500);
  }
}
