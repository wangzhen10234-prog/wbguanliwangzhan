"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  notes: string;
  updatedAt?: string;
};

type SheetRow = {
  key: string;
  product: Product | null;
  cost: CostRow;
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
const ORIGINAL_ORDER = new Map(["wz311b", "wz311p", "wz310b", "wz810b", "wz810g"].map((sku, index) => [sku, index]));

function inputDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function normalizeSku(value: string) {
  return value.toLocaleLowerCase().replace(/[\s_.-]+/g, "");
}

function emptyCost(product: Product): CostRow {
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
    targetMarginRate: 10,
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
      for (const row of storedRows) nextCosts[normalizeSku(row.sellerSku)] = { ...row, targetMarginRate: Number(row.targetMarginRate ?? 10) };
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
    return [...keys].map((key) => {
      const product = products.get(key) ?? null;
      return { key, product, cost: costs[key] };
    }).filter((row): row is SheetRow => Boolean(row.cost)).sort((left, right) => {
      const leftRank = ORIGINAL_ORDER.get(left.key) ?? 10_000;
      const rightRank = ORIGINAL_ORDER.get(right.key) ?? 10_000;
      return leftRank - rightRank || left.cost.sellerSku.localeCompare(right.cost.sellerSku, "zh-CN");
    });
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
    setMessage("");
  }

  async function saveAll() {
    if (!dirty.size) return;
    setSaving(true);
    setError("");
    setMessage("");
    const pendingKeys = [...dirty];
    try {
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
        return [key, body.row] as const;
      }));
      setCosts((current) => {
        const next = { ...current };
        for (const [key, row] of savedRows) next[key] = row;
        return next;
      });
      setDirty((current) => {
        const next = new Set(current);
        for (const key of pendingKeys) next.delete(key);
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

        <section className="sheet-panel">
          <div className="sheet-toolbar">
            <div><h2>产品统计表</h2><p>字段、分组和计算公式均按你提供的 WPS 原表制作；商品按卖家商品编号与 WB 系统对应。</p></div>
            <div className="sheet-actions">
              <label className="sheet-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索商品编码、SKU、分类或规格" /></label>
              <button className="sheet-save-button" disabled={saving || dirty.size === 0} onClick={saveAll}>{saving ? "保存中…" : dirty.size ? `保存修改（${dirty.size}）` : "已全部保存"}</button>
            </div>
          </div>

          <div className="sheet-scroll">
            <table className="wps-sheet" aria-label="产品统计表">
              <colgroup>
                <col className="col-row-number" />
                <col className="col-a" /><col className="col-b" /><col className="col-c" /><col className="col-d" /><col className="col-e" /><col className="col-f" /><col className="col-g" />
                <col className="col-h" /><col className="col-i" /><col className="col-j" /><col className="col-k" /><col className="col-l" /><col className="col-m" /><col className="col-n" />
                <col className="col-o" /><col className="col-p" /><col className="col-q" /><col className="col-r" /><col className="col-s" /><col className="col-t" /><col className="col-u" />
                <col className="col-v" /><col className="col-w" /><col className="col-x" /><col className="col-y" /><col className="col-z" /><col className="col-aa" /><col className="col-ab" /><col className="col-ac" />
              </colgroup>
              <thead>
                <tr className="sheet-formula-row">
                  <th className="sheet-row-number">1</th><th colSpan={17} /><th className="formula-note">实际售价*平台佣金率</th><th /><th className="formula-note">实际售价*广告投流费率</th><th colSpan={3} /><th className="formula-note">实际售价*退损率</th><th colSpan={3} /><th className="formula-note">实际售价-总成本</th><th className="formula-note">毛利/实际售价*100%</th>
                </tr>
                <tr className="sheet-group-row">
                  <th className="sheet-row-number">2</th><th colSpan={11} /><th colSpan={5}>一、基础费用</th><th colSpan={6}>二、平台费用</th><th colSpan={2}>三、售后费用</th><th colSpan={5} />
                </tr>
                <tr className="sheet-heading-row">
                  <th className="sheet-row-number">3</th>
                  <th>主推分类</th><th>商品编码</th><th>sku</th><th>是否上线</th><th>图片</th><th>图片是否齐全</th><th>规格</th><th>长（cm）</th><th>宽（cm）</th><th>高（cm）</th><th>重量（g）</th>
                  <th>产品成本<br />（卢布）</th><th>汇率</th><th>1、产品成本<br />（元）</th><th>2、操作费<br />（元）</th><th>3、尾程物流费<br />（元）</th><th>平台佣金率（%）</th><th>4、平台佣金费用<br />（元）</th><th>广告投流费率（%）</th><th>5、广告投流费用<br />（元）</th><th>平台活动折扣率</th><th>折扣费用</th><th>退损率（%）</th><th>6、退损费（元）</th>
                  <th className="blue-heading">总成本（元）</th><th className="red-heading">参考售价（元）</th><th className="red-heading">实际售价（元）</th><th>毛利（元）</th><th>毛利率（%）</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(({ key, product, cost }, index) => {
                  const value = formulas(cost);
                  const invalid = value.actualSalePriceCny === null;
                  return (
                    <tr key={key} className={dirty.has(key) ? "is-dirty" : ""}>
                      <th className="sheet-row-number">{index + 4}</th>
                      <td className="sticky-a"><input className="sheet-text-input centered wrap" aria-label={`${cost.sellerSku} 主推分类`} value={cost.category} onChange={(event) => updateCost(key, "category", event.target.value)} /></td>
                      <td className="sticky-b"><b className="sheet-seller-sku">{cost.sellerSku}</b></td>
                      <td><input className="sheet-text-input centered" aria-label={`${cost.sellerSku} sku`} value={cost.internalSku} onChange={(event) => updateCost(key, "internalSku", event.target.value)} /></td>
                      <td><span>{product ? "是" : "否"}</span></td>
                      <td><span className={`sheet-product-image ${product?.image ? "" : "placeholder"}`} style={product?.image ? { backgroundImage: `url(${product.image})` } : undefined}>{product?.image ? "" : "—"}</span></td>
                      <td><span className={product?.image ? "image-complete" : "image-missing"}>{product?.image ? "齐全" : "未齐全"}</span></td>
                      <td><input className="sheet-text-input centered" aria-label={`${cost.sellerSku} 规格`} value={cost.specification} onChange={(event) => updateCost(key, "specification", event.target.value)} /></td>
                      <td><NumberCell blankZero label={`${cost.sellerSku} 长`} value={cost.lengthCm} onChange={(next) => updateCost(key, "lengthCm", next)} /></td>
                      <td><NumberCell blankZero label={`${cost.sellerSku} 宽`} value={cost.widthCm} onChange={(next) => updateCost(key, "widthCm", next)} /></td>
                      <td><NumberCell blankZero label={`${cost.sellerSku} 高`} value={cost.heightCm} onChange={(next) => updateCost(key, "heightCm", next)} /></td>
                      <td><NumberCell blankZero label={`${cost.sellerSku} 重量`} step="1" value={cost.weightG} onChange={(next) => updateCost(key, "weightG", next)} /></td>
                      <td><NumberCell blankZero label={`${cost.sellerSku} 产品成本卢布`} value={cost.productCostRub} onChange={(next) => updateCost(key, "productCostRub", next)} /></td>
                      <td><NumberCell blankZero label={`${cost.sellerSku} 汇率`} value={cost.productCostRub > 0 ? cost.exchangeRate : 0} onChange={(next) => updateCost(key, "exchangeRate", next)} /></td>
                      <td className={cost.productCostRub > 0 ? "formula-cell" : "manual-cost-cell"}>{cost.productCostRub > 0 ? display(value.productCostCny) : <NumberCell blankZero label={`${cost.sellerSku} 人民币产品成本`} value={cost.productCostCny} onChange={(next) => updateCost(key, "productCostCny", next)} />}</td>
                      <td><NumberCell blankZero label={`${cost.sellerSku} 操作费`} value={cost.handlingFeeCny} onChange={(next) => updateCost(key, "handlingFeeCny", next)} /></td>
                      <td className="formula-cell">{display(value.lastMileFeeCny)}</td>
                      <td><NumberCell label={`${cost.sellerSku} 平台佣金率`} suffix="%" value={cost.commissionRate} onChange={(next) => updateCost(key, "commissionRate", next)} /></td>
                      <td className="formula-cell">{display(value.commissionFeeCny)}</td>
                      <td><NumberCell label={`${cost.sellerSku} 广告投流费率`} suffix="%" value={cost.adRate} onChange={(next) => updateCost(key, "adRate", next)} /></td>
                      <td className="formula-cell">{display(value.adFeeCny)}</td>
                      <td><NumberCell label={`${cost.sellerSku} 平台活动折扣率`} suffix="%" value={cost.activityDiscountRate} onChange={(next) => updateCost(key, "activityDiscountRate", next)} /></td>
                      <td className="formula-cell">{display(value.discountFeeCny)}</td>
                      <td><NumberCell label={`${cost.sellerSku} 退损率`} suffix="%" value={cost.returnLossRate} onChange={(next) => updateCost(key, "returnLossRate", next)} /></td>
                      <td className="formula-cell">{display(value.returnLossFeeCny)}</td>
                      <td className="formula-cell total-cost">{display(value.totalCostCny)}</td>
                      <td className="formula-cell reference-price">{display(value.referencePriceCny, 0)}</td>
                      <td className={`formula-cell actual-price ${invalid ? "formula-error" : ""}`}>{display(value.actualSalePriceCny)}</td>
                      <td className="formula-cell">{display(value.grossProfitCny)}</td>
                      <td><NumberCell label={`${cost.sellerSku} 毛利率`} suffix="%" value={cost.targetMarginRate} onChange={(next) => updateCost(key, "targetMarginRate", next)} /></td>
                    </tr>
                  );
                })}
                {!loading && filteredRows.length === 0 && <tr className="sheet-empty-row"><td colSpan={30}>没有找到符合条件的商品</td></tr>}
              </tbody>
            </table>
          </div>
          <footer className="sheet-footer"><span>共 {filteredRows.length} 条产品记录</span><span>P=(H×I×J÷1000)×2+6 · N=L÷M（L 留空时可直接录入 N）· AA=(N+O+P)÷(1−Q−S−U−W−AC) · Z=AA÷0.7 · AB=AA−Y</span></footer>
        </section>
      </section>
    </main>
  );
}
