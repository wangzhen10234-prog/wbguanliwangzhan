"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AppSidebar } from "../_components/app-sidebar";

type ProductRow = {
  nmId: number;
  name: string;
  sku: string;
  category: string;
  brand: string;
  image: string | null;
  sales: number;
  orders: number;
  grossSalesUnits: number;
  returnsCount: number;
  pendingCount: number;
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
  periodAverageRating: number | null;
  periodPositiveRate: number | null;
  status: "热销" | "稳定" | "缺货" | "高退货" | "低评分" | "滞销";
};

type ProductData = {
  source: string;
  syncedAt: string;
  syncSchedule: { timezone: string; hours: number[]; currentSlot: string; nextAt: string; mode: "manual" | "scheduled" };
  period: { from: string; to: string; days: number };
  currency: "RUB" | "CNY";
  selectedWarehouse: string | null;
  warehouses: Array<{ name: string; orders: number; returns: number; stock: number }>;
  dataAvailability: { productCards: boolean; feedbacks: boolean; inventory: boolean; orderDetails: boolean };
  products: ProductRow[];
  orderSummary: { orders: number; success: number; abnormal: number; pending: number; orderAmount: number; salesAmount: number; abnormalRate: number };
  orderDetails: Array<{
    id: string;
    orderNumber: string;
    nmId: number;
    article: string;
    createdAt: string;
    warehouseName: string;
    amount: number;
    currency: "CNY";
    supplierStatus: string;
    wbStatus: string;
    outcome: "success" | "abnormal" | "pending";
    statusLabel: string;
  }>;
};

type SortKey = "sales" | "orders" | "netUnits" | "returnRate" | "periodAverageRating" | "periodPositiveRate" | "stock" | "stockCoverDays";

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

function formatMoney(value: number, currency: "RUB" | "CNY" = "RUB") {
  const symbol = currency === "CNY" ? "¥" : "₽";
  return `${symbol} ${Math.round(value || 0).toLocaleString("en-US")}`;
}

function formatPercent(value: number | null) {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

function escapeCsv(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function normalizeProductCode(value: string) {
  return value.toLocaleLowerCase().replace(/[\s_-]+/g, "");
}

export default function ProductsPage() {
  const today = toInputDate(new Date());
  const earliest = shiftDate(today, -179);
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
  const [warehouse, setWarehouse] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [productKeyword, setProductKeyword] = useState("");
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [activeProductIndex, setActiveProductIndex] = useState(0);
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("sales");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const productPickerRef = useRef<HTMLDivElement>(null);
  const forceRefreshRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ from: periodStart, to: periodEnd, view: "products" });
    if (warehouse) params.set("warehouse", warehouse);
    params.set("includeOrders", "true");
    if (forceRefreshRef.current) params.set("refresh", "manual");
    forceRefreshRef.current = false;
    fetch(`/api/wb/dashboard?${params.toString()}`, {
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
  }, [periodStart, periodEnd, warehouse, reloadKey]);

  useEffect(() => {
    const nextAt = data?.syncSchedule?.nextAt;
    if (!nextAt) return;
    const delay = Math.max(1_000, new Date(nextAt).getTime() - Date.now() + 1_500);
    const timer = window.setTimeout(() => {
      if (window.localStorage.getItem("wb-last-auto-sync") === nextAt) {
        window.setTimeout(() => { setLoading(true); setReloadKey((key) => key + 1); }, 12_000);
        return;
      }
      window.localStorage.setItem("wb-last-auto-sync", nextAt);
      setLoading(true);
      setReloadKey((key) => key + 1);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [data?.syncSchedule?.nextAt]);

  useEffect(() => {
    function closeProductPicker(event: PointerEvent) {
      if (!productPickerRef.current?.contains(event.target as Node)) setProductPickerOpen(false);
    }
    document.addEventListener("pointerdown", closeProductPicker);
    return () => document.removeEventListener("pointerdown", closeProductPicker);
  }, []);

  const scopedProducts = useMemo(() => {
    const products = data?.products ?? [];
    if (!selectedProductId) return products;
    return products.filter((item) => String(item.nmId) === selectedProductId);
  }, [data, selectedProductId]);

  const selectedProduct = useMemo(
    () => (data?.products ?? []).find((item) => String(item.nmId) === selectedProductId) ?? null,
    [data, selectedProductId],
  );

  const productPickerOptions = useMemo(() => {
    const needle = normalizeProductCode(productKeyword);
    const products = [...(data?.products ?? [])].sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true, sensitivity: "base" }));
    return needle ? products.filter((item) => normalizeProductCode(item.sku).includes(needle)) : products;
  }, [data, productKeyword]);

  const summary = useMemo(() => {
    const products = scopedProducts;
    const reviews = products.reduce((sum, item) => sum + item.periodReviewsCount, 0);
    const success = products.reduce((sum, item) => sum + item.netUnits, 0);
    const abnormal = products.reduce((sum, item) => sum + item.returnsCount, 0);
    const completed = success + abnormal;
    return {
      products: products.length,
      units: success,
      returns: abnormal,
      pending: products.reduce((sum, item) => sum + item.pendingCount, 0),
      orders: products.reduce((sum, item) => sum + item.orders, 0),
      abnormalRate: completed ? (abnormal / completed) * 100 : 0,
      sales: products.reduce((sum, item) => sum + item.sales, 0),
      attention: products.filter((item) => issueStatuses.has(item.status)).length,
      positiveRate: reviews ? products.reduce((sum, item) => sum + (item.periodPositiveRate ?? 0) * item.periodReviewsCount, 0) / reviews : null,
      reviews,
    };
  }, [scopedProducts]);

  const filteredProducts = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const filtered = scopedProducts.filter((item) => {
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
  }, [scopedProducts, query, statusFilter, sortKey, sortDirection]);

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
    if (draftStart < earliest || countDays(draftStart, draftEnd) > 180) return setDateError("支持近 180 天内、最长 180 天的查询周期");
    beginLoad();
    setPeriodStart(draftStart);
    setPeriodEnd(draftEnd);
    setDateError("");
    setReloadKey((key) => key + 1);
  }

  function refresh() {
    forceRefreshRef.current = true;
    beginLoad();
    setReloadKey((key) => key + 1);
  }

  function changeWarehouse(value: string) {
    beginLoad();
    setWarehouse(value);
    setSelectedProductId("");
    setProductKeyword("");
    setProductPickerOpen(false);
  }

  function changeProduct(value: string) {
    setSelectedProductId(value);
    setProductKeyword((data?.products ?? []).find((item) => String(item.nmId) === value)?.sku ?? "");
    setProductPickerOpen(false);
    setQuery("");
    setStatusFilter("all");
    setPage(1);
  }

  function searchProduct(value: string) {
    setProductKeyword(value);
    setProductPickerOpen(true);
    setActiveProductIndex(0);
    if (selectedProductId) {
      setSelectedProductId("");
      setQuery("");
      setStatusFilter("all");
      setPage(1);
    }
  }

  function handleProductPickerKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setProductPickerOpen(true);
      setActiveProductIndex((index) => Math.min(index + 1, Math.max(0, productPickerOptions.length - 1)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setProductPickerOpen(true);
      setActiveProductIndex((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter" && productPickerOpen && productPickerOptions[activeProductIndex]) {
      event.preventDefault();
      changeProduct(String(productPickerOptions[activeProductIndex].nmId));
    } else if (event.key === "Escape") {
      setProductPickerOpen(false);
    }
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
    const header = ["商品名称", "SKU", "WB nmId", "类目", "品牌", `销售额(${data?.currency ?? "RUB"})`, "订单数", "正常签收", "非正常签收", "待签收", "异常退货率", "正常签收率", "平均售价", "本期平均评分", "本期评价数", "本期好评率", "累计平均评分", "累计评价数", "累计好评率", "库存", "可售天数", "状态"];
    const rows = filteredProducts.map((item) => [item.name, item.sku, item.nmId, item.category, item.brand, Math.round(item.sales), item.orders, item.netUnits, item.returnsCount, item.pendingCount, item.returnRate.toFixed(1), item.buyoutRate.toFixed(1), Math.round(item.averagePrice), item.periodAverageRating?.toFixed(2) ?? "", item.periodReviewsCount, item.periodPositiveRate?.toFixed(1) ?? "", item.averageRating?.toFixed(2) ?? "", item.reviewsCount, item.positiveRate?.toFixed(1) ?? "", item.stock, item.stockCoverDays?.toFixed(1) ?? "", item.status]);
    const csv = "\uFEFF" + [header, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `wb-product-analysis-${periodStart}-${periodEnd}-${selectedProductId || "all-products"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="app-shell">
      <AppSidebar active="products" syncedAt={data?.syncedAt} nextSyncAt={data?.syncSchedule?.nextAt} loading={loading} error={error} onRefresh={refresh}>
        <div className="nav-section">当前分析</div>
        <div className="product-side-summary"><span>统计周期</span><b>{periodStart}</b><i>至</i><b>{periodEnd}</b><small>共 {countDays(periodStart, periodEnd)} 天</small></div>
        <div className="product-side-summary scope"><span>分析范围</span><b>{warehouse || "全部仓库"}</b><small>{selectedProduct ? `单品：${selectedProduct.sku}` : "全部商品"}</small></div>
      </AppSidebar>

      <section className="workspace product-workspace">
        <header className="topbar product-topbar">
          <div><p className="eyebrow">PRODUCT PERFORMANCE · 真实商品数据</p><h1>综合商品分析</h1></div>
          <div className="top-actions"><button className="export-button" onClick={exportCsv} disabled={!filteredProducts.length}>↓ 导出当前表格</button><div className="avatar">Z</div></div>
        </header>

        <section className="product-period-panel" aria-label="选择分析周期">
          <div className="product-period-heading"><strong>时间筛选</strong><small>表格全部指标按所选周期重新计算</small></div>
          <div className="period-presets"><span>快捷周期</span><button disabled={loading} className={countDays(periodStart, periodEnd) === 7 ? "active" : ""} onClick={() => choosePreset(7)}>近 7 天</button><button disabled={loading} className={countDays(periodStart, periodEnd) === 30 ? "active" : ""} onClick={() => choosePreset(30)}>近 30 天</button><button disabled={loading} className={countDays(periodStart, periodEnd) === 90 ? "active" : ""} onClick={() => choosePreset(90)}>近 90 天</button><button disabled={loading} className={countDays(periodStart, periodEnd) === 180 ? "active" : ""} onClick={() => choosePreset(180)}>近 180 天</button></div>
          <div className="period-custom"><label><span>开始日期</span><input disabled={loading} type="date" value={draftStart} min={earliest} max={today} onChange={(event) => { setDraftStart(event.target.value); setDateError(""); }} /></label><b>→</b><label><span>结束日期</span><input disabled={loading} type="date" value={draftEnd} min={draftStart || earliest} max={today} onChange={(event) => { setDraftEnd(event.target.value); setDateError(""); }} /></label><button disabled={loading} onClick={applyDates}>{loading ? "计算中…" : "查询"}</button></div>
          {dateError && <p className="product-date-error" role="alert">{dateError}</p>}
        </section>

        <section className="product-scope-panel" aria-label="选择仓库和商品">
          <div className="product-scope-heading"><strong>分析范围</strong><small>先选仓库，再选择是否只看一个商品</small></div>
          <label><span>WB 仓库</span><select disabled={loading} value={warehouse} onChange={(event) => changeWarehouse(event.target.value)}><option value="">全部仓库</option>{(data?.warehouses ?? []).map((item) => <option key={item.name} value={item.name}>{item.name} · {item.orders} 单 · 库存 {item.stock}</option>)}</select></label>
          <div className="product-picker product-combobox" ref={productPickerRef}>
            <span className="scope-field-label">具体商品（卖家商品编号）</span>
            <div className={`product-combobox-control ${productPickerOpen ? "open" : ""}`}>
              <span aria-hidden="true">⌕</span>
              <input
                aria-autocomplete="list"
                aria-controls="seller-product-code-options"
                aria-expanded={productPickerOpen}
                autoComplete="off"
                disabled={loading}
                placeholder="输入卖家商品编号，支持模糊搜索"
                role="combobox"
                value={productKeyword}
                onChange={(event) => searchProduct(event.target.value)}
                onFocus={() => { setProductPickerOpen(true); setActiveProductIndex(0); }}
                onKeyDown={handleProductPickerKeyDown}
              />
              {(productKeyword || selectedProductId) && <button type="button" aria-label="清空具体商品" onClick={() => changeProduct("")}>×</button>}
            </div>
            {productPickerOpen && !loading && (
              <div className="product-code-options" id="seller-product-code-options" role="listbox">
                {productPickerOptions.length ? productPickerOptions.map((item, index) => (
                  <button
                    className={index === activeProductIndex ? "active" : ""}
                    key={item.nmId}
                    role="option"
                    tabIndex={-1}
                    type="button"
                    aria-selected={String(item.nmId) === selectedProductId}
                    onMouseEnter={() => setActiveProductIndex(index)}
                    onClick={() => changeProduct(String(item.nmId))}
                  >{item.sku}</button>
                )) : <p>没有匹配的卖家商品编号</p>}
              </div>
            )}
          </div>
          {selectedProduct && <button className="clear-product-button" onClick={() => changeProduct("")}>退出单品模式</button>}
          <p>库存为当前可售库存，不随时间周期回溯，运输途中不计入；评价按商品统计，不区分仓库。</p>
        </section>

        <div className={`notice product-notice ${error ? "error" : "connected"}`}>
          <div className="notice-icon">{loading ? "↻" : error ? "!" : "✓"}</div>
          <div><strong>{loading ? "正在汇总订单状态和经营数据" : error ? "商品数据同步未完成" : selectedProduct ? `正在查看单品：${selectedProduct.name}` : "商品销售状态分析已更新"}</strong><p>{loading ? "正在读取每笔订单的签收、取消、拒收、瑕疵和配送状态。" : error || `${warehouse || "全部仓库"} · ${summary.orders} 笔订单；所有非正常签收均已计入异常退货率。`}</p></div>
          {error && <button onClick={refresh}>重新同步</button>}
        </div>

        <section className="product-stat-grid" aria-label="商品分析汇总">
          <article><span>{selectedProduct ? "当前商品" : "商品总数"}</span><strong>{loading && !data ? "—" : summary.products}</strong><small>{selectedProduct ? selectedProduct.sku : "全部在售商品卡片"}</small></article>
          <article><span>全部订单</span><strong>{summary.orders.toLocaleString("en-US")}</strong><small>待签收 {summary.pending} 笔</small></article>
          <article><span>正常签收</span><strong>{summary.units.toLocaleString("en-US")}</strong><small>已由买家正常收货</small></article>
          <article className={summary.returns > 0 ? "attention" : ""}><span>非正常签收率</span><strong>{summary.abnormalRate.toFixed(1)}%</strong><small>{summary.returns} 笔取消、拒收、退回或瑕疵</small></article>
          <article><span>本期销售额</span><strong>{formatMoney(summary.sales, data?.currency)}</strong><small>{countDays(periodStart, periodEnd)} 天 · {data?.currency === "CNY" ? "店铺结算币" : "俄罗斯卢布"}</small></article>
        </section>

        <section className="product-table-panel">
          <div className="product-table-toolbar">
            <div><h2>{selectedProduct ? "单品经营明细" : "商品经营明细"}</h2><p>{warehouse || "全部仓库"} · {periodStart} 至 {periodEnd} · 异常退货率＝非正常签收 ÷（正常签收＋非正常签收）。</p></div>
            <div className="product-filters"><label className="product-search"><span>⌕</span><input type="search" value={query} placeholder="搜索商品、SKU、WB货号、类目" onChange={(event) => { setQuery(event.target.value); setPage(1); }} /></label><select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }} aria-label="按商品状态筛选"><option value="all">全部状态</option><option value="attention">只看需关注</option><option value="热销">热销</option><option value="稳定">稳定</option><option value="缺货">缺货</option><option value="高退货">高退货</option><option value="低评分">低评分</option><option value="滞销">滞销</option></select></div>
          </div>

          <div className="product-detail-table-wrap">
            <table className="product-detail-table">
              <thead><tr><th>商品</th><th><button onClick={() => changeSort("sales")}>销售额{sortMark("sales")}</button></th><th><button onClick={() => changeSort("orders")}>订单{sortMark("orders")}</button></th><th><button onClick={() => changeSort("netUnits")}>正常签收{sortMark("netUnits")}</button></th><th><button onClick={() => changeSort("returnRate")}>异常退货率{sortMark("returnRate")}</button></th><th>待签收</th><th>正常签收率</th><th><button onClick={() => changeSort("periodAverageRating")}>本期评分{sortMark("periodAverageRating")}</button></th><th><button onClick={() => changeSort("periodPositiveRate")}>本期好评率{sortMark("periodPositiveRate")}</button></th><th><button onClick={() => changeSort("stock")}>当前库存{sortMark("stock")}</button></th><th><button onClick={() => changeSort("stockCoverDays")}>可售天数{sortMark("stockCoverDays")}</button></th><th>状态</th></tr></thead>
              <tbody>{visibleProducts.map((item, index) => <tr key={item.nmId}><td>{item.image ? <span className="product-photo" style={{ backgroundImage: `url(${item.image})` }} aria-hidden="true" /> : <div className={`product-thumb tone-${index % 4}`}>{item.category.slice(0, 1) || "W"}</div>}<div className="product-identity emphasized-sku"><b>{item.name}</b><small>{item.sku}</small><em>WB {item.nmId} · {item.category} · {item.brand}</em></div></td><td><b>{formatMoney(item.sales, data?.currency)}</b><small>均价 {formatMoney(item.averagePrice, data?.currency)}</small></td><td><b>{item.orders}</b></td><td><b>{item.netUnits}</b></td><td><span className={item.returnRate >= 15 ? "value-bad" : item.returnRate <= 5 ? "value-good" : ""}>{item.returnRate.toFixed(1)}%</span><small>{item.returnsCount} 笔非正常</small></td><td><span>{item.pendingCount}</span></td><td><span>{item.buyoutRate.toFixed(1)}%</span></td><td><span className="rating-value">{item.periodAverageRating === null ? "—" : `★ ${item.periodAverageRating.toFixed(2)}`}</span><small>本期 {item.periodReviewsCount} 条 · 累计 {item.reviewsCount}</small></td><td><span className={(item.periodPositiveRate ?? 100) < 80 ? "value-bad" : "value-good"}>{formatPercent(item.periodPositiveRate)}</span><small>累计 {formatPercent(item.positiveRate)}</small></td><td><b>{data?.dataAvailability.inventory ? item.stock : "—"}</b></td><td><span>{item.stockCoverDays === null ? "无销量" : `${item.stockCoverDays.toFixed(1)} 天`}</span><small>日均 {item.dailyUnits.toFixed(2)}</small></td><td><span className={`product-status status-${item.status}`}>{item.status}</span></td></tr>)}{!loading && visibleProducts.length === 0 && <tr className="empty-row"><td colSpan={12}>没有符合当前筛选条件的商品</td></tr>}</tbody>
            </table>
          </div>

          <footer className="product-table-footer"><span>共 {filteredProducts.length} 个商品 · 第 {Math.min(page, pageCount)} / {pageCount} 页</span><div><button onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}>← 上一页</button><button onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={page >= pageCount}>下一页 →</button></div></footer>
        </section>

      </section>
    </main>
  );
}
