"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from "react";
import { AppSidebar } from "../_components/app-sidebar";
import { normalizeProductSku, productCostSourceKey } from "../_lib/product-cost-aliases";
import { calculatePriceManagement, type PriceManagementCost } from "../_lib/price-management";

type PriceSize = { sizeId: number; techSizeName: string; price: number; discountedPrice: number; clubDiscountedPrice: number };
type PriceProduct = {
  nmId: number;
  vendorCode: string;
  title: string;
  category: string;
  image: string;
  currency: string;
  discount: number;
  clubDiscount: number;
  editableSizePrice: boolean;
  isBadTurnover: boolean | null;
  sizes: PriceSize[];
};
type PriceData = {
  source: "WB Prices and Discounts API";
  syncedAt: string;
  syncSchedule: { nextAt: string; mode: "scheduled" | "manual" };
  products: PriceProduct[];
  stale: boolean;
  warning: string;
};
type CostRow = PriceManagementCost & { sellerSku: string; nmId: number | null };
type CostResponse = { rows?: CostRow[]; error?: string };
type StatusFilter = "all" | "profit" | "loss" | "missing";

const PAGE_SIZE = 100;

function sourceMoney(value: number, currency: string) {
  const symbol = currency === "CNY" ? "¥" : currency === "RUB" ? "₽" : currency;
  return `${symbol} ${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function cnyMoney(value: number | null) {
  return value === null || !Number.isFinite(value) ? "待补全" : `¥ ${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function percent(value: number | null) {
  return value === null || !Number.isFinite(value) ? "待补全" : `${value.toFixed(1)}%`;
}

export default function PriceManagementPage() {
  const [data, setData] = useState<PriceData | null>(null);
  const [costRows, setCostRows] = useState<CostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [currencyFilter, setCurrencyFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const forceRefreshRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (forceRefreshRef.current) params.set("refresh", "manual");
    forceRefreshRef.current = false;
    Promise.all([
      fetch(`/api/wb/prices?${params}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
        const body = await response.json() as PriceData | { error?: string };
        if (!response.ok) throw new Error("error" in body && body.error ? body.error : "价格数据同步失败");
        return body as PriceData;
      }),
      fetch("/api/product-costs", { cache: "no-store", signal: controller.signal }).then(async (response) => {
        const body = await response.json() as CostResponse;
        if (!response.ok) throw new Error(body.error || "产品成本读取失败");
        return body.rows ?? [];
      }),
    ])
      .then(([priceData, costs]) => { setData(priceData); setCostRows(costs); setError(""); })
      .catch((reason: Error) => { if (reason.name !== "AbortError") setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reloadKey]);

  useEffect(() => {
    const nextAt = data?.syncSchedule.nextAt;
    if (!nextAt) return;
    const timer = window.setTimeout(() => { setLoading(true); setReloadKey((value) => value + 1); }, Math.max(1000, new Date(nextAt).getTime() - Date.now() + 1500));
    return () => window.clearTimeout(timer);
  }, [data?.syncSchedule.nextAt]);

  const costByNmId = useMemo(() => new Map(costRows.filter((cost) => cost.nmId).map((cost) => [Number(cost.nmId), cost])), [costRows]);
  const costBySku = useMemo(() => new Map(costRows.map((cost) => [normalizeProductSku(cost.sellerSku), cost])), [costRows]);
  const rows = useMemo(() => (data?.products ?? []).flatMap((product) => {
    const cost = costByNmId.get(product.nmId) ?? costBySku.get(productCostSourceKey(product.vendorCode)) ?? null;
    const sizes = product.sizes.length ? product.sizes : [{ sizeId: 0, techSizeName: "默认", price: 0, discountedPrice: 0, clubDiscountedPrice: 0 }];
    return sizes.map((size) => {
      const calculation = calculatePriceManagement(product.currency, size.discountedPrice, cost);
      const status: Exclude<StatusFilter, "all"> = !calculation.ready ? "missing" : Number(calculation.expectedProfitCny) >= 0 ? "profit" : "loss";
      return { product, size, cost, calculation, status, key: `${product.nmId}-${size.sizeId}` };
    });
  }), [costByNmId, costBySku, data?.products]);

  const summary = useMemo(() => {
    const profitable = rows.filter((row) => row.status === "profit");
    const products = data?.products ?? [];
    return {
      products: new Set(rows.map((row) => row.product.nmId)).size,
      variants: rows.length,
      profit: profitable.length,
      loss: rows.filter((row) => row.status === "loss").length,
      missing: rows.filter((row) => row.status === "missing").length,
      averageDiscount: products.length ? products.reduce((sum, product) => sum + product.discount, 0) / products.length : 0,
      totalProfit: profitable.reduce((sum, row) => sum + Number(row.calculation.expectedProfitCny || 0), 0),
    };
  }, [data?.products, rows]);

  const currencies = useMemo(() => [...new Set(rows.map((row) => row.product.currency))].sort(), [rows]);
  const filtered = useMemo(() => {
    const needle = normalizeProductSku(query);
    return rows.filter((row) => {
      const matchesQuery = !needle || [row.product.vendorCode, row.product.title, row.product.category, String(row.product.nmId)].some((value) => normalizeProductSku(value).includes(needle));
      return matchesQuery && (statusFilter === "all" || row.status === statusFilter) && (currencyFilter === "all" || row.product.currency === currencyFilter);
    });
  }, [currencyFilter, query, rows, statusFilter]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visibleRows = filtered.slice((Math.min(page, totalPages) - 1) * PAGE_SIZE, Math.min(page, totalPages) * PAGE_SIZE);

  function chooseStatus(status: StatusFilter) {
    setStatusFilter(status);
    setPage(1);
  }

  function refresh() {
    forceRefreshRef.current = true;
    setLoading(true);
    setError("");
    setReloadKey((value) => value + 1);
  }

  return <main className="app-shell">
    <AppSidebar active="prices" syncedAt={data?.syncedAt} nextSyncAt={data?.syncSchedule.nextAt} loading={loading} error={error} onRefresh={refresh} />
    <section className="workspace price-workspace">
      <header className="topbar"><div><p className="eyebrow">PRICE CONTROL · WB 价格与折扣</p><h1>价格管理</h1></div><div className="avatar">Z</div></header>

      <section className="price-source-banner">
        <span>¥</span><div><h2>WB 后台价格已连接商品成本表</h2><p>原价、折扣比例和折扣后价直接读取 WB Prices and Discounts API；盈利按商品详情中已登记的成本与费率计算。</p></div><small>{data?.syncedAt ? `最近读取 ${new Date(data.syncedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}` : "等待首次读取"}</small>
      </section>
      {(data?.warning || error) && <div className="price-warning" role="alert">{error || data?.warning}</div>}

      <section className="price-stat-grid" aria-label="价格管理汇总">
        <button type="button" className={statusFilter === "all" ? "active" : ""} onClick={() => chooseStatus("all")}><span>价格商品</span><b>{summary.products}</b><small>{summary.variants} 个价格规格</small></button>
        <button type="button" className={`profit ${statusFilter === "profit" ? "active" : ""}`} onClick={() => chooseStatus("profit")}><span>预计盈利</span><b>{summary.profit}</b><small>盈利规格单件合计 {cnyMoney(summary.totalProfit)}</small></button>
        <button type="button" className={`loss ${statusFilter === "loss" ? "active" : ""}`} onClick={() => chooseStatus("loss")}><span>预计亏损</span><b>{summary.loss}</b><small>当前折扣价低于成本</small></button>
        <button type="button" className={`missing ${statusFilter === "missing" ? "active" : ""}`} onClick={() => chooseStatus("missing")}><span>成本待补全</span><b>{summary.missing}</b><small>无法生成盈亏结论</small></button>
        <button type="button" onClick={() => { setStatusFilter("all"); setPage(1); }}><span>平均后台折扣</span><b>{summary.averageDiscount.toFixed(1)}%</b><small>按 WB 返回比例统计</small></button>
      </section>

      <section className="price-formula-note">
        <b>当前价格预计盈亏</b><span>WB 最终折扣价 −（拿货价＋操作费＋尾程物流＋平台佣金＋广告费＋产品详情预留折扣费＋退损费）</span><small>WB 折扣已经体现在最终折扣价中，不会再次按后台折扣比例重复扣费。</small>
      </section>

      <section className="price-table-panel">
        <header><div><h2>商品价格与盈利明细</h2><p>“商品总成本价”和“商品最终售价”沿用产品详情的反推公式；“当前价预计总支出”按 WB 当前折扣后价格重新计算。</p></div><div className="price-filters"><label><span>⌕</span><input type="search" placeholder="搜索 SKU、商品或 WB ID" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} /></label><select value={statusFilter} onChange={(event) => chooseStatus(event.target.value as StatusFilter)}><option value="all">全部评估结果</option><option value="profit">预计盈利</option><option value="loss">预计亏损</option><option value="missing">成本待补全</option></select><select value={currencyFilter} onChange={(event) => { setCurrencyFilter(event.target.value); setPage(1); }}><option value="all">全部币种</option>{currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></div></header>
        <div className="price-table-wrap">
          <table className="price-table">
            <thead><tr><th>商品</th><th>规格</th><th>后台原价<br /><small>WB price</small></th><th>折扣比例<br /><small>WB discount</small></th><th>最终折扣价<br /><small>当前卖价</small></th><th>商品总成本价<br /><small>产品详情目标口径</small></th><th>商品最终售价<br /><small>产品详情反推</small></th><th>当前价预计总支出</th><th>预计盈亏</th><th>利润率</th><th>评估结果</th></tr></thead>
            <tbody>{visibleRows.map((row) => {
              const tone = row.status === "profit" ? "positive" : row.status === "loss" ? "negative" : "pending";
              const calculation = row.calculation;
              return <tr key={row.key} className={tone}>
                <td><div className="price-product-cell">{row.product.image ? <img src={row.product.image} alt="" referrerPolicy="no-referrer" /> : <span>W</span>}<div><b>{row.product.vendorCode}</b><small>{row.product.title}</small><em>WB {row.product.nmId} · {row.product.category}</em></div></div></td>
                <td><b>{row.size.techSizeName === "0" ? "默认" : row.size.techSizeName}</b><small>{row.product.editableSizePrice ? "独立尺码价" : "商品统一价"}</small></td>
                <td><b>{sourceMoney(row.size.price, row.product.currency)}</b><small>{row.product.currency}</small></td>
                <td><b>{row.product.discount.toFixed(1)}%</b><small>{row.product.clubDiscount > 0 ? `WB 俱乐部另减 ${row.product.clubDiscount}%` : "卖家后台折扣"}</small></td>
                <td className="current-price"><b>{sourceMoney(row.size.discountedPrice, row.product.currency)}</b><small>API discountedPrice</small></td>
                <td><b>{cnyMoney(calculation.registeredTotalCostCny)}</b><small>目标售价下总成本</small></td>
                <td><b>{cnyMoney(calculation.targetFinalSalePriceCny)}</b><small>{calculation.priceGapCny === null ? "成本未完整" : `当前价差 ${calculation.priceGapCny >= 0 ? "+" : ""}${cnyMoney(calculation.priceGapCny)}`}</small></td>
                <td><b>{cnyMoney(calculation.currentTotalCostCny)}</b><small>{calculation.fixedCostCny === null ? "成本未完整" : `固定 ${cnyMoney(calculation.fixedCostCny)} + 比例 ${calculation.variableRate.toFixed(1)}%`}</small></td>
                <td className={tone}><b>{calculation.expectedProfitCny === null ? "待补全" : `${calculation.expectedProfitCny >= 0 ? "+" : "−"}${cnyMoney(Math.abs(calculation.expectedProfitCny))}`}</b><small>按当前单件价格</small></td>
                <td className={tone}><b>{percent(calculation.profitRate)}</b><small>预计盈亏 ÷ 当前卖价</small></td>
                <td><span className={`price-result ${tone}`}>{row.status === "profit" ? "预计盈利" : row.status === "loss" ? "预计亏损" : "成本待补全"}</span><small>{row.product.isBadTurnover ? "WB 标记低周转" : "价格数据正常"}</small></td>
              </tr>;
            })}{!loading && visibleRows.length === 0 && <tr><td className="price-empty" colSpan={11}>没有符合当前筛选条件的商品</td></tr>}</tbody>
          </table>
        </div>
        <footer><span>共 {filtered.length} 条 · 每页最多 {PAGE_SIZE} 条</span><div><button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>← 上一页</button><b>{Math.min(page, totalPages)} / {totalPages}</b><button type="button" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>下一页 →</button></div></footer>
      </section>
    </section>
  </main>;
}
