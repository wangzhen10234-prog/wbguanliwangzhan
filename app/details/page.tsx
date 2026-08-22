"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AppSidebar } from "../_components/app-sidebar";

type Settlement = {
  nmId: number;
  sellerSku: string;
  title: string;
  settledUnits: number;
  transactionAmount: number;
  forPay: number;
  wbExpenses: number;
  netPayout: number;
};

type Product = {
  nmId: number;
  name: string;
  sku: string;
  category: string;
  image: string | null;
  sales: number;
  preliminaryPayout: number;
  settlement: Settlement;
};

type DashboardData = {
  syncedAt: string;
  syncSchedule: { nextAt: string };
  period: { from: string; to: string; days: number };
  products: Product[];
  settlement: { available: boolean; source: string; rowsCount: number; unallocatedExpenses: number };
};

type CostRow = {
  sellerSku: string;
  nmId: number | null;
  internalSku: string;
  category: string;
  specification: string;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightG: number;
  productCostRub: number;
  exchangeRate: number;
  productCostCny: number;
  handlingFeeCny: number;
  lastMileFeeCny: number;
  commissionRate: number;
  adRate: number;
  activityDiscountRate: number;
  returnLossRate: number;
  referencePriceCny: number;
  notes: string;
  updatedAt?: string;
};

type CalculatedRow = {
  product: Product;
  cost: CostRow;
  productCostCny: number;
  pricingCost: number;
  payoutCny: number;
  ownCostCny: number;
  netProfitCny: number;
  netMargin: number | null;
};

const DAY_MS = 86_400_000;

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

function normalizeSku(value: string) {
  return value.toLocaleLowerCase().replace(/[\s_.-]+/g, "");
}

function money(value: number, currency: "CNY" | "RUB" = "CNY", digits = 2) {
  const symbol = currency === "CNY" ? "¥" : "₽";
  return `${symbol} ${Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function blankCost(product: Product): CostRow {
  return {
    sellerSku: product.sku,
    nmId: product.nmId,
    internalSku: "",
    category: product.category || "",
    specification: "",
    lengthCm: 0,
    widthCm: 0,
    heightCm: 0,
    weightG: 0,
    productCostRub: 0,
    exchangeRate: 11.2,
    productCostCny: 0,
    handlingFeeCny: 0,
    lastMileFeeCny: 0,
    commissionRate: 0,
    adRate: 0,
    activityDiscountRate: 0,
    returnLossRate: 0,
    referencePriceCny: 0,
    notes: "",
  };
}

function effectiveProductCost(cost: CostRow) {
  if (cost.productCostCny > 0) return cost.productCostCny;
  return cost.exchangeRate > 0 ? cost.productCostRub / cost.exchangeRate : 0;
}

function calculate(product: Product, cost: CostRow): CalculatedRow {
  const productCostCny = effectiveProductCost(cost);
  const exchangeRate = cost.exchangeRate || 11.2;
  const settledUnits = Math.max(0, product.settlement.settledUnits);
  const transactionCny = product.settlement.transactionAmount / exchangeRate;
  const payoutCny = product.settlement.netPayout / exchangeRate;
  const unitOwnCost = productCostCny + cost.handlingFeeCny + cost.lastMileFeeCny;
  const adCost = Math.abs(transactionCny) * cost.adRate / 100;
  const returnProvision = Math.abs(transactionCny) * cost.returnLossRate / 100;
  const ownCostCny = unitOwnCost * settledUnits + adCost + returnProvision;
  const netProfitCny = payoutCny - ownCostCny;
  const netMargin = Math.abs(transactionCny) > 0 ? (netProfitCny / Math.abs(transactionCny)) * 100 : null;
  const actualAverageCny = settledUnits > 0 ? transactionCny / settledUnits : cost.referencePriceCny;
  const pricingRate = cost.commissionRate + cost.adRate + cost.activityDiscountRate + cost.returnLossRate;
  const pricingCost = unitOwnCost + Math.max(0, actualAverageCny) * pricingRate / 100;
  return { product, cost, productCostCny, pricingCost, payoutCny, ownCostCny, netProfitCny, netMargin };
}

function NumberInput({ value, onChange, ariaLabel, step = "0.01" }: { value: number; onChange: (value: number) => void; ariaLabel: string; step?: string }) {
  return <input aria-label={ariaLabel} className="detail-number-input" inputMode="decimal" min="0" step={step} type="number" value={Number.isFinite(value) ? value : 0} onChange={(event) => onChange(Math.max(0, Number(event.target.value || 0)))} />;
}

export default function ProductDetailsPage() {
  const today = toInputDate(new Date());
  const earliest = shiftDate(today, -89);
  const [draftStart, setDraftStart] = useState(() => shiftDate(today, -29));
  const [draftEnd, setDraftEnd] = useState(today);
  const [periodStart, setPeriodStart] = useState(() => shiftDate(today, -29));
  const [periodEnd, setPeriodEnd] = useState(today);
  const [data, setData] = useState<DashboardData | null>(null);
  const [costs, setCosts] = useState<Record<number, CostRow>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dateError, setDateError] = useState("");
  const [query, setQuery] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState<Set<number>>(new Set());
  const [saved, setSaved] = useState<Set<number>>(new Set());
  const forceRefreshRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ from: periodStart, to: periodEnd, includeFinance: "true" });
    if (forceRefreshRef.current) params.set("refresh", "manual");
    forceRefreshRef.current = false;
    Promise.all([
      fetch(`/api/wb/dashboard?${params}`, { signal: controller.signal, cache: "no-store" }).then(async (response) => {
        const body = await response.json() as DashboardData | { error?: string };
        if (!response.ok) throw new Error("error" in body && body.error ? body.error : "WB 数据读取失败");
        return body as DashboardData;
      }),
      fetch("/api/product-costs", { signal: controller.signal, cache: "no-store" }).then(async (response) => {
        const body = await response.json() as { rows?: CostRow[]; error?: string };
        if (!response.ok) throw new Error(body.error || "产品成本表读取失败");
        return body.rows ?? [];
      }),
    ]).then(([dashboard, storedRows]) => {
      const bySku = new Map(storedRows.map((row) => [normalizeSku(row.sellerSku), row]));
      const nextCosts: Record<number, CostRow> = {};
      for (const product of dashboard.products) {
        const stored = bySku.get(normalizeSku(product.sku));
        nextCosts[product.nmId] = stored ? { ...stored, sellerSku: product.sku, nmId: product.nmId } : blankCost(product);
      }
      setData(dashboard);
      setCosts(nextCosts);
      setError("");
    }).catch((reason: Error) => {
      if (reason.name !== "AbortError") setError(reason.message);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [periodStart, periodEnd, reloadKey]);

  useEffect(() => {
    const nextAt = data?.syncSchedule.nextAt;
    if (!nextAt) return;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setReloadKey((key) => key + 1);
    }, Math.max(1_000, new Date(nextAt).getTime() - Date.now() + 1_500));
    return () => window.clearTimeout(timer);
  }, [data?.syncSchedule.nextAt]);

  const calculatedRows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (data?.products ?? [])
      .filter((product) => !needle || [product.sku, product.name, product.category, String(product.nmId)].some((value) => value.toLocaleLowerCase().includes(needle)))
      .map((product) => calculate(product, costs[product.nmId] ?? blankCost(product)))
      .sort((a, b) => b.netProfitCny - a.netProfitCny);
  }, [costs, data?.products, query]);

  const summary = useMemo(() => {
    const allRows = (data?.products ?? []).map((product) => calculate(product, costs[product.nmId] ?? blankCost(product)));
    const transactionCny = allRows.reduce((sum, row) => sum + row.product.settlement.transactionAmount / (row.cost.exchangeRate || 11.2), 0);
    const payout = allRows.reduce((sum, row) => sum + row.payoutCny, 0);
    const ownCost = allRows.reduce((sum, row) => sum + row.ownCostCny, 0);
    const profit = allRows.reduce((sum, row) => sum + row.netProfitCny, 0);
    const registered = allRows.filter((row) => row.productCostCny > 0).length;
    return {
      transactionCny,
      payout,
      ownCost,
      profit,
      margin: Math.abs(transactionCny) > 0 ? profit / Math.abs(transactionCny) * 100 : null,
      units: allRows.reduce((sum, row) => sum + row.product.settlement.settledUnits, 0),
      registered,
      total: allRows.length,
    };
  }, [costs, data?.products]);

  function beginLoad() {
    setLoading(true);
    setError("");
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
    if (draftStart < earliest || countDays(draftStart, draftEnd) > 90) return setDateError("正式结算明细支持近 90 天、最长 90 天的查询周期");
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

  function updateCost(productId: number, field: keyof CostRow, value: string | number) {
    setCosts((current) => {
      const row = { ...current[productId], [field]: value } as CostRow;
      if ((field === "productCostRub" || field === "exchangeRate") && row.productCostRub > 0 && row.exchangeRate > 0) {
        row.productCostCny = Math.round(row.productCostRub / row.exchangeRate * 10_000) / 10_000;
      }
      return { ...current, [productId]: row };
    });
    setSaved((current) => {
      const next = new Set(current);
      next.delete(productId);
      return next;
    });
  }

  async function saveRow(productId: number) {
    const row = costs[productId];
    if (!row) return;
    setSaving((current) => new Set(current).add(productId));
    try {
      const response = await fetch("/api/product-costs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(row),
      });
      const body = await response.json() as { row?: CostRow; error?: string };
      if (!response.ok || !body.row) throw new Error(body.error || "保存失败");
      setCosts((current) => ({ ...current, [productId]: { ...body.row!, sellerSku: row.sellerSku, nmId: productId } }));
      setSaved((current) => new Set(current).add(productId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setSaving((current) => {
        const next = new Set(current);
        next.delete(productId);
        return next;
      });
    }
  }

  return (
    <main className="app-shell">
      <AppSidebar active="details" syncedAt={data?.syncedAt} nextSyncAt={data?.syncSchedule.nextAt} loading={loading} error={error} onRefresh={refresh}>
        <div className="nav-section">成本登记进度</div>
        <div className="product-side-summary"><span>已登记商品</span><b>{summary.registered} / {summary.total}</b><small>按卖家商品编号自动匹配</small></div>
        <div className="product-side-summary scope"><span>结算口径</span><b>{data?.settlement.available ? "正式财务报告" : "销售接口预估"}</b><small>{periodStart} 至 {periodEnd}</small></div>
      </AppSidebar>

      <section className="workspace product-workspace details-workspace">
        <header className="topbar product-topbar"><div><p className="eyebrow">PRODUCT DETAIL · 成本与实际利润</p><h1>产品详情</h1></div><div className="details-source"><span className={data?.settlement.available ? "exact" : "estimate"} />{data?.settlement.source || "正在读取结算数据"}</div></header>

        <section className="product-period-panel">
          <div className="product-period-heading"><strong>利润周期</strong><small>成交、回款、成本与利润按所选周期重新计算</small></div>
          <div className="period-presets"><span>快捷周期</span>{[7, 30, 90].map((days) => <button key={days} className={countDays(periodStart, periodEnd) === days ? "active" : ""} disabled={loading} onClick={() => choosePreset(days)}>近 {days} 天</button>)}</div>
          <div className="period-custom"><label><span>开始日期</span><input max={today} min={earliest} type="date" value={draftStart} onChange={(event) => setDraftStart(event.target.value)} /></label><b>→</b><label><span>结束日期</span><input max={today} min={earliest} type="date" value={draftEnd} onChange={(event) => setDraftEnd(event.target.value)} /></label><button onClick={applyDates}>查询</button></div>
          {dateError && <p className="product-date-error">{dateError}</p>}
        </section>

        <div className={`notice product-notice ${error ? "error" : "connected"}`}><div className="notice-icon">{loading ? "↻" : error ? "!" : "✓"}</div><div><strong>{loading ? "正在合并 WB 结算与产品成本" : error ? "部分数据读取未完成" : "产品、成交、回款与成本已完成对应"}</strong><p>{error || (data?.settlement.available ? `已读取 ${data.settlement.rowsCount} 条正式结算明细；卖家商品编号用于匹配成本表。` : "正式结算暂不可用，当前以销售接口 forPay 作为预估回款。")}</p></div></div>

        <section className="details-stat-grid">
          <article><span>本期成交额（折合）</span><strong>{money(summary.transactionCny)}</strong><small>按每个商品登记汇率折算</small></article>
          <article className="featured"><span>WB 商品净回款</span><strong>{money(summary.payout)}</strong><small>回款减行级物流、收单及罚款</small></article>
          <article><span>自有成本与预提</span><strong>{money(summary.ownCost)}</strong><small>货值、操作、尾程、广告、退损</small></article>
          <article className={summary.profit < 0 ? "attention" : "profit"}><span>本期净利润</span><strong>{money(summary.profit)}</strong><small>已结算净销量 {summary.units.toLocaleString("zh-CN")} 件</small></article>
          <article className={summary.profit < 0 ? "attention" : "profit"}><span>净利润率</span><strong>{summary.margin === null ? "—" : `${summary.margin.toFixed(1)}%`}</strong><small>净利润 ÷ 实际成交额</small></article>
        </section>

        <section className="details-formula-note">
          <b>实际利润口径</b>
          <span>WB 正式回款（RUB）÷ 商品汇率 −（产品成本 + 操作费 + 尾程）× 已结算净销量 − 广告费预提 − 退损预提。</span>
          <small>平台佣金和活动折扣已体现在 WB 成交价与回款中，不重复扣除；它们仅用于“定价成本”测算。</small>
        </section>

        <section className="product-table-panel details-table-panel">
          <div className="product-table-toolbar"><div><h2>产品成本与实际利润明细</h2><p>表格参考你的 WPS“产品统计表”结构；修改后点击该行“保存”。</p></div><label className="product-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索卖家商品编号、名称、WB 货号" /></label></div>
          <div className="details-table-wrap">
            <table className="details-table">
              <thead>
                <tr className="details-group-head"><th rowSpan={2}>系统商品</th><th colSpan={6}>基础资料</th><th colSpan={5}>一、基础费用</th><th colSpan={4}>二、平台定价参数</th><th rowSpan={2}>参考售价<br />¥</th><th colSpan={5}>三、WB 实际结算</th><th colSpan={3}>四、利润结果</th><th rowSpan={2}>操作</th></tr>
                <tr><th>内部 SKU</th><th>分类</th><th>规格</th><th>长×宽×高 cm</th><th>重量 g</th><th>WB 货号</th><th>产品成本 ₽</th><th>汇率<br />₽/¥</th><th>产品成本 ¥</th><th>操作费 ¥</th><th>尾程 ¥</th><th>佣金率</th><th>广告率</th><th>活动折扣</th><th>退损率</th><th>净销量</th><th>成交额 ₽</th><th>forPay ₽</th><th>WB 行级费用 ₽</th><th>净回款 ¥</th><th>定价成本/件 ¥</th><th>净利润 ¥</th><th>净利率</th></tr>
              </thead>
              <tbody>
                {calculatedRows.map(({ product, cost, productCostCny, pricingCost, payoutCny, netProfitCny, netMargin }) => (
                  <tr key={product.nmId}>
                    <td className="details-product-cell"><span className={`detail-product-photo ${product.image ? "" : "placeholder"}`} style={product.image ? { backgroundImage: `url(${product.image})` } : undefined}>{product.image ? "" : product.sku.slice(0, 1).toUpperCase()}</span><div><b>{product.sku}</b><span>{product.name}</span></div></td>
                    <td><input className="detail-text-input short" value={cost.internalSku} onChange={(event) => updateCost(product.nmId, "internalSku", event.target.value)} aria-label={`${product.sku} 内部SKU`} /></td>
                    <td><input className="detail-text-input" value={cost.category} onChange={(event) => updateCost(product.nmId, "category", event.target.value)} aria-label={`${product.sku} 分类`} /></td>
                    <td><input className="detail-text-input" value={cost.specification} onChange={(event) => updateCost(product.nmId, "specification", event.target.value)} aria-label={`${product.sku} 规格`} /></td>
                    <td><div className="dimension-inputs"><NumberInput ariaLabel={`${product.sku} 长`} value={cost.lengthCm} onChange={(value) => updateCost(product.nmId, "lengthCm", value)} /><NumberInput ariaLabel={`${product.sku} 宽`} value={cost.widthCm} onChange={(value) => updateCost(product.nmId, "widthCm", value)} /><NumberInput ariaLabel={`${product.sku} 高`} value={cost.heightCm} onChange={(value) => updateCost(product.nmId, "heightCm", value)} /></div></td>
                    <td><NumberInput ariaLabel={`${product.sku} 重量`} step="1" value={cost.weightG} onChange={(value) => updateCost(product.nmId, "weightG", value)} /></td>
                    <td><b className="detail-nmid">{product.nmId}</b></td>
                    <td><NumberInput ariaLabel={`${product.sku} 卢布成本`} value={cost.productCostRub} onChange={(value) => updateCost(product.nmId, "productCostRub", value)} /></td>
                    <td><NumberInput ariaLabel={`${product.sku} 汇率`} value={cost.exchangeRate} onChange={(value) => updateCost(product.nmId, "exchangeRate", value)} /></td>
                    <td><NumberInput ariaLabel={`${product.sku} 人民币成本`} value={cost.productCostCny} onChange={(value) => updateCost(product.nmId, "productCostCny", value)} /><small>有效 {money(productCostCny, "CNY", 2)}</small></td>
                    <td><NumberInput ariaLabel={`${product.sku} 操作费`} value={cost.handlingFeeCny} onChange={(value) => updateCost(product.nmId, "handlingFeeCny", value)} /></td>
                    <td><NumberInput ariaLabel={`${product.sku} 尾程`} value={cost.lastMileFeeCny} onChange={(value) => updateCost(product.nmId, "lastMileFeeCny", value)} /></td>
                    <td><NumberInput ariaLabel={`${product.sku} 佣金率`} value={cost.commissionRate} onChange={(value) => updateCost(product.nmId, "commissionRate", value)} /></td>
                    <td><NumberInput ariaLabel={`${product.sku} 广告率`} value={cost.adRate} onChange={(value) => updateCost(product.nmId, "adRate", value)} /></td>
                    <td><NumberInput ariaLabel={`${product.sku} 活动折扣`} value={cost.activityDiscountRate} onChange={(value) => updateCost(product.nmId, "activityDiscountRate", value)} /></td>
                    <td><NumberInput ariaLabel={`${product.sku} 退损率`} value={cost.returnLossRate} onChange={(value) => updateCost(product.nmId, "returnLossRate", value)} /></td>
                    <td><NumberInput ariaLabel={`${product.sku} 参考售价`} value={cost.referencePriceCny} onChange={(value) => updateCost(product.nmId, "referencePriceCny", value)} /></td>
                    <td><b>{product.settlement.settledUnits}</b></td>
                    <td><b>{money(product.settlement.transactionAmount, "RUB")}</b></td>
                    <td><b>{money(product.settlement.forPay, "RUB")}</b></td>
                    <td><span>{money(product.settlement.wbExpenses, "RUB")}</span></td>
                    <td><b className="value-good">{money(payoutCny)}</b></td>
                    <td><b>{money(pricingCost)}</b></td>
                    <td><b className={netProfitCny >= 0 ? "value-good" : "value-bad"}>{money(netProfitCny)}</b></td>
                    <td><b className={netProfitCny >= 0 ? "value-good" : "value-bad"}>{netMargin === null ? "—" : `${netMargin.toFixed(1)}%`}</b></td>
                    <td><button className={`detail-save-button ${saved.has(product.nmId) ? "saved" : ""}`} disabled={saving.has(product.nmId)} onClick={() => saveRow(product.nmId)}>{saving.has(product.nmId) ? "保存中" : saved.has(product.nmId) ? "已保存" : "保存"}</button></td>
                  </tr>
                ))}
                {!loading && calculatedRows.length === 0 && <tr className="empty-row"><td colSpan={26}>没有找到符合条件的商品</td></tr>}
              </tbody>
            </table>
          </div>
          <footer className="product-table-footer"><span>共 {calculatedRows.length} 个商品 · 已登记成本 {summary.registered} 个</span><span>未分摊店铺级费用：{money((data?.settlement.unallocatedExpenses || 0) / 11.2, "CNY")}</span></footer>
        </section>
      </section>
    </main>
  );
}
