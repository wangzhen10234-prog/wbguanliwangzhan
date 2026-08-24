"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AppSidebar } from "../_components/app-sidebar";

type TrackingStage = "transit" | "ready" | "completed" | "unknown";
type ReturnRow = {
  id: string;
  orderId: number;
  srid: string;
  nmId: number;
  subjectName: string;
  brand: string;
  barcode: string;
  size: string;
  shkId: number;
  stickerId: string;
  orderDate: string;
  returnType: string;
  reason: string;
  rawStatus: string;
  statusLabel: string;
  trackingStage: TrackingStage;
  isStatusActive: boolean;
  destinationOfficeId: number;
  destinationAddress: string;
  readyToReturnAt: string;
  completedAt: string;
  expiredAt: string;
};
type ReturnClaim = {
  id: string;
  nmId: number;
  claimType: number;
  status: number;
  statusExtended: number;
  userComment: string;
  wbComment: string;
  actions: string[];
  photos: string[];
  videos: string[];
  createdAt: string;
  updatedAt: string;
  deliveredAt: string;
  isArchive: boolean;
};
type ReturnsData = {
  source: string;
  syncedAt: string;
  window: { from: string; to: string; maxDays: number };
  returns: ReturnRow[];
  claims: ReturnClaim[];
  summary: { total: number; active: number; transit: number; ready: number; completed: number; unknown: number; activeClaims: number; archivedClaims: number };
  dataAvailability: { logisticsReport: boolean; buyerClaims: boolean };
  warnings: string[];
  syncSchedule: { timezone: string; hours: number[]; nextAt: string; mode: "manual" | "scheduled" };
};
type Product = { nmId: number; name: string; sku: string; image: string | null };

const DAY_MS = 86_400_000;

function beijingDateKey(value: Date | string = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00+08:00`);
  return beijingDateKey(new Date(date.getTime() + days * DAY_MS));
}

function dateTime(value?: string, dateOnly = false) {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T12:00:00+03:00` : value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(dateOnly ? {} : { hour: "2-digit", minute: "2-digit" }),
  }).format(date);
}

export default function ReturnsPage() {
  const today = beijingDateKey();
  const [periodFrom, setPeriodFrom] = useState(shiftDate(today, -179));
  const [periodTo, setPeriodTo] = useState(today);
  const [draftFrom, setDraftFrom] = useState(periodFrom);
  const [draftTo, setDraftTo] = useState(periodTo);
  const [data, setData] = useState<ReturnsData | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [claimFilter, setClaimFilter] = useState<"active" | "archived">("active");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const forceRefreshRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const returnParams = new URLSearchParams({ from: periodFrom, to: periodTo });
    const productParams = new URLSearchParams({ from: periodFrom, to: periodTo, view: "products" });
    if (forceRefreshRef.current) {
      returnParams.set("refresh", "manual");
      productParams.set("refresh", "manual");
    }
    forceRefreshRef.current = false;
    Promise.all([
      fetch(`/api/wb/returns?${returnParams}`, { signal: controller.signal, cache: "no-store", headers: { Accept: "application/json" } }).then(async (response) => {
        const body = await response.json() as ReturnsData | { error?: string };
        if (!response.ok) throw new Error("error" in body && body.error ? body.error : "退货数据读取失败");
        return body as ReturnsData;
      }),
      fetch(`/api/wb/dashboard?${productParams}`, { signal: controller.signal, cache: "no-store", headers: { Accept: "application/json" } })
        .then(async (response): Promise<{ products?: Product[] }> => response.ok ? await response.json() as { products?: Product[] } : { products: [] })
        .catch(() => ({ products: [] as Product[] })),
    ]).then(([returnsData, productData]) => {
      setData(returnsData);
      setProducts(productData.products || []);
      setWarning(!productData.products?.length ? "退货与物流数据已连接；商品图片接口暂未返回，订单信息仍保持完整。" : "");
      setError("");
    }).catch((reason: Error) => {
      if (reason.name !== "AbortError") setError(reason.message);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [periodFrom, periodTo, reloadKey]);

  useEffect(() => {
    const nextAt = data?.syncSchedule.nextAt;
    if (!nextAt) return;
    const delay = Math.max(1_000, new Date(nextAt).getTime() - Date.now() + 1_500);
    const timer = window.setTimeout(() => { setLoading(true); setReloadKey((key) => key + 1); }, delay);
    return () => window.clearTimeout(timer);
  }, [data?.syncSchedule.nextAt]);

  const productById = useMemo(() => new Map(products.map((product) => [product.nmId, product])), [products]);
  const filteredReturns = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (data?.returns || []).filter((row) => {
      const product = productById.get(row.nmId);
      const matchesStage = stageFilter === "all"
        || stageFilter === "active" && row.isStatusActive
        || row.trackingStage === stageFilter;
      const matchesQuery = !needle || [String(row.orderId), row.srid, String(row.nmId), product?.sku || "", product?.name || "", row.subjectName, row.reason, row.rawStatus, row.destinationAddress].some((value) => value.toLocaleLowerCase().includes(needle));
      return matchesStage && matchesQuery;
    });
  }, [data?.returns, productById, query, stageFilter]);
  const filteredClaims = useMemo(() => (data?.claims || []).filter((claim) => claim.isArchive === (claimFilter === "archived")), [claimFilter, data?.claims]);
  const selectedReturn = useMemo(() => (data?.returns || []).find((row) => row.id === selectedId) || null, [data?.returns, selectedId]);

  function applyPreset(days: number) {
    const to = beijingDateKey();
    const from = shiftDate(to, -(days - 1));
    setLoading(true); setDraftFrom(from); setDraftTo(to); setPeriodFrom(from); setPeriodTo(to); setSelectedId(null);
  }

  function applyCustomPeriod() {
    const fromStamp = new Date(`${draftFrom}T12:00:00+08:00`).getTime();
    const toStamp = new Date(`${draftTo}T12:00:00+08:00`).getTime();
    if (!Number.isFinite(fromStamp) || !Number.isFinite(toStamp) || fromStamp > toStamp) return;
    const maxFrom = shiftDate(draftTo, -179);
    const nextFrom = fromStamp < new Date(`${maxFrom}T12:00:00+08:00`).getTime() ? maxFrom : draftFrom;
    setLoading(true); setDraftFrom(nextFrom); setPeriodFrom(nextFrom); setPeriodTo(draftTo); setSelectedId(null);
  }

  function refresh() {
    forceRefreshRef.current = true;
    setLoading(true);
    setReloadKey((key) => key + 1);
  }

  function chooseStage(next: string) {
    setStageFilter(next);
    setQuery("");
    setSelectedId(null);
  }

  const messages = [warning, ...(data?.warnings || [])].filter(Boolean);

  return <main className="app-shell">
    <AppSidebar active="returns" syncedAt={data?.syncedAt} nextSyncAt={data?.syncSchedule.nextAt} loading={loading} error={error} onRefresh={refresh} />
    <section className="workspace product-workspace returns-workspace">
      <header className="topbar product-topbar"><div><p>RETURNS · WB 退货与商品移动</p><h1>退货</h1></div><div className="avatar">Z</div></header>

      <section className="product-period-panel returns-period-panel">
        <div className="product-period-heading"><strong>退货周期</strong><small>单次最多查询 180 天</small></div>
        <div className="period-presets"><span>快捷周期</span>{[30, 90, 180].map((days) => <button type="button" key={days} className={periodFrom === shiftDate(today, -(days - 1)) && periodTo === today ? "active" : ""} onClick={() => applyPreset(days)}>近 {days} 天</button>)}</div>
        <div className="period-custom"><label><span>开始</span><input type="date" value={draftFrom} max={draftTo} onChange={(event) => setDraftFrom(event.target.value)} /></label><b>→</b><label><span>结束</span><input type="date" value={draftTo} min={draftFrom} max={today} onChange={(event) => setDraftTo(event.target.value)} /></label><button type="button" onClick={applyCustomPeriod}>查询</button></div>
      </section>

      <section className="returns-notice"><span>↩</span><div><strong>退货订单与物流均来自 WB 官方 API</strong><p>退货物流读取 Goods Return Report；买家退货申请读取 Buyers Returns API。物流状态、取货地址和时间均按平台原始字段展示。</p></div><small>{data ? `${data.window.from} — ${data.window.to}` : "正在读取退货接口"}</small></section>
      {(error || messages.length) ? <section className={`returns-message ${error ? "error" : "warning"}`} role={error ? "alert" : undefined}><strong>{error ? "退货数据暂不可用" : "数据提示"}</strong><span>{error || messages.join("；")}</span></section> : null}

      <section className="returns-summary-grid" aria-label="退货物流汇总">
        <button type="button" className={stageFilter === "all" ? "active" : ""} onClick={() => chooseStage("all")}><span>全部退货</span><strong>{data?.summary.total ?? "—"}</strong><small>所选周期退货物流记录</small></button>
        <button type="button" className={`processing ${stageFilter === "active" ? "active" : ""}`} onClick={() => chooseStage("active")}><span>物流处理中</span><strong>{data?.summary.active ?? "—"}</strong><small>WB isStatusActive = 1</small></button>
        <button type="button" className={`transit ${stageFilter === "transit" ? "active" : ""}`} onClick={() => chooseStage("transit")}><span>运输至取货点</span><strong>{data?.summary.transit ?? "—"}</strong><small>正在退回途中</small></button>
        <button type="button" className={`ready ${stageFilter === "ready" ? "active" : ""}`} onClick={() => chooseStage("ready")}><span>已到达，可取回</span><strong>{data?.summary.ready ?? "—"}</strong><small>请关注取货地址和期限</small></button>
        <button type="button" className={`completed ${stageFilter === "completed" ? "active" : ""}`} onClick={() => chooseStage("completed")}><span>退货已完成</span><strong>{data?.summary.completed ?? "—"}</strong><small>已取回或平台已完成</small></button>
        <button type="button" className={`unknown ${stageFilter === "unknown" ? "active" : ""}`} onClick={() => chooseStage("unknown")}><span>状态待确认</span><strong>{data?.summary.unknown ?? "—"}</strong><small>平台当前未给出明确节点</small></button>
      </section>

      <section className="returns-claims-panel">
        <div className="returns-section-heading"><div><h2>买家退货申请</h2><p>WB 该接口只返回最近 14 天；这里保持只读展示，不会自动同意或拒绝申请。</p></div><div className="returns-claim-tabs"><button type="button" className={claimFilter === "active" ? "active" : ""} onClick={() => setClaimFilter("active")}>待处理 {data?.summary.activeClaims ?? 0}</button><button type="button" className={claimFilter === "archived" ? "active" : ""} onClick={() => setClaimFilter("archived")}>已归档 {data?.summary.archivedClaims ?? 0}</button></div></div>
        <div className="returns-claim-list">
          {filteredClaims.map((claim) => { const product = productById.get(claim.nmId); return <article key={claim.id}><header><b>{product?.sku || `WB ${claim.nmId}`}</b><span>{claim.isArchive ? "已归档" : "待处理"}</span></header><p>{claim.userComment}</p><small>{claim.wbComment}</small><footer><em>状态代码 {claim.status}/{claim.statusExtended}</em><em>{dateTime(claim.updatedAt || claim.createdAt)}</em></footer></article>; })}
          {!loading && filteredClaims.length === 0 && <div className="returns-empty"><strong>{claimFilter === "active" ? "最近 14 天没有待处理退货申请" : "最近 14 天没有已归档退货申请"}</strong><span>退货物流记录仍在下方正常展示。</span></div>}
        </div>
      </section>

      <section className="returns-table-panel">
        <div className="returns-table-toolbar"><div><h2>退货订单与物流明细</h2><p>点击“查看物流”可核对平台状态、目的网点和全部官方时间字段。</p></div><div className="returns-filters"><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索订单号、SKU、商品、原因或地址" aria-label="搜索退货订单" /><select value={stageFilter} onChange={(event) => chooseStage(event.target.value)} aria-label="退货物流状态"><option value="all">全部物流状态</option><option value="active">物流处理中</option><option value="transit">运输至取货点</option><option value="ready">已到达，可取回</option><option value="completed">退货已完成</option><option value="unknown">状态待确认</option></select></div></div>
        <div className="returns-table-wrap"><table className="returns-table"><thead><tr><th>商品</th><th>订单号</th><th>下单日期</th><th>退货类型</th><th>退货原因</th><th>物流状态</th><th>目的取货点</th><th>可取回时间</th><th>完成时间</th><th>超期时间</th><th>物流标识</th><th>追踪</th></tr></thead><tbody>
          {filteredReturns.map((row) => { const product = productById.get(row.nmId); return <tr key={row.id}>
            <td><div className="returns-product-cell">{product?.image ? <span className="returns-product-photo" style={{ backgroundImage: `url(${product.image})` }} /> : <span className="returns-product-photo placeholder">W</span>}<div><b>{product?.sku || `WB ${row.nmId}`}</b><small title={product?.name || row.subjectName}>{product?.name || row.subjectName}</small><em>WB {row.nmId} · {row.brand}</em></div></div></td>
            <td><b>{row.orderId || "—"}</b><small>srid {row.srid || "—"}</small></td>
            <td><b>{dateTime(row.orderDate, true)}</b><small>原订单日期</small></td>
            <td><b title={row.returnType}>{row.returnType}</b><small>WB returnType</small></td>
            <td><b title={row.reason}>{row.reason}</b><small>WB reason</small></td>
            <td><span className={`returns-stage ${row.trackingStage}`}>{row.statusLabel}</span><small>{row.rawStatus} · {row.isStatusActive ? "处理中" : "已结束"}</small></td>
            <td><b title={row.destinationAddress}>{row.destinationAddress}</b><small>网点 {row.destinationOfficeId || "—"}</small></td>
            <td><b>{dateTime(row.readyToReturnAt)}</b></td>
            <td><b>{dateTime(row.completedAt)}</b></td>
            <td><b>{dateTime(row.expiredAt)}</b></td>
            <td><b>SHK {row.shkId || "—"}</b><small>贴纸 {row.stickerId} · 条码 {row.barcode}</small></td>
            <td><button type="button" onClick={() => setSelectedId(row.id)}>查看物流</button></td>
          </tr>; })}
          {!loading && filteredReturns.length === 0 && <tr className="empty-row"><td colSpan={12}>没有符合当前筛选条件的退货订单</td></tr>}
        </tbody></table></div>
        <footer className="returns-table-footer"><span>共 {filteredReturns.length} 条退货记录</span><span>WB 当前只开放状态与关键时间，不提供逐站扫描轨迹；系统不会补造物流节点。</span></footer>
      </section>

      {selectedReturn && <section className="returns-tracking-panel">
        <div className="returns-section-heading"><div><h2>订单 {selectedReturn.orderId} · 退货物流追踪</h2><p>{selectedReturn.subjectName} · WB {selectedReturn.nmId}</p></div><button type="button" onClick={() => setSelectedId(null)}>关闭</button></div>
        <div className="returns-tracking-body">
          <article className="returns-current-status"><span>WB 当前物流状态</span><b className={`returns-stage ${selectedReturn.trackingStage}`}>{selectedReturn.statusLabel}</b><small>{selectedReturn.rawStatus} · 最近同步 {dateTime(data?.syncedAt)}</small></article>
          <div className="returns-timeline">
            <article className="done"><i>1</i><div><b>原订单创建</b><span>{dateTime(selectedReturn.orderDate, true)}</span></div></article>
            <article className={selectedReturn.isStatusActive ? "current" : "done"}><i>2</i><div><b>{selectedReturn.statusLabel}</b><span>{selectedReturn.destinationAddress}</span></div></article>
            <article className={selectedReturn.readyToReturnAt ? "done" : "waiting"}><i>3</i><div><b>可取回时间</b><span>{dateTime(selectedReturn.readyToReturnAt)}</span></div></article>
            <article className={selectedReturn.completedAt ? "done" : "waiting"}><i>4</i><div><b>退货完成</b><span>{dateTime(selectedReturn.completedAt)}</span></div></article>
          </div>
          <div className="returns-tracking-facts"><article><span>退货类型</span><b>{selectedReturn.returnType}</b></article><article><span>退货原因</span><b>{selectedReturn.reason}</b></article><article><span>取货网点</span><b>{selectedReturn.destinationAddress}</b><small>ID {selectedReturn.destinationOfficeId || "—"}</small></article><article><span>物流标识</span><b>SHK {selectedReturn.shkId}</b><small>贴纸 {selectedReturn.stickerId} · srid {selectedReturn.srid}</small></article></div>
        </div>
      </section>}
    </section>
  </main>;
}
