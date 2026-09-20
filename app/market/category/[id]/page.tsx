"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { AppSidebar } from "../../../_components/app-sidebar";
import type { MarketCategoryMetric, MarketHistoryPoint } from "../../../_lib/market-niche-types";

type DetailData = { category: MarketCategoryMetric; history: MarketHistoryPoint[]; watched: boolean; products: unknown[]; sellers: unknown[]; priceDistribution: unknown[]; capabilities: { products: boolean; sellers: boolean; priceDistribution: boolean } };
const metric = (value: number | null | undefined, suffix = "") => typeof value === "number" ? `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value)}${suffix}` : "—";
const rub = (value: number | null | undefined) => typeof value === "number" ? `₽ ${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value)}` : "—";

export default function MarketCategoryPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const id = decodeURIComponent(String(params?.id || ""));
  const period = Number(search.get("period") || 30);
  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/market/category?id=${encodeURIComponent(id)}&period=${period}`, { cache: "no-store" });
      const body = await response.json() as DetailData & { error?: string };
      if (!response.ok) throw new Error(body.error || "品类详情读取失败");
      setData(body);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "品类详情读取失败"); }
    finally { setLoading(false); }
  }, [id, period]);
  useEffect(() => { if (id) queueMicrotask(() => void load()); }, [id, load]);
  const maxRevenue = useMemo(() => Math.max(1, ...(data?.history.map((item) => item.revenueRub || 0) || [1])), [data]);

  async function toggleWatch() {
    if (!data) return;
    const next = !data.watched;
    const response = await fetch("/api/market/category", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, watched: next }) });
    if (response.ok) setData({ ...data, watched: next });
  }

  const row = data?.category;
  return <div className="app-shell"><AppSidebar active="niches" syncedAt={row?.updatedAt} loading={loading} error={error} onRefresh={load} />
    <main className="workspace niche-workspace"><header className="topbar niche-topbar"><div><p className="eyebrow">MARKET CATEGORY · Анализ ниши</p><h1>{row?.nameZh || row?.nameRu || "品类详情"}</h1><p>{row ? `${row.nameRu} · WB Subject ${row.subjectId}` : "正在读取已导入的官方报表"}</p></div><div className="niche-detail-actions"><a href="/niches">← 返回全市场选品</a>{row && <button onClick={() => void toggleWatch()}>{data?.watched ? "★ 已加入观察" : "☆ 加入观察"}</button>}</div></header>
      {error ? <section className="niche-empty-state"><strong>无法显示该品类</strong><p>{error}</p><a href="/niches">返回导入或选择其他品类</a></section> : row && <>
        <section className="niche-detail-summary"><article><span>机会评分</span><b>{row.opportunityScore ?? "—"}</b><small>归一化筛选分</small></article><article><span>{period} 天销售额</span><b>{rub(row.revenueRub)}</b><small>{metric(row.revenueGrowth, "%")} 增长</small></article><article><span>销量</span><b>{metric(row.salesUnits)}</b><small>{metric(row.salesGrowth, "%")} 增长</small></article><article><span>卖家 / 商品卡</span><b>{metric(row.sellerCount)} / {metric(row.productCount)}</b><small>官方导出口径</small></article><article><span>购买率</span><b>{metric(row.buyoutRate, "%")}</b><small>平均价 {rub(row.averagePriceRub)}</small></article><article><span>库存周转</span><b>{metric(row.turnoverDays, " 天")}</b><small>平均库存 {metric(row.averageStock)}</small></article></section>
        <section className="niche-detail-grid"><article className="niche-detail-panel"><header><h2>销售趋势</h2><span>只绘制已保存的真实历史快照</span></header>{data.history.length > 1 ? <div className="niche-history-chart">{data.history.map((item) => <div key={`${item.metricDate}-${item.periodDays}`}><i style={{ height: `${Math.max(4, (item.revenueRub || 0) / maxRevenue * 100)}%` }} /><b>{rub(item.revenueRub)}</b><small>{item.metricDate.slice(5)}</small></div>)}</div> : <div className="niche-unsupported"><b>历史快照不足</b><p>继续导入不同日期的同周期官方报表后，系统才会生成趋势与季节性结论。</p></div>}</article>
          <article className="niche-detail-panel"><header><h2>评分说明</h2><span>不是盈利承诺或囤货建议</span></header><div className="niche-score-explanation">{row.opportunityReasons?.map((reason) => <p key={reason}>✓ {reason}</p>)}<small>不同量纲先在当前样本中转成百分位，再按可配置权重合成；缺失项不参与。</small></div></article></section>
        <section className="niche-detail-panel"><header><h2>价格分布</h2><span>0-500 / 500-1000 / 1000-1500 / 1500-3000 / 3000+ ₽</span></header><div className="niche-unsupported"><b>当前数据源暂不支持</b><p>导入报表未提供价格段的商品数、销量、销售额与购买率时，系统不会推算或补值。</p></div></section>
        <section className="niche-detail-grid"><article className="niche-detail-panel"><header><h2>TOP 50 商品</h2><span>商品级全市场数据</span></header><div className="niche-unsupported"><b>当前数据源暂不支持</b><p>WB 公开 API 未提供可验证的全市场商品排行榜；不会用本店商品代替。</p></div></article><article className="niche-detail-panel"><header><h2>TOP 卖家</h2><span>卖家市场份额</span></header><div className="niche-unsupported"><b>当前数据源暂不支持</b><p>只有取得合法且包含卖家明细的数据源后才会展示。</p></div></article></section>
        <section className="niche-detail-panel"><header><h2>季节性</h2><span>最近 12 个月</span></header><div className="niche-unsupported"><b>{data.history.length >= 12 ? "等待按月数据识别" : "真实历史数据不足"}</b><p>系统不会让 AI 猜测旺季；需要至少 12 个月连续官方快照。</p></div></section>
        <footer className="niche-data-foot">数据来源：WB_EXPORT · 可信度：OFFICIAL_EXPORT · 指标日期：{row.metricDate} · 系统更新时间：{row.updatedAt}</footer>
      </>}
    </main></div>;
}
