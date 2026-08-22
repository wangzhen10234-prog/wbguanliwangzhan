"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { AppSidebar } from "../_components/app-sidebar";

type Product = {
  nmId: number;
  name: string;
  sku: string;
  category: string;
  image: string | null;
};

type DashboardData = {
  syncedAt: string;
  syncSchedule: { nextAt: string };
  products: Product[];
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
  targetMarginRate: number;
  sortOrder: number;
  notes: string;
  updatedAt?: string;
};

type SheetRow = {
  key: string;
  product: Product | null;
  cost: CostRow;
  order: number;
};

type FormulaValues = {
  productCostCny: number | null;
  lastMileFeeCny: number;
  commissionFeeCny: number | null;
  adFeeCny: number | null;
  discountFeeCny: number | null;
  returnLossFeeCny: number | null;
  totalCostCny: number | null;
  referencePriceCny: number | null;
  actualSalePriceCny: number | null;
  grossProfitCny: number | null;
};

const DAY_MS = 86_400_000;
const ORIGINAL_ORDER = new Map(["wz311b", "wz311p", "wz310b", "wz810b", "wz810g"].map((sku, index) => [sku, (index + 1) * 100]));

function inputDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function normalizeSku(value: string) {
  return value.toLocaleLowerCase().replace(/[\s_.-]+/g, "");
}

function emptyCost(product: Product | null, sortOrder = 0): CostRow {
  return {
    sellerSku: product?.sku ?? "",
    nmId: product?.nmId ?? null,
    internalSku: "",
    category: product?.category || "",
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
    targetMarginRate: 10,
    sortOrder,
    notes: "",
  };
}

function formulas(cost: CostRow): FormulaValues {
  // 原 WPS 公式：P=(H*I*J/1000)*2+6。
  const lastMileFeeCny = (cost.lengthCm * cost.widthCm * cost.heightCm / 1000) * 2 + 6;
  // 原 WPS 多数行使用 N=L/M；像 wz310B 这种 L、M 留空的行则直接录入 N。
  if (cost.productCostRub > 0 && cost.exchangeRate <= 0) {
    return { productCostCny: null, lastMileFeeCny, commissionFeeCny: null, adFeeCny: null, discountFeeCny: null, returnLossFeeCny: null, totalCostCny: null, referencePriceCny: null, actualSalePriceCny: null, grossProfitCny: null };
  }
  const productCostCny = cost.productCostRub > 0 && cost.exchangeRate > 0 ? cost.productCostRub / cost.exchangeRate : cost.productCostCny;
  // 原 WPS 公式：AA=(N+O+P)/(1-(Q+S+U+W+AC))，百分比在网页中以 0-100 输入。
  const denominator = 1 - (cost.commissionRate + cost.adRate + cost.activityDiscountRate + cost.returnLossRate + cost.targetMarginRate) / 100;
  if (denominator <= 0) {
    return {
      productCostCny,
      lastMileFeeCny,
      commissionFeeCny: null,
      adFeeCny: null,
      discountFeeCny: null,
      returnLossFeeCny: null,
      totalCostCny: null,
      referencePriceCny: null,
      actualSalePriceCny: null,
      grossProfitCny: null,
    };
  }
  const actualSalePriceCny = (productCostCny + cost.handlingFeeCny + lastMileFeeCny) / denominator;
  const commissionFeeCny = actualSalePriceCny * cost.commissionRate / 100; // R=Q*AA
  const adFeeCny = actualSalePriceCny * cost.adRate / 100; // T=S*AA
  const discountFeeCny = actualSalePriceCny * cost.activityDiscountRate / 100; // V=U*AA
  const returnLossFeeCny = actualSalePriceCny * cost.returnLossRate / 100; // X=W*AA
  // 原 WPS 公式顺序：Y=N+O+P+R+T+X+V。
  const totalCostCny = productCostCny + cost.handlingFeeCny + lastMileFeeCny + commissionFeeCny + adFeeCny + returnLossFeeCny + discountFeeCny;
  const referencePriceCny = actualSalePriceCny / 0.7; // Z=AA/0.7
  const grossProfitCny = actualSalePriceCny - totalCostCny; // AB=AA-Y
  return { productCostCny, lastMileFeeCny, commissionFeeCny, adFeeCny, discountFeeCny, returnLossFeeCny, totalCostCny, referencePriceCny, actualSalePriceCny, grossProfitCny };
}

function display(value: number | null, digits = 2) {
  if (value === null || !Number.isFinite(value)) return "#DIV/0!";
  return value.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function NumberCell({ value, onChange, label, step = "0.01", suffix, blankZero = false }: { value: number; onChange: (value: number) => void; label: string; step?: string; suffix?: string; blankZero?: boolean }) {
  return (
    <label className={`sheet-input-wrap ${suffix ? "with-suffix" : ""}`}>
      <input aria-label={label} inputMode="decimal" min="0" step={step} type="number" value={blankZero && value === 0 ? "" : Number.isFinite(value) ? value : 0} onChange={(event) => onChange(Math.max(0, Number(event.target.value || 0)))} />
      {suffix && <span>{suffix}</span>}
    </label>
  );
}

export default function ProductDetailsPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [costs, setCosts] = useState<Record<string, CostRow>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const forceRefreshRef = useRef(false);
  const draftSequenceRef = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const today = new Date();
    const start = new Date(today.getTime() - 6 * DAY_MS);
    const params = new URLSearchParams({ from: inputDate(start), to: inputDate(today) });
    if (forceRefreshRef.current) params.set("refresh", "manual");
    forceRefreshRef.current = false;

    Promise.all([
      fetch(`/api/wb/dashboard?${params}`, { signal: controller.signal, cache: "no-store" }).then(async (response) => {
        const body = await response.json() as DashboardData | { error?: string };
        if (!response.ok) throw new Error("error" in body && body.error ? body.error : "WB 商品资料读取失败");
        return { value: body as DashboardData, error: "" };
      }).catch((reason: Error) => ({ value: null, error: reason.name === "AbortError" ? "" : reason.message })),
      fetch("/api/product-costs", { signal: controller.signal, cache: "no-store" }).then(async (response) => {
        const body = await response.json() as { rows?: CostRow[]; error?: string };
        if (!response.ok) throw new Error(body.error || "产品记录表读取失败");
        return body.rows ?? [];
      }),
    ]).then(([dashboardResult, storedRows]) => {
      const nextCosts: Record<string, CostRow> = {};
      for (const row of storedRows) nextCosts[normalizeSku(row.sellerSku)] = { ...row, targetMarginRate: Number(row.targetMarginRate ?? 10), sortOrder: Number(row.sortOrder ?? 0) };
      for (const product of dashboardResult.value?.products ?? []) {
        const key = normalizeSku(product.sku);
        nextCosts[key] = nextCosts[key]
          ? { ...nextCosts[key], sellerSku: product.sku, nmId: product.nmId }
          : emptyCost(product);
      }
      setData(dashboardResult.value);
      setCosts(nextCosts);
      setDirty(new Set());
      setError(dashboardResult.error ? `${dashboardResult.error}，产品记录表仍可编辑` : "");
    }).catch((reason: Error) => {
      if (reason.name !== "AbortError") setError(reason.message);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [reloadKey]);

  const rows = useMemo<SheetRow[]>(() => {
    const products = new Map((data?.products ?? []).map((product) => [normalizeSku(product.sku), product]));
    const keys = new Set([...products.keys(), ...Object.keys(costs)]);
    const productOrder = new Map([...products.keys()].sort((left, right) => left.localeCompare(right, "zh-CN")).map((key, index) => [key, 10_000 + index * 100]));
    const manualOrder = new Map(Object.keys(costs).filter((key) => !products.has(normalizeSku(costs[key].sellerSku)) && !key.startsWith("draft:")).sort((left, right) => left.localeCompare(right, "zh-CN")).map((key, index) => [key, 100_000 + index * 100]));
    return [...keys].map((key) => {
      const cost = costs[key];
      if (!cost) return null;
      const sellerKey = normalizeSku(cost.sellerSku);
      const product = products.get(sellerKey) ?? products.get(key) ?? null;
      const order = cost.sortOrder > 0 ? cost.sortOrder : ORIGINAL_ORDER.get(sellerKey) ?? productOrder.get(sellerKey) ?? manualOrder.get(key) ?? 1_000_000;
      return { key, product, cost, order };
    }).filter((row): row is SheetRow => Boolean(row)).sort((left, right) => left.order - right.order || left.cost.sellerSku.localeCompare(right.cost.sellerSku, "zh-CN"));
  }, [costs, data?.products]);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return rows;
    return rows.filter(({ cost, product }) => [cost.sellerSku, cost.internalSku, cost.category, cost.specification, product?.name ?? "", String(product?.nmId ?? "")].some((value) => value.toLocaleLowerCase().includes(needle)));
  }, [query, rows]);

  function refresh() {
    if (dirty.size) {
      setError("请先保存表格修改，再同步 WB 商品资料");
      return;
    }
    forceRefreshRef.current = true;
    setLoading(true);
    setError("");
    setReloadKey((key) => key + 1);
  }

  function updateCost(key: string, field: keyof CostRow, value: string | number) {
    setCosts((current) => ({ ...current, [key]: { ...current[key], [field]: value } as CostRow }));
    setDirty((current) => new Set(current).add(key));
    setError("");
    setMessage("");
  }

  function addRowAfter(afterKey: string | null) {
    const afterIndex = afterKey ? rows.findIndex((row) => row.key === afterKey) : -1;
    const previous = afterIndex >= 0 ? rows[afterIndex] : null;
    const following = afterIndex >= 0 ? rows[afterIndex + 1] : rows[0];
    const sortOrder = previous && following
      ? (previous.order + following.order) / 2
      : previous
        ? previous.order + 100
        : following
          ? Math.max(1, following.order / 2)
          : 100;
    const key = `draft:${Date.now()}:${++draftSequenceRef.current}`;
    setCosts((current) => ({ ...current, [key]: emptyCost(null, sortOrder) }));
    setDirty((current) => new Set(current).add(key));
    setQuery("");
    setError("");
    setMessage("已添加空白产品行，请先填写卖家商品编号");
  }

  async function saveAll() {
    if (!dirty.size) return;
    setSaving(true);
    setError("");
    setMessage("");
    const pendingKeys = [...dirty];
    try {
      const owners = new Map<string, string>();
      for (const [key, cost] of Object.entries(costs)) {
        const sellerKey = normalizeSku(cost.sellerSku);
        if (!sellerKey) {
          if (dirty.has(key)) throw new Error("新增产品必须先填写卖家商品编号");
          continue;
        }
        const existing = owners.get(sellerKey);
        if (existing && existing !== key) throw new Error(`卖家商品编号 ${cost.sellerSku} 已存在，请勿重复添加`);
        owners.set(sellerKey, key);
      }
      for (const key of pendingKeys) {
        const cost = costs[key];
        const rateTotal = cost.commissionRate + cost.adRate + cost.activityDiscountRate + cost.returnLossRate + cost.targetMarginRate;
        if (rateTotal >= 100) throw new Error(`${cost.sellerSku} 的费率与毛利率合计必须小于 100%`);
      }
      const savedRows = await Promise.all(pendingKeys.map(async (key) => {
        const cost = costs[key];
        const calculated = formulas(cost);
        const payload = { ...cost, productCostCny: calculated.productCostCny ?? cost.productCostCny, lastMileFeeCny: calculated.lastMileFeeCny, referencePriceCny: calculated.referencePriceCny ?? 0 };
        const response = await fetch("/api/product-costs", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await response.json() as { row?: CostRow; error?: string };
        if (!response.ok || !body.row) throw new Error(body.error || `${cost.sellerSku} 保存失败`);
        return [key, normalizeSku(body.row.sellerSku), body.row] as const;
      }));
      setCosts((current) => {
        const next = { ...current };
        for (const [oldKey, newKey, row] of savedRows) {
          if (oldKey !== newKey) delete next[oldKey];
          next[newKey] = row;
        }
        return next;
      });
      setDirty((current) => {
        const next = new Set(current);
        for (const [oldKey, newKey] of savedRows) {
          next.delete(oldKey);
          next.delete(newKey);
        }
        return next;
      });
      setMessage(`已保存 ${savedRows.length} 行产品记录`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "产品记录保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="app-shell">
      <AppSidebar active="details" syncedAt={data?.syncedAt} nextSyncAt={data?.syncSchedule.nextAt} loading={loading} error={error} onRefresh={refresh}>
        <div className="nav-section">产品统计表</div>
        <div className="product-side-summary"><span>系统商品记录</span><b>{rows.length} 条</b><small>按卖家商品编号自动对应</small></div>
        <div className="product-side-summary scope"><span>未保存修改</span><b>{dirty.size} 行</b><small>表内蓝字和红字均由公式自动计算</small></div>
      </AppSidebar>

      <section className="workspace details-workspace sheet-workspace">
        <header className="topbar product-topbar">
          <div><p className="eyebrow">PRODUCT REGISTER · 原表公式复刻</p><h1>产品详情</h1></div>
          <div className="sheet-save-state"><span className={error ? "error" : dirty.size ? "dirty" : "saved"} />{error || message || (loading ? "正在读取产品表" : dirty.size ? `${dirty.size} 行等待保存` : "所有修改已保存")}</div>
        </header>

        <section className="pricing-panel">
          <div className="pricing-hero">
            <div className="pricing-hero-copy"><span className="pricing-hero-icon">⌁</span><div><span className="pricing-workbench-kicker">SMART PRICING · 智能反推定价</span><h2>产品定价工作台</h2><p>修改任意成本、尺寸或费率，最终售价与全部费用立即联动更新。</p></div></div>
            <div className="pricing-hero-metrics"><div><span>产品记录</span><b>{rows.length}</b></div><div><span>WB 已匹配</span><b>{rows.filter((row) => row.product).length}</b></div><div className={dirty.size ? "attention" : ""}><span>待保存</span><b>{dirty.size}</b></div></div>
          </div>

          <div className="pricing-commandbar">
            <div className="pricing-legend"><span><i className="editable" />白色为可编辑数据</span><span><i className="calculated" />淡紫色为自动计算</span><span><i className="price" />最终售价实时反推</span></div>
            <div className="sheet-actions">
              <label className="sheet-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索商品编码、SKU、分类或规格" /></label>
              <button className="sheet-save-button" disabled={saving || dirty.size === 0} onClick={saveAll}>{saving ? "保存中…" : dirty.size ? `保存修改（${dirty.size}）` : "已全部保存"}</button>
            </div>
          </div>

          <div className="pricing-table-scroll">
            <table className="pricing-ledger-table" aria-label="产品定价表">
              <colgroup>
                <col className="col-a" /><col className="col-b" /><col className="col-c" /><col className="col-d" /><col className="col-e" /><col className="col-f" /><col className="col-g" />
                <col className="col-h" /><col className="col-i" /><col className="col-j" /><col className="col-k" /><col className="col-l" /><col className="col-m" /><col className="col-n" />
                <col className="col-o" /><col className="col-p" /><col className="col-q" /><col className="col-r" /><col className="col-s" /><col className="col-t" /><col className="col-u" />
                <col className="col-v" /><col className="col-w" /><col className="col-x" /><col className="col-y" /><col className="col-z" /><col className="col-aa" /><col className="col-ab" /><col className="col-ac" />
              </colgroup>
              <thead>
                <tr className="pricing-group-row"><th colSpan={11}><span>01</span>商品资料</th><th colSpan={5}><span>02</span>基础费用</th><th colSpan={6}><span>03</span>平台费用</th><th colSpan={2}><span>04</span>售后费用</th><th colSpan={5} className="result-group"><span>05</span>价格与利润</th></tr>
                <tr className="pricing-heading-row">
                  <th>主推分类</th><th>卖家商品编号</th><th>SKU</th><th>上线状态</th><th>商品图片</th><th>图片状态</th><th>规格</th><th>长<br /><small>cm</small></th><th>宽<br /><small>cm</small></th><th>高<br /><small>cm</small></th><th>重量<br /><small>g</small></th>
                  <th>产品成本<br /><small>₽</small></th><th>汇率</th><th>产品成本<br /><small>¥</small></th><th>操作费<br /><small>¥</small></th><th>尾程物流费<br /><small>¥ · 自动</small></th><th>平台佣金率</th><th>平台佣金<br /><small>¥ · 自动</small></th><th>广告投流率</th><th>广告费用<br /><small>¥ · 自动</small></th><th>活动折扣率</th><th>折扣费用<br /><small>¥ · 自动</small></th><th>退损率</th><th>退损费<br /><small>¥ · 自动</small></th>
                  <th>总成本<br /><small>¥</small></th><th>参考售价<br /><small>¥</small></th><th className="final-price-heading">最终售价<br /><small>¥ · 反推</small></th><th>毛利<br /><small>¥</small></th><th>目标毛利率</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(({ key, product, cost }) => {
                  const value = formulas(cost);
                  const invalid = value.actualSalePriceCny === null;
                  const isDraft = key.startsWith("draft:");
                  const label = cost.sellerSku || "新产品";
                  return (
                    <Fragment key={key}>
                      <tr className={`pricing-data-row ${dirty.has(key) ? "is-dirty" : ""} ${isDraft ? "is-new" : ""}`}>
                        <td className="sticky-a"><input className="sheet-text-input" aria-label={`${label} 主推分类`} value={cost.category} placeholder="输入分类" onChange={(event) => updateCost(key, "category", event.target.value)} /></td>
                        <td className="sticky-b">{isDraft ? <input className="sheet-text-input product-code-input" aria-label="新产品卖家商品编号" value={cost.sellerSku} placeholder="必填商品编号" onChange={(event) => updateCost(key, "sellerSku", event.target.value)} /> : <div className="product-code-lock"><b>{cost.sellerSku}</b><small>{product ? "已匹配 WB" : "手工记录"}</small></div>}</td>
                        <td><input className="sheet-text-input" aria-label={`${label} SKU`} value={cost.internalSku} placeholder="内部 SKU" onChange={(event) => updateCost(key, "internalSku", event.target.value)} /></td>
                        <td><span className={`data-status ${product ? "online" : "offline"}`}><i />{product ? "已上线" : isDraft ? "待登记" : "未匹配"}</span></td>
                        <td><span className={`sheet-product-image ${product?.image ? "" : "placeholder"}`} style={product?.image ? { backgroundImage: `url(${product.image})` } : undefined}>{product?.image ? "" : isDraft ? "+" : "—"}</span></td>
                        <td><span className={`image-status ${product?.image ? "complete" : "missing"}`}>{product?.image ? "图片齐全" : "待补图片"}</span></td>
                        <td><input className="sheet-text-input" aria-label={`${label} 规格`} value={cost.specification} placeholder="型号 / 颜色" onChange={(event) => updateCost(key, "specification", event.target.value)} /></td>
                        <td><NumberCell blankZero label={`${label} 长`} value={cost.lengthCm} onChange={(next) => updateCost(key, "lengthCm", next)} /></td>
                        <td><NumberCell blankZero label={`${label} 宽`} value={cost.widthCm} onChange={(next) => updateCost(key, "widthCm", next)} /></td>
                        <td><NumberCell blankZero label={`${label} 高`} value={cost.heightCm} onChange={(next) => updateCost(key, "heightCm", next)} /></td>
                        <td><NumberCell blankZero label={`${label} 重量`} step="1" value={cost.weightG} onChange={(next) => updateCost(key, "weightG", next)} /></td>
                        <td><NumberCell blankZero label={`${label} 产品成本卢布`} value={cost.productCostRub} onChange={(next) => updateCost(key, "productCostRub", next)} /></td>
                        <td><NumberCell blankZero label={`${label} 汇率`} value={cost.productCostRub > 0 ? cost.exchangeRate : 0} onChange={(next) => updateCost(key, "exchangeRate", next)} /></td>
                        <td className={cost.productCostRub > 0 ? "formula-cell" : "manual-cost-cell"}>{cost.productCostRub > 0 ? <span className="computed-value">{display(value.productCostCny)}</span> : <NumberCell blankZero label={`${label} 人民币产品成本`} value={cost.productCostCny} onChange={(next) => updateCost(key, "productCostCny", next)} />}</td>
                        <td><NumberCell blankZero label={`${label} 操作费`} value={cost.handlingFeeCny} onChange={(next) => updateCost(key, "handlingFeeCny", next)} /></td>
                        <td className="formula-cell"><span className="computed-value">{display(value.lastMileFeeCny)}</span></td>
                        <td><NumberCell label={`${label} 平台佣金率`} suffix="%" value={cost.commissionRate} onChange={(next) => updateCost(key, "commissionRate", next)} /></td>
                        <td className="formula-cell"><span className="computed-value">{display(value.commissionFeeCny)}</span></td>
                        <td><NumberCell label={`${label} 广告投流费率`} suffix="%" value={cost.adRate} onChange={(next) => updateCost(key, "adRate", next)} /></td>
                        <td className="formula-cell"><span className="computed-value">{display(value.adFeeCny)}</span></td>
                        <td><NumberCell label={`${label} 平台活动折扣率`} suffix="%" value={cost.activityDiscountRate} onChange={(next) => updateCost(key, "activityDiscountRate", next)} /></td>
                        <td className="formula-cell"><span className="computed-value">{display(value.discountFeeCny)}</span></td>
                        <td><NumberCell label={`${label} 退损率`} suffix="%" value={cost.returnLossRate} onChange={(next) => updateCost(key, "returnLossRate", next)} /></td>
                        <td className="formula-cell"><span className="computed-value">{display(value.returnLossFeeCny)}</span></td>
                        <td className="formula-cell total-cost"><span className="result-value">{display(value.totalCostCny)}</span></td>
                        <td className="formula-cell reference-price"><span className="result-value">{display(value.referencePriceCny, 0)}</span></td>
                        <td className={`formula-cell actual-price ${invalid ? "formula-error" : ""}`}><span className="final-price-value"><small>¥</small>{display(value.actualSalePriceCny)}</span></td>
                        <td className="formula-cell gross-profit"><span className="result-value">{display(value.grossProfitCny)}</span></td>
                        <td><NumberCell label={`${label} 毛利率`} suffix="%" value={cost.targetMarginRate} onChange={(next) => updateCost(key, "targetMarginRate", next)} /></td>
                      </tr>
                      <tr className="inline-add-row"><td colSpan={29}><button aria-label={`在 ${label} 后添加新产品`} onClick={() => addRowAfter(key)}><span>＋</span>在此处插入新产品</button></td></tr>
                    </Fragment>
                  );
                })}
                {!loading && filteredRows.length === 0 && <tr className="sheet-empty-row"><td colSpan={29}>{query ? "没有找到符合条件的商品" : "还没有产品记录"}</td></tr>}
              </tbody>
            </table>
          </div>
          <footer className="pricing-footer"><div><b>实时定价公式</b><span>基础成本 ÷（1 − 佣金 − 广告 − 折扣 − 退损 − 目标毛利率）</span></div><button className="append-product-button" onClick={() => addRowAfter(rows.at(-1)?.key ?? null)}><span>＋</span>在末尾添加产品</button></footer>
        </section>
      </section>
    </main>
  );
}
