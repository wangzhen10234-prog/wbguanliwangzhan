"use client";

import { useEffect, useRef, useState } from "react";
import { AppSidebar } from "../_components/app-sidebar";

type FinanceData = {
  syncedAt: string;
  syncSchedule: { nextAt: string };
  metrics: { salesAmount: number; ordersCount: number; payoutAmount: number; returnsCount: number; returnRate: number; balanceCurrent: number; balanceAvailable: number };
  trend: Array<{ date: string; sales: number; orders: number }>;
};

function toInputDate(date: Date) { return date.toISOString().slice(0, 10); }
function shiftDate(dateString: string, days: number) { const date = new Date(`${dateString}T12:00:00`); date.setDate(date.getDate() + days); return toInputDate(date); }
function rubles(value: number) { return `₽ ${Math.round(value || 0).toLocaleString("en-US")}`; }

export default function FinancePage() {
  const today = toInputDate(new Date());
  const [days, setDays] = useState(30);
  const from = shiftDate(today, -(days - 1));
  const [data, setData] = useState<FinanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const forceRefreshRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ from, to: today });
    if (forceRefreshRef.current) params.set("refresh", "manual");
    forceRefreshRef.current = false;
    fetch(`/api/wb/dashboard?${params.toString()}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => { const body = await response.json() as FinanceData | { error?: string }; if (!response.ok) throw new Error("error" in body && body.error ? body.error : "财务数据读取失败"); return body as FinanceData; })
      .then(setData)
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

  const metrics = data?.metrics;
  function refresh() { forceRefreshRef.current = true; setLoading(true); setError(""); setReloadKey((key) => key + 1); }

  return (
    <main className="app-shell">
      <AppSidebar active="finance" syncedAt={data?.syncedAt} nextSyncAt={data?.syncSchedule?.nextAt} loading={loading} error={error} onRefresh={refresh} />
      <section className="workspace product-workspace">
        <header className="topbar product-topbar"><div><p className="eyebrow">FINANCE · WB 账户与销售结算</p><h1>回款与余额</h1></div><div className="period-presets finance-periods">{[7, 30, 90].map((value) => <button key={value} className={days === value ? "active" : ""} disabled={loading} onClick={() => { setLoading(true); setDays(value); }}>近 {value} 天</button>)}</div></header>
        <div className={`notice ${error ? "error" : "connected"}`}><div className="notice-icon">{loading ? "↻" : error ? "!" : "✓"}</div><div><strong>{loading ? "正在读取财务与余额数据" : error ? "财务数据同步未完成" : "账户余额与回款数据已更新"}</strong><p>{error || `${from} 至 ${today}；余额为当前值，销售与预计回款按周期统计。`}</p></div></div>
        <section className="finance-stat-grid">
          <article className="featured"><span>预计回款</span><strong>{loading && !data ? "—" : rubles(metrics?.payoutAmount ?? 0)}</strong><small>最终金额以 WB 财务结算报告为准</small></article>
          <article><span>可提现余额</span><strong>{rubles(metrics?.balanceAvailable ?? 0)}</strong><small>当前账户可提取金额</small></article>
          <article><span>账户当前余额</span><strong>{rubles(metrics?.balanceCurrent ?? 0)}</strong><small>来自 WB Finance API</small></article>
          <article><span>本期销售额</span><strong>{rubles(metrics?.salesAmount ?? 0)}</strong><small>{metrics?.ordersCount ?? 0} 笔有效订单</small></article>
          <article className={(metrics?.returnsCount ?? 0) > 0 ? "attention" : ""}><span>退货与取消</span><strong>{metrics?.returnsCount ?? 0}</strong><small>比例 {(metrics?.returnRate ?? 0).toFixed(1)}%</small></article>
        </section>
        <section className="product-table-panel">
          <div className="product-table-toolbar"><div><h2>每日销售与订单</h2><p>用于对照销售额变化；回款以最终结算单为准。</p></div></div>
          <div className="product-detail-table-wrap"><table className="finance-detail-table"><thead><tr><th>日期</th><th>销售额</th><th>订单数</th><th>日均单价</th></tr></thead><tbody>{[...(data?.trend ?? [])].reverse().map((item) => <tr key={item.date}><td><b>{item.date}</b></td><td><b>{rubles(item.sales)}</b></td><td><span>{item.orders}</span></td><td><span>{item.orders ? rubles(item.sales / item.orders) : "—"}</span></td></tr>)}{!loading && !data?.trend.length && <tr className="empty-row"><td colSpan={4}>本周期暂无财务记录</td></tr>}</tbody></table></div>
        </section>
      </section>
    </main>
  );
}
