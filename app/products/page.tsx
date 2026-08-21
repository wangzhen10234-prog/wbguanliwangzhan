"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type ProductRow = {
  nmId: number;
  name: string;
  sku: string;
  category: string;
  brand: string;
  sales: number;
  orders: number;
  grossSalesUnits: number;
  returnsCount: number;
  units: number;
  netUnits: number;
  stock: number;
  returnRate: number;
  buyoutRate: number;
  averagePrice: number;
  dailyUnits: number;
  stockCoverDays: number | null;
  reviewsCount: number;
  periodReviewsCount: number;
  averageRating: number | null;
  positiveRate: number | null;
  status: "热销" | "稳定" | "缺货" | "高退货" | "低评分" | "滞销";
};

type ProductData = {
  source: string;
  syncedAt: string;
  period: { from: string; to: string; days: number };
  dataAvailability: { productCards: boolean; feedbacks: boolean; inventory: boolean };
  products: ProductRow[];
};

type SortKey = "sales" | "orders" | "netUnits" | "returnRate" | "averageRating" | "positiveRate" | "stock" | "stockCoverDays";

const DAY_MS = 86_400_000;
const PAGE_SIZE = 20;
const issueStatuses = new Set(["缺货", "高退货", "低评分", "滞销"]);

function toInputDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function shiftDate(dateString: string, days: number) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + days);
  return toInputDate(date);
}

function countDays(start: string, end: string) {
  return Math.round((new Date(`${end}T12:00:00`).getTime() - new Date(`${start}T12:00:00`).getTime()) / DAY_MS) + 1;
}

function formatRubles(value: number) {
  return `₽ ${Math.round(value || 0).toLocaleString("en-US")}`;
}

function formatDateTime(value?: string) {
  if (!value) return "正在首次同步";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatPercent(value: number | null) {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

function escapeCsv(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export default function ProductsPage() {
  const today = toInputDate(new Date());
  const earliest = shiftDate(today, -89);
  const [draftStart, setDraftStart] = useState(() => shiftDate(today, -29));
  const [draftEnd, setDraftEnd] = useState(today);
  const [periodStart, setPeriodStart] = useState(() => shiftDate(today, -29));
  const [periodEnd, setPeriodEnd] = useState(today);
  const [data, setData] = useState<ProductData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dateError, setDateError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("sales");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/wb/dashboard?from=${periodStart}&to=${periodEnd}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then(async (response) => {
        const body = (await response.json()) as ProductData | { error?: string };
        if (!response.ok) throw new Error("error" in body && body.error ? body.error : "同步失败，请稍后重试");
        return body as ProductData;
      })
      .then((body) => setData(body))
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") setError(reason.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [periodStart, periodEnd, reloadKey]);

  const summary = useMemo(() => {
    const products = data?.products ?? [];
    const reviews = products.reduce((sum, item) => sum + item.reviewsCount, 0);
    return {
      products: products.length,
      units: products.reduce((sum, item) => sum + item.netUnits, 0),
      returns: products.reduce((sum, item) => sum + item.returnsCount, 0),
      sales: products.reduce((sum, item) => sum + item.sales, 0),
      attention: products.filter((item) => issueStatuses.has(item.status)).length,
      positiveRate: reviews ? products.reduce((sum, item) => sum + (item.positiveRate ?? 0) * item.reviewsCount, 0) / reviews : null,
      reviews,
    };
  }, [data]);

  const filteredProducts = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const filtered = (data?.products ?? []).filter((item) => {
      const matchesQuery = !needle || [item.name, item.sku, item.category, item.brand, String(item.nmId)].some((value) => value.toLocaleLowerCase().includes(needle));
      const matchesStatus = statusFilter === "all" || (statusFilter === "attention" ? issueStatuses.has(item.status) : item.status === statusFilter);
      return matchesQuery && matchesStatus;
    });
    return [...filtered].sort((a, b) => {
      const aValue = a[sortKey] ?? -1;
      const bValue = b[sortKey] ?? -1;
      const difference = Number(aValue) - Number(bValue);
      return sortDirection === "desc" ? -difference : difference;
    });
  }, [data, query, statusFilter, sortKey, sortDirection]);

  const pageCount = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
  const visibleProducts = filteredProducts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function beginLoad() {
    setLoading(true);
    setError("");
    setPage(1);
  }

  function choosePreset(days: number) {
    const start = shiftDate(today, -(days - 1));
    beginLoad();
    setDraftStart(start);
    setDraftEnd(today);
    setPeriodStart(start);
    setPeriodEnd(today);
    setDateError("");
    setReloadKey((key) => key + 1);
  }

  function applyDates() {
    if (!draftStart || !draftEnd) return setDateError("请选择完整日期");
    if (draftStart > draftEnd) return setDateError("开始日期不能晚于结束日期");
    if (draftStart < earliest || countDays(draftStart, draftEnd) > 90) return setDateError("支持近 90 天内、最长 90 天的查询周期");
    beginLoad();
    setPeriodStart(draftStart);
    setPeriodEnd(draftEnd);
    setDateError("");
    setReloadKey((key) => key + 1);
  }

  function refresh() {
    beginLoad();
    setReloadKey((key) => key + 1);
  }

  function changeSort(key: SortKey) {
    setPage(1);
    if (sortKey === key) setSortDirection((direction) => direction === "desc" ? "asc" : "desc");
    else {
      setSortKey(key);
      setSortDirection("desc");
    }
  }

  function sortMark(key: SortKey) {
    return sortKey === key ? (sortDirection === "desc" ? " ↓" : " ↑") : "";
  }

  function exportCsv() {
    if (!filteredProducts.length) return;
    const header = ["商品名称", "SKU", "WB nmId", "类目", "品牌", "销售额", "订单数", "净销量", "退货件数", "退货率", "成交率", "平均售价", "平均评分", "评价数", "好评率", "库存", "可售天数", "状态"];
    const rows = filteredProducts.map((item) => [item.name, item.sku, item.nmId, item.category, item.brand, Math.round(item.sales), item.orders, item.netUnits, item.returnsCount, item.returnRate.toFixed(1), item.buyoutRate.toFixed(1), Math.round(item.averagePrice), item.averageRating?.toFixed(2) ?? "", item.reviewsCount, item.positiveRate?.toFixed(1) ?? "", item.stock, item.stockCoverDays?.toFixed(1) ?? "", item.status]);
    const csv = "\uFEFF" + [header, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `wb-product-analysis-${periodStart}-${periodEnd}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">W</span><div><strong>WB Insight</strong><small>俄罗斯店铺分析</small></div></div>
        <nav aria-label="主导航">
          <Link className="nav-item" href="/"><span>▦</span>经营总览</Link>
          <Link className="nav-item" href="/#sales"><span>↗</span>销售分析</Link>
          <Link className="nav-item active" href="/products"><span>◇</span>商品分析</Link>
          <Link className="nav-item" href="/#stock"><span>□</span>库存监控</Link>
          <Link className="nav-item" href="/#finance"><span>₽</span>回款与余额</Link>
        </nav>
        <div className="nav-section">当前分析</div>
        <div className="product-side-summary"><span>统计周期</span><b>{periodStart}</b><i>至</i><b>{periodEnd}</b><small>共 {countDays(periodStart, periodEnd)} 天</small></div>
        <div className="sidebar-foot">
          <div className={`sync-status ${error ? "error" : "connected"}`}><span className="status-dot" /><div><b>{error ? "同步异常" : "商品数据已连接"}</b><small>{error ? "请重新同步" : formatDateTime(data?.syncedAt)}</small></div></div>
          <button className="connect-btn" onClick={refresh}>{loading ? "同步中…" : "重新同步商品数据"}</button>
        </div>
      </aside>

      <section className="workspace product-workspace">
        <header className="topbar product-topbar">
          <div><p className="eyebrow">PRODUCT PERFORMANCE · 真实商品数据</p><h1>商品分析明细</h1></div>
          <div className="top-actions"><button className="export-button" onClick={exportCsv} disabled={!filteredProducts.length}>↓ 导出当前表格</button><div className="avatar">Z</div></div>
        </header>

        <section className="product-period-panel" aria-label="选择分析周期">
          <div className="period-presets"><span>快捷周期</span><button onClick={() => choosePreset(7)}>近 7 天</button><button className={countDays(periodStart, periodEnd) === 30 ? "active" : ""} onClick={() => choosePreset(30)}>近 30 天</button><button onClick={() => choosePreset(90)}>近 90 天</button></div>
          <div className="period-custom"><label><span>开始日期</span><input type="date" value={draftStart} min={earliest} max={today} onChange={(event) => { setDraftStart(event.target.value); setDateError(""); }} /></label><b>→</b><label><span>结束日期</span><input type="date" value={draftEnd} min={draftStart || earliest} max={today} onChange={(event) => { setDraftEnd(event.target.value); setDateError(""); }} /></label><button onClick={applyDates}>查询</button></div>
          {dateError && <p className="product-date-error" role="alert">{dateError}</p>}
        </section>

        <div className={`notice product-notice ${error ? "error" : "connected"}`}>
          <div className="notice-icon">{loading ? "↻" : error ? "!" : "✓"}</div>
          <div><strong>{loading ? "正在汇总每个商品的完整经营数据" : error ? "商品数据同步未完成" : "商品销售状态分析已更新"}</strong><p>{loading ? "正在计算销量、退货率、评价、好评率、库存和周转状态。" : error || `共 ${summary.products} 个商品；评价口径为全部已获取评价，销售与退货口径为当前所选周期。`}</p></div>
          {error && <button onClick={refresh}>重新同步</button>}
        </div>

        <section className="product-stat-grid" aria-label="商品分析汇总">
          <article><span>商品总数</span><strong>{loading && !data ? "—" : summary.products}</strong><small>全部在售商品卡片</small></article>
          <article><span>本期净销量</span><strong>{summary.units.toLocaleString("en-US")}</strong><small>销售 {summary.units + summary.returns} · 退货 {summary.returns}</small></article>
          <article><span>本期销售额</span><strong>{formatRubles(summary.sales)}</strong><small>{countDays(periodStart, periodEnd)} 天商品销售合计</small></article>
          <article><span>整体好评率</span><strong>{formatPercent(summary.positiveRate)}</strong><small>{summary.reviews} 条有效评价</small></article>
          <article className={summary.attention > 0 ? "attention" : ""}><span>需关注商品</span><strong>{summary.attention}</strong><small>缺货、高退货、低评分或滞销</small></article>
        </section>

        <section className="product-table-panel">
          <div className="product-table-toolbar">
            <div><h2>商品经营明细</h2><p>退货率＝退货 ÷（销售＋退货）；好评率＝4–5 星评价占比。点击列名可排序。</p></div>
            <div className="product-filters"><label className="product-search"><span>⌕</span><input type="search" value={query} placeholder="搜索商品、SKU、WB货号、类目" onChange={(event) => { setQuery(event.target.value); setPage(1); }} /></label><select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }} aria-label="按商品状态筛选"><option value="all">全部状态</option><option value="attention">只看需关注</option><option value="热销">热销</option><option value="稳定">稳定</option><option value="缺货">缺货</option><option value="高退货">高退货</option><option value="低评分">低评分</option><option value="滞销">滞销</option></select></div>
          </div>

          <div className="product-detail-table-wrap">
            <table className="product-detail-table">
              <thead><tr><th>商品</th><th><button onClick={() => changeSort("sales")}>销售额{sortMark("sales")}</button></th><th><button onClick={() => changeSort("orders")}>订单{sortMark("orders")}</button></th><th><button onClick={() => changeSort("netUnits")}>净销量{sortMark("netUnits")}</button></th><th><button onClick={() => changeSort("returnRate")}>退货率{sortMark("returnRate")}</button></th><th>成交率</th><th><button onClick={() => changeSort("averageRating")}>评分{sortMark("averageRating")}</button></th><th><button onClick={() => changeSort("positiveRate")}>好评率{sortMark("positiveRate")}</button></th><th><button onClick={() => changeSort("stock")}>库存{sortMark("stock")}</button></th><th><button onClick={() => changeSort("stockCoverDays")}>可售天数{sortMark("stockCoverDays")}</button></th><th>状态</th></tr></thead>
              <tbody>{visibleProducts.map((item, index) => <tr key={item.nmId}><td><div className={`product-thumb tone-${index % 4}`}>{item.category.slice(0, 1) || "W"}</div><div className="product-identity"><b>{item.name}</b><small>{item.sku} · WB {item.nmId}</small><em>{item.category} · {item.brand}</em></div></td><td><b>{formatRubles(item.sales)}</b><small>均价 {formatRubles(item.averagePrice)}</small></td><td><b>{item.orders}</b></td><td><b>{item.netUnits}</b><small>售出 {item.grossSalesUnits}</small></td><td><span className={item.returnRate >= 15 ? "value-bad" : item.returnRate <= 5 ? "value-good" : ""}>{item.returnRate.toFixed(1)}%</span><small>{item.returnsCount} 件退货</small></td><td><span>{item.buyoutRate.toFixed(1)}%</span></td><td><span className="rating-value">{item.averageRating === null ? "—" : `★ ${item.averageRating.toFixed(2)}`}</span><small>{item.reviewsCount} 条评价</small></td><td><span className={(item.positiveRate ?? 100) < 80 ? "value-bad" : "value-good"}>{formatPercent(item.positiveRate)}</span><small>本期新增 {item.periodReviewsCount}</small></td><td><b>{data?.dataAvailability.inventory ? item.stock : "—"}</b></td><td><span>{item.stockCoverDays === null ? "无销量" : `${item.stockCoverDays.toFixed(1)} 天`}</span><small>日均 {item.dailyUnits.toFixed(2)}</small></td><td><span className={`product-status status-${item.status}`}>{item.status}</span></td></tr>)}{!loading && visibleProducts.length === 0 && <tr className="empty-row"><td colSpan={11}>没有符合当前筛选条件的商品</td></tr>}</tbody>
            </table>
          </div>

          <footer className="product-table-footer"><span>共 {filteredProducts.length} 个商品 · 第 {Math.min(page, pageCount)} / {pageCount} 页</span><div><button onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}>← 上一页</button><button onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={page >= pageCount}>下一页 →</button></div></footer>
        </section>
      </section>
    </main>
  );
}
