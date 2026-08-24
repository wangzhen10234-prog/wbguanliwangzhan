"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AppSidebar } from "../_components/app-sidebar";
import { normalizeProductSku, productCostSourceKey } from "../_lib/product-cost-aliases";

type PromotionProduct = {
  nmId: number;
  inAction: boolean;
  price: number;
  planPrice: number;
  currencyCode: string;
  discount: number;
  planDiscount: number;
};

type Promotion = {
  id: number;
  name: string;
  description: string;
  startDateTime: string;
  endDateTime: string;
  type: string;
  participationPercentage: number;
  inPromoActionTotal: number;
  notInPromoActionTotal: number;
  exceptionProductsCount: number;
  ranging: Array<{ condition: string; participationRate: number; boost: number }>;
  products: PromotionProduct[];
  productDataAvailable: boolean;
};

type PromotionData = {
  source: string;
  syncedAt: string;
  window: { from: string; to: string };
  promotions: Promotion[];
  truncated: boolean;
  syncSchedule: { timezone: string; hours: number[]; currentSlot: string; nextAt: string; mode: "manual" | "scheduled" };
};

type Product = {
  nmId: number;
  name: string;
  sku: string;
  image: string | null;
  averagePrice: number;
};

type ProductData = { products: Product[] };

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
  adRate: number;
  activityDiscountRate: number;
  returnLossRate: number;
};

type Evaluation = {
  key: string;
  promotion: Promotion;
  product: Product | null;
  promoProduct: PromotionProduct;
  cost: CostRow | null;
  currentPriceRub: number;
  promoPriceRub: number;
  reductionRate: number | null;
  costReady: boolean;
  promoPriceCny: number | null;
  fixedCostCny: number | null;
  variableRate: number | null;
  breakEvenPriceCny: number | null;
  profitCny: number | null;
  profitRate: number | null;
  decision: "profit" | "loss" | "missing";
};

const DAY_MS = 86_400_000;

function beijingDateKey(value: Date | string = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function shiftDate(dateString: string, days: number) {
  const date = new Date(`${dateString}T12:00:00+08:00`);
  return beijingDateKey(new Date(date.getTime() + days * DAY_MS));
}

function money(value: number | null, currency: "RUB" | "CNY" = "CNY") {
  if (value === null || !Number.isFinite(value)) return "—";
  const symbol = currency === "RUB" ? "₽" : "¥";
  const digits = currency === "RUB" ? 0 : 2;
  return `${symbol} ${value.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function percent(value: number | null, digits = 1) {
  return value === null || !Number.isFinite(value) ? "—" : `${value.toFixed(digits)}%`;
}

function dateTime(value: string) {
  if (!value) return "时间待公布";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function promotionState(promotion: Promotion) {
  const now = Date.now();
  const start = new Date(promotion.startDateTime).getTime();
  const end = new Date(promotion.endDateTime).getTime();
  if (Number.isFinite(end) && end < now) return { key: "ended", label: "已结束" } as const;
  if (Number.isFinite(start) && start > now) return { key: "upcoming", label: "即将开始" } as const;
  return { key: "active", label: "进行中" } as const;
}

function currentBoost(promotion: Promotion) {
  return promotion.ranging
    .filter((tier) => tier.participationRate <= promotion.participationPercentage)
    .sort((a, b) => b.participationRate - a.participationRate)[0]?.boost ?? null;
}

function boostReference(promotion: Promotion) {
  const current = currentBoost(promotion);
  if (current !== null) return { boost: current, current: true, participationRate: promotion.participationPercentage };
  const firstTier = [...promotion.ranging].sort((a, b) => a.participationRate - b.participationRate)[0];
  return firstTier ? { boost: firstTier.boost, current: false, participationRate: firstTier.participationRate } : null;
}

function ProductPhoto({ product }: { product: Product | null }) {
  if (product?.image) return <span className="promotion-product-photo" style={{ backgroundImage: `url(${product.image})` }} aria-hidden="true" />;
  return <span className="promotion-product-photo placeholder" aria-hidden="true">W</span>;
}

export default function PromotionsPage() {
  const [promotionData, setPromotionData] = useState<PromotionData | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [costRows, setCostRows] = useState<CostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedPromotion, setSelectedPromotion] = useState("all");
  const [decisionFilter, setDecisionFilter] = useState("all");
  const [query, setQuery] = useState("");
  const forceRefreshRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const today = beijingDateKey();
    const productParams = new URLSearchParams({ from: shiftDate(today, -89), to: today, view: "products" });
    const promotionParams = new URLSearchParams();
    if (forceRefreshRef.current) {
      productParams.set("refresh", "manual");
      promotionParams.set("refresh", "manual");
    }
    forceRefreshRef.current = false;
    Promise.all([
      fetch(`/api/wb/promotions?${promotionParams.toString()}`, { signal: controller.signal, cache: "no-store", headers: { Accept: "application/json" } }).then(async (response) => {
        const body = await response.json() as PromotionData | { error?: string };
        if (!response.ok) throw new Error("error" in body && body.error ? body.error : "促销日历读取失败");
        return body as PromotionData;
      }),
      fetch(`/api/wb/dashboard?${productParams.toString()}`, { signal: controller.signal, cache: "no-store", headers: { Accept: "application/json" } }).then(async (response) => {
        const body = await response.json() as ProductData | { error?: string };
        if (!response.ok) throw new Error("error" in body && body.error ? body.error : "商品信息读取失败");
        return body as ProductData;
      }),
      fetch("/api/product-costs", { signal: controller.signal, cache: "no-store", headers: { Accept: "application/json" } }).then(async (response) => {
        const body = await response.json() as { rows?: CostRow[]; error?: string };
        if (!response.ok) throw new Error(body.error || "产品成本读取失败");
        return body.rows ?? [];
      }),
    ])
      .then(([promotions, productData, costs]) => {
        setPromotionData(promotions);
        setProducts(productData.products ?? []);
        setCostRows(costs);
        setError("");
      })
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") setError(reason.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reloadKey]);

  useEffect(() => {
    const nextAt = promotionData?.syncSchedule?.nextAt;
    if (!nextAt) return;
    const delay = Math.max(1_000, new Date(nextAt).getTime() - Date.now() + 1_500);
    const timer = window.setTimeout(() => { setLoading(true); setReloadKey((value) => value + 1); }, delay);
    return () => window.clearTimeout(timer);
  }, [promotionData?.syncSchedule?.nextAt]);

  const productById = useMemo(() => new Map(products.map((product) => [product.nmId, product])), [products]);
  const costByNmId = useMemo(() => new Map(costRows.filter((cost) => cost.nmId).map((cost) => [Number(cost.nmId), cost])), [costRows]);
  const costBySku = useMemo(() => new Map(costRows.map((cost) => [normalizeProductSku(cost.sellerSku), cost])), [costRows]);

  const evaluations = useMemo(() => {
    const rows: Evaluation[] = [];
    for (const promotion of promotionData?.promotions ?? []) {
      for (const promoProduct of promotion.products) {
        const product = productById.get(promoProduct.nmId) ?? null;
        const cost = costByNmId.get(promoProduct.nmId)
          ?? (product ? costBySku.get(productCostSourceKey(product.sku)) ?? null : null);
        const exchangeRate = Number(cost?.exchangeRate || 0);
        const productCost = cost
          ? cost.productCostRub > 0 && exchangeRate > 0 ? cost.productCostRub / exchangeRate : Number(cost.productCostCny || 0)
          : 0;
        const lastMile = cost ? (cost.lengthCm * cost.widthCm * cost.heightCm / 1000) * 2 + 6 : 0;
        const variableRate = cost ? cost.commissionRate + cost.adRate + cost.activityDiscountRate + cost.returnLossRate : 0;
        const currentPriceRub = Number(promoProduct.price || product?.averagePrice || 0);
        const promoPriceRub = Number(promoProduct.planPrice || 0);
        const reductionRate = currentPriceRub > 0 && promoPriceRub > 0 ? Math.max(0, (currentPriceRub - promoPriceRub) / currentPriceRub * 100) : null;
        const promoPriceCny = promoPriceRub > 0 && exchangeRate > 0 ? promoPriceRub / exchangeRate : null;
        const fixedCostCny = cost ? productCost + Number(cost.handlingFeeCny || 0) + lastMile : null;
        const costReady = Boolean(cost && productCost > 0 && exchangeRate > 0 && promoPriceCny !== null && variableRate < 100);
        const breakEvenPriceCny = costReady && fixedCostCny !== null ? fixedCostCny / (1 - variableRate / 100) : null;
        const profitCny = costReady && promoPriceCny !== null && fixedCostCny !== null ? promoPriceCny * (1 - variableRate / 100) - fixedCostCny : null;
        const profitRate = profitCny !== null && promoPriceCny ? profitCny / promoPriceCny * 100 : null;
        rows.push({
          key: `${promotion.id}-${promoProduct.nmId}`,
          promotion,
          product,
          promoProduct,
          cost,
          currentPriceRub,
          promoPriceRub,
          reductionRate,
          costReady,
          promoPriceCny,
          fixedCostCny,
          variableRate: cost ? variableRate : null,
          breakEvenPriceCny,
          profitCny,
          profitRate,
          decision: !costReady ? "missing" : (profitCny ?? 0) >= 0 ? "profit" : "loss",
        });
      }
    }
    return rows;
  }, [costByNmId, costBySku, productById, promotionData?.promotions]);

  const evaluationsByPromotion = useMemo(() => {
    const map = new Map<number, Evaluation[]>();
    for (const row of evaluations) map.set(row.promotion.id, [...(map.get(row.promotion.id) ?? []), row]);
    return map;
  }, [evaluations]);

  const summary = useMemo(() => ({
    promotions: promotionData?.promotions.length ?? 0,
    products: new Set(evaluations.map((row) => row.promoProduct.nmId)).size,
    profitable: evaluations.filter((row) => row.decision === "profit").length,
    loss: evaluations.filter((row) => row.decision === "loss").length,
    missing: evaluations.filter((row) => row.decision === "missing").length,
  }), [evaluations, promotionData?.promotions.length]);

  const filtered = useMemo(() => {
    const needle = normalizeProductSku(query);
    return evaluations.filter((row) => {
      const matchesPromotion = selectedPromotion === "all" || String(row.promotion.id) === selectedPromotion;
      const matchesDecision = decisionFilter === "all" || row.decision === decisionFilter;
      const matchesQuery = !needle || [row.product?.sku || "", row.product?.name || "", String(row.promoProduct.nmId), row.promotion.name]
        .some((value) => normalizeProductSku(value).includes(needle));
      return matchesPromotion && matchesDecision && matchesQuery;
    });
  }, [decisionFilter, evaluations, query, selectedPromotion]);

  function refresh() {
    forceRefreshRef.current = true;
    setLoading(true);
    setError("");
    setReloadKey((value) => value + 1);
  }

  return (
    <main className="app-shell">
      <AppSidebar active="promotions" syncedAt={promotionData?.syncedAt} nextSyncAt={promotionData?.syncSchedule?.nextAt} loading={loading} error={error} onRefresh={refresh} />
      <section className="workspace product-workspace promotion-workspace">
        <header className="topbar product-topbar"><div><p className="eyebrow">PROMOTION CALENDAR · WB 官方活动</p><h1>平台活动评估</h1></div><div className="avatar">Z</div></header>

        <section className="promotion-notice">
          <span className="promotion-notice-icon">%</span>
          <div><strong>按 WB 活动计划价逐品测算</strong><p>预计利润已计入产品本金、操作费、尾程物流、佣金、广告、折扣和退损预留；活动折扣与排名加成直接取自 WB 官方接口。</p></div>
          <small>{promotionData ? `${dateTime(promotionData.window.from)} — ${dateTime(promotionData.window.to)}` : "正在读取活动日历"}</small>
        </section>

        <section className="promotion-summary-grid" aria-label="活动评估汇总">
          <article><span>可评估活动</span><strong>{summary.promotions}</strong><small>未来 90 天 WB 可参与活动</small></article>
          <article><span>适配商品</span><strong>{summary.products}</strong><small>已取得活动计划价</small></article>
          <article className="good"><span>预计可盈利</span><strong>{summary.profitable}</strong><small>按单件活动价测算</small></article>
          <article className={summary.loss ? "bad" : ""}><span>预计会亏损</span><strong>{summary.loss}</strong><small>不建议直接降至活动价</small></article>
          <article className={summary.missing ? "attention" : ""}><span>成本待补全</span><strong>{summary.missing}</strong><small>需先完善产品详情数据</small></article>
        </section>

        {error && <section className="promotion-error" role="alert"><strong>活动评估暂不可用</strong><span>{error}</span><button type="button" onClick={refresh}>重新读取</button></section>}

        <section className="promotion-calendar-panel">
          <div className="promotion-section-heading"><div><h2>促销活动日历</h2><p>降价比例按每个 SKU 的当前价与计划价计算；“加成”是 WB 公布的排名权益，不等同于实际访客增长。</p></div><span>{loading ? "同步中…" : `${promotionData?.promotions.length ?? 0} 个活动`}</span></div>
          <div className="promotion-card-grid">
            {(promotionData?.promotions ?? []).map((promotion) => {
              const state = promotionState(promotion);
              const rows = evaluationsByPromotion.get(promotion.id) ?? [];
              const reductionRates = rows.map((row) => row.reductionRate).filter((value): value is number => value !== null);
              const minReduction = reductionRates.length ? Math.min(...reductionRates) : null;
              const maxReduction = reductionRates.length ? Math.max(...reductionRates) : null;
              const boost = boostReference(promotion);
              return <button type="button" key={promotion.id} className={`promotion-card ${selectedPromotion === String(promotion.id) ? "active" : ""}`} onClick={() => setSelectedPromotion((value) => value === String(promotion.id) ? "all" : String(promotion.id))}>
                <div className="promotion-card-head"><span className={`promotion-state ${state.key}`}>{state.label}</span><small>{promotion.type === "auto" ? "自动活动" : "常规活动"}</small></div>
                <strong title={promotion.name}>{promotion.name}</strong>
                <p>{dateTime(promotion.startDateTime)} — {dateTime(promotion.endDateTime)}</p>
                <div className="promotion-card-metrics"><span><small>SKU 需再降价</small><b>{minReduction === null ? "待公布" : maxReduction === minReduction ? percent(minReduction) : `${percent(minReduction)}–${percent(maxReduction)}`}</b></span><span><small>可获得排名/流量加成</small><b>{boost === null ? "未量化" : `+${boost.boost}%${boost.current ? "" : " 起"}`}</b></span></div>
                <div className="promotion-boost-tiers">{promotion.ranging.length ? promotion.ranging.map((tier) => <i key={`${tier.condition}-${tier.participationRate}`}>参与 {tier.participationRate}% → 加成 {tier.boost}%</i>) : <i>WB 未提供量化加成档位</i>}</div>
                <footer><span>可评估 {rows.length} 个商品</span><span>当前参与率 {percent(promotion.participationPercentage)}</span></footer>
              </button>;
            })}
            {!loading && !error && !(promotionData?.promotions.length) && <div className="promotion-empty-card"><strong>未来 90 天暂无可参与活动</strong><span>WB 发布新活动后会在下一次同步时自动出现。</span></div>}
          </div>
          {promotionData?.truncated && <p className="promotion-truncated">当前活动较多，先展示开始时间最近的 30 个活动，避免触发 WB 接口频率限制。</p>}
        </section>

        <section className="promotion-table-panel">
          <div className="promotion-table-toolbar">
            <div><h2>商品活动盈亏明细</h2><p>活动价是 WB 要求的计划售价；安全底价使用产品详情中的完整成本与费率反推。</p></div>
            <div className="promotion-filters">
              <input aria-label="搜索 SKU、商品或活动" type="search" value={query} placeholder="搜索 SKU、商品或活动" onChange={(event) => setQuery(event.target.value)} />
              <select aria-label="选择活动" value={selectedPromotion} onChange={(event) => setSelectedPromotion(event.target.value)}><option value="all">全部活动</option>{(promotionData?.promotions ?? []).map((promotion) => <option key={promotion.id} value={promotion.id}>{promotion.name}</option>)}</select>
              <select aria-label="选择评估结果" value={decisionFilter} onChange={(event) => setDecisionFilter(event.target.value)}><option value="all">全部评估结果</option><option value="profit">可盈利参与</option><option value="loss">参与将亏损</option><option value="missing">成本待补全</option></select>
            </div>
          </div>
          <div className="promotion-table-wrap">
            <table className="promotion-table">
              <thead><tr><th>商品</th><th>活动</th><th>当前售价</th><th>活动计划价</th><th>降价比例</th><th>活动总折扣</th><th>排名/流量加成</th><th>完整成本</th><th>安全底价</th><th>预计盈亏</th><th>评估结果</th></tr></thead>
              <tbody>
                {filtered.map((row) => {
                  const boost = boostReference(row.promotion);
                  return <tr key={row.key}>
                    <td><div className="promotion-product-cell"><ProductPhoto product={row.product} /><div><b>{row.product?.sku || `WB ${row.promoProduct.nmId}`}</b><small>{row.product?.name || `nmId ${row.promoProduct.nmId}`}</small></div></div></td>
                    <td><b title={row.promotion.name}>{row.promotion.name}</b><small>{row.promoProduct.inAction ? "已参加" : "可参加"}</small></td>
                    <td><b>{money(row.currentPriceRub, "RUB")}</b><small>WB 活动接口当前价</small></td>
                    <td><b>{money(row.promoPriceRub, "RUB")}</b><small>{money(row.promoPriceCny, "CNY")}</small></td>
                    <td><b className={(row.reductionRate ?? 0) >= 20 ? "value-bad" : ""}>{percent(row.reductionRate)}</b><small>当前价 → 计划价</small></td>
                    <td><b>{percent(row.promoProduct.planDiscount)}</b><small>当前 {percent(row.promoProduct.discount)}</small></td>
                    <td><b>{boost === null ? "未量化" : `+${boost.boost}%${boost.current ? "" : " 起"}`}</b><small>{boost === null ? "平台未给出档位" : boost.current ? `当前参与率 ${percent(row.promotion.participationPercentage)}` : `参与率达到 ${percent(boost.participationRate)}`}</small></td>
                    <td><b>{money(row.fixedCostCny, "CNY")}</b><small>{row.variableRate === null ? "产品详情待补" : `另计比例费 ${percent(row.variableRate)}`}</small></td>
                    <td><b>{money(row.breakEvenPriceCny, "CNY")}</b><small>低于此价预计亏损</small></td>
                    <td><b className={row.decision === "profit" ? "value-good" : row.decision === "loss" ? "value-bad" : ""}>{row.profitCny === null ? "待补成本" : `${row.profitCny >= 0 ? "+" : "−"}${money(Math.abs(row.profitCny), "CNY")}`}</b><small>{row.profitRate === null ? "无法计算利润率" : `利润率 ${percent(row.profitRate)}`}</small></td>
                    <td><span className={`promotion-decision ${row.decision}`}>{row.decision === "profit" ? "可盈利参与" : row.decision === "loss" ? "参与将亏损" : "成本待补全"}</span></td>
                  </tr>;
                })}
                {!loading && filtered.length === 0 && <tr className="empty-row"><td colSpan={11}>{error ? "促销数据暂时无法读取" : "没有符合当前筛选条件的商品"}</td></tr>}
              </tbody>
            </table>
          </div>
          <footer className="promotion-table-footer"><span>共 {filtered.length} 条商品活动组合</span><span>利润为单件预估值，未将“排名加成”直接换算为销量。</span></footer>
        </section>
      </section>
    </main>
  );
}
