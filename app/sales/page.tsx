"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AppSidebar } from "../_components/app-sidebar";
import { normalizeProductSku, productCostSourceKey } from "../_lib/product-cost-aliases";
import { calculateOrderFinancial, isCurrentValidNewOrder, isUnprocessedClientCancellation, returnRateSummary, waitingFinancial, type OrderFinancial } from "../_lib/sales-financials";
import { matchesWbStatusFilter, supplierStatusLabel, WB_STATUS_FILTERS, wbStatusLabel, type WbLogisticsStage } from "../_lib/wb-order-status";

type Product = { nmId: number; name: string; sku: string; image: string | null };
type OrderSettlement = {
  matched: boolean;
  rowsCount: number;
  transactionAmount: number;
  forPay: number;
  logisticsFee: number;
  acquiringFee: number;
  penaltyFee: number;
  deductionFee: number;
  storageFee: number;
  acceptanceFee: number;
  additionalPayment: number;
  wbExpenses: number;
  netPayout: number;
  currency: string;
};
type Order = {
  id: string;
  orderNumber: string;
  nmId: number;
  article: string;
  createdAt: string;
  rid?: string;
  warehouseName: string;
  amount: number;
  currency: "CNY";
  supplierStatus: string;
  wbStatus: string;
  outcome: "success" | "abnormal" | "pending";
  invalid: boolean;
  statusLabel: string;
  completionAt: string | null;
  completionSource: "sale" | "return" | "cancel" | null;
  settlement: OrderSettlement | null;
};
type CostRow = {
  sellerSku: string;
  nmId: number | null;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  productCostRub: number;
  exchangeRate: number;
  productCostCny: number;
  handlingFeeCny: number;
};
type SalesData = {
  syncedAt: string;
  syncSchedule: { nextAt: string };
  warehouses: Array<{ name: string; orders: number; stock: number }>;
  products: Product[];
  orderDetails: Order[];
  orderSummary: {
    orders: number;
    success: number;
    abnormal: number;
    invalid: number;
    rateAbnormal: number;
    pending: number;
    orderAmount: number;
    salesAmount: number;
    abnormalRate: number;
    todayActive: number;
    todayActiveSuccess: number;
    todayActiveAbnormal: number;
    todayActiveDate: string;
    todayActiveOrderIds: string[];
    todayActiveUnmatched: number;
  };
  dataAvailability: { orderDetails: boolean; financeReport: boolean };
};
type LiveOrderStatus = {
  source: string;
  checkedAt: string;
  orderId: string;
  supplierStatus: string;
  supplierLabel: string;
  wbStatus: string;
  wbLabel: string;
  stage: WbLogisticsStage;
  stageLabel: string;
  description: string;
  history: {
    available: boolean;
    source: string;
    deliveryDate: string | null;
    events: Array<{ code: string; label: string; date: string | null; location: string | null }>;
    reason: string | null;
  };
};

const DAY_MS = 86_400_000;
const PAGE_SIZE = 100;
function beijingDateKey(value: Date | string = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function toInputDate(date: Date) { return beijingDateKey(date); }
function shiftDate(dateString: string, days: number) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + days);
  return toInputDate(date);
}
function countDays(start: string, end: string) {
  return Math.round((new Date(`${end}T12:00:00`).getTime() - new Date(`${start}T12:00:00`).getTime()) / DAY_MS) + 1;
}
function formatMoney(value: number) { return `¥ ${Math.round(value || 0).toLocaleString("en-US")}`; }
function formatFinanceMoney(value: number) {
  const sign = value < 0 ? "−" : "";
  return `${sign}¥ ${Math.abs(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function formatFinanceNumber(value: number) {
  return Math.abs(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function signedBreakdown(parts: Array<{ label: string; value: number }>) {
  const visible = parts.filter((part) => Math.abs(part.value) >= 0.005);
  if (!visible.length) return "无额外扣费";
  return visible.map((part, index) => {
    const negative = part.value < 0;
    const prefix = index === 0 ? negative ? "−" : "" : negative ? "－" : "＋";
    return `${prefix}${part.label} ${formatFinanceNumber(part.value)}`;
  }).join(" ");
}
function platformFeeBreakdown(finance: Pick<OrderFinancial, "commissionFee" | "logisticsFee" | "acquiringFee" | "penaltyFee" | "deductionFee" | "storageFee" | "acceptanceFee" | "additionalPayment">) {
  return signedBreakdown([
    { label: "佣金", value: finance.commissionFee },
    { label: "物流", value: finance.logisticsFee },
    { label: "收款", value: finance.acquiringFee },
    { label: "罚款", value: finance.penaltyFee },
    { label: "其他扣款", value: finance.deductionFee },
    { label: "仓储", value: finance.storageFee },
    { label: "入库", value: finance.acceptanceFee },
    { label: "补款", value: -finance.additionalPayment },
  ]);
}
function productCostBreakdown(finance: Pick<OrderFinancial, "productPrincipal" | "handlingFee">) {
  return signedBreakdown([
    { label: "拿货", value: finance.productPrincipal },
    { label: "操作", value: finance.handlingFee },
  ]);
}
function formatDateTime(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
function formatBeijingCompletionDate(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date).replaceAll("/", ".");
}
function formatBeijingStatusTime(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}
export default function SalesPage() {
  const [today, setToday] = useState(() => toInputDate(new Date()));
  const earliest = "2024-01-29";
  const [draftStart, setDraftStart] = useState(earliest);
  const [draftEnd, setDraftEnd] = useState(today);
  const [periodStart, setPeriodStart] = useState(earliest);
  const [periodEnd, setPeriodEnd] = useState(today);
  const [warehouse, setWarehouse] = useState("");
  const [data, setData] = useState<SalesData | null>(null);
  const [costRows, setCostRows] = useState<CostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dateError, setDateError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [wbStatusFilter, setWbStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState<"all" | "today-active">("all");
  const [financialFilter, setFinancialFilter] = useState<"all" | "profit" | "cost">("all");
  const [page, setPage] = useState(1);
  const [statusOrder, setStatusOrder] = useState<Order | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveOrderStatus | null>(null);
  const [liveStatusLoading, setLiveStatusLoading] = useState(false);
  const [liveStatusError, setLiveStatusError] = useState("");
  const forceRefreshRef = useRef(false);
  const todayRef = useRef(today);
  const statusRequestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = toInputDate(new Date());
      const previous = todayRef.current;
      if (next === previous) return;
      todayRef.current = next;
      setToday(next);
      setDraftEnd((value) => value === previous ? next : value);
      setPeriodEnd((value) => value === previous ? next : value);
      forceRefreshRef.current = true;
      setLoading(true);
      setReloadKey((key) => key + 1);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ from: periodStart, to: periodEnd, includeOrders: "true", includeFinance: "true", view: "sales" });
    if (warehouse) params.set("warehouse", warehouse);
    if (forceRefreshRef.current) params.set("refresh", "manual");
    forceRefreshRef.current = false;
    Promise.all([
      fetch(`/api/wb/dashboard?${params.toString()}`, { signal: controller.signal, headers: { Accept: "application/json" }, cache: "no-store" })
        .then(async (response) => {
          const body = await response.json() as SalesData | { error?: string };
          if (!response.ok) throw new Error("error" in body && body.error ? body.error : "同步失败，请稍后重试");
          return body as SalesData;
        }),
      fetch("/api/product-costs", { signal: controller.signal, headers: { Accept: "application/json" }, cache: "no-store" })
        .then(async (response) => {
          const body = await response.json() as { rows?: CostRow[]; error?: string };
          if (!response.ok) throw new Error(body.error || "产品成本读取失败");
          return body.rows ?? [];
        })
        .catch((reason: Error) => {
          if (reason.name === "AbortError") throw reason;
          return [] as CostRow[];
        }),
    ])
      .then(([dashboard, costs]) => { setData(dashboard); setCostRows(costs); })
      .catch((reason: Error) => { if (reason.name !== "AbortError") setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [periodStart, periodEnd, warehouse, reloadKey]);

  useEffect(() => {
    const nextAt = data?.syncSchedule?.nextAt;
    if (!nextAt) return;
    const timer = window.setTimeout(() => {
      if (window.localStorage.getItem("wb-last-auto-sync") === nextAt) {
        window.setTimeout(() => { setLoading(true); setReloadKey((key) => key + 1); }, 12_000);
        return;
      }
      window.localStorage.setItem("wb-last-auto-sync", nextAt);
      setLoading(true);
      setReloadKey((key) => key + 1);
    }, Math.max(1_000, new Date(nextAt).getTime() - Date.now() + 1_500));
    return () => window.clearTimeout(timer);
  }, [data?.syncSchedule?.nextAt]);

  useEffect(() => {
    if (!statusOrder) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      statusRequestRef.current?.abort();
      statusRequestRef.current = null;
      setStatusOrder(null);
      setLiveStatus(null);
      setLiveStatusError("");
      setLiveStatusLoading(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [statusOrder]);

  const productById = useMemo(() => new Map((data?.products ?? []).map((item) => [item.nmId, item])), [data]);
  const orders = useMemo(() => data?.orderDetails ?? [], [data?.orderDetails]);
  const costBySku = useMemo(() => new Map(costRows.map((row) => [normalizeProductSku(row.sellerSku), row])), [costRows]);
  const costByNmId = useMemo(() => new Map(costRows.filter((row) => row.nmId).map((row) => [Number(row.nmId), row])), [costRows]);
  const financialByOrder = useMemo(() => {
    const result = new Map<string, OrderFinancial>();
    for (const order of orders) {
      const product = productById.get(order.nmId);
      const sellerSku = order.article || product?.sku || "";
      const cost = costByNmId.get(order.nmId)
        ?? costBySku.get(normalizeProductSku(sellerSku))
        ?? costBySku.get(productCostSourceKey(sellerSku));
      result.set(order.id, calculateOrderFinancial(order, cost));
    }
    return result;
  }, [costByNmId, costBySku, orders, productById]);
  const rollup = useMemo(() => {
    const result = orders.reduce((sum, order) => {
      sum.orders += 1;
      sum.amount += order.amount;
      sum[order.outcome] += 1;
      if (isUnprocessedClientCancellation(order)) sum.invalid += 1;
      if (isCurrentValidNewOrder(order)) sum.supplierNew += 1;
      return sum;
    }, { orders: 0, amount: 0, success: 0, abnormal: 0, invalid: 0, pending: 0, supplierNew: 0 });
    const rate = returnRateSummary(result.success, result.abnormal, result.invalid);
    return { ...result, rateAbnormal: rate.rateAbnormal, abnormalRate: rate.returnRate };
  }, [orders]);
  const wbStatusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const order of orders) {
      const status = String(order.wbStatus || "").toLowerCase();
      counts.set(status, (counts.get(status) ?? 0) + 1);
      if (matchesWbStatusFilter(status, "__canceled__")) counts.set("__canceled__", (counts.get("__canceled__") ?? 0) + 1);
    }
    return counts;
  }, [orders]);
  const financeRollup = useMemo(() => {
    const summary = { settled: 0, waiting: 0, abnormal: 0, actualAbnormal: 0, estimatedAbnormal: 0, zeroCostAbnormal: 0, costReady: 0, settlementGross: 0, postCommissionPayout: 0, platformPayout: 0, platformDeduction: 0, commissionFee: 0, logisticsFee: 0, acquiringFee: 0, penaltyFee: 0, deductionFee: 0, storageFee: 0, acceptanceFee: 0, additionalPayment: 0, productPrincipal: 0, handlingFee: 0, productCost: 0, costExpense: 0, normalCostExpense: 0, abnormalCostExpense: 0, profit: 0, saleBase: 0 };
    for (const order of orders) {
      const finance = financialByOrder.get(order.id);
      if (!finance) continue;
      summary[finance.kind] += 1;
      if (finance.kind === "abnormal") {
        if (finance.billingSource === "actual") summary.actualAbnormal += 1;
        else if (finance.billingSource === "zero") summary.zeroCostAbnormal += 1;
        else summary.estimatedAbnormal += 1;
      }
      if (finance.profit !== null) {
        summary.costReady += 1;
        summary.saleBase += order.amount;
      }
      summary.settlementGross += finance.settlementGross ?? 0;
      summary.postCommissionPayout += finance.postCommissionPayout ?? 0;
      summary.platformPayout += finance.platformPayout ?? 0;
      summary.platformDeduction += finance.platformDeduction ?? 0;
      summary.commissionFee += finance.commissionFee;
      summary.logisticsFee += finance.logisticsFee;
      summary.acquiringFee += finance.acquiringFee;
      summary.penaltyFee += finance.penaltyFee;
      summary.deductionFee += finance.deductionFee;
      summary.storageFee += finance.storageFee;
      summary.acceptanceFee += finance.acceptanceFee;
      summary.additionalPayment += finance.additionalPayment;
      summary.productPrincipal += finance.productPrincipal;
      summary.handlingFee += finance.handlingFee;
      summary.productCost += finance.productCost ?? 0;
      summary.costExpense += finance.costExpense ?? 0;
      if (finance.kind === "settled") summary.normalCostExpense += finance.costExpense ?? 0;
      if (finance.kind === "abnormal") summary.abnormalCostExpense += finance.costExpense ?? 0;
      summary.profit += finance.profit ?? 0;
    }
    return { ...summary, profitRate: summary.saleBase ? (summary.profit / summary.saleBase) * 100 : 0 };
  }, [financialByOrder, orders]);
  const filteredOrders = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const todayActiveOrderIds = new Set(data?.orderSummary?.todayActiveOrderIds ?? []);
    return orders.filter((order) => {
      const product = productById.get(order.nmId);
      const invalid = isUnprocessedClientCancellation(order);
      const matchesStatus = statusFilter === "all" ? true : statusFilter === "invalid" ? invalid : order.outcome === statusFilter;
      const matchesWbStatus = matchesWbStatusFilter(order.wbStatus, wbStatusFilter);
      const matchesTodayActive = dateFilter !== "today-active" || todayActiveOrderIds.has(order.id);
      const finance = financialByOrder.get(order.id);
      const matchesFinancial = financialFilter === "all"
        || (financialFilter === "profit" && finance?.profit !== null && finance?.profit !== undefined)
        || (financialFilter === "cost" && finance?.costExpense !== null && finance?.costExpense !== undefined);
      const matchesQuery = !needle || [order.orderNumber, order.article, product?.name || "", order.warehouseName, order.statusLabel].some((value) => value.toLocaleLowerCase().includes(needle));
      return matchesStatus && matchesWbStatus && matchesTodayActive && matchesFinancial && matchesQuery;
    });
  }, [data?.orderSummary?.todayActiveOrderIds, dateFilter, financialByOrder, financialFilter, orders, productById, query, statusFilter, wbStatusFilter]);
  const pageCount = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));
  const visibleOrders = filteredOrders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const statusProduct = statusOrder ? productById.get(statusOrder.nmId) : null;

  function beginLoad() { setLoading(true); setError(""); setPage(1); }
  function choosePreset(days: number) {
    const start = shiftDate(today, -(days - 1));
    beginLoad(); setDraftStart(start); setDraftEnd(today); setPeriodStart(start); setPeriodEnd(today); setDateError("");
  }
  function chooseAllHistory() {
    beginLoad(); setDraftStart(earliest); setDraftEnd(today); setPeriodStart(earliest); setPeriodEnd(today); setDateError("");
  }
  function applyDates() {
    if (!draftStart || !draftEnd) return setDateError("请选择完整日期");
    if (draftStart > draftEnd) return setDateError("开始日期不能晚于结束日期");
    if (draftStart < earliest) return setDateError(`支持查询 ${earliest} 至今的数据`);
    beginLoad(); setPeriodStart(draftStart); setPeriodEnd(draftEnd); setDateError(""); setReloadKey((key) => key + 1);
  }
  function refresh() { forceRefreshRef.current = true; beginLoad(); setReloadKey((key) => key + 1); }
  function chooseOrderFilter(filter: "all" | "success" | "abnormal" | "pending" | "today-active") {
    setQuery("");
    setPage(1);
    setFinancialFilter("all");
    setWbStatusFilter("all");
    if (filter === "today-active") {
      setStatusFilter("all");
      setDateFilter("today-active");
      return;
    }
    setStatusFilter(filter);
    setDateFilter("all");
  }
  function chooseFinancialFilter(filter: "profit" | "cost") {
    setQuery("");
    setPage(1);
    setStatusFilter("all");
    setWbStatusFilter("all");
    setDateFilter("all");
    setFinancialFilter((current) => current === filter ? "all" : filter);
  }
  async function readLiveOrderStatus(order: Order) {
    statusRequestRef.current?.abort();
    const controller = new AbortController();
    statusRequestRef.current = controller;
    setStatusOrder(order);
    setLiveStatus(null);
    setLiveStatusError("");
    setLiveStatusLoading(true);
    try {
      const response = await fetch("/api/wb/order-status", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: Number(order.id) }),
        cache: "no-store",
        signal: controller.signal,
      });
      const body = await response.json() as LiveOrderStatus | { error?: string };
      if (!response.ok) throw new Error("error" in body && body.error ? body.error : "WB 当前状态读取失败");
      if (!controller.signal.aborted) setLiveStatus(body as LiveOrderStatus);
    } catch (reason) {
      if (!controller.signal.aborted) setLiveStatusError(reason instanceof Error ? reason.message : "WB 当前状态读取失败");
    } finally {
      if (!controller.signal.aborted) setLiveStatusLoading(false);
    }
  }
  function closeLiveOrderStatus() {
    statusRequestRef.current?.abort();
    statusRequestRef.current = null;
    setStatusOrder(null);
    setLiveStatus(null);
    setLiveStatusError("");
    setLiveStatusLoading(false);
  }

  return (
    <main className="app-shell">
      <AppSidebar active="sales" syncedAt={data?.syncedAt} nextSyncAt={data?.syncSchedule?.nextAt} loading={loading} error={error} onRefresh={refresh}>
        <div className="nav-section">当前查询</div>
        <div className="product-side-summary"><span>订单周期</span><b>{periodStart}</b><i>至</i><b>{periodEnd}</b><small>{warehouse || "全部仓库"}</small></div>
      </AppSidebar>

      <section className="workspace product-workspace">
        <header className="topbar product-topbar"><div><p className="eyebrow">ORDER STATUS · WB 实时订单</p><h1>销售状况</h1></div><div className="avatar">Z</div></header>

        <section className="product-period-panel" aria-label="选择订单周期">
          <div className="product-period-heading"><strong>时间筛选</strong><small>默认汇总全部历史订单，可按周期筛选</small></div>
          <div className="period-presets"><span>快捷周期</span><button disabled={loading} className={periodStart === earliest && periodEnd === today ? "active" : ""} onClick={chooseAllHistory}>全部历史</button>{[7, 30, 90, 180].map((days) => <button key={days} disabled={loading} className={countDays(periodStart, periodEnd) === days ? "active" : ""} onClick={() => choosePreset(days)}>近 {days} 天</button>)}</div>
          <div className="period-custom"><label><span>开始日期</span><input disabled={loading} type="date" value={draftStart} min={earliest} max={today} onChange={(event) => { setDraftStart(event.target.value); setDateError(""); }} /></label><b>→</b><label><span>结束日期</span><input disabled={loading} type="date" value={draftEnd} min={draftStart || earliest} max={today} onChange={(event) => { setDraftEnd(event.target.value); setDateError(""); }} /></label><button disabled={loading} onClick={applyDates}>{loading ? "计算中…" : "查询"}</button></div>
          {dateError && <p className="product-date-error" role="alert">{dateError}</p>}
        </section>

        <section className="product-scope-panel compact-scope" aria-label="按仓库筛选">
          <div className="product-scope-heading"><strong>销售范围</strong><small>选择一个仓库查看对应订单</small></div>
          <label><span>WB 仓库</span><select disabled={loading} value={warehouse} onChange={(event) => { beginLoad(); setWarehouse(event.target.value); }}><option value="">全部仓库</option>{(data?.warehouses ?? []).map((item) => <option key={item.name} value={item.name}>{item.name} · {item.orders} 单</option>)}</select></label>
          <p>订单号已使用 WB 卖家后台的数字订单编号，便于直接对标查找。</p>
        </section>

        <section className="product-stat-grid sales-stat-grid" aria-label="销售状况汇总">
          <button type="button" className={`sales-stat-card ${statusFilter === "all" && dateFilter === "all" && financialFilter === "all" ? "active" : ""}`} aria-pressed={statusFilter === "all" && dateFilter === "all" && financialFilter === "all"} onClick={() => chooseOrderFilter("all")}><span>全部订单</span><strong>{rollup.orders}</strong><small>{periodStart} 至 {periodEnd}</small></button>
          <button type="button" className={`sales-stat-card ${statusFilter === "success" && dateFilter === "all" ? "active" : ""}`} aria-pressed={statusFilter === "success" && dateFilter === "all"} onClick={() => chooseOrderFilter("success")}><span>正常签收</span><strong>{rollup.success}</strong><small>买家已正常收货</small></button>
          <button type="button" className={`sales-stat-card ${rollup.abnormal ? "attention" : ""} ${statusFilter === "abnormal" && dateFilter === "all" ? "active" : ""}`} aria-pressed={statusFilter === "abnormal" && dateFilter === "all"} onClick={() => chooseOrderFilter("abnormal")}><span>非正常签收</span><strong>{rollup.abnormal}</strong><small>退货率 {rollup.abnormalRate.toFixed(1)}% · 无效 {rollup.invalid} 笔已排除</small></button>
          <button type="button" className={`sales-stat-card ${statusFilter === "pending" && dateFilter === "all" ? "active" : ""}`} aria-pressed={statusFilter === "pending" && dateFilter === "all"} onClick={() => chooseOrderFilter("pending")}><span>待签收/处理中</span><strong>{rollup.pending}</strong><small>仍在运输或待取件</small></button>
          <button type="button" className={`sales-stat-card today-active ${dateFilter === "today-active" ? "active" : ""}`} aria-pressed={dateFilter === "today-active"} title={`${data?.orderSummary?.todayActiveDate || today} · 北京时间 · 当日已形成最终结果 · WB API`} onClick={() => chooseOrderFilter("today-active")}><span>今日已完结订单</span><strong>{data?.orderSummary?.todayActive ?? 0}</strong><small>正常完结 {data?.orderSummary?.todayActiveSuccess ?? 0} · 非正常完结 {data?.orderSummary?.todayActiveAbnormal ?? 0}{data?.orderSummary?.todayActiveUnmatched ? ` · 待关联 ${data.orderSummary.todayActiveUnmatched}` : ""}</small></button>
          <article><span>订单金额</span><strong>{formatMoney(rollup.amount)}</strong><small>订单结算币</small></article>
          <button type="button" className={`sales-stat-card cost-expense ${financialFilter === "cost" ? "active" : ""}`} aria-pressed={financialFilter === "cost"} onClick={() => chooseFinancialFilter("cost")}><span>预估成本支出</span><strong>{formatFinanceMoney(financeRollup.costExpense)}</strong><small>正常 {formatFinanceNumber(financeRollup.normalCostExpense)} · 异常 {formatFinanceNumber(financeRollup.abnormalCostExpense)} · 零支出 {financeRollup.zeroCostAbnormal} 笔</small></button>
          <button type="button" className={`sales-stat-card profit-estimate ${financialFilter === "profit" ? "active" : ""}`} aria-pressed={financialFilter === "profit"} onClick={() => chooseFinancialFilter("profit")}><span>净利润预估</span><strong className={financeRollup.profit >= 0 ? "value-good" : "value-bad"}>{formatFinanceMoney(financeRollup.profit)}</strong><small>已核算 {financeRollup.costReady} 笔 · 点击查看订单</small></button>
        </section>

        <section className="order-detail-panel sales-order-panel">
          <div className="order-detail-toolbar">
            <div><h2>{financialFilter === "profit" ? "净利润预估订单明细" : financialFilter === "cost" ? "预估成本支出订单明细" : "全部订单、签收与利润"}</h2><p>平台结账为成交金额依次扣除佣金、物流及其他账单费用后的最终实结；总成本支出＝平台净扣费＋商品成本，异常单＝尾程物流＋操作费。</p></div>
            <div className="order-detail-actions">
              <span className={`finance-source-status ${data?.dataAvailability.financeReport ? "connected" : "waiting"}`}>{data?.dataAvailability.financeReport ? "财务账单已连接" : "财务账单待同步"}</span>
              {financialFilter !== "all" && <button type="button" className="financial-filter-clear" onClick={() => setFinancialFilter("all")}>清除财务筛选</button>}
              <div className="order-detail-filters">
                <label><span>⌕</span><input type="search" value={query} placeholder="搜索订单号、SKU 或仓库" onChange={(event) => { setQuery(event.target.value); setPage(1); }} /></label>
                <select aria-label="按签收结果筛选" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setDateFilter("all"); setFinancialFilter("all"); setPage(1); }}><option value="all">全部签收结果</option><option value="success">正常签收</option><option value="abnormal">非正常签收（含无效）</option><option value="invalid">只看无效订单</option><option value="pending">待签收/处理中</option></select>
                <select aria-label="按 WB 物流状态筛选" value={wbStatusFilter} onChange={(event) => { setWbStatusFilter(event.target.value); setPage(1); }}>
                  <option value="all">全部 WB 状态</option>
                  {WB_STATUS_FILTERS.map((item) => <option key={item.value} value={item.value}>{item.label} · {wbStatusCounts.get(item.value) ?? 0}</option>)}
                </select>
              </div>
            </div>
          </div>
          <div className="order-detail-table-wrap">
            <table className="order-detail-table">
              <thead><tr><th>订单时间</th><th>订单号</th><th>SKU 编码</th><th>仓库</th><th>成交价</th><th>供应商状态</th><th>WB 状态</th><th>签收结果<small>完结日期 · 北京时间</small></th><th>结账状态</th><th>平台结账<small>佣金＋物流＋账单费用扣除后</small></th><th>平台总扣费<small>佣金＋物流＋收款/罚款/仓储等</small></th><th>商品成本<small>拿货成本＋操作费</small></th><th>预估成本支出<small>平台净扣费＋商品成本</small></th><th>单笔利润</th><th>利润率</th></tr></thead>
              <tbody>
                <tr className="order-rollup-row"><td><b>综合统计</b><small>{periodStart} 至 {periodEnd}</small></td><td><b>{rollup.orders} 笔订单</b></td><td><b>{new Set(orders.map((order) => order.article)).size} 个 SKU</b></td><td><b>{warehouse || "全部仓库"}</b></td><td><b>{formatMoney(rollup.amount)}</b><small>平台成交价合计</small></td><td><b className="value-good">正常 {rollup.success}</b><small className="supplier-new-count">当前新订单 {rollup.supplierNew}</small></td><td><b>待签 {rollup.pending}</b></td><td><b className={rollup.abnormal ? "value-bad" : "value-good"}>非正常 {rollup.abnormal} · 退货率 {rollup.abnormalRate.toFixed(1)}%</b><small>计入退货率 {rollup.rateAbnormal} · 无效排除 {rollup.invalid}</small></td><td><b className="value-good">已结 {financeRollup.settled}</b><small>异常实扣 {financeRollup.actualAbnormal} · 预估 {financeRollup.estimatedAbnormal} · 零支出 {financeRollup.zeroCostAbnormal}</small></td><td><b>{formatFinanceMoney(financeRollup.platformPayout)}</b><small className="finance-breakdown">佣金后货款 {formatFinanceNumber(financeRollup.postCommissionPayout)}；再扣账单费 {formatFinanceNumber(financeRollup.postCommissionPayout - financeRollup.platformPayout)}</small></td><td><b>{formatFinanceMoney(financeRollup.platformDeduction)}</b><small className="finance-breakdown">{platformFeeBreakdown(financeRollup)}</small></td><td><b>{formatFinanceMoney(financeRollup.productCost)}</b><small className="finance-breakdown">{productCostBreakdown(financeRollup)} · {financeRollup.costReady} 笔</small></td><td><b>{formatFinanceMoney(financeRollup.costExpense)}</b><small className="finance-breakdown">正常 {formatFinanceNumber(financeRollup.normalCostExpense)}＋异常 {formatFinanceNumber(financeRollup.abnormalCostExpense)}</small></td><td><b className={financeRollup.profit >= 0 ? "value-good" : "value-bad"}>{formatFinanceMoney(financeRollup.profit)}</b></td><td><b className={financeRollup.profitRate >= 0 ? "value-good" : "value-bad"}>{financeRollup.profitRate.toFixed(1)}%</b></td></tr>
                {visibleOrders.map((order) => {
                  const product = productById.get(order.nmId);
                  const finance = financialByOrder.get(order.id) ?? waitingFinancial();
                  const financeClass = finance.zeroCostReason ? "finance-zero-cost" : finance.kind === "abnormal" ? "finance-abnormal" : finance.kind === "waiting" ? "finance-waiting" : (finance.profit ?? 0) >= 0 ? "finance-positive" : "finance-negative";
                  const costPendingCopy = finance.kind === "waiting" ? "待结账" : "待录成本";
                  const settlementLabel = finance.kind === "settled" ? "已结账" : finance.zeroCostReason ? "无需支出" : finance.kind === "abnormal" ? finance.billingSource === "actual" ? "已扣款" : "预估扣款" : "待结账";
                  const completionDate = formatBeijingCompletionDate(order.completionAt);
                  const invalidOrder = isUnprocessedClientCancellation(order);
                  const costExpenseBreakdown = finance.zeroCostReason ? "新订单客户取消，未处理" : finance.kind === "settled" ? `平台净扣费 ${formatFinanceNumber(finance.platformDeduction ?? 0)}＋商品成本 ${formatFinanceNumber(finance.productCost ?? 0)}` : finance.kind === "abnormal" ? `尾程物流 ${formatFinanceNumber(finance.logisticsFee)}＋操作费 ${formatFinanceNumber(finance.handlingFee)}` : "等待订单完结/账单";
                  return <tr key={order.id} className={financeClass}><td><b>{formatDateTime(order.createdAt)}</b><small>{order.createdAt.slice(0, 10)}</small></td><td><div className="order-id-with-photo">{product?.image ? <span className="order-photo" style={{ backgroundImage: `url(${product.image})` }} aria-hidden="true" /> : <span className="order-photo placeholder">W</span>}<div><b className="order-number" title={order.orderNumber}>{order.orderNumber}</b><small>WB {order.nmId}</small></div></div></td><td><b className="order-sku-code">{order.article || product?.sku || "—"}</b></td><td><span>{order.warehouseName}</span></td><td><b>{formatMoney(order.amount)}</b></td><td><span className={`supplier-status ${isCurrentValidNewOrder(order) ? "new" : ""}`}>{supplierStatusLabel(order.supplierStatus)}</span><small>{order.supplierStatus || "—"}</small></td><td><button type="button" className="wb-live-status-button" title="点击通过 WB API 读取实时状态" onClick={() => readLiveOrderStatus(order)}><span>{wbStatusLabel(order.wbStatus, order.supplierStatus)}</span><small>{order.wbStatus || "—"} · 查看实时状态</small></button></td><td><span className={`order-outcome ${invalidOrder ? "invalid" : order.outcome}`}>{invalidOrder ? "无效订单" : order.outcome === "success" ? "正常签收" : order.outcome === "abnormal" ? "非正常签收" : "待签收"}</span>{invalidOrder && <small className="invalid-order-note">新订单阶段客户取消 · 不计退货率</small>}{order.outcome !== "pending" && <small className={`order-completion-date ${completionDate ? "matched" : "unavailable"}`}>{completionDate ? `完结：${completionDate}` : "完结：WB API 未返回"}</small>}</td><td className="finance-cell"><span className={`finance-status ${finance.kind}`}>{settlementLabel}</span>{finance.zeroCostReason && <small>未进入备货，无拿货/操作/物流支出</small>}</td><td className="finance-cell"><b>{finance.platformPayout === null ? finance.kind === "abnormal" ? "账单未出" : "待结账" : formatFinanceMoney(finance.platformPayout)}</b>{finance.kind === "settled" && finance.postCommissionPayout !== null && <small className="finance-breakdown">佣金后货款 {formatFinanceNumber(finance.postCommissionPayout)}；再扣账单费 {formatFinanceNumber(finance.postCommissionPayout - (finance.platformPayout ?? 0))}</small>}{finance.kind === "abnormal" && finance.platformPayout !== null && <small className="finance-breakdown">{finance.zeroCostReason ? "未处理订单，无平台扣款" : "异常单物流扣款"}</small>}</td><td className="finance-cell"><b>{finance.platformDeduction === null ? finance.kind === "abnormal" ? "待录成本" : "待结账" : formatFinanceMoney(finance.platformDeduction)}</b>{finance.platformDeduction !== null && <small className="finance-breakdown">{platformFeeBreakdown(finance)}</small>}{finance.kind === "abnormal" && <small>{finance.billingSource === "actual" ? "WB 账单实扣" : finance.billingSource === "zero" ? "新订单取消，支出为 0" : "按尾程费预估"}</small>}</td><td className="finance-cell"><b>{finance.productCost === null ? costPendingCopy : formatFinanceMoney(finance.productCost)}</b>{finance.productCost !== null && <small className="finance-breakdown">{finance.zeroCostReason ? "拿货 0.00＋操作 0.00" : productCostBreakdown(finance)}</small>}</td><td className="finance-cell"><b>{finance.costExpense === null ? costPendingCopy : formatFinanceMoney(finance.costExpense)}</b>{finance.costExpense !== null && <small className="finance-breakdown">{costExpenseBreakdown}</small>}</td><td className="finance-cell"><b>{finance.profit === null ? costPendingCopy : formatFinanceMoney(finance.profit)}</b>{finance.profit !== null && <small>收入 {formatFinanceNumber(finance.incomeEstimate ?? 0)}－支出 {formatFinanceNumber(finance.costExpense ?? 0)}</small>}</td><td className="finance-cell"><b>{finance.profitRate === null ? costPendingCopy : `${finance.profitRate.toFixed(1)}%`}</b></td></tr>;
                })}
                {!loading && visibleOrders.length === 0 && <tr className="empty-row"><td colSpan={15}>{data?.dataAvailability.orderDetails ? "没有符合当前筛选条件的订单" : "WB 订单状态暂时无法读取，请稍后手动同步"}</td></tr>}
              </tbody>
            </table>
          </div>
          <footer className="product-table-footer"><span>共 {filteredOrders.length} 笔订单 · 第 {Math.min(page, pageCount)} / {pageCount} 页</span><div><button onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}>← 上一页</button><button onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={page >= pageCount}>下一页 →</button></div></footer>
        </section>
      </section>

      {statusOrder && <div className="wb-status-backdrop">
        <section className="wb-status-dialog" role="dialog" aria-modal="true" aria-labelledby="wb-status-title">
          <button type="button" className="wb-status-close" aria-label="关闭物流状态详情" onClick={closeLiveOrderStatus}>×</button>
          <div className="wb-status-product-heading">
            {statusProduct?.image ? <span className="wb-status-product-photo" style={{ backgroundImage: `url(${statusProduct.image})` }} aria-hidden="true" /> : <span className="wb-status-product-photo placeholder" aria-hidden="true">W</span>}
            <div className="wb-status-dialog-heading">
              <span>订单状态 · WB API 实时读取</span>
              <h2 id="wb-status-title">{statusProduct?.name || `WB 商品 ${statusOrder.nmId}`}</h2>
              <p>SKU {statusOrder.article || statusProduct?.sku || "—"} · 订单 {statusOrder.orderNumber} · {statusOrder.warehouseName}</p>
            </div>
          </div>

          {liveStatusLoading && <div className="wb-status-loading" role="status"><i /><b>正在向 WB API 读取当前物流状态…</b><small>每次打开都会重新读取，不使用订单列表缓存。</small></div>}
          {!liveStatusLoading && liveStatusError && <div className="wb-status-error" role="alert"><b>{liveStatusError}</b><button type="button" onClick={() => readLiveOrderStatus(statusOrder)}>重新读取</button></div>}
          {!liveStatusLoading && liveStatus && <>
            <div className={`wb-status-current ${liveStatus.stage === "canceled" ? "canceled" : ""}`}>
              <div><span>WB 当前物流状态</span><strong>{liveStatus.wbLabel}</strong><small>{liveStatus.wbStatus || "—"}</small></div>
              <div><span>卖家处理状态</span><strong>{liveStatus.supplierLabel}</strong><small>{liveStatus.supplierStatus || "—"}</small></div>
              <div><span>当前节点</span><strong>{liveStatus.stageLabel}</strong><small>北京时间 {formatBeijingStatusTime(liveStatus.checkedAt)}</small></div>
            </div>
            <div className="wb-logistics-timeline" aria-label="WB API 订单物流状态">
              <div className="wb-timeline-title">
                <b>{liveStatus.history.events.length ? "WB API 物流轨迹" : "WB API 当前状态"}</b>
                <small>{liveStatus.history.events.length ? `${liveStatus.history.events.length} 个实际返回节点` : "普通 FBS 暂未开放完整历史节点"}</small>
              </div>
              {liveStatus.history.events.length ? liveStatus.history.events.map((event, index) => <article className={index === 0 ? "current" : ""} key={`${event.code}-${event.date || index}`}>
                <i aria-hidden="true" />
                <div><b>{event.label}</b><span>{event.date ? formatBeijingStatusTime(event.date) : "WB API 未返回节点时间"}{event.location ? ` · ${event.location}` : ""}</span><small>状态代码：{event.code || "—"}</small></div>
              </article>) : <article className="current">
                <i aria-hidden="true" />
                <div><b>{liveStatus.wbLabel}</b><span>本次实时读取：{formatBeijingStatusTime(liveStatus.checkedAt)}</span><small>{liveStatus.description}</small></div>
              </article>}
            </div>
            {liveStatus.history.deliveryDate && <div className="wb-history-delivery-date"><span>WB 返回的预计送达时间</span><b>{formatBeijingStatusTime(liveStatus.history.deliveryDate)}</b></div>}
            {!liveStatus.history.events.length && <p className="wb-history-unavailable">{liveStatus.history.reason || "WB 未返回该订单的历史物流节点。"}</p>}
            <div className="wb-status-explanation"><b>当前状态说明</b><p>{liveStatus.description}</p></div>
            <div className="wb-status-source"><div><span>数据源</span><b>{liveStatus.source}</b></div><button type="button" onClick={() => readLiveOrderStatus(statusOrder)}>重新读取最新状态</button></div>
            <p className="wb-status-limit">说明：跨境订单在 WB 返回历史记录时逐项展示真实节点、时间和地点；普通 FBS 公共接口目前只返回当前状态，因此不会用推测节点补齐后台时间线。</p>
          </>}
        </section>
      </div>}
    </main>
  );
}
