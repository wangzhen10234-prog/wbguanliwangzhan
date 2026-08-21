"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AppSidebar } from "./_components/app-sidebar";

type DashboardData = {
  source: "wildberries";
  syncedAt: string;
  syncSchedule: { timezone: string; hours: number[]; currentSlot: string; nextAt: string; mode: "manual" | "scheduled" };
  period: { from: string; to: string; days: number };
  metrics: {
    salesAmount: number;
    ordersCount: number;
    cancelledOrders: number;
    payoutAmount: number;
    returnsCount: number;
    returnRate: number;
    balanceCurrent: number;
    balanceAvailable: number;
  };
  trend: { date: string; sales: number; orders: number }[];
  categories: { name: string; value: number; share: number }[];
  products: {
    nmId: number;
    name: string;
    sku: string;
    category: string;
    image: string | null;
    sales: number;
    orders: number;
    units: number;
    stock: number;
    buyoutRate: number;
  }[];
  inventory: {
    available: boolean;
    totalQuantity: number;
    productCount: number;
    critical: number;
    low: number;
    slow: number;
  };
};

type RangeKey = "7" | "14" | "21";

const MS_PER_DAY = 86_400_000;
const colors = ["#7558e8", "#ac9bf3", "#d5cef9", "#ece8fb"];

function toInputDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function shiftDate(dateString: string, days: number) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + days);
  return toInputDate(date);
}

function countDays(start: string, end: string) {
  return Math.round((new Date(`${end}T12:00:00`).getTime() - new Date(`${start}T12:00:00`).getTime()) / MS_PER_DAY) + 1;
}

function formatDate(dateString: string) {
  const date = new Date(`${dateString}T12:00:00`);
  return `${date.getMonth() + 1}月 ${date.getDate()}日`;
}

function formatShortDate(dateString: string) {
  const date = new Date(`${dateString}T12:00:00`);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatRubles(value: number) {
  return `₽ ${Math.round(value || 0).toLocaleString("en-US")}`;
}

function formatCompactRubles(value: number) {
  const amount = Math.abs(value || 0);
  if (amount >= 1_000_000) return `₽${(value / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `₽${Math.round(value / 1_000)}K`;
  return `₽${Math.round(value)}`;
}

function syncTime(value?: string) {
  if (!value) return "正在首次同步";
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export default function Home() {
  const today = toInputDate(new Date());
  const earliest = shiftDate(today, -89);
  const [range, setRange] = useState<RangeKey | "custom">("21");
  const [customStart, setCustomStart] = useState(() => shiftDate(today, -20));
  const [customEnd, setCustomEnd] = useState(today);
  const [appliedStart, setAppliedStart] = useState(() => shiftDate(today, -20));
  const [appliedEnd, setAppliedEnd] = useState(today);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [dateError, setDateError] = useState("");
  const [showConnect, setShowConnect] = useState(false);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const dateControlRef = useRef<HTMLDivElement>(null);
  const forceRefreshRef = useRef(false);

  const periodEnd = range === "custom" ? appliedEnd : today;
  const periodStart = range === "custom" ? appliedStart : shiftDate(today, -(Number(range) - 1));
  const periodDays = countDays(periodStart, periodEnd);
  const rangeLabel = range === "custom" ? `自定义 · ${periodDays} 天` : `近 ${range} 天`;
  const dateLabel = `${formatDate(periodStart)} — ${formatDate(periodEnd)}`;

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ from: periodStart, to: periodEnd });
    if (forceRefreshRef.current) params.set("refresh", "manual");
    forceRefreshRef.current = false;
    fetch(`/api/wb/dashboard?${params.toString()}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then(async (response) => {
        const body = (await response.json()) as DashboardData | { error?: string };
        if (!response.ok) throw new Error("error" in body && body.error ? body.error : "同步失败，请稍后重试");
        return body as DashboardData;
      })
      .then((body) => setData(body))
      .catch((error: Error) => {
        if (error.name !== "AbortError") setDataError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [periodStart, periodEnd, reloadKey]);

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
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowConnect(false);
        setShowDatePicker(false);
      }
    };
    const closeDatePicker = (event: PointerEvent) => {
      if (dateControlRef.current && !dateControlRef.current.contains(event.target as Node)) setShowDatePicker(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("pointerdown", closeDatePicker);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("pointerdown", closeDatePicker);
    };
  }, []);

  const trend = useMemo(() => {
    const source = data?.trend ?? [];
    if (source.length <= 21) return source;
    return Array.from({ length: 21 }, (_, index) => source[Math.round((index * (source.length - 1)) / 20)]);
  }, [data]);
  const maxSales = Math.max(1, ...trend.map((item) => Math.max(0, item.sales)));
  const maxOrders = Math.max(1, ...trend.map((item) => item.orders));
  const chartMax = Math.ceil(maxSales / 1000) * 1000 || 1;
  const labelEvery = trend.length > 14 ? 3 : trend.length > 7 ? 2 : 1;
  const averageSales = data ? data.metrics.salesAmount / Math.max(1, data.period.days) : 0;
  const peakSales = trend.length ? Math.max(...trend.map((item) => item.sales)) : 0;
  const categoryStops = useMemo(() => {
    const result = (data?.categories ?? []).reduce<{ cursor: number; pieces: string[] }>((acc, category, index) => ({
      cursor: acc.cursor + category.share,
      pieces: [...acc.pieces, `${colors[index]} ${acc.cursor}% ${acc.cursor + category.share}%`],
    }), { cursor: 0, pieces: [] });
    const pieces = result.cursor < 100 ? [...result.pieces, `#f1eef8 ${result.cursor}% 100%`] : result.pieces;
    return `conic-gradient(${pieces.join(",")})`;
  }, [data]);

  function choosePreset(value: RangeKey) {
    setLoading(true);
    setDataError("");
    setReloadKey((key) => key + 1);
    setRange(value);
    setCustomStart(shiftDate(today, -(Number(value) - 1)));
    setCustomEnd(today);
    setDateError("");
    setShowDatePicker(false);
  }

  function applyCustomRange() {
    if (!customStart || !customEnd) return setDateError("请选择完整的开始和结束日期");
    if (customStart > customEnd) return setDateError("开始日期不能晚于结束日期");
    if (customStart < earliest || countDays(customStart, customEnd) > 90) return setDateError("订单与销售支持查询近 90 天内、最长 90 天的周期");
    setLoading(true);
    setDataError("");
    setReloadKey((key) => key + 1);
    setAppliedStart(customStart);
    setAppliedEnd(customEnd);
    setRange("custom");
    setDateError("");
    setShowDatePicker(false);
  }

  function refresh() {
    forceRefreshRef.current = true;
    setLoading(true);
    setDataError("");
    setReloadKey((key) => key + 1);
    setShowConnect(false);
  }

  function exportCsv() {
    if (!data?.products.length) return;
    const header = ["商品名称", "WB nmId", "SKU", "类目", "销售额(卢布)", "订单数", "售出件数", "库存", "成交率"];
    const rows = data.products.map((item) => [item.name, item.nmId, item.sku, item.category, Math.round(item.sales), item.orders, item.units, item.stock, `${item.buyoutRate.toFixed(1)}%`]);
    const csv = "\uFEFF" + [header, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `wb-insight-${periodStart}-${periodEnd}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const metrics = data?.metrics;
  const products = data?.products.slice(0, 5) ?? [];
  const inventory = data?.inventory;
  const inventoryAlerts = inventory?.available ? inventory.critical + inventory.low + inventory.slow : 0;

  return (
    <main className="app-shell">
      <AppSidebar active="overview" syncedAt={data?.syncedAt} nextSyncAt={data?.syncSchedule?.nextAt} loading={loading} error={dataError} onRefresh={refresh} />

      <section className="workspace" id="overview">
        <header className="topbar">
          <div><p className="eyebrow">Панель продавца · Live workspace</p><h1>经营总览</h1></div>
          <div className="top-actions">
            <button className="export-button" onClick={exportCsv} disabled={!products.length}>↓ 导出 CSV</button>
            <div className="date-control" ref={dateControlRef}>
              <button className="date-button" onClick={() => setShowDatePicker((open) => !open)} aria-expanded={showDatePicker} aria-haspopup="dialog"><span>◫</span><em>{range === "custom" ? "自定义" : `近 ${range} 天`}</em><b>{dateLabel}</b><i>⌄</i></button>
              {showDatePicker && <section className="date-popover" role="dialog" aria-label="选择分析周期">
                <div className="date-popover-head"><div><strong>选择时间周期</strong><small>真实指标、图表和导出数据会同步更新</small></div><button onClick={() => setShowDatePicker(false)} aria-label="关闭">×</button></div>
                <div className="quick-ranges" aria-label="快捷周期"><button className={range === "7" ? "selected" : ""} onClick={() => choosePreset("7")}>近 7 天</button><button className={range === "14" ? "selected" : ""} onClick={() => choosePreset("14")}>近 14 天</button><button className={range === "21" ? "selected" : ""} onClick={() => choosePreset("21")}>近 21 天</button></div>
                <div className="custom-range-title"><span>自定义日期（近 90 天）</span><i /></div>
                <div className="date-inputs"><label><span>开始日期</span><input type="date" value={customStart} min={earliest} max={today} onChange={(event) => { setCustomStart(event.target.value); setDateError(""); }} /></label><b>→</b><label><span>结束日期</span><input type="date" value={customEnd} min={customStart || earliest} max={today} onChange={(event) => { setCustomEnd(event.target.value); setDateError(""); }} /></label></div>
                {dateError && <p className="date-error" role="alert">{dateError}</p>}
                <div className="date-popover-foot"><span>{customStart && customEnd && customStart <= customEnd ? `共 ${countDays(customStart, customEnd)} 天` : "请选择有效日期"}</span><button onClick={applyCustomRange}>应用此周期</button></div>
              </section>}
            </div>
            <div className="avatar">Z</div>
          </div>
        </header>

        <div className={`notice ${dataError ? "error" : "connected"}`}>
          <div className="notice-icon">{loading ? "↻" : dataError ? "!" : "✓"}</div>
          <div><strong>{loading ? "正在从 Wildberries 同步真实数据" : dataError ? "本次同步未完成" : "Wildberries 实时数据已连接"}</strong><p>{loading ? `正在读取 ${dateLabel} 的订单、销售、库存与财务数据。` : dataError || `统计周期 ${dateLabel}，最近同步于 ${syncTime(data?.syncedAt)}。`}</p></div>
          <button onClick={dataError ? refresh : () => setShowConnect(true)}>{dataError ? "重新同步" : "安全状态"}</button>
        </div>

        <section className="metric-grid" aria-label={`${rangeLabel}核心经营指标`}>
          <article className="metric-card featured"><div className="metric-head"><span>销售额</span><i>↗</i></div><strong>{loading && !data ? "同步中…" : formatRubles(metrics?.salesAmount ?? 0)}</strong><div className="metric-foot"><span className="up">{metrics?.ordersCount ?? 0} 单</span><small>已售 {data?.products.reduce((sum, item) => sum + item.units, 0) ?? 0} 件</small></div><div className="spark-bars">{trend.slice(-10).map((item) => <span key={item.date} style={{ height: `${Math.max(5, (Math.max(0, item.sales) / maxSales) * 100)}%` }} />)}</div></article>
          <article className="metric-card"><div className="metric-head"><span>有效订单</span><i>⌑</i></div><strong>{loading && !data ? "—" : (metrics?.ordersCount ?? 0).toLocaleString("en-US")}</strong><div className="metric-foot"><span className="up">实时</span><small>取消 {metrics?.cancelledOrders ?? 0} 单</small></div><p className="metric-note">订单数据来自 WB Statistics API</p></article>
          <article className="metric-card" id="finance"><div className="metric-head"><span>预计回款</span><i>₽</i></div><strong>{loading && !data ? "—" : formatRubles(metrics?.payoutAmount ?? 0)}</strong><div className="metric-foot"><span className="up">可提现</span><small>{formatRubles(metrics?.balanceAvailable ?? 0)}</small></div><p className="metric-note">最终金额以 WB 财务结算报告为准</p></article>
          <article className="metric-card"><div className="metric-head"><span>退货率</span><i>↩</i></div><strong>{loading && !data ? "—" : `${(metrics?.returnRate ?? 0).toFixed(1)}%`}</strong><div className="metric-foot"><span className="down">{metrics?.returnsCount ?? 0} 件</span><small>销售与退货记录</small></div><p className="metric-note">当前账户余额 {formatRubles(metrics?.balanceCurrent ?? 0)}</p></article>
        </section>

        <section className="dashboard-grid" id="sales">
          <article className="panel sales-panel">
            <div className="panel-title"><div><h2>销售趋势</h2><p>{rangeLabel}每日销售额表现</p></div><div className="legend"><span><i className="purple-dot" />销售额</span><span><i className="gray-dot" />订单</span></div></div>
            <div className="chart-wrap"><div className="y-axis"><span>{formatCompactRubles(chartMax)}</span><span>{formatCompactRubles(chartMax * .75)}</span><span>{formatCompactRubles(chartMax * .5)}</span><span>{formatCompactRubles(chartMax * .25)}</span><span>₽0</span></div><div className="bar-chart">{trend.map((item, index) => <div className="bar-col" key={item.date} title={`${formatDate(item.date)} · ${formatRubles(item.sales)} · ${item.orders} 单`}><span className={index === trend.length - 1 ? "bar current" : "bar"} style={{ height: `${Math.max(3, (Math.max(0, item.sales) / maxSales) * 100)}%` }} /><small>{index % labelEvery === 0 || index === trend.length - 1 ? formatShortDate(item.date) : ""}</small></div>)}</div></div>
            <div className="chart-summary"><span>本期日均销售额 <b>{formatRubles(averageSales)}</b></span><span>单日峰值 <b>{formatRubles(peakSales)}</b></span><span>峰值订单 <b>{maxOrders} 单</b></span></div>
          </article>
          <article className="panel category-panel"><div className="panel-title"><div><h2>类目贡献</h2><p>销售额占比</p></div><span className="panel-tag live">实时</span></div><div className="donut" style={{ background: categoryStops }} aria-label="真实类目销售额占比"><div><b>{formatCompactRubles(metrics?.salesAmount ?? 0)}</b><small>总销售额</small></div></div><div className="category-list">{(data?.categories ?? []).map((category, index) => <div key={category.name}><span><i style={{ background: colors[index] }} />{category.name}</span><b>{category.share.toFixed(1)}%</b></div>)}{!loading && !data?.categories.length && <p className="empty-copy">本周期暂无类目数据</p>}</div></article>
        </section>

        <section className="bottom-grid">
          <article className="panel products-panel" id="products"><div className="panel-title"><div><h2>热销商品</h2><p>按真实销售额排序</p></div><a className="text-action" href="/products">完整综合商品分析 →</a></div><div className="table-wrap"><table><thead><tr><th>商品</th><th>销售额</th><th>订单</th><th>库存</th><th>成交率</th></tr></thead><tbody>{products.map((product, index) => <tr key={product.nmId}><td><div className={`product-thumb tone-${index % 4}`}>{product.category.slice(0, 1)}</div><div><b>{product.name}</b><small>{product.sku} · WB {product.nmId}</small></div></td><td><b>{formatRubles(product.sales)}</b></td><td>{product.orders}</td><td>{inventory?.available ? product.stock : "—"}</td><td><span className="rate">{product.buyoutRate.toFixed(1)}%</span></td></tr>)}{!loading && products.length === 0 && <tr className="empty-row"><td colSpan={5}>本周期暂无商品销售记录</td></tr>}</tbody></table></div></article>
          <article className="panel stock-panel" id="stock"><div className="panel-title"><div><h2>库存监控</h2><p>{inventory?.available ? `${inventory.totalQuantity.toLocaleString("en-US")} 件 · ${inventory.productCount} 个商品` : "正在读取 WB 仓库库存"}</p></div><span className="alert-count">{inventory?.available ? `${inventoryAlerts} 项` : "—"}</span></div><div className="stock-item"><div className="stock-icon urgent">!</div><div><b>{inventory?.available ? `${inventory.critical} 个商品即将缺货` : "库存数据暂不可用"}</b><p>{inventory?.available ? "预计可售不足 5 天" : "稍后重新同步即可重试"}</p></div><span>重点</span></div><div className="stock-item"><div className="stock-icon warning">↓</div><div><b>{inventory?.available ? `${inventory.low} 个商品库存偏低` : "—"}</b><p>库存覆盖 5–10 天</p></div><span>关注</span></div><div className="stock-item"><div className="stock-icon calm">↗</div><div><b>{inventory?.available ? `${inventory.slow} 个商品周转较慢` : "—"}</b><p>本周期无订单但仍有库存</p></div><span>分析</span></div><button className="stock-button" onClick={refresh} disabled={loading}>{loading ? "同步中…" : "立即刷新库存"}</button></article>
        </section>
      </section>

      {showConnect && <div className="modal-backdrop"><section className="connect-modal" role="dialog" aria-modal="true" aria-labelledby="connect-title"><button className="modal-close" onClick={() => setShowConnect(false)} aria-label="关闭">×</button><div className="modal-mark">W</div><p className="modal-eyebrow">WB API · SECURE CONNECTION</p><h2 id="connect-title">店铺连接已启用</h2><p className="modal-lead">订单、销售、库存和财务数据均由服务器端读取。浏览器不会收到 API 密钥，网页源码和导出的 CSV 中也不会包含密钥。</p><div className="api-needs"><div><span>01</span><p><b>服务器密钥</b><small>密钥加密保存在部署环境，不写入代码仓库</small></p></div><div><span>02</span><p><b>固定接口白名单</b><small>只请求官方 Wildberries API 地址</small></p></div><div><span>03</span><p><b>只读分析</b><small>当前功能不修改商品、价格、广告或账户数据</small></p></div></div><div className="modal-note"><b>已启用</b><span>真实订单、销售/退货、仓库库存和账户余额；自定义周期支持近 90 天。</span></div><div className="modal-actions"><button className="secondary" onClick={() => setShowConnect(false)}>关闭</button><button className="primary" onClick={refresh}>立即同步</button></div></section></div>}
    </main>
  );
}
