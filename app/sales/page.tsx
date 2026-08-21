"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AppSidebar } from "../_components/app-sidebar";

type Product = { nmId: number; name: string; sku: string; image: string | null };
type Order = {
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
};
type SalesData = {
  syncedAt: string;
  syncSchedule: { nextAt: string };
  warehouses: Array<{ name: string; orders: number; stock: number }>;
  products: Product[];
  orderDetails: Order[];
  dataAvailability: { orderDetails: boolean };
};

const DAY_MS = 86_400_000;
const PAGE_SIZE = 20;

function toInputDate(date: Date) { return date.toISOString().slice(0, 10); }
function shiftDate(dateString: string, days: number) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + days);
  return toInputDate(date);
}
function countDays(start: string, end: string) {
  return Math.round((new Date(`${end}T12:00:00`).getTime() - new Date(`${start}T12:00:00`).getTime()) / DAY_MS) + 1;
}
function formatMoney(value: number) { return `¥ ${Math.round(value || 0).toLocaleString("en-US")}`; }
function formatDateTime(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
function supplierStatusLabel(value: string) {
  return ({ new: "新订单", confirm: "备货中", complete: "配送中", cancel: "卖家取消" } as Record<string, string>)[value] || "—";
}

export default function SalesPage() {
  const today = toInputDate(new Date());
  const earliest = shiftDate(today, -179);
  const [draftStart, setDraftStart] = useState(() => shiftDate(today, -29));
  const [draftEnd, setDraftEnd] = useState(today);
  const [periodStart, setPeriodStart] = useState(() => shiftDate(today, -29));
  const [periodEnd, setPeriodEnd] = useState(today);
  const [warehouse, setWarehouse] = useState("");
  const [data, setData] = useState<SalesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dateError, setDateError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const forceRefreshRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ from: periodStart, to: periodEnd, includeOrders: "true" });
    if (warehouse) params.set("warehouse", warehouse);
    if (forceRefreshRef.current) params.set("refresh", "manual");
    forceRefreshRef.current = false;
    fetch(`/api/wb/dashboard?${params.toString()}`, { signal: controller.signal, headers: { Accept: "application/json" }, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as SalesData | { error?: string };
        if (!response.ok) throw new Error("error" in body && body.error ? body.error : "同步失败，请稍后重试");
        return body as SalesData;
      })
      .then(setData)
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

  const productById = useMemo(() => new Map((data?.products ?? []).map((item) => [item.nmId, item])), [data]);
  const orders = useMemo(() => data?.orderDetails ?? [], [data?.orderDetails]);
  const rollup = useMemo(() => {
    const result = orders.reduce((sum, order) => {
      sum.orders += 1;
      sum.amount += order.amount;
      sum[order.outcome] += 1;
      return sum;
    }, { orders: 0, amount: 0, success: 0, abnormal: 0, pending: 0 });
    const completed = result.success + result.abnormal;
    return { ...result, abnormalRate: completed ? (result.abnormal / completed) * 100 : 0 };
  }, [orders]);
  const filteredOrders = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return orders.filter((order) => {
      const product = productById.get(order.nmId);
      const matchesStatus = statusFilter === "all" || order.outcome === statusFilter;
      const matchesQuery = !needle || [order.orderNumber, order.article, product?.name || "", order.warehouseName, order.statusLabel].some((value) => value.toLocaleLowerCase().includes(needle));
      return matchesStatus && matchesQuery;
    });
  }, [orders, productById, query, statusFilter]);
  const pageCount = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));
  const visibleOrders = filteredOrders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function beginLoad() { setLoading(true); setError(""); setPage(1); }
  function choosePreset(days: number) {
    const start = shiftDate(today, -(days - 1));
    beginLoad(); setDraftStart(start); setDraftEnd(today); setPeriodStart(start); setPeriodEnd(today); setDateError("");
  }
  function applyDates() {
    if (!draftStart || !draftEnd) return setDateError("请选择完整日期");
    if (draftStart > draftEnd) return setDateError("开始日期不能晚于结束日期");
    if (draftStart < earliest || countDays(draftStart, draftEnd) > 180) return setDateError("支持近 180 天内、最长 180 天的查询周期");
    beginLoad(); setPeriodStart(draftStart); setPeriodEnd(draftEnd); setDateError(""); setReloadKey((key) => key + 1);
  }
  function refresh() { forceRefreshRef.current = true; beginLoad(); setReloadKey((key) => key + 1); }

  return (
    <main className="app-shell">
      <AppSidebar active="sales" syncedAt={data?.syncedAt} nextSyncAt={data?.syncSchedule?.nextAt} loading={loading} error={error} onRefresh={refresh}>
        <div className="nav-section">当前查询</div>
        <div className="product-side-summary"><span>订单周期</span><b>{periodStart}</b><i>至</i><b>{periodEnd}</b><small>{warehouse || "全部仓库"}</small></div>
      </AppSidebar>

      <section className="workspace product-workspace">
        <header className="topbar product-topbar"><div><p className="eyebrow">ORDER STATUS · WB 实时订单</p><h1>销售状况</h1></div><div className="avatar">Z</div></header>

        <section className="product-period-panel" aria-label="选择订单周期">
          <div className="product-period-heading"><strong>时间筛选</strong><small>订单与状态按所选周期重新汇总</small></div>
          <div className="period-presets"><span>快捷周期</span>{[7, 30, 90, 180].map((days) => <button key={days} disabled={loading} className={countDays(periodStart, periodEnd) === days ? "active" : ""} onClick={() => choosePreset(days)}>近 {days} 天</button>)}</div>
          <div className="period-custom"><label><span>开始日期</span><input disabled={loading} type="date" value={draftStart} min={earliest} max={today} onChange={(event) => { setDraftStart(event.target.value); setDateError(""); }} /></label><b>→</b><label><span>结束日期</span><input disabled={loading} type="date" value={draftEnd} min={draftStart || earliest} max={today} onChange={(event) => { setDraftEnd(event.target.value); setDateError(""); }} /></label><button disabled={loading} onClick={applyDates}>{loading ? "计算中…" : "查询"}</button></div>
          {dateError && <p className="product-date-error" role="alert">{dateError}</p>}
        </section>

        <section className="product-scope-panel compact-scope" aria-label="按仓库筛选">
          <div className="product-scope-heading"><strong>销售范围</strong><small>选择一个仓库查看对应订单</small></div>
          <label><span>WB 仓库</span><select disabled={loading} value={warehouse} onChange={(event) => { beginLoad(); setWarehouse(event.target.value); }}><option value="">全部仓库</option>{(data?.warehouses ?? []).map((item) => <option key={item.name} value={item.name}>{item.name} · {item.orders} 单</option>)}</select></label>
          <p>订单号已使用 WB 卖家后台的数字订单编号，便于直接对标查找。</p>
        </section>

        <section className="product-stat-grid" aria-label="销售状况汇总">
          <article><span>全部订单</span><strong>{rollup.orders}</strong><small>{periodStart} 至 {periodEnd}</small></article>
          <article><span>正常签收</span><strong>{rollup.success}</strong><small>买家已正常收货</small></article>
          <article className={rollup.abnormal ? "attention" : ""}><span>非正常签收</span><strong>{rollup.abnormal}</strong><small>异常率 {rollup.abnormalRate.toFixed(1)}%</small></article>
          <article><span>待签收/处理中</span><strong>{rollup.pending}</strong><small>仍在运输或待取件</small></article>
          <article><span>订单金额</span><strong>{formatMoney(rollup.amount)}</strong><small>订单结算币</small></article>
        </section>

        <section className="order-detail-panel sales-order-panel">
          <div className="order-detail-toolbar">
            <div><h2>全部订单与状态</h2><p>第一行为综合统计；取消、拒收、退回、瑕疵和卖家取消全部计入非正常签收。</p></div>
            <div className="order-detail-filters"><label><span>⌕</span><input type="search" value={query} placeholder="搜索数字订单号、卖家编号、商品或仓库" onChange={(event) => { setQuery(event.target.value); setPage(1); }} /></label><select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}><option value="all">全部订单状态</option><option value="success">正常签收</option><option value="abnormal">非正常签收</option><option value="pending">待签收/处理中</option></select></div>
          </div>
          <div className="order-detail-table-wrap">
            <table className="order-detail-table">
              <thead><tr><th>订单时间</th><th>订单号</th><th>商品</th><th>仓库</th><th>订单金额</th><th>供应商状态</th><th>WB 状态</th><th>签收结果</th></tr></thead>
              <tbody>
                <tr className="order-rollup-row"><td><b>综合统计</b><small>{periodStart} 至 {periodEnd}</small></td><td><b>{rollup.orders} 笔订单</b></td><td><b>{new Set(orders.map((order) => order.nmId)).size} 个商品</b></td><td><b>{warehouse || "全部仓库"}</b></td><td><b>{formatMoney(rollup.amount)}</b><small>订单结算币</small></td><td><b className="value-good">正常 {rollup.success}</b></td><td><b>待签 {rollup.pending}</b></td><td><b className={rollup.abnormal ? "value-bad" : "value-good"}>非正常 {rollup.abnormal} · {rollup.abnormalRate.toFixed(1)}%</b></td></tr>
                {visibleOrders.map((order) => { const product = productById.get(order.nmId); return <tr key={order.id}><td><b>{formatDateTime(order.createdAt)}</b><small>{order.createdAt.slice(0, 10)}</small></td><td><div className="order-id-with-photo">{product?.image ? <span className="order-photo" style={{ backgroundImage: `url(${product.image})` }} aria-hidden="true" /> : <span className="order-photo placeholder">W</span>}<div><b className="order-number" title={order.orderNumber}>{order.orderNumber}</b><small>WB {order.nmId}</small></div></div></td><td><div className="order-product-copy"><b>{product?.name || order.article}</b><small>{order.article}</small></div></td><td><span>{order.warehouseName}</span></td><td><b>{formatMoney(order.amount)}</b></td><td><span>{supplierStatusLabel(order.supplierStatus)}</span><small>{order.supplierStatus || "—"}</small></td><td><span>{order.statusLabel}</span><small>{order.wbStatus || "—"}</small></td><td><span className={`order-outcome ${order.outcome}`}>{order.outcome === "success" ? "正常签收" : order.outcome === "abnormal" ? "非正常签收" : "待签收"}</span></td></tr>; })}
                {!loading && visibleOrders.length === 0 && <tr className="empty-row"><td colSpan={8}>{data?.dataAvailability.orderDetails ? "没有符合当前筛选条件的订单" : "WB 订单状态暂时无法读取，请稍后手动同步"}</td></tr>}
              </tbody>
            </table>
          </div>
          <footer className="product-table-footer"><span>共 {filteredOrders.length} 笔订单 · 第 {Math.min(page, pageCount)} / {pageCount} 页</span><div><button onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}>← 上一页</button><button onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={page >= pageCount}>下一页 →</button></div></footer>
        </section>
      </section>
    </main>
  );
}
