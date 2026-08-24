"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AppSidebar } from "../_components/app-sidebar";

type FinanceMovement = {
  id: string;
  reportRowId: string;
  reportId: string;
  date: string;
  operation: string;
  rawOperation: string;
  direction: "credit" | "debit" | "neutral";
  orderNumber: string;
  orderUid: string;
  srid: string;
  nmId: number;
  sellerSku: string;
  title: string;
  transactionAmount: number;
  settlementAmount: number;
  platformFees: number;
  additionalPayment: number;
  netChange: number;
  currency: string;
  balanceBefore: number | null;
  balanceAfter: number | null;
  feeBreakdown: { logistics: number; acquiring: number; penalty: number; deduction: number; storage: number; acceptance: number };
};

type FinanceData = {
  syncedAt: string;
  syncSchedule: { nextAt: string };
  dataAvailability: { balance: boolean; financeReport: boolean };
  metrics: { salesAmount: number; ordersCount: number; payoutAmount: number | null; returnsCount: number; returnRate: number; balanceCurrent: number | null; balanceAvailable: number | null };
  accountBalance: { available: boolean; source: string; currency: string; current: number | null; forWithdraw: number | null; rawCurrent: number | null; rawForWithdraw: number | null; unitScale: number; fetchedAt: string | null };
  settlement: { available: boolean; source: string; currency: string; fetchedAt: string | null; rowsCount: number; unallocatedExpenses: number };
  financeMovementSummary: { entries: number; creditEntries: number; debitEntries: number; matchedOrderEntries: number; credits: number; debits: number; netChange: number; currency: string };
  financeBalanceTrace: { available: boolean; mode: string; source: string; anchorBalance: number | null; anchorAt: string | null; calculatedOpeningBalance: number | null; includesWithdrawalsOrUnpublishedChanges: boolean };
  financeMovements: FinanceMovement[];
  trend: Array<{ date: string; sales: number; orders: number }>;
};

const MOVEMENT_PAGE_SIZE = 20;

function toInputDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function shiftDate(dateString: string, days: number) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
function money(value: number | null | undefined, currency = "CNY") {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat("zh-CN", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}
function compact(value: string, start = 10, end = 7) {
  if (!value || value.length <= start + end + 1) return value;
  return `${value.slice(0, start)}…${value.slice(-end)}`;
}
function timestamp(value?: string | null) {
  if (!value) return "等待首次实时同步";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}
function feeBreakdown(movement: FinanceMovement) {
  const labels: Array<[keyof FinanceMovement["feeBreakdown"], string]> = [
    ["logistics", "物流"], ["acquiring", "收款"], ["penalty", "罚款"], ["deduction", "其他扣款"], ["storage", "仓储"], ["acceptance", "入库"],
  ];
  const parts = labels.filter(([key]) => movement.feeBreakdown[key] > 0).map(([key, label]) => `${label} ${movement.feeBreakdown[key].toFixed(2)}`);
  return parts.length ? parts.join("＋") : "无额外费用";
}

export default function FinancePage() {
  const today = toInputDate(new Date());
  const [days, setDays] = useState(30);
  const from = days === 0 ? "2024-01-29" : shiftDate(today, -(days - 1));
  const [data, setData] = useState<FinanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [showMovements, setShowMovements] = useState(false);
  const [movementQuery, setMovementQuery] = useState("");
  const [movementFilter, setMovementFilter] = useState<"all" | "credit" | "debit">("all");
  const [movementPage, setMovementPage] = useState(1);
  const forceRefreshRef = useRef(false);
  const movementPanelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ from, to: today, view: "finance", includeFinance: "true", includeOrders: "true" });
    if (forceRefreshRef.current) params.set("refresh", "manual");
    forceRefreshRef.current = false;
    fetch(`/api/wb/dashboard?${params.toString()}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => { const body = await response.json() as FinanceData | { error?: string }; if (!response.ok) throw new Error("error" in body && body.error ? body.error : "财务数据读取失败"); return body as FinanceData; })
      .then((body) => { setData(body); setMovementPage(1); })
      .catch((reason: Error) => { if (reason.name !== "AbortError") setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [from, today, reloadKey]);

  useEffect(() => {
    const nextAt = data?.syncSchedule?.nextAt;
    if (!nextAt) return;
    const timer = window.setTimeout(() => { if (window.localStorage.getItem("wb-last-auto-sync") === nextAt) { window.setTimeout(() => { setLoading(true); setReloadKey((key) => key + 1); }, 12_000); return; } window.localStorage.setItem("wb-last-auto-sync", nextAt); setLoading(true); setReloadKey((key) => key + 1); }, Math.max(1_000, new Date(nextAt).getTime() - Date.now() + 1_500));
    return () => window.clearTimeout(timer);
  }, [data?.syncSchedule?.nextAt]);

  useEffect(() => {
    if (!showMovements) return;
    const frame = window.requestAnimationFrame(() => movementPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    return () => window.cancelAnimationFrame(frame);
  }, [showMovements]);

  const filteredMovements = useMemo(() => {
    const needle = movementQuery.trim().toLocaleLowerCase();
    return (data?.financeMovements ?? []).filter((movement) => {
      if (movementFilter !== "all" && movement.direction !== movementFilter) return false;
      if (!needle) return true;
      return [movement.orderNumber, movement.orderUid, movement.srid, movement.sellerSku, String(movement.nmId || ""), movement.operation, movement.rawOperation, movement.reportRowId]
        .some((value) => value.toLocaleLowerCase().includes(needle));
    });
  }, [data?.financeMovements, movementFilter, movementQuery]);
  const movementPageCount = Math.max(1, Math.ceil(filteredMovements.length / MOVEMENT_PAGE_SIZE));
  const visibleMovements = filteredMovements.slice((movementPage - 1) * MOVEMENT_PAGE_SIZE, movementPage * MOVEMENT_PAGE_SIZE);

  const metrics = data?.metrics;
  const balance = data?.accountBalance;
  const settlement = data?.settlement;
  const movementSummary = data?.financeMovementSummary;
  const settlementCurrency = settlement?.currency || balance?.currency || "CNY";
  const financeReady = Boolean(balance?.available && settlement?.available);
  function refresh() { forceRefreshRef.current = true; setLoading(true); setError(""); setReloadKey((key) => key + 1); }

  return (
    <main className="app-shell">
      <AppSidebar active="finance" syncedAt={balance?.fetchedAt || data?.syncedAt} nextSyncAt={data?.syncSchedule?.nextAt} loading={loading} error={error} onRefresh={refresh} />
      <section className="workspace product-workspace">
        <header className="topbar product-topbar"><div><p className="eyebrow">FINANCE · WB 账户与销售结算</p><h1>回款与余额</h1></div><div className="period-presets finance-periods">{[7, 30, 90, 180, 0].map((value) => <button key={value} className={days === value ? "active" : ""} disabled={loading} onClick={() => { setLoading(true); setDays(value); }}>{value ? `近 ${value} 天` : "全部历史"}</button>)}</div></header>
        <div className={`notice ${error ? "error" : financeReady ? "connected" : ""}`}><div className="notice-icon">{loading ? "↻" : error ? "!" : financeReady ? "✓" : "!"}</div><div><strong>{loading ? "正在读取 WB 余额与正式财务明细" : error ? "财务数据同步未完成" : financeReady ? "真实余额与财务结算明细已更新" : "部分财务数据暂时不可用"}</strong><p>{error || `${from} 至 ${today}；余额取自 WB 余额接口，资金明细取自 WB 正式财务结算报告。`}</p></div></div>
        <section className="finance-stat-grid">
          <article className="featured"><span>本期已结算净额</span><strong>{settlement?.available ? money(movementSummary?.netChange ?? metrics?.payoutAmount, settlementCurrency) : "—"}</strong><small>{settlement?.available ? `${movementSummary?.entries ?? 0} 条 WB 正式结算明细` : "未读取到正式财务报告，不使用预估值代替"}</small></article>
          <button type="button" className={`finance-balance-card ${showMovements ? "active" : ""}`} aria-expanded={showMovements} onClick={() => setShowMovements((value) => !value)}><span>账户当前余额</span><strong>{money(balance?.current, balance?.currency || "CNY")}</strong><small>WB 余额接口 · 更新于 {timestamp(balance?.fetchedAt)}</small><em>{showMovements ? "收起资金明细 ↑" : "点击查看逐笔资金变动 →"}</em></button>
          <article><span>可提现余额</span><strong>{money(balance?.forWithdraw, balance?.currency || "CNY")}</strong><small>WB 字段 for_withdraw · 当前可提取金额</small></article>
          <article><span>本期销售额</span><strong>{money(metrics?.salesAmount, "RUB")}</strong><small>{metrics?.ordersCount ?? 0} 笔有效订单 · 销售端货币</small></article>
          <article className={(metrics?.returnsCount ?? 0) > 0 ? "attention" : ""}><span>退货与取消</span><strong>{metrics?.returnsCount ?? 0}</strong><small>比例 {(metrics?.returnRate ?? 0).toFixed(1)}%</small></article>
        </section>

        {showMovements && <section ref={movementPanelRef} className="finance-movement-panel">
          <div className="finance-movement-heading"><div><span>WB OFFICIAL FINANCE LEDGER</span><h2>账户资金结算明细</h2><p>每一行对应 WB 正式财务报告的一行；末列以当前余额为锚点，按 WB 行号倒推账单余额轨迹。</p></div><div className="finance-movement-source"><b>{settlement?.available ? "财务 API 已连接" : "财务 API 暂不可用"}</b><small>{settlement?.source}<br />更新于 {timestamp(settlement?.fetchedAt)}</small></div></div>
          <div className="finance-movement-summary"><div><span>入账合计</span><b className="movement-credit">+{money(movementSummary?.credits ?? 0, settlementCurrency)}</b><small>{movementSummary?.creditEntries ?? 0} 条</small></div><div><span>扣款合计</span><b className="movement-debit">−{money(movementSummary?.debits ?? 0, settlementCurrency)}</b><small>{movementSummary?.debitEntries ?? 0} 条</small></div><div><span>本期净变动</span><b className={(movementSummary?.netChange ?? 0) >= 0 ? "movement-credit" : "movement-debit"}>{money(movementSummary?.netChange ?? 0, settlementCurrency)}</b><small>{movementSummary?.entries ?? 0} 条 WB 明细</small></div></div>
          <div className="finance-movement-toolbar"><label><span>⌕</span><input type="search" value={movementQuery} placeholder="搜索订单号、SKU、类型或 WB 行号" onChange={(event) => { setMovementQuery(event.target.value); setMovementPage(1); }} /></label><select value={movementFilter} onChange={(event) => { setMovementFilter(event.target.value as "all" | "credit" | "debit"); setMovementPage(1); }}><option value="all">全部资金变动</option><option value="credit">只看入账</option><option value="debit">只看扣款</option></select><button type="button" onClick={() => setShowMovements(false)}>收起明细</button></div>
          <div className="finance-movement-table-wrap">
            <table className="finance-movement-table">
              <thead><tr><th>结算日期</th><th>变动类型</th><th>订单 / 关联号</th><th>SKU</th><th>成交与佣金后结算</th><th>平台费用</th><th>补款</th><th>本笔净变动</th><th>WB 报告行号</th><th>账单余额轨迹<small>由当前余额倒推</small></th></tr></thead>
              <tbody>
                {visibleMovements.map((movement) => <tr key={movement.id}>
                  <td><b>{movement.date || "—"}</b></td>
                  <td><span className={`movement-kind ${movement.direction}`}>{movement.operation}</span><small>{movement.rawOperation || "WB 财务结算"}</small></td>
                  <td><b title={movement.orderNumber || movement.orderUid || movement.srid}>{movement.orderNumber ? `订单 ${movement.orderNumber}` : movement.orderUid ? compact(movement.orderUid) : movement.srid ? compact(movement.srid) : "平台级费用"}</b><small title={movement.orderUid || movement.srid}>{movement.orderUid ? `UID ${compact(movement.orderUid, 8, 6)}` : movement.srid ? `SRID ${compact(movement.srid, 8, 6)}` : "未关联具体订单"}</small></td>
                  <td><b>{movement.sellerSku || (movement.nmId ? String(movement.nmId) : "—")}</b><small>{movement.nmId ? `WB ${movement.nmId}` : "平台级"}</small></td>
                  <td><b>{money(movement.transactionAmount, movement.currency)}</b><small>佣金后 {money(movement.settlementAmount, movement.currency)}</small></td>
                  <td><b className={movement.platformFees > 0 ? "movement-debit" : ""}>{movement.platformFees > 0 ? `−${money(movement.platformFees, movement.currency)}` : money(0, movement.currency)}</b><small>{feeBreakdown(movement)}</small></td>
                  <td><b className={movement.additionalPayment > 0 ? "movement-credit" : movement.additionalPayment < 0 ? "movement-debit" : ""}>{money(movement.additionalPayment, movement.currency)}</b></td>
                  <td><b className={movement.netChange >= 0 ? "movement-credit" : "movement-debit"}>{movement.netChange > 0 ? "+" : ""}{money(movement.netChange, movement.currency)}</b></td>
                  <td><b>{movement.reportRowId || "—"}</b><small>{movement.reportId ? `报告 ${movement.reportId}` : "WB 唯一行号"}</small></td>
                  <td className="movement-balance-trace">{movement.balanceBefore !== null && movement.balanceAfter !== null ? <><b>{money(movement.balanceBefore, movement.currency)} → {money(movement.balanceAfter, movement.currency)}</b><small>账单推算 · 本笔 {movement.netChange >= 0 ? "增加" : "减少"} {money(Math.abs(movement.netChange), movement.currency)}</small></> : <><b>—</b><small>仅支持截至今日的余额轨迹</small></>}</td>
                </tr>)}
                {!loading && visibleMovements.length === 0 && <tr className="empty-row"><td colSpan={10}>{settlement?.available ? "没有符合当前筛选条件的财务明细" : "WB 正式财务结算明细暂时无法读取，请稍后手动同步"}</td></tr>}
              </tbody>
            </table>
          </div>
          <footer className="product-table-footer"><span>共 {filteredMovements.length} 条 · 第 {Math.min(movementPage, movementPageCount)} / {movementPageCount} 页</span><div><button onClick={() => setMovementPage((value) => Math.max(1, value - 1))} disabled={movementPage <= 1}>← 上一页</button><button onClick={() => setMovementPage((value) => Math.min(movementPageCount, value + 1))} disabled={movementPage >= movementPageCount}>下一页 →</button></div></footer>
          <p className="finance-ledger-note">准确性说明：每笔净变动来自 WB 正式财务报告并按 WB 行号去重；余额轨迹以实时当前余额为锚点，按结算行号倒推。WB 未提供每笔历史余额快照及完整提现流水 API，因此该列标记为“账单推算”，不会冒充平台原始余额流水。</p>
        </section>}

        <section className="product-table-panel">
          <div className="product-table-toolbar"><div><h2>每日销售与订单</h2><p>用于对照销售额变化；真实回款与扣费以上方 WB 正式财务结算明细为准。</p></div></div>
          <div className="product-detail-table-wrap"><table className="finance-detail-table"><thead><tr><th>日期</th><th>销售额</th><th>订单数</th><th>日均单价</th></tr></thead><tbody>{[...(data?.trend ?? [])].reverse().map((item) => <tr key={item.date}><td><b>{item.date}</b></td><td><b>{money(item.sales, "RUB")}</b></td><td><span>{item.orders}</span></td><td><span>{item.orders ? money(item.sales / item.orders, "RUB") : "—"}</span></td></tr>)}{!loading && !data?.trend.length && <tr className="empty-row"><td colSpan={4}>本周期暂无销售记录</td></tr>}</tbody></table></div>
        </section>
      </section>
    </main>
  );
}
