"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppSidebar } from "../../_components/app-sidebar";
import type { MarketCategoryMetric } from "../../_lib/market-niche-types";

const FIELDS: Array<{ key: keyof MarketCategoryMetric; label: string; suffix?: string }> = [
  { key: "revenueRub", label: "销售额", suffix: " ₽" }, { key: "salesUnits", label: "销量" }, { key: "revenueGrowth", label: "销售额增长", suffix: "%" },
  { key: "sellerCount", label: "卖家数量" }, { key: "productCount", label: "商品卡数量" }, { key: "averagePriceRub", label: "平均价格", suffix: " ₽" },
  { key: "buyoutRate", label: "购买率", suffix: "%" }, { key: "turnoverDays", label: "库存周转", suffix: " 天" }, { key: "concentration", label: "市场集中度", suffix: "%" },
  { key: "opportunityScore", label: "机会评分" },
];
function valueLabel(value: unknown, suffix = "") { return typeof value === "number" ? `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value)}${suffix}` : "—"; }

export default function NicheComparePage() {
  const search = useSearchParams();
  const ids = useMemo(() => (search.get("ids") || "").split(",").map(decodeURIComponent).filter(Boolean).slice(0, 5), [search]);
  const period = Number(search.get("period") || 30);
  const [rows, setRows] = useState<MarketCategoryMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const response = await fetch(`/api/market/categories?period=${period}`, { cache: "no-store" }); const body = await response.json() as { rows?: MarketCategoryMetric[]; error?: string }; if (!response.ok) throw new Error(body.error || "读取失败"); setRows((body.rows || []).filter((row) => ids.includes(row.subjectId))); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "读取失败"); } finally { setLoading(false); }
  }, [ids, period]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  return <div className="app-shell"><AppSidebar active="niches" loading={loading} error={error} onRefresh={load}/><main className="workspace niche-workspace"><header className="topbar niche-topbar"><div><p className="eyebrow">CATEGORY COMPARISON</p><h1>品类对比</h1><p>最多横向比较 5 个全市场品类；空白表示数据源没有提供。</p></div><a className="niche-back-link" href="/niches">← 返回品类总览</a></header>{rows.length < 2 ? <section className="niche-empty-state"><strong>请选择至少两个已导入品类</strong><p>返回总览勾选品类后再进入对比。</p></section> : <section className="niche-compare-panel" data-horizontal-scroll><table><thead><tr><th>指标</th>{rows.map((row) => <th key={row.subjectId}><a href={`/market/category/${encodeURIComponent(row.subjectId)}?period=${period}`}>{row.nameZh || row.nameRu}<small>{row.nameRu} · {row.subjectId}</small></a></th>)}</tr></thead><tbody>{FIELDS.map((field) => <tr key={String(field.key)}><th>{field.label}</th>{rows.map((row) => <td key={row.subjectId}>{valueLabel(row[field.key], field.suffix)}</td>)}</tr>)}</tbody></table></section>}</main></div>;
}
