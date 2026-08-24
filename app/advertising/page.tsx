"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AppSidebar } from "../_components/app-sidebar";
import { evaluateAdvertisingBid } from "../_lib/advertising-evaluation";
import { normalizeProductSku, productCostSourceKey } from "../_lib/product-cost-aliases";

type Metrics = {
  views: number;
  clicks: number;
  spend: number;
  addToCart: number;
  orders: number;
  sales: number;
  buyouts: number;
  ctr: number;
  cpc: number;
  cr: number;
  cpo: number;
  roas: number;
};
type OfficialRecommendation = {
  base?: {
    competitiveBid?: { bidKopecks?: number };
    leadersBid?: { bidKopecks?: number };
    top2?: { bidKopecks?: number };
  };
  normQueries?: Array<{
    normQuery?: string;
    reachMax?: { bidKopecks?: number; bidKopecksMin?: number };
    reachMedium?: { bidKopecks?: number; bidKopecksMin?: number };
    reachMin?: { bidKopecks?: number; bidKopecksMin?: number };
  }>;
};
type AdvertisingProduct = {
  nmId: number;
  subjectId: number;
  subjectName: string;
  currentBidsKopecks: { search: number; recommendation: number };
  minimumBids: Array<{ currency: string; type: string; valueKopecks: number }>;
  currency: string | null;
  statsScope: "product" | "campaign-single-product" | "unavailable";
  stats: Metrics | null;
  officialRecommendation: OfficialRecommendation | null;
};
type AdvertisingCampaign = {
  id: number;
  name: string;
  status: number;
  statusLabel: string;
  bidType: string;
  paymentType: "cpc" | "cpm";
  placements: { search: boolean; recommendations: boolean };
  timestamps: { created: string; started: string; updated: string; deleted: string };
  currency: string | null;
  stats: Metrics | null;
  products: AdvertisingProduct[];
};
type AdvertisingData = {
  source: string;
  syncedAt: string;
  window: { from: string; to: string; maxDays: number };
  accountCurrency: string | null;
  campaigns: AdvertisingCampaign[];
  daily: Array<Metrics & { date: string }>;
  summary: Metrics & { campaigns: number; activeCampaigns: number; pausedCampaigns: number; currentProducts: number };
  warnings: string[];
  recommendationCoverage: { eligible: number; loaded: number; limited: boolean };
  syncSchedule: { timezone: string; hours: number[]; currentSlot: string; nextAt: string; mode: "manual" | "scheduled" };
};
type Product = { nmId: number; name: string; sku: string; image: string | null; averagePrice: number };
type CostRow = {
  sellerSku: string;
  nmId: number | null;
  productCostRub: number;
  exchangeRate: number;
  productCostCny: number;
  handlingFeeCny: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  commissionRate: number;
  activityDiscountRate: number;
  returnLossRate: number;
};

const DAY_MS = 86_400_000;
const CURRENT_STATUSES = new Set([4, 9, 11]);

function beijingDateKey(value: Date | string = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00+08:00`);
  return beijingDateKey(new Date(date.getTime() + days * DAY_MS));
}

function currencySymbol(currency?: string | null) {
  return currency === "RUB" ? "₽" : currency === "CNY" ? "¥" : currency || "";
}

function money(value: number | null | undefined, currency?: string | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${currencySymbol(currency)} ${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
}

function integer(value: number | null | undefined) {
  return Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 0 });
}

function percent(value: number | null | undefined, digits = 1) {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : `${value.toFixed(digits)}%`;
}

function statusTone(status: number) {
  if (status === 9) return "active";
  if (status === 11) return "paused";
  if (status === 4) return "ready";
  return "ended";
}

function placementLabel(campaign: AdvertisingCampaign) {
  const placements = [campaign.placements.search ? "搜索" : "", campaign.placements.recommendations ? "推荐" : ""].filter(Boolean);
  return placements.join(" + ") || "平台未返回";
}

function decisionLabel(decision: ReturnType<typeof evaluateAdvertisingBid>["decision"]) {
  return ({ missing: "成本待补", learning: "样本积累中", unviable: "最低价过高", loss: "广告后亏损", high: "出价偏高", efficient: "出价可控" } as const)[decision];
}

export default function AdvertisingPage() {
  const today = beijingDateKey();
  const [periodFrom, setPeriodFrom] = useState(shiftDate(today, -6));
  const [periodTo, setPeriodTo] = useState(today);
  const [draftFrom, setDraftFrom] = useState(periodFrom);
  const [draftTo, setDraftTo] = useState(periodTo);
  const [data, setData] = useState<AdvertisingData | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [productCurrency, setProductCurrency] = useState<string | null>(null);
  const [costRows, setCostRows] = useState<CostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [secondaryWarning, setSecondaryWarning] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("current");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [campaignFilter, setCampaignFilter] = useState("all");
  const [decisionFilter, setDecisionFilter] = useState("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const forceRefreshRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const advertisingParams = new URLSearchParams({ from: periodFrom, to: periodTo });
    const productParams = new URLSearchParams({ from: shiftDate(periodTo, -89), to: periodTo, view: "products" });
    if (forceRefreshRef.current) {
      advertisingParams.set("refresh", "manual");
      productParams.set("refresh", "manual");
    }
    forceRefreshRef.current = false;
    Promise.all([
      fetch(`/api/wb/advertising?${advertisingParams}`, { signal: controller.signal, cache: "no-store", headers: { Accept: "application/json" } }).then(async (response) => {
        const body = await response.json() as AdvertisingData | { error?: string };
        if (!response.ok) throw new Error("error" in body && body.error ? body.error : "推广数据读取失败");
        return body as AdvertisingData;
      }),
      fetch(`/api/wb/dashboard?${productParams}`, { signal: controller.signal, cache: "no-store", headers: { Accept: "application/json" } })
        .then(async (response): Promise<{ products?: Product[]; currency?: string }> => response.ok ? await response.json() as { products?: Product[]; currency?: string } : { products: [] })
        .catch(() => ({ products: [] as Product[], currency: undefined })),
      fetch("/api/product-costs", { signal: controller.signal, cache: "no-store", headers: { Accept: "application/json" } })
        .then(async (response): Promise<{ rows?: CostRow[] }> => response.ok ? await response.json() as { rows?: CostRow[] } : { rows: [] })
        .catch(() => ({ rows: [] as CostRow[] })),
    ])
      .then(([advertising, productData, costs]) => {
        setData(advertising);
        setProducts(productData.products || []);
        setProductCurrency(productData.currency || null);
        setCostRows(costs.rows || []);
        setSecondaryWarning(!productData.products?.length || !costs.rows?.length ? "推广活动与统计已连接；部分商品资料或成本暂未读取，相关建议价会明确显示为待补。" : "");
        setError("");
      })
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") setError(reason.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [periodFrom, periodTo, reloadKey]);

  useEffect(() => {
    const nextAt = data?.syncSchedule?.nextAt;
    if (!nextAt) return;
    const delay = Math.max(1_000, new Date(nextAt).getTime() - Date.now() + 1_500);
    const timer = window.setTimeout(() => { setLoading(true); setReloadKey((key) => key + 1); }, delay);
    return () => window.clearTimeout(timer);
  }, [data?.syncSchedule?.nextAt]);

  const productById = useMemo(() => new Map(products.map((product) => [product.nmId, product])), [products]);
  const costByNmId = useMemo(() => new Map(costRows.filter((row) => row.nmId).map((row) => [Number(row.nmId), row])), [costRows]);
  const costBySku = useMemo(() => new Map(costRows.map((row) => [normalizeProductSku(row.sellerSku), row])), [costRows]);

  const rows = useMemo(() => (data?.campaigns || []).flatMap((campaign) => campaign.products.map((advertProduct) => {
    const product = productById.get(advertProduct.nmId) || null;
    const cost = costByNmId.get(advertProduct.nmId) || (product ? costBySku.get(productCostSourceKey(product.sku)) || null : null);
    const primaryPlacement = campaign.placements.search ? "search" : campaign.placements.recommendations ? "recommendation" : "search";
    const currentBidKopecks = primaryPlacement === "search" ? advertProduct.currentBidsKopecks.search : advertProduct.currentBidsKopecks.recommendation;
    const minimum = advertProduct.minimumBids.find((bid) => bid.type === primaryPlacement)
      || advertProduct.minimumBids.find((bid) => primaryPlacement === "recommendation" && bid.type === "recommendations")
      || advertProduct.minimumBids[0]
      || null;
    const currency = advertProduct.currency || campaign.currency || data?.accountCurrency || null;
    const officialCompetitiveBid = advertProduct.officialRecommendation?.base?.competitiveBid?.bidKopecks
      ? Number(advertProduct.officialRecommendation.base.competitiveBid.bidKopecks) / 100
      : null;
    const evaluation = evaluateAdvertisingBid({
      paymentType: campaign.paymentType,
      currency,
      currentBid: currentBidKopecks > 0 ? currentBidKopecks / 100 : null,
      minimumBid: minimum ? minimum.valueKopecks / 100 : null,
      officialCompetitiveBid,
      averageProductPrice: Number(product?.averagePrice || 0),
      averageProductPriceCurrency: productCurrency,
      stats: advertProduct.stats,
      cost,
    });
    return {
      key: `${campaign.id}:${advertProduct.nmId}`,
      campaign,
      advertProduct,
      product,
      cost,
      currency,
      primaryPlacement,
      currentBid: currentBidKopecks > 0 ? currentBidKopecks / 100 : null,
      minimumBid: minimum ? minimum.valueKopecks / 100 : null,
      officialCompetitiveBid,
      officialLeadersBid: advertProduct.officialRecommendation?.base?.leadersBid?.bidKopecks ? Number(advertProduct.officialRecommendation.base.leadersBid.bidKopecks) / 100 : null,
      officialTop2Bid: advertProduct.officialRecommendation?.base?.top2?.bidKopecks ? Number(advertProduct.officialRecommendation.base.top2.bidKopecks) / 100 : null,
      evaluation,
    };
  })), [costByNmId, costBySku, data, productById, productCurrency]);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return rows.filter((row) => {
      const matchesQuery = !needle || [row.product?.sku || "", row.product?.name || "", String(row.advertProduct.nmId), row.campaign.name, String(row.campaign.id)].some((value) => value.toLocaleLowerCase().includes(needle));
      const matchesStatus = statusFilter === "all"
        || statusFilter === "current" && CURRENT_STATUSES.has(row.campaign.status)
        || statusFilter === String(row.campaign.status);
      const matchesPayment = paymentFilter === "all" || row.campaign.paymentType === paymentFilter;
      const matchesCampaign = campaignFilter === "all" || String(row.campaign.id) === campaignFilter;
      const matchesDecision = decisionFilter === "all" || row.evaluation.decision === decisionFilter;
      return matchesQuery && matchesStatus && matchesPayment && matchesCampaign && matchesDecision;
    });
  }, [campaignFilter, decisionFilter, paymentFilter, query, rows, statusFilter]);

  const currentCampaigns = useMemo(() => (data?.campaigns || []).filter((campaign) => CURRENT_STATUSES.has(campaign.status)), [data]);
  const selectedRow = useMemo(() => selectedKey ? rows.find((row) => row.key === selectedKey) || null : null, [rows, selectedKey]);
  const maxDailySpend = Math.max(1, ...(data?.daily || []).map((day) => day.spend));

  function applyPreset(days: number) {
    const to = beijingDateKey();
    const from = shiftDate(to, -(days - 1));
    setLoading(true);
    setDraftFrom(from); setDraftTo(to); setPeriodFrom(from); setPeriodTo(to);
  }

  function applyCustomPeriod() {
    const fromStamp = new Date(`${draftFrom}T12:00:00+08:00`).getTime();
    const toStamp = new Date(`${draftTo}T12:00:00+08:00`).getTime();
    if (!Number.isFinite(fromStamp) || !Number.isFinite(toStamp) || fromStamp > toStamp) return;
    const maxFrom = shiftDate(draftTo, -30);
    const nextFrom = fromStamp < new Date(`${maxFrom}T12:00:00+08:00`).getTime() ? maxFrom : draftFrom;
    setLoading(true);
    setDraftFrom(nextFrom); setPeriodFrom(nextFrom); setPeriodTo(draftTo);
  }

  function refresh() {
    forceRefreshRef.current = true;
    setLoading(true);
    setReloadKey((key) => key + 1);
  }

  return <main className="app-shell">
    <AppSidebar active="advertising" syncedAt={data?.syncedAt} nextSyncAt={data?.syncSchedule?.nextAt} loading={loading} error={error} onRefresh={refresh} />
    <section className="workspace product-workspace advertising-workspace">
      <header className="topbar product-topbar"><div><p>ADVERTISING · WB 推广 API</p><h1>推广</h1></div><div className="avatar">Z</div></header>

      <section className="product-period-panel advertising-period-panel">
        <div className="product-period-heading"><strong>统计周期</strong><small>推广统计单次最多 31 天</small></div>
        <div className="period-presets"><span>快捷周期</span>{[7, 14, 30].map((days) => <button key={days} type="button" className={periodFrom === shiftDate(beijingDateKey(), -(days - 1)) && periodTo === beijingDateKey() ? "active" : ""} onClick={() => applyPreset(days)}>近 {days} 天</button>)}</div>
        <div className="period-custom"><label><span>开始</span><input type="date" value={draftFrom} max={draftTo} onChange={(event) => setDraftFrom(event.target.value)} /></label><b>→</b><label><span>结束</span><input type="date" value={draftTo} min={draftFrom} max={today} onChange={(event) => setDraftTo(event.target.value)} /></label><button type="button" onClick={applyCustomPeriod}>查询</button></div>
      </section>

      <section className="advertising-notice">
        <span>◎</span><div><strong>推广数据全部来自 WB Promotion API</strong><p>当前出价与最低出价按接口原始戈比分值 ÷100；币种直接读取 WB 的 currency 字段。系统建议价不是 WB 官方价格，会单独标记并展示完整计算依据。</p></div><small>{data ? `${data.window.from} — ${data.window.to}` : "正在连接推广接口"}</small>
      </section>

      {(error || secondaryWarning || data?.warnings?.length) ? <section className={`advertising-message ${error ? "error" : "warning"}`} role={error ? "alert" : undefined}><strong>{error ? "推广数据暂不可用" : "数据完整性提示"}</strong><span>{error || [secondaryWarning, ...(data?.warnings || [])].filter(Boolean).join("；")}</span></section> : null}

      <section className="advertising-summary-grid" aria-label="推广汇总">
        <article className="active"><span>投放中活动</span><strong>{data?.summary.activeCampaigns ?? "—"}</strong><small>WB 状态 9</small></article>
        <article className="paused"><span>已暂停活动</span><strong>{data?.summary.pausedCampaigns ?? "—"}</strong><small>WB 状态 11</small></article>
        <article><span>当前活动商品</span><strong>{data?.summary.currentProducts ?? "—"}</strong><small>投放中、待启动、已暂停 · nmId 去重</small></article>
        <article><span>广告花费</span><strong>{money(data?.summary.spend, data?.accountCurrency)}</strong><small>{periodFrom} 至 {periodTo}</small></article>
        <article><span>广告归因订单</span><strong>{data ? integer(data.summary.orders) : "—"}</strong><small>归因销售 {money(data?.summary.sales, data?.accountCurrency)}</small></article>
        <article className={(data?.summary.roas || 0) < 1 ? "bad" : "good"}><span>广告 ROAS</span><strong>{data ? data.summary.roas.toFixed(2) : "—"}</strong><small>归因销售额 ÷ 广告花费</small></article>
      </section>

      <section className="advertising-campaign-panel">
        <div className="advertising-section-heading"><div><h2>当前推广活动</h2><p>展示投放中、待启动和已暂停活动；暂停状态完全以 WB API 返回为准。</p></div><span>{currentCampaigns.length} 个当前活动</span></div>
        <div className="advertising-campaign-grid">
          {currentCampaigns.map((campaign) => <button type="button" key={campaign.id} className={campaignFilter === String(campaign.id) ? "active" : ""} onClick={() => { setCampaignFilter((value) => value === String(campaign.id) ? "all" : String(campaign.id)); setStatusFilter("all"); }}>
            <header><span className={`advertising-status ${statusTone(campaign.status)}`}>{campaign.statusLabel}</span><small>{campaign.paymentType.toUpperCase()} · {placementLabel(campaign)}</small></header>
            <strong>{campaign.name}</strong><p>ID {campaign.id} · {campaign.products.length} 个商品</p>
            <footer><span>花费 <b>{money(campaign.stats?.spend, campaign.currency || data?.accountCurrency)}</b></span><span>订单 <b>{integer(campaign.stats?.orders)}</b></span><span>ROAS <b>{campaign.stats?.roas?.toFixed(2) || "0.00"}</b></span></footer>
          </button>)}
          {!loading && currentCampaigns.length === 0 && <div className="advertising-empty"><strong>WB 当前没有投放中或暂停的活动</strong><span>历史活动仍可在下方筛选查看。</span></div>}
        </div>
      </section>

      <section className="advertising-trend-panel">
        <div className="advertising-section-heading"><div><h2>每日推广表现</h2><p>展示、点击、订单和花费均为 WB 活动统计汇总，不做客户端补数。</p></div><span>{data?.daily.length || 0} 天有数据</span></div>
        <div className="advertising-daily-grid">
          {(data?.daily || []).map((day) => <article key={day.date}><div><b>{day.date.slice(5)}</b><small>花费 {money(day.spend, data?.accountCurrency)}</small></div><span><i style={{ width: `${Math.max(3, day.spend / maxDailySpend * 100)}%` }} /></span><footer><em>展现 {integer(day.views)}</em><em>点击 {integer(day.clicks)}</em><em>订单 {integer(day.orders)}</em><em>ROAS {day.roas.toFixed(2)}</em></footer></article>)}
          {!loading && !(data?.daily.length) && <div className="advertising-empty"><strong>所选周期暂无推广统计</strong><span>可切换到近 30 天查看历史数据。</span></div>}
        </div>
      </section>

      <section className="advertising-table-panel">
        <div className="advertising-table-toolbar"><div><h2>商品推广与出价明细</h2><p>“当前出价”“WB 最低出价”“WB 官方推荐”和“系统建议价”严格分列，避免混淆。</p></div><div className="advertising-filters">
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 SKU、商品、活动或 ID" aria-label="搜索推广商品" />
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="推广状态"><option value="current">当前活动</option><option value="all">全部状态</option><option value="9">投放中</option><option value="11">已暂停</option><option value="4">待启动</option><option value="7">已结束</option></select>
          <select value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)} aria-label="计费方式"><option value="all">全部计费</option><option value="cpc">CPC 按点击</option><option value="cpm">CPM 按展示</option></select>
          <select value={decisionFilter} onChange={(event) => setDecisionFilter(event.target.value)} aria-label="系统评估"><option value="all">全部评估</option><option value="efficient">出价可控</option><option value="high">出价偏高</option><option value="loss">广告后亏损</option><option value="unviable">最低价过高</option><option value="learning">样本积累中</option><option value="missing">成本待补</option></select>
        </div></div>
        <div className="advertising-table-wrap"><table className="advertising-table"><thead><tr><th>商品</th><th>活动与状态</th><th>计费/位置</th><th>当前出价</th><th>WB 最低出价</th><th>WB 官方推荐</th><th>系统建议价</th><th>展现/点击</th><th>CTR/实际单价</th><th>订单/转化率</th><th>花费/CPO</th><th>归因销售/ROAS</th><th>单件广告前利润</th><th>保本出价</th><th>广告后净利润</th><th>评估</th></tr></thead><tbody>
          {filteredRows.map((row) => <tr key={row.key}>
            <td><div className="advertising-product-cell">{row.product?.image ? <span className="advertising-product-photo" style={{ backgroundImage: `url(${row.product.image})` }} /> : <span className="advertising-product-photo placeholder">W</span>}<div><b>{row.product?.sku || `WB ${row.advertProduct.nmId}`}</b><small title={row.product?.name || row.advertProduct.subjectName}>{row.product?.name || row.advertProduct.subjectName || `nmId ${row.advertProduct.nmId}`}</small><em>WB {row.advertProduct.nmId}</em></div></div></td>
            <td><b title={row.campaign.name}>{row.campaign.name}</b><small><span className={`advertising-status ${statusTone(row.campaign.status)}`}>{row.campaign.statusLabel}</span> · ID {row.campaign.id}</small></td>
            <td><b>{row.campaign.paymentType.toUpperCase()}</b><small>{row.campaign.paymentType === "cpc" ? "按点击计费" : "按千次展示"} · {placementLabel(row.campaign)}</small></td>
            <td><b>{money(row.currentBid, row.currency)}</b><small>搜索 {money(row.advertProduct.currentBidsKopecks.search ? row.advertProduct.currentBidsKopecks.search / 100 : null, row.currency)} · 推荐 {money(row.advertProduct.currentBidsKopecks.recommendation ? row.advertProduct.currentBidsKopecks.recommendation / 100 : null, row.currency)}</small></td>
            <td><b>{money(row.minimumBid, row.currency)}</b><small>{row.advertProduct.minimumBids.length ? row.advertProduct.minimumBids.map((bid) => `${bid.type} ${money(bid.valueKopecks / 100, bid.currency || row.currency)}`).join(" · ") : "WB 暂未返回最低价"}</small></td>
            <td><b>{row.campaign.paymentType === "cpc" ? "不提供" : money(row.officialCompetitiveBid, row.currency)}</b><small>{row.campaign.paymentType === "cpc" ? "WB 官方仅支持 CPM 推荐" : `头部 ${money(row.officialLeadersBid, row.currency)} · Top2 ${money(row.officialTop2Bid, row.currency)}`}</small></td>
            <td><b className={row.evaluation.suggestedBid === null ? "" : "value-good"}>{money(row.evaluation.suggestedBid, row.currency)}</b><small>保本出价 × 80% 安全系数</small></td>
            <td><b>{integer(row.advertProduct.stats?.views)} / {integer(row.advertProduct.stats?.clicks)}</b><small>{row.advertProduct.statsScope === "unavailable" ? "WB 未返回单品拆分" : "WB 推广统计"}</small></td>
            <td><b>{percent(row.advertProduct.stats?.ctr)} / {money(row.evaluation.actualUnitCost, row.currency)}</b><small>点击率 / 实际 {row.campaign.paymentType.toUpperCase()} 成本</small></td>
            <td><b>{integer(row.advertProduct.stats?.orders)} / {percent(row.advertProduct.stats?.cr)}</b><small>归因订单 / 点击转化率</small></td>
            <td><b>{money(row.advertProduct.stats?.spend, row.currency)}</b><small>CPO {money(row.advertProduct.stats?.cpo, row.currency)}</small></td>
            <td><b>{money(row.advertProduct.stats?.sales, row.currency)}</b><small>ROAS {row.advertProduct.stats?.roas?.toFixed(2) || "—"}</small></td>
            <td><b>{money(row.evaluation.preAdProfitPerOrderCurrency, row.currency)}</b><small>成交价扣除商品、平台与退损预留</small></td>
            <td><b>{money(row.evaluation.breakEvenBid, row.currency)}</b><small>{row.campaign.paymentType === "cpc" ? "单件利润 × 点击转化率" : "单件利润 × 每千次展现订单"}</small></td>
            <td><b className={(row.evaluation.estimatedNetProfit || 0) < 0 ? "value-bad" : "value-good"}>{money(row.evaluation.estimatedNetProfit, row.currency)}</b><small>广告前利润合计 − 实际花费</small></td>
            <td><button type="button" className={`advertising-decision ${row.evaluation.decision}`} onClick={() => setSelectedKey(row.key)}>{decisionLabel(row.evaluation.decision)}</button><small>点击查看公式</small></td>
          </tr>)}
          {!loading && filteredRows.length === 0 && <tr className="empty-row"><td colSpan={16}>没有符合当前筛选条件的推广商品</td></tr>}
        </tbody></table></div>
        <footer className="advertising-table-footer"><span>共 {filteredRows.length} 条商品推广记录 · 当前表格默认展示当前活动</span><span>多商品活动若 WB 未返回单品拆分，绝不复制活动汇总值到每个商品。</span></footer>
      </section>

      {selectedRow && <section className="advertising-formula-panel">
        <div className="advertising-section-heading"><div><h2>{selectedRow.product?.sku || `WB ${selectedRow.advertProduct.nmId}`} · 建议价计算依据</h2><p>所有输入值、币种和计算公式均可核对；WB 官方数据与系统推算明确分开。</p></div><button type="button" onClick={() => setSelectedKey(null)}>关闭</button></div>
        <div className="advertising-formula-grid">
          <article><span>API 出价基线</span><b>当前 {money(selectedRow.currentBid, selectedRow.currency)}</b><small>WB 最低 {money(selectedRow.minimumBid, selectedRow.currency)} · 实际 {selectedRow.campaign.paymentType.toUpperCase()} {money(selectedRow.evaluation.actualUnitCost, selectedRow.currency)}</small></article>
          <article><span>成交价口径</span><b>{money(selectedRow.evaluation.sellingPriceCny, "CNY")}</b><small>{selectedRow.evaluation.priceSource === "attributed-sales" ? "WB 归因销售额 ÷ 归因订单" : selectedRow.evaluation.priceSource === "product-average" ? `商品近 90 天均价（${productCurrency || "未知币种"} → CNY）` : "价格数据待补"}</small></article>
          <article><span>固定成本</span><b>{money(selectedRow.evaluation.fixedCostCny, "CNY")}</b><small>拿货 {money(selectedRow.evaluation.productCostCny, "CNY")} + 操作 {money(selectedRow.evaluation.handlingFeeCny, "CNY")} + 物流 {money(selectedRow.evaluation.lastMileFeeCny, "CNY")}</small></article>
          <article><span>非广告比例费用</span><b>{percent(selectedRow.evaluation.nonAdvertisingRate)}</b><small>佣金 {percent(selectedRow.cost?.commissionRate)} + 活动折扣 {percent(selectedRow.cost?.activityDiscountRate)} + 退损 {percent(selectedRow.cost?.returnLossRate)}</small></article>
          <article><span>单件广告前利润</span><b>{money(selectedRow.evaluation.preAdProfitPerOrderCurrency, selectedRow.currency)}</b><small>成交价 − 固定成本 − 非广告比例费用；此处不重复计广告费</small></article>
          <article><span>保本出价</span><b>{money(selectedRow.evaluation.breakEvenBid, selectedRow.currency)}</b><small>{selectedRow.campaign.paymentType === "cpc" ? `${money(selectedRow.evaluation.preAdProfitPerOrderCurrency, selectedRow.currency)} × ${integer(selectedRow.advertProduct.stats?.orders)} ÷ ${integer(selectedRow.advertProduct.stats?.clicks)} 次点击` : `${money(selectedRow.evaluation.preAdProfitPerOrderCurrency, selectedRow.currency)} × 每千次展现订单数`}</small></article>
          <article><span>系统建议价</span><b>{money(selectedRow.evaluation.suggestedBid, selectedRow.currency)}</b><small>保本出价 × 80%；若低于 WB 最低价，则直接标记“不建议投放”</small></article>
          <article className={(selectedRow.evaluation.estimatedNetProfit || 0) < 0 ? "bad" : "good"}><span>广告后净利润</span><b>{money(selectedRow.evaluation.estimatedNetProfit, selectedRow.currency)}</b><small>{money(selectedRow.evaluation.preAdProfitPerOrderCurrency, selectedRow.currency)} × {integer(selectedRow.advertProduct.stats?.orders)} 单 − 花费 {money(selectedRow.advertProduct.stats?.spend, selectedRow.currency)}</small></article>
        </div>
      </section>}
    </section>
  </main>;
}
