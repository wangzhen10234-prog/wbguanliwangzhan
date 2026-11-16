"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AppSidebar } from "../_components/app-sidebar";
import { formatMarketChange, type FunnelConversions, type FunnelMetrics, type MarketCategory, type MarketProduct } from "../_lib/market-analytics";

import { MARKET_MAX_DAYS, marketToday, marketShiftDate, marketPeriod, marketComparisonPeriod } from "../_lib/market-period";

type DailyPoint = FunnelMetrics & FunnelConversions & { date: string };
type MarketData = {
  syncedAt: string;
  period: { from: string; to: string; days: number };
  comparisonPeriod: { from: string; to: string; days: number; available: boolean };
  historyPeriod: { from: string; to: string } | null;
  currency: string;
  summary: FunnelMetrics & FunnelConversions & { products: number; stock: number };
  categories: MarketCategory[];
  products: MarketProduct[];
  daily: DailyPoint[];
  recommendations: Array<{ level: "high" | "medium" | "good"; title: string; detail: string }>;
  dataAvailability: { productFunnel: boolean; groupedHistory: boolean; groupedHistoryReason: string; brandShare: boolean; brandShareReason: string };
  brandShare: { brands: string[]; selectedBrand: string; parentSubjects: Array<{ parentId: number; parentName: string }>; selectedParentId: number; report: Array<{ applyDate: string; brandRating: number; pricePercent: number; qtyPercent: number }> };
};

function money(value: number, currency: string) { return `${currency === "CNY" ? "¥" : currency === "RUB" ? "₽" : currency + " "}${Math.round(value || 0).toLocaleString("en-US")}`; }
function percent(value: number) { return `${Number(value || 0).toFixed(1)}%`; }
function dynamicClass(value: number | null, current: number, previous?: number | null) {
  return previous === 0 ? current > 0 ? "up" : "" : value === null ? "" : value > 0 ? "up" : value < 0 ? "down" : "";
}

export default function MarketPage() {
  const today = marketToday();
  const [from, setFrom] = useState(marketShiftDate(today, -29));
  const [to, setTo] = useState(today);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const [custom, setCustom] = useState(false);
  const [rangeError, setRangeError] = useState("");
  const [data, setData] = useState<MarketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [brand, setBrand] = useState("");
  const [parentId, setParentId] = useState(0);
  const [subjectId, setSubjectId] = useState(0);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"openCount" | "orderCount" | "orderSum" | "orderFromOpenPercent" | "buyoutPercent">("orderSum");
  const manualRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ from, to });
    if (brand) params.set("brand", brand);
    if (parentId) params.set("parentId", String(parentId));
    if (manualRef.current) params.set("refresh", "manual");
    manualRef.current = false;
    setLoading(true); setError(""); setData(null);
    fetch(`/api/wb/market?${params.toString()}`, { cache: "no-store", signal: controller.signal, headers: { Accept: "application/json" } })
      .then(async (response) => { const body = await response.json() as MarketData | { error?: string }; if (!response.ok) throw new Error("error" in body && body.error ? body.error : "产品行情同步失败"); return body as MarketData; })
      .then((body) => { if (!controller.signal.aborted) setData(body); })
      .catch((reason: Error) => { if (!controller.signal.aborted) setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [from, to, brand, parentId, reloadKey]);

  const visibleProducts = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return [...(data?.products ?? [])].filter((item) => (!subjectId || item.subjectId === subjectId) && (!needle || [item.sku, item.title, item.subjectName, item.brand, String(item.nmId)].some((value) => value.toLocaleLowerCase().includes(needle))))
      .sort((a, b) => Number(b[sort] || 0) - Number(a[sort] || 0));
  }, [data, subjectId, query, sort]);

  const maxDaily = Math.max(1, ...(data?.daily ?? []).map((item) => item.openCount));
  const latestShare = data?.brandShare.report.at(-1);
  const comparison = data?.comparisonPeriod || marketComparisonPeriod({ from, days: Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1 });
  function applyRange(nextFrom: string, nextTo: string) {
    try {
      marketPeriod(nextFrom, nextTo, today);
      setRangeError(""); setError(""); setSubjectId(0); setDraftFrom(nextFrom); setDraftTo(nextTo);
      if (from === nextFrom && to === nextTo) { setReloadKey((value) => value + 1); return; }
      setLoading(true); setData(null); setFrom(nextFrom); setTo(nextTo);
    } catch (reason) { setRangeError(reason instanceof Error ? reason.message : "请选择有效日期"); }
  }
  function chooseDays(days: number) { setCustom(false); applyRange(marketShiftDate(today, -(days - 1)), today); }
  function refresh() { manualRef.current = true; setReloadKey((value) => value + 1); }

  return <main className="app-shell">
    <AppSidebar active="market" syncedAt={data?.syncedAt} loading={loading} error={error} onRefresh={refresh}>
      <div className="nav-section">行情口径</div>
      <div className="market-side-note"><b>官方店铺数据</b><span>销售漏斗 · 分类 · 单品</span><small>竞品真实销量不伪造</small></div>
    </AppSidebar>

    <section className="workspace market-workspace">
      <header className="topbar market-topbar">
        <div><p className="eyebrow">PRODUCT MARKET · 官方经营分析</p><h1>产品行情</h1><p className="market-lead">用店铺真实漏斗定位流量、转化、购买和取消问题；市场份额仅展示 WB 官方可核验口径。</p></div>
        <div className="top-actions"><span className="market-source-pill official">WB 官方 API</span><div className="avatar">Z</div></div>
      </header>

      <section className="market-filter-panel">
        <div><b>分析周期</b><small>单次查询 1–{MARKET_MAX_DAYS} 天；日期按 WB 销售漏斗报表口径，日趋势仅支持最近 7 天</small></div>
        <div className="market-presets">{[7, 30, 90].map((days) => <button type="button" className={!custom && to === today && from === marketShiftDate(today, -(days - 1)) ? "active" : ""} key={days} onClick={() => chooseDays(days)}>近 {days} 天</button>)}<button type="button" className={custom ? "active" : ""} aria-expanded={custom} aria-controls="market-custom-dates" onClick={() => { setCustom((value) => !value); setRangeError(""); }}>自定义时间</button></div>
        <span>当前查询：{from} → {to}</span>
        {custom && <form className="market-custom-dates" id="market-custom-dates" onSubmit={(event) => { event.preventDefault(); applyRange(draftFrom, draftTo); }}><label>开始日期<input type="date" aria-label="开始日期" required min={marketShiftDate(today, -365)} max={draftTo || today} value={draftFrom} onChange={(event) => { setDraftFrom(event.target.value); setRangeError(""); }} /></label><span>至</span><label>结束日期<input type="date" aria-label="结束日期" required min={draftFrom || marketShiftDate(today, -365)} max={today} value={draftTo} onChange={(event) => { setDraftTo(event.target.value); setRangeError(""); }} /></label><button type="submit">查询</button><small>包含开始和结束当天，单次最多 {MARKET_MAX_DAYS} 天；点击查询后生效。</small>{rangeError && <p role="alert">{rangeError}</p>}</form>}
      </section>
      <section className="market-comparison-note"><b>本期：{from} ～ {to}</b><span>{comparison.available ? `环比对比期：${comparison.from} ～ ${comparison.to}（同为 ${comparison.days} 天）` : "上一完整周期超出 WB 近一年数据范围，本期不显示环比"}</span><small>环比 =（本期数值 − 上期数值）÷ 上期数值 × 100%，采用 WB 官方返回值；上期为 0 时显示“新增”或“持平”。包含今天时，本期数据尚未完整。</small></section>

      <div className={`notice market-notice ${error ? "error" : "connected"}`}><div className="notice-icon">{loading ? "↻" : error ? "!" : "✓"}</div><div><strong>{loading ? "正在读取 WB 店铺销售漏斗" : error ? "产品行情同步未完成" : "官方店铺经营数据已更新"}</strong><p>{loading ? "正在汇总浏览、加购、订单、购买、取消、收藏和分类表现。" : error || `本期 ${data?.summary.products ?? 0} 个商品；金额币种按 WB 返回的 ${data?.currency ?? "—"} 显示。`}</p></div>{error && <button onClick={refresh}>重新同步</button>}</div>

      <section className="market-metric-grid" aria-label="店铺销售漏斗统计">
        <article><span>浏览量</span><b>{data?.summary.openCount.toLocaleString() ?? "—"}</b><small>打开商品卡次数</small></article>
        <article><span>加购量</span><b>{data?.summary.cartCount.toLocaleString() ?? "—"}</b><small>进卡→加购 {percent(data?.summary.addToCartPercent ?? 0)}</small></article>
        <article><span>订单量</span><b>{data?.summary.orderCount.toLocaleString() ?? "—"}</b><small>整体下单转化 {percent(data?.summary.orderFromOpenPercent ?? 0)}</small></article>
        <article className="money"><span>订单金额</span><b>{data ? money(data.summary.orderSum, data.currency) : "—"}</b><small>WB 漏斗订单额</small></article>
        <article className="good"><span>购买量</span><b>{data?.summary.buyoutCount.toLocaleString() ?? "—"}</b><small>购买完成率 {percent(data?.summary.buyoutPercent ?? 0)}</small></article>
        <article className="good"><span>购买金额</span><b>{data ? money(data.summary.buyoutSum, data.currency) : "—"}</b><small>归因到下单日期</small></article>
        <article className="bad"><span>取消量</span><b>{data?.summary.cancelCount.toLocaleString() ?? "—"}</b><small>需结合退货原因复核</small></article>
        <article className="bad"><span>取消金额</span><b>{data ? money(data.summary.cancelSum, data.currency) : "—"}</b><small>WB 漏斗取消额</small></article>
        <article><span>转化率</span><b>{percent(data?.summary.orderFromOpenPercent ?? 0)}</b><small>浏览→下单；加购→下单 {percent(data?.summary.cartToOrderPercent ?? 0)}</small></article>
        <article><span>收藏量</span><b>{data?.summary.addToWishlist.toLocaleString() ?? "—"}</b><small>加入愿望清单</small></article>
      </section>

      <section className="market-dashboard-grid">
        <article className="market-panel market-funnel-panel"><header><div><h2>店铺转化漏斗</h2><p>同一周期、同一店铺的 WB 官方商品卡统计</p></div><span className="market-source-pill official">官方</span></header><div className="market-funnel"><div style={{ width: "100%" }}><span>浏览</span><b>{data?.summary.openCount.toLocaleString() ?? "—"}</b></div><i>↓ {percent(data?.summary.addToCartPercent ?? 0)}</i><div style={{ width: "82%" }}><span>加购</span><b>{data?.summary.cartCount.toLocaleString() ?? "—"}</b></div><i>↓ {percent(data?.summary.cartToOrderPercent ?? 0)}</i><div style={{ width: "64%" }}><span>下单</span><b>{data?.summary.orderCount.toLocaleString() ?? "—"}</b></div><i>↓ {percent(data?.summary.buyoutPercent ?? 0)}</i><div className="last" style={{ width: "48%" }}><span>购买</span><b>{data?.summary.buyoutCount.toLocaleString() ?? "—"}</b></div></div></article>
        <article className="market-panel market-daily-panel"><header><div><h2>所选周期内的最近 7 天趋势</h2><p>{data?.dataAvailability.groupedHistory ? ` ${data.historyPeriod?.from} ～ ${data.historyPeriod?.to} · WB 官方约每 2 小时更新` : data?.dataAvailability.groupedHistoryReason || "等待数据"}</p></div><span className={`market-source-pill ${data?.dataAvailability.groupedHistory ? "official" : "limited"}`}>{data?.dataAvailability.groupedHistory ? "官方" : "受限"}</span></header><div className="market-daily-chart">{(data?.daily ?? []).map((item) => <div key={item.date}><b title={`浏览 ${item.openCount} · 加购 ${item.cartCount} · 订单 ${item.orderCount}`} style={{ height: `${Math.max(8, item.openCount / maxDaily * 100)}%` }}><i style={{ height: `${Math.max(4, item.orderCount / Math.max(1, item.openCount) * 100)}%` }} /></b><span>{item.date.slice(5)}</span><small>{item.orderCount} 单</small></div>)}{!loading && !(data?.daily.length) && <p>暂无每日走势</p>}</div></article>
        <article className="market-panel market-advice-panel"><header><div><h2>问题诊断</h2><p>基于当前漏斗的规则分析，不冒充 WB 官方建议</p></div><span className="market-source-pill estimated">系统分析</span></header><div className="market-advice-list">{(data?.recommendations ?? []).map((item) => <div className={item.level} key={item.title}><span>{item.level === "high" ? "优先" : item.level === "medium" ? "关注" : "稳定"}</span><div><b>{item.title}</b><p>{item.detail}</p></div></div>)}</div></article>
      </section>

      <section className="market-panel market-category-panel"><header><div><h2>分类经营对比</h2><p>按 WB 商品分类聚合，点击一行可筛选下方单品</p></div><span className="market-source-pill official">店铺官方数据</span></header><div className="market-table-wrap"><table className="market-table"><thead><tr><th>产品分类</th><th>商品</th><th>浏览</th><th>加购</th><th>订单</th><th>订单金额</th><th>浏览→下单</th><th>购买完成率</th><th>取消</th><th>收藏</th><th>库存</th></tr></thead><tbody>{(data?.categories ?? []).map((item) => <tr className={subjectId === item.subjectId ? "selected" : ""} key={item.subjectId} onClick={() => setSubjectId(subjectId === item.subjectId ? 0 : item.subjectId)}><td><b>{item.subjectName}</b><small>WB 分类 ID {item.subjectId || "—"}</small></td><td>{item.products}</td><td>{item.openCount}</td><td>{item.cartCount}</td><td>{item.orderCount}</td><td><b>{money(item.orderSum, data?.currency ?? "RUB")}</b></td><td><span className={item.orderFromOpenPercent < 2 ? "value-bad" : "value-good"}>{percent(item.orderFromOpenPercent)}</span></td><td>{percent(item.buyoutPercent)}</td><td>{item.cancelCount}</td><td>{item.addToWishlist}</td><td>{item.stock}</td></tr>)}{!loading && !(data?.categories.length) && <tr className="empty-row"><td colSpan={11}>当前周期没有分类漏斗数据</td></tr>}</tbody></table></div></section>

      <section className="market-panel market-product-panel"><header><div><h2>{subjectId ? `${data?.categories.find((item) => item.subjectId === subjectId)?.subjectName ?? "分类"} · 单品排行` : "单品行情排行"}</h2><p>{comparison.available ? `环比对比 ${comparison.from} ～ ${comparison.to}；同天数、紧邻上一周期。` : "上一完整周期超出接口数据范围，环比显示无对比。"}</p></div><div className="market-product-tools"><label><span>⌕</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 SKU、标题、WB 货号" /></label><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="orderSum">按订单金额</option><option value="openCount">按浏览量</option><option value="orderCount">按订单量</option><option value="orderFromOpenPercent">按下单转化</option><option value="buyoutPercent">按购买完成率</option></select>{subjectId > 0 && <button onClick={() => setSubjectId(0)}>清除分类</button>}</div></header><div className="market-table-wrap"><table className="market-table market-product-table"><thead><tr><th>商品</th><th>浏览 / 环比</th><th>加购 / 环比</th><th>订单 / 环比</th><th>订单金额 / 环比</th><th>下单转化</th><th>购买</th><th>取消</th><th>收藏</th><th>评分</th><th>库存</th></tr></thead><tbody>{visibleProducts.map((item) => <tr key={item.nmId}><td><b>{item.sku}</b><small>{item.title}</small><em>WB {item.nmId} · {item.subjectName}</em></td><td><b>{item.openCount}</b><small className={dynamicClass(item.openDynamic, item.openCount, item.past?.openCount)}>{formatMarketChange(item.openDynamic, item.openCount, item.past?.openCount)}</small></td><td><b>{item.cartCount}</b><small className={dynamicClass(item.cartDynamic, item.cartCount, item.past?.cartCount)}>{formatMarketChange(item.cartDynamic, item.cartCount, item.past?.cartCount)}</small></td><td><b>{item.orderCount}</b><small className={dynamicClass(item.orderDynamic, item.orderCount, item.past?.orderCount)}>{formatMarketChange(item.orderDynamic, item.orderCount, item.past?.orderCount)}</small></td><td><b>{money(item.orderSum, data?.currency ?? "RUB")}</b><small className={dynamicClass(item.orderSumDynamic, item.orderSum, item.past?.orderSum)}>{formatMarketChange(item.orderSumDynamic, item.orderSum, item.past?.orderSum)}</small></td><td>{percent(item.orderFromOpenPercent)}<small>加购→下单 {percent(item.cartToOrderPercent)}</small></td><td>{item.buyoutCount}<small>{money(item.buyoutSum, data?.currency ?? "RUB")}</small></td><td>{item.cancelCount}<small>{money(item.cancelSum, data?.currency ?? "RUB")}</small></td><td>{item.addToWishlist}</td><td>★ {item.feedbackRating.toFixed(2)}<small>商品分 {item.productRating.toFixed(1)}</small></td><td>{item.stock}</td></tr>)}{!loading && !visibleProducts.length && <tr className="empty-row"><td colSpan={11}>没有符合当前筛选条件的商品</td></tr>}</tbody></table></div><footer>显示 {visibleProducts.length} 个商品 · 数据来源：WB 销售漏斗 API</footer></section>

      <section className="market-panel market-share-panel"><header><div><h2>官方品牌市场份额</h2><p>WB 品牌销售份额接口；只有近 90 天有销量且已登记品牌时可查询</p></div><span className={`market-source-pill ${data?.dataAvailability.brandShare ? "official" : "limited"}`}>{data?.dataAvailability.brandShare ? "WB 官方份额" : "暂不可用"}</span></header><div className="market-share-controls"><label><span>品牌</span><select value={brand} onChange={(event) => { setBrand(event.target.value); setParentId(0); }}><option value="">选择品牌</option>{(data?.brandShare.brands ?? []).map((item) => <option value={item} key={item}>{item}</option>)}</select></label><label><span>一级分类</span><select value={parentId} disabled={!brand || !(data?.brandShare.parentSubjects.length)} onChange={(event) => setParentId(Number(event.target.value))}><option value="0">选择分类</option>{(data?.brandShare.parentSubjects ?? []).map((item) => <option value={item.parentId} key={item.parentId}>{item.parentName}</option>)}</select></label></div>{latestShare ? <div className="market-share-result"><article><span>品牌销量份额</span><b>{percent(latestShare.qtyPercent)}</b><small>{latestShare.applyDate}</small></article><article><span>品牌销售额份额</span><b>{percent(latestShare.pricePercent)}</b><small>WB 官方口径</small></article><article><span>品牌排名</span><b>第 {latestShare.brandRating} 名</b><small>所选一级分类</small></article><div>{data?.brandShare.report.map((item) => <i key={item.applyDate} title={`${item.applyDate} · 销量份额 ${item.qtyPercent}%`} style={{ height: `${Math.max(6, Math.min(100, item.qtyPercent))}%` }} />)}</div></div> : <div className="market-share-empty"><b>当前没有可展示的品牌份额</b><p>{data?.dataAvailability.brandShareReason || "请选择品牌与分类"}</p></div>}</section>

      <section className="market-boundary"><b>数据边界</b><p><span className="market-source-pill official">WB 官方 API</span> 浏览、加购、订单、购买、取消、收藏、金额、库存与品牌份额。</p><p><span className="market-source-pill estimated">系统分析</span> 问题提示和行动建议由上述数据按规则计算。</p><p><span className="market-source-pill limited">不提供</span> WB 没有向卖家开放竞品真实销量，因此系统不会把前台热度、评价数或排名伪装成竞品销量。</p></section>
    </section>
  </main>;
}
