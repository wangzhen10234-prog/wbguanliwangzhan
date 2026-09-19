"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { AppSidebar } from "../_components/app-sidebar";
import { calculateCurrentSellingCost, type CurrentSellingCostStatus } from "../_lib/current-selling-cost";
import { findCurrentSellingPrice, type SellingPriceProduct } from "../_lib/current-selling-price";
import { inferProductCostCurrency, switchProductCostCurrency, type ProductCostCurrency } from "../_lib/product-cost-currency";
import { normalizeProductSku } from "../_lib/product-cost-aliases";
import { matchesProductDeletion, type ProductDeletionMarker } from "../_lib/product-deletions";
import { reconcileProductCosts } from "../_lib/product-matching";

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

type PriceData = {
  syncedAt: string;
  products: SellingPriceProduct[];
  stale: boolean;
  warning: string;
};

type CostRow = {
  sellerSku: string;
  nmId: number | null;
  imageUrl: string;
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

type BatchEditableField =
  | "category"
  | "internalSku"
  | "imageUrl"
  | "specification"
  | "lengthCm"
  | "widthCm"
  | "heightCm"
  | "weightG"
  | "productCostRub"
  | "exchangeRate"
  | "productCostCny"
  | "handlingFeeCny"
  | "commissionRate"
  | "adRate"
  | "activityDiscountRate"
  | "returnLossRate"
  | "targetMarginRate";

type BatchFieldOption = {
  key: BatchEditableField;
  label: string;
  kind: "text" | "number" | "percent" | "url";
};

const DAY_MS = 86_400_000;
const ORIGINAL_ORDER = new Map(["wz311b", "wz311p", "wz310b", "wz810b", "wz810g"].map((sku, index) => [sku, (index + 1) * 100]));
const BATCH_FIELDS: BatchFieldOption[] = [
  { key: "commissionRate", label: "% 平台佣金率", kind: "percent" },
  { key: "adRate", label: "% 广告投流率", kind: "percent" },
  { key: "activityDiscountRate", label: "% 活动折扣率", kind: "percent" },
  { key: "returnLossRate", label: "% 退损率", kind: "percent" },
  { key: "targetMarginRate", label: "% 目标毛利率", kind: "percent" },
  { key: "category", label: "产品分类", kind: "text" },
  { key: "internalSku", label: "内部 SKU", kind: "text" },
  { key: "specification", label: "规格", kind: "text" },
  { key: "imageUrl", label: "商品图片链接", kind: "url" },
  { key: "lengthCm", label: "长度（cm）", kind: "number" },
  { key: "widthCm", label: "宽度（cm）", kind: "number" },
  { key: "heightCm", label: "高度（cm）", kind: "number" },
  { key: "weightG", label: "重量（g）", kind: "number" },
  { key: "productCostRub", label: "产品成本（₽）", kind: "number" },
  { key: "exchangeRate", label: "汇率", kind: "number" },
  { key: "productCostCny", label: "产品成本（¥）", kind: "number" },
  { key: "handlingFeeCny", label: "操作费（¥）", kind: "number" },
];
const RATE_FIELDS = new Set<BatchEditableField>(["commissionRate", "adRate", "activityDiscountRate", "returnLossRate", "targetMarginRate"]);

function inputDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function emptyCost(product: Product | null, sortOrder = 0): CostRow {
  return {
    sellerSku: product?.sku ?? "",
    nmId: product?.nmId ?? null,
    imageUrl: "",
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

function currencySymbol(currency: string) {
  if (currency === "CNY") return "¥";
  if (currency === "RUB") return "₽";
  return currency;
}

function displayCurrentPrice(price: ReturnType<typeof findCurrentSellingPrice>) {
  if (!price) return "—";
  const minimum = display(price.min);
  return Math.abs(price.max - price.min) < 0.005 ? minimum : `${minimum}–${display(price.max)}`;
}

function currentCostStatusLabel(status: CurrentSellingCostStatus) {
  if (status === "profit") return "当前售价高于总成本";
  if (status === "loss") return "当前售价低于总成本";
  if (status === "mixed") return "不同规格有盈有亏";
  return "当前售价与总成本持平";
}

function productCategory(row: SheetRow) {
  return row.cost.category.trim() || row.product?.category?.trim() || "未分类";
}

function CardTextInput({ label, value, placeholder, onChange, mono = false }: { label: string; value: string; placeholder?: string; onChange: (value: string) => void; mono?: boolean }) {
  return <input className={`product-card-edit-input ${mono ? "mono" : ""}`} aria-label={label} title="点击修改" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />;
}

function CardNumberInput({ label, value, onChange, prefix, suffix, step = "0.01", blankZero = false }: { label: string; value: number; onChange: (value: number) => void; prefix?: string; suffix?: string; step?: string; blankZero?: boolean }) {
  return <label className="product-card-number-input" title="点击修改">
    {prefix && <span>{prefix}</span>}
    <input aria-label={label} inputMode="decimal" min="0" step={step} type="number" value={blankZero && value === 0 ? "" : Number.isFinite(value) ? value : 0} onChange={(event) => onChange(Math.max(0, Number(event.target.value || 0)))} />
    {suffix && <span>{suffix}</span>}
  </label>;
}

type ProductCardViewProps = {
  rows: SheetRow[];
  loading: boolean;
  priceData: PriceData | null;
  priceError: string;
  dirty: Set<string>;
  costCurrencies: Record<string, ProductCostCurrency>;
  onUpdate: (key: string, field: keyof CostRow, value: string | number) => void;
  onCurrencyChange: (key: string, currency: ProductCostCurrency) => void;
  onEditImage: (key: string, currentUrl: string) => void;
};

function ProductCardView({ rows, loading, priceData, priceError, dirty, costCurrencies, onUpdate, onCurrencyChange, onEditImage }: ProductCardViewProps) {
  if (!loading && rows.length === 0) return <div className="product-card-empty"><b>没有找到符合条件的商品</b><span>请更换产品分类或清除搜索条件。</span></div>;

  return <div className="product-card-grid" aria-label="产品详情卡片">
    {rows.map(({ key, product, cost }) => {
      const value = formulas(cost);
      const costCurrency = costCurrencies[key] ?? inferProductCostCurrency(cost);
      const imageUrl = cost.imageUrl || product?.image;
      const imageLabel = cost.imageUrl ? "自定义图片" : product?.image ? "WB 主图" : "待补图片";
      const currentSellingPrice = findCurrentSellingPrice(
        priceData?.products ?? [],
        { nmId: product?.nmId ?? cost.nmId, sellerSku: product?.sku ?? cost.sellerSku },
        cost.exchangeRate,
      );
      const currentSellingCost = calculateCurrentSellingCost(currentSellingPrice, cost);
      const currentPriceSource = currentSellingPrice
        ? currentSellingPrice.convertedToCny
          ? "WB API · ₽ 已按本行汇率换算"
          : currentSellingPrice.priceCount > 1
            ? `${currentSellingPrice.priceCount} 档规格价 · WB API`
            : priceData?.stale ? "上次成功同步价" : "WB API 折扣后价格"
        : priceError ? "价格接口暂不可用" : product ? "WB 暂未返回售价" : "未匹配 WB 商品";
      const currentCostValue = currentSellingCost
        ? `¥${Math.abs(currentSellingCost.max - currentSellingCost.min) < 0.005 ? display(currentSellingCost.min) : `${display(currentSellingCost.min)}–${display(currentSellingCost.max)}`}`
        : "—";
      const currentCostCopy = currentSellingCost
        ? currentCostStatusLabel(currentSellingCost.status)
        : currentSellingPrice ? currentSellingPrice.currency === "CNY" ? "成本资料待补全" : "售价币种暂不能换算" : "等待当前售价";
      const label = cost.sellerSku || cost.internalSku || "当前商品";
      return <article className={`product-detail-card ${key.startsWith("draft:") ? "draft" : ""} ${dirty.has(key) ? "is-dirty" : ""}`} key={key}>
        <header className="product-card-head">
          <button type="button" className={`product-card-photo product-card-photo-button ${imageUrl ? "" : "placeholder"}`} onClick={() => onEditImage(key, cost.imageUrl)} title="点击更换商品图片">{imageUrl ? <>
            {/* WB and user-provided image hosts are dynamic, so the native element intentionally avoids a fixed Next image allowlist. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt={product?.name || cost.sellerSku || "商品图片"} loading="lazy" referrerPolicy="no-referrer" />
          </> : "点击补图"}<i aria-hidden="true">✎</i></button>
          <div className="product-card-title"><div><CardTextInput label={`${label} 产品分类`} value={cost.category} placeholder={product?.category || "输入分类"} onChange={(next) => onUpdate(key, "category", next)} /><em className={product ? "online" : "offline"} title="WB 匹配状态，只读">{product ? "已上线" : key.startsWith("draft:") ? "待登记" : "未匹配"}</em>{dirty.has(key) && <em className="dirty">待保存</em>}</div><h3 title="商品名称来自 WB API，仅供查看">{product?.name || cost.sellerSku || "未命名新产品"}</h3><div className="product-card-seller-sku"><span>卖家商品编号</span><CardTextInput mono label={`${label} 卖家商品编号`} value={cost.sellerSku} placeholder="必填商品编号" onChange={(next) => onUpdate(key, "sellerSku", next)} /></div></div>
          <button type="button" className={`product-card-image-state ${imageUrl ? "complete" : "missing"}`} onClick={() => onEditImage(key, cost.imageUrl)}>{imageLabel}<small>点击修改</small></button>
        </header>

        <section className="product-card-section"><h4><span>01</span>商品资料</h4><dl className="product-card-data product-card-product-data">
          <div className="editable"><dt>产品分类</dt><dd><CardTextInput label={`${label} 产品分类`} value={cost.category} placeholder={product?.category || "输入分类"} onChange={(next) => onUpdate(key, "category", next)} /></dd></div>
          <div className="editable"><dt>内部 SKU</dt><dd><CardTextInput mono label={`${label} 内部 SKU`} value={cost.internalSku} placeholder="填写内部 SKU" onChange={(next) => onUpdate(key, "internalSku", next)} /></dd></div>
          <div className="read-only" title="WB 商品 ID 来自平台匹配，不可手动修改"><dt>WB 商品 ID · 只读</dt><dd>{product?.nmId ?? cost.nmId ?? "—"}</dd></div>
          <div className="editable"><dt>规格</dt><dd><CardTextInput label={`${label} 规格`} value={cost.specification} placeholder="型号 / 颜色" onChange={(next) => onUpdate(key, "specification", next)} /></dd></div>
          <div className="editable dimensions"><dt>长 × 宽 × 高（cm）</dt><dd><CardNumberInput blankZero label={`${label} 长`} value={cost.lengthCm} onChange={(next) => onUpdate(key, "lengthCm", next)} /><i>×</i><CardNumberInput blankZero label={`${label} 宽`} value={cost.widthCm} onChange={(next) => onUpdate(key, "widthCm", next)} /><i>×</i><CardNumberInput blankZero label={`${label} 高`} value={cost.heightCm} onChange={(next) => onUpdate(key, "heightCm", next)} /></dd></div>
          <div className="editable"><dt>重量</dt><dd><CardNumberInput blankZero label={`${label} 重量`} value={cost.weightG} step="1" suffix="g" onChange={(next) => onUpdate(key, "weightG", next)} /></dd></div>
          <div className="editable image-action"><dt>图片状态</dt><dd><button type="button" onClick={() => onEditImage(key, cost.imageUrl)}>{imageLabel}<small>点击更换</small></button></dd></div>
          <div className="editable"><dt>表内顺序</dt><dd><CardNumberInput blankZero label={`${label} 表内顺序`} value={cost.sortOrder} step="1" onChange={(next) => onUpdate(key, "sortOrder", next)} /></dd></div>
        </dl></section>

        <section className="product-card-section"><h4><span>02</span>基础费用</h4><dl className="product-card-data product-card-cost-data">
          <div className="editable currency-picker"><dt>供货商结算币种</dt><dd><select aria-label={`${label} 供货商结算币种`} value={costCurrency} onChange={(event) => onCurrencyChange(key, event.target.value as ProductCostCurrency)}><option value="CNY">人民币 ¥</option><option value="RUB">卢布 ₽</option></select></dd></div>
          <div className={costCurrency === "RUB" ? "editable" : "read-only"}><dt>卢布成本{costCurrency === "CNY" ? " · 不使用" : ""}</dt><dd>{costCurrency === "RUB" ? <CardNumberInput blankZero prefix="₽" label={`${label} 产品成本卢布`} value={cost.productCostRub} onChange={(next) => onUpdate(key, "productCostRub", next)} /> : "—"}</dd></div>
          <div className="editable"><dt>汇率（₽ ÷ ¥）</dt><dd><CardNumberInput label={`${label} 汇率`} value={cost.exchangeRate} onChange={(next) => onUpdate(key, "exchangeRate", next)} /></dd></div>
          <div className={costCurrency === "RUB" ? "read-only" : "editable"}><dt>人民币成本{costCurrency === "RUB" ? " · 自动换算" : " · 直接填写"}</dt><dd>{costCurrency === "RUB" ? `¥${display(value.productCostCny)}` : <CardNumberInput blankZero prefix="¥" label={`${label} 人民币产品成本`} value={cost.productCostCny} onChange={(next) => onUpdate(key, "productCostCny", next)} />}</dd></div>
          <div className="editable"><dt>操作费</dt><dd><CardNumberInput blankZero prefix="¥" label={`${label} 操作费`} value={cost.handlingFeeCny} onChange={(next) => onUpdate(key, "handlingFeeCny", next)} /></dd></div>
          <div className="read-only" title="按商品尺寸自动计算"><dt>尾程物流费 · 自动</dt><dd>¥{display(value.lastMileFeeCny)}</dd></div>
        </dl></section>

        <section className="product-card-section"><h4><span>03</span>平台与售后费用</h4><dl className="product-card-data rate-data">
          <div className="editable"><dt>平台佣金率</dt><dd><CardNumberInput suffix="%" label={`${label} 平台佣金率`} value={cost.commissionRate} onChange={(next) => onUpdate(key, "commissionRate", next)} /><small>自动费用 ¥{display(value.commissionFeeCny)}</small></dd></div>
          <div className="editable"><dt>广告投流率</dt><dd><CardNumberInput suffix="%" label={`${label} 广告投流率`} value={cost.adRate} onChange={(next) => onUpdate(key, "adRate", next)} /><small>自动费用 ¥{display(value.adFeeCny)}</small></dd></div>
          <div className="editable"><dt>活动折扣率</dt><dd><CardNumberInput suffix="%" label={`${label} 活动折扣率`} value={cost.activityDiscountRate} onChange={(next) => onUpdate(key, "activityDiscountRate", next)} /><small>自动费用 ¥{display(value.discountFeeCny)}</small></dd></div>
          <div className="editable"><dt>退损率</dt><dd><CardNumberInput suffix="%" label={`${label} 退损率`} value={cost.returnLossRate} onChange={(next) => onUpdate(key, "returnLossRate", next)} /><small>自动费用 ¥{display(value.returnLossFeeCny)}</small></dd></div>
        </dl></section>

        <section className="product-card-section product-card-pricing"><h4><span>04</span>价格与利润</h4><dl className="product-card-price-grid">
          <div className="read-only"><dt>总成本 · 自动</dt><dd>¥{display(value.totalCostCny)}</dd></div><div className="read-only"><dt>参考售价 · 自动</dt><dd>¥{display(value.referencePriceCny, 0)}</dd></div><div className="recommended read-only"><dt>最终售价 · 自动</dt><dd>¥{display(value.actualSalePriceCny)}</dd><small>按目标毛利率反推</small></div><div className="live read-only"><dt>当前在售价 · WB API</dt><dd>{currentSellingPrice ? `${currencySymbol(currentSellingPrice.currency)}${displayCurrentPrice(currentSellingPrice)}` : "—"}</dd><small>{currentPriceSource}</small></div><div className={`current-cost read-only ${currentSellingCost?.status ?? "missing"}`}><dt>当前在售总成本 · 自动</dt><dd>{currentCostValue}</dd><small>{currentCostCopy}</small></div><div className="profit editable"><dt>毛利 / 目标毛利率</dt><dd><strong>¥{display(value.grossProfitCny)}</strong><CardNumberInput suffix="%" label={`${label} 目标毛利率`} value={cost.targetMarginRate} onChange={(next) => onUpdate(key, "targetMarginRate", next)} /></dd><small>修改毛利率后售价实时重算</small></div>
        </dl></section>

        <footer className="product-card-foot"><label><b>备注</b><textarea aria-label={`${label} 备注`} title="点击修改" value={cost.notes} placeholder="点击填写备注" rows={1} onChange={(event) => onUpdate(key, "notes", event.target.value)} /></label><span title="更新时间由系统记录，不可手动修改"><b>更新时间 · 只读</b>{cost.updatedAt ? new Date(cost.updatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : key.startsWith("draft:") ? "尚未保存" : "未记录"}</span></footer>
      </article>;
    })}
  </div>;
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
  const [priceData, setPriceData] = useState<PriceData | null>(null);
  const [priceError, setPriceError] = useState("");
  const [costs, setCosts] = useState<Record<string, CostRow>>({});
  const [costCurrencies, setCostCurrencies] = useState<Record<string, ProductCostCurrency>>({});
  const [loading, setLoading] = useState(true);
  const [matching, setMatching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchField, setBatchField] = useState<BatchEditableField>("commissionRate");
  const [batchValue, setBatchValue] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const forceRefreshRef = useRef(false);
  const draftSequenceRef = useRef(0);
  const persistedSellerSkuRef = useRef<Record<string, string>>({});

  useEffect(() => {
    const controller = new AbortController();
    const today = new Date();
    const start = new Date(today.getTime() - 6 * DAY_MS);
    const params = new URLSearchParams({ from: inputDate(start), to: inputDate(today), view: "details" });
    const manualMatch = forceRefreshRef.current;
    if (manualMatch) params.set("refresh", "manual");
    forceRefreshRef.current = false;

    Promise.all([
      fetch(`/api/wb/dashboard?${params}`, { signal: controller.signal, cache: "no-store" }).then(async (response) => {
        const body = await response.json() as DashboardData | { error?: string };
        if (!response.ok) throw new Error("error" in body && body.error ? body.error : "WB 商品资料读取失败");
        return { value: body as DashboardData, error: "" };
      }).catch((reason: Error) => ({ value: null, error: reason.name === "AbortError" ? "" : reason.message })),
      fetch("/api/product-costs", { signal: controller.signal, cache: "no-store" }).then(async (response) => {
        const body = await response.json() as { rows?: CostRow[]; deletedProducts?: ProductDeletionMarker[]; error?: string };
        if (!response.ok) throw new Error(body.error || "产品记录表读取失败");
        return { rows: body.rows ?? [], deletedProducts: body.deletedProducts ?? [] };
      }),
      fetch(`/api/wb/prices${manualMatch ? "?refresh=manual" : ""}`, { signal: controller.signal, cache: "no-store" }).then(async (response) => {
        const body = await response.json() as PriceData | { error?: string };
        if (!response.ok) throw new Error("error" in body && body.error ? body.error : "WB 当前售价读取失败");
        return { value: body as PriceData, error: "" };
      }).catch((reason: Error) => ({ value: null, error: reason.name === "AbortError" ? "" : reason.message })),
    ]).then(([dashboardResult, productRegister, priceResult]) => {
      const visibleProducts = (dashboardResult.value?.products ?? []).filter((product) =>
        !matchesProductDeletion(product, productRegister.deletedProducts),
      );
      const normalizedRows = productRegister.rows.filter((row) =>
        !matchesProductDeletion({ sku: row.sellerSku, nmId: row.nmId }, productRegister.deletedProducts),
      ).map((row) => ({
        ...row,
        targetMarginRate: Number(row.targetMarginRate ?? 10),
        sortOrder: Number(row.sortOrder ?? 0),
      }));
      const matches = reconcileProductCosts(normalizedRows, visibleProducts, emptyCost);
      const nextCosts: Record<string, CostRow> = {};
      const nextPersistedSellerSkus: Record<string, string> = {};
      for (const match of matches) {
        nextCosts[match.key] = match.cost;
        nextPersistedSellerSkus[match.key] = match.persistedSellerSku;
      }
      persistedSellerSkuRef.current = nextPersistedSellerSkus;
      setData(dashboardResult.value ? { ...dashboardResult.value, products: visibleProducts } : null);
      setPriceData(priceResult.value);
      setPriceError(priceResult.error);
      setCosts(nextCosts);
      setCostCurrencies({});
      setDirty(new Set());
      setSelected(new Set());
      setError(dashboardResult.error ? `${dashboardResult.error}，产品记录表仍可编辑` : "");
      if (manualMatch && dashboardResult.value) {
        const matched = matches.filter((match) => match.product).length;
        const newProducts = matches.filter((match) => match.strategy === "newProduct").length;
        const manual = matches.filter((match) => match.strategy === "manual").length;
        setMessage(`匹配完成：WB 已匹配 ${matched} 个${newProducts ? `，新发现 ${newProducts} 个商品` : ""}${manual ? `，${manual} 个手工记录待核对编号` : ""}`);
      }
    }).catch((reason: Error) => {
      if (reason.name !== "AbortError") setError(reason.message);
    }).finally(() => {
      if (!controller.signal.aborted) {
        setLoading(false);
        setMatching(false);
      }
    });
    return () => controller.abort();
  }, [reloadKey]);

  const rows = useMemo<SheetRow[]>(() => {
    const products = new Map((data?.products ?? []).map((product) => [normalizeProductSku(product.sku), product]));
    const productsByNmId = new Map((data?.products ?? []).map((product) => [product.nmId, product]));
    const productOrder = new Map([...products.keys()].sort((left, right) => left.localeCompare(right, "zh-CN")).map((key, index) => [key, 10_000 + index * 100]));
    const manualOrder = new Map(Object.keys(costs).filter((key) => {
      const cost = costs[key];
      return !products.has(normalizeProductSku(cost.sellerSku)) && !(cost.nmId && productsByNmId.has(cost.nmId)) && !key.startsWith("draft:");
    }).sort((left, right) => left.localeCompare(right, "zh-CN")).map((key, index) => [key, 100_000 + index * 100]));
    return Object.entries(costs).map(([key, cost]) => {
      const sellerKey = normalizeProductSku(cost.sellerSku);
      const product = products.get(sellerKey) ?? (cost.nmId ? productsByNmId.get(cost.nmId) : null) ?? null;
      const productKey = product ? normalizeProductSku(product.sku) : sellerKey;
      const order = cost.sortOrder > 0 ? cost.sortOrder : ORIGINAL_ORDER.get(sellerKey) ?? productOrder.get(productKey) ?? manualOrder.get(key) ?? 1_000_000;
      return { key, product, cost, order };
    }).sort((left, right) => left.order - right.order || left.cost.sellerSku.localeCompare(right.cost.sellerSku, "zh-CN"));
  }, [costs, data?.products]);

  const categories = useMemo(() => [...new Set(rows.map(productCategory))].sort((left, right) => left.localeCompare(right, "zh-CN")), [rows]);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return rows.filter((row) => {
      if (categoryFilter !== "all" && productCategory(row) !== categoryFilter) return false;
      if (!needle) return true;
      const { cost, product } = row;
      return [cost.sellerSku, cost.internalSku, cost.category, cost.specification, product?.name ?? "", String(product?.nmId ?? "")].some((value) => value.toLocaleLowerCase().includes(needle));
    });
  }, [categoryFilter, query, rows]);

  const batchOption = BATCH_FIELDS.find((option) => option.key === batchField) ?? BATCH_FIELDS[0];
  const allFilteredSelected = filteredRows.length > 0 && filteredRows.every((row) => selected.has(row.key));

  function refresh() {
    if (dirty.size) {
      setError("请先保存表格修改，再同步 WB 商品资料");
      return;
    }
    forceRefreshRef.current = true;
    setMatching(true);
    setLoading(true);
    setError("");
    setMessage("正在从 WB 获取最新商品并重新匹配…");
    setReloadKey((key) => key + 1);
  }

  function updateCost(key: string, field: keyof CostRow, value: string | number) {
    setCosts((current) => ({ ...current, [key]: { ...current[key], [field]: value } as CostRow }));
    setDirty((current) => new Set(current).add(key));
    setError("");
    setMessage("");
  }

  function changeCostCurrency(key: string, currency: ProductCostCurrency) {
    setCosts((current) => {
      const cost = current[key];
      if (!cost) return current;
      return { ...current, [key]: { ...cost, ...switchProductCostCurrency(cost, currency) } };
    });
    setCostCurrencies((current) => ({ ...current, [key]: currency }));
    setDirty((current) => new Set(current).add(key));
    setError("");
    setMessage(currency === "CNY" ? "已切换为人民币结算，可直接填写人民币产品成本" : "已切换为卢布结算，人民币成本将按汇率自动换算");
  }

  function toggleRow(key: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleFilteredRows() {
    setSelected((current) => {
      const next = new Set(current);
      const shouldSelect = filteredRows.some((row) => !next.has(row.key));
      for (const row of filteredRows) {
        if (shouldSelect) next.add(row.key);
        else next.delete(row.key);
      }
      return next;
    });
  }

  function applyBatchEdit() {
    const selectedKeys = [...selected].filter((key) => costs[key]);
    if (!selectedKeys.length) {
      setError("请先勾选需要批量修改的商品");
      setMessage("");
      return;
    }

    let nextValue: string | number = batchValue.trim();
    if (batchOption.kind === "number" || batchOption.kind === "percent") {
      const numericValue = Number(batchValue);
      if (batchValue.trim() === "" || !Number.isFinite(numericValue) || numericValue < 0 || (batchOption.kind === "percent" && numericValue > 100)) {
        setError(batchOption.kind === "percent" ? "百分比请输入 0–100 之间的数值" : "请输入不小于 0 的有效数值");
        setMessage("");
        return;
      }
      nextValue = numericValue;
    } else if (batchOption.kind === "url" && nextValue) {
      try {
        const parsed = new URL(nextValue);
        if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("INVALID_URL");
        nextValue = parsed.href;
      } catch {
        setError("图片链接无效，请粘贴以 https:// 开头的 WB 主图链接");
        setMessage("");
        return;
      }
    }

    if (RATE_FIELDS.has(batchField)) {
      const invalidKey = selectedKeys.find((key) => {
        const row = { ...costs[key], [batchField]: nextValue } as CostRow;
        return row.commissionRate + row.adRate + row.activityDiscountRate + row.returnLossRate + row.targetMarginRate >= 100;
      });
      if (invalidKey) {
        setError(`${costs[invalidKey].sellerSku} 修改后的费率与毛利率合计必须小于 100%`);
        setMessage("");
        return;
      }
    }

    setCosts((current) => {
      const next = { ...current };
      for (const key of selectedKeys) next[key] = { ...next[key], [batchField]: nextValue } as CostRow;
      return next;
    });
    setDirty((current) => {
      const next = new Set(current);
      for (const key of selectedKeys) next.add(key);
      return next;
    });
    setError("");
    setMessage(`已批量修改 ${selectedKeys.length} 行“${batchOption.label.replace("% ", "")}”，请保存修改`);
    setBatchValue("");
  }

  function editImageUrl(key: string, currentUrl: string) {
    const nextUrl = window.prompt("粘贴 WB 商品主图的 HTTPS 链接；留空后保存可删除自定义图片。", currentUrl);
    if (nextUrl === null) return;
    const imageUrl = nextUrl.trim();
    let normalizedImageUrl = imageUrl;
    if (imageUrl) {
      try {
        const parsed = new URL(imageUrl);
        if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("INVALID_URL");
        normalizedImageUrl = parsed.href;
      } catch {
        setError("图片链接无效，请粘贴以 https:// 开头的 WB 主图链接");
        setMessage("");
        return;
      }
    }
    updateCost(key, "imageUrl", normalizedImageUrl);
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
    setCategoryFilter("all");
    setError("");
    setMessage("已添加空白产品行，请先填写卖家商品编号");
  }

  async function deleteRow(key: string, product: Product | null, cost: CostRow) {
    const label = cost.sellerSku || cost.internalSku || "当前商品";
    if (!window.confirm(`确认删除“${label}”这一行吗？删除后不会因 WB 同步自动重新出现。`)) return;

    if (key.startsWith("draft:")) {
      setCosts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setCostCurrencies((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setDirty((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      setSelected((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      setMessage(`已删除未保存的产品行“${label}”`);
      setError("");
      return;
    }

    setDeleting((current) => new Set(current).add(key));
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/product-costs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sellerSku: product?.sku || cost.sellerSku,
          persistedSellerSku: persistedSellerSkuRef.current[key] || "",
          nmId: product?.nmId ?? cost.nmId,
        }),
      });
      const body = await response.json() as { deleted?: boolean; error?: string };
      if (!response.ok || !body.deleted) throw new Error(body.error || `${label} 删除失败`);

      setCosts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setCostCurrencies((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setDirty((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      setSelected((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      const nextPersistedSellerSkus = { ...persistedSellerSkuRef.current };
      delete nextPersistedSellerSkus[key];
      persistedSellerSkuRef.current = nextPersistedSellerSkus;
      setMessage(`已删除产品行“${label}”`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "产品行删除失败");
    } finally {
      setDeleting((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
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
        const sellerKey = normalizeProductSku(cost.sellerSku);
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
        const payload = { ...cost, previousSellerSku: persistedSellerSkuRef.current[key] || "", productCostCny: calculated.productCostCny ?? cost.productCostCny, lastMileFeeCny: calculated.lastMileFeeCny, referencePriceCny: calculated.referencePriceCny ?? 0 };
        const response = await fetch("/api/product-costs", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await response.json() as { row?: CostRow; error?: string };
        if (!response.ok || !body.row) throw new Error(body.error || `${cost.sellerSku} 保存失败`);
        return [key, normalizeProductSku(body.row.sellerSku), body.row] as const;
      }));
      const nextPersistedSellerSkus = { ...persistedSellerSkuRef.current };
      for (const [oldKey, newKey, row] of savedRows) {
        delete nextPersistedSellerSkus[oldKey];
        nextPersistedSellerSkus[newKey] = row.sellerSku;
      }
      persistedSellerSkuRef.current = nextPersistedSellerSkus;
      setCosts((current) => {
        const next = { ...current };
        for (const [oldKey, newKey, row] of savedRows) {
          if (oldKey !== newKey) delete next[oldKey];
          next[newKey] = row;
        }
        return next;
      });
      setCostCurrencies((current) => {
        const next = { ...current };
        for (const [oldKey, newKey] of savedRows) {
          const currency = next[oldKey];
          if (oldKey !== newKey) delete next[oldKey];
          if (currency) next[newKey] = currency;
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
      setSelected((current) => {
        const next = new Set(current);
        for (const [oldKey, newKey] of savedRows) {
          if (next.delete(oldKey)) next.add(newKey);
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
          <div className="product-topbar-actions">
            <div className="product-view-switch" role="group" aria-label="产品详情展示方式"><button type="button" className={viewMode === "table" ? "active" : ""} aria-pressed={viewMode === "table"} onClick={() => setViewMode("table")}><span aria-hidden="true">▤</span>表格编辑</button><button type="button" className={viewMode === "cards" ? "active" : ""} aria-pressed={viewMode === "cards"} onClick={() => setViewMode("cards")}><span aria-hidden="true">▦</span>卡片展示</button></div>
            <div className="sheet-save-state"><span className={error ? "error" : dirty.size ? "dirty" : "saved"} />{error || message || (loading ? "正在读取产品表" : dirty.size ? `${dirty.size} 行等待保存` : "所有修改已保存")}</div>
          </div>
        </header>

        <section className="pricing-panel">
          <div className="pricing-hero">
            <div className="pricing-hero-copy"><span className="pricing-hero-icon">⌁</span><div><span className="pricing-workbench-kicker">SMART PRICING · 智能反推定价</span><h2>产品定价工作台</h2><p>供货商成本可选人民币直填或卢布换算，最终售价与全部费用立即联动更新。</p></div></div>
            <div className="pricing-hero-metrics"><div><span>产品记录</span><b>{rows.length}</b></div><div><span>WB 已匹配</span><b>{rows.filter((row) => row.product).length}</b></div><div className={dirty.size ? "attention" : ""}><span>待保存</span><b>{dirty.size}</b></div></div>
          </div>

          <div className="pricing-commandbar">
            {viewMode === "table" ? <div className="pricing-legend"><span><i className="editable" />白色为可编辑数据</span><span><i className="calculated" />淡紫色为自动计算</span><span><i className="price" />最终售价实时反推</span><span className="independent-product-register-note"><i>店</i>当前店铺独立产品表</span></div> : <div className="product-card-view-copy"><b>卡片内可直接编辑</b><span>点击白色字段修改；WB 官方数据和自动计算结果保持只读。</span></div>}
            <div className="sheet-actions">
              <button className="product-match-button" type="button" disabled={loading || saving} onClick={refresh}>{matching ? "匹配中…" : "↻ 匹配 WB 产品"}</button>
              <label className="product-category-filter"><span>产品分类</span><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} aria-label="按产品分类筛选"><option value="all">全部产品分类（{rows.length}）</option>{categories.map((category) => <option key={category} value={category}>{category}（{rows.filter((row) => productCategory(row) === category).length}）</option>)}</select></label>
              <label className="sheet-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索商品编码、SKU、分类或规格" /></label>
              <button className="sheet-save-button" disabled={saving || dirty.size === 0} onClick={saveAll}>{saving ? "保存中…" : dirty.size ? `保存修改（${dirty.size}）` : "已全部保存"}</button>
            </div>
          </div>

          {viewMode === "table" ? <>
          <div className={`batch-edit-bar ${selected.size ? "active" : ""}`}>
            <div className="batch-selection-summary"><b>{selected.size}</b><span>个商品已选</span>{selected.size > 0 && <button type="button" onClick={() => setSelected(new Set())}>清除选择</button>}</div>
            <label className="batch-control"><span>批量修改</span><select value={batchField} onChange={(event) => { setBatchField(event.target.value as BatchEditableField); setBatchValue(""); }} aria-label="选择批量修改字段">{BATCH_FIELDS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
            <label className={`batch-value ${batchOption.kind === "percent" ? "with-percent" : ""}`}><input type={batchOption.kind === "number" || batchOption.kind === "percent" ? "number" : "text"} min={batchOption.kind === "number" || batchOption.kind === "percent" ? "0" : undefined} max={batchOption.kind === "percent" ? "100" : undefined} step={batchOption.kind === "number" || batchOption.kind === "percent" ? "0.01" : undefined} value={batchValue} onChange={(event) => setBatchValue(event.target.value)} placeholder={batchOption.kind === "url" ? "粘贴 HTTPS 图片链接" : batchOption.kind === "text" ? "输入统一内容" : "输入统一数值"} aria-label={`${batchOption.label}批量修改值`} />{batchOption.kind === "percent" && <span>%</span>}</label>
            <button className="batch-apply-button" type="button" disabled={!selected.size} onClick={applyBatchEdit}>应用到 {selected.size || 0} 行</button>
            <small>可连续修改多个字段，最后统一保存</small>
          </div>

          <div className="pricing-table-scroll">
            <table className="pricing-ledger-table" aria-label="产品定价表">
              <colgroup>
                <col className="col-a" /><col className="col-b" /><col className="col-c" /><col className="col-d" /><col className="col-e" /><col className="col-f" /><col className="col-g" />
                <col className="col-h" /><col className="col-i" /><col className="col-j" /><col className="col-k" /><col className="col-cost-currency" /><col className="col-l" /><col className="col-m" /><col className="col-n" />
                <col className="col-o" /><col className="col-p" /><col className="col-q" /><col className="col-r" /><col className="col-s" /><col className="col-t" /><col className="col-u" />
                <col className="col-v" /><col className="col-w" /><col className="col-x" /><col className="col-y" /><col className="col-z" /><col className="col-aa" /><col className="col-ab" /><col className="col-ac" />
                <col className="col-ad" /><col className="col-ae" /><col className="col-af" />
              </colgroup>
              <thead>
                <tr className="pricing-group-row"><th colSpan={11}><span>01</span>商品资料</th><th colSpan={6}><span>02</span>基础费用</th><th colSpan={6}><span>03</span>平台费用</th><th colSpan={2}><span>04</span>售后费用</th><th colSpan={7} className="result-group"><span>05</span>价格与利润</th><th className="action-group"><span>06</span>操作</th></tr>
                <tr className="pricing-heading-row">
                  <th><label className="batch-check-all"><input type="checkbox" checked={allFilteredSelected} onChange={toggleFilteredRows} aria-label={allFilteredSelected ? "取消选择当前筛选结果" : "选择当前筛选结果"} /><span>产品分类</span></label></th><th>卖家商品编号</th><th>SKU</th><th>上线状态</th><th>商品图片</th><th>图片状态</th><th>规格</th><th>长<br /><small>cm</small></th><th>宽<br /><small>cm</small></th><th>高<br /><small>cm</small></th><th>重量<br /><small>g</small></th>
                  <th>结算币种<br /><small>供货商</small></th><th>产品成本<br /><small>₽</small></th><th>汇率<br /><small>₽ ÷ ¥</small></th><th>产品成本<br /><small>¥</small></th><th>操作费<br /><small>¥</small></th><th>尾程物流费<br /><small>¥ · 自动</small></th><th>平台佣金率</th><th>平台佣金<br /><small>¥ · 自动</small></th><th>广告投流率</th><th>广告费用<br /><small>¥ · 自动</small></th><th>活动折扣率</th><th>折扣费用<br /><small>¥ · 自动</small></th><th>退损率</th><th>退损费<br /><small>¥ · 自动</small></th>
                  <th>总成本<br /><small>¥</small></th><th>参考售价<br /><small>¥</small></th><th className="final-price-heading">最终售价<br /><small>¥ · 反推</small></th><th className="current-selling-price-heading">当前在售价<br /><small>WB API · 当前折扣价</small></th><th className="current-selling-cost-heading">当前在售总成本<br /><small>¥ · 按当前售价计算</small></th><th>毛利<br /><small>¥</small></th><th>目标毛利率</th><th className="delete-action-heading">删除</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(({ key, product, cost }) => {
                  const value = formulas(cost);
                  const costCurrency = costCurrencies[key] ?? inferProductCostCurrency(cost);
                  const invalid = value.actualSalePriceCny === null;
                  const isDraft = key.startsWith("draft:");
                  const label = cost.sellerSku || "新产品";
                  const imageUrl = cost.imageUrl || product?.image;
                  const imageLabel = cost.imageUrl ? "自定义图片" : product?.image ? "WB 主图" : "待补图片";
                  const currentSellingPrice = findCurrentSellingPrice(
                    priceData?.products ?? [],
                    { nmId: product?.nmId ?? cost.nmId, sellerSku: product?.sku ?? cost.sellerSku },
                    cost.exchangeRate,
                  );
                  const currentSellingCost = calculateCurrentSellingCost(currentSellingPrice, cost);
                  return (
                    <Fragment key={key}>
                      <tr className={`pricing-data-row ${dirty.has(key) ? "is-dirty" : ""} ${selected.has(key) ? "is-selected" : ""} ${isDraft ? "is-new" : ""}`}>
                        <td className="sticky-a"><div className="row-select-cell"><input className="row-select-checkbox" type="checkbox" checked={selected.has(key)} onChange={() => toggleRow(key)} aria-label={`选择 ${label}`} /><input className="sheet-text-input" aria-label={`${label} 产品分类`} value={cost.category} placeholder="输入分类" onChange={(event) => updateCost(key, "category", event.target.value)} /></div></td>
                        <td className="sticky-b"><div className="product-code-editor"><input className="sheet-text-input product-code-input" aria-label={`${label} 卖家商品编号`} value={cost.sellerSku} placeholder="必填商品编号" onChange={(event) => updateCost(key, "sellerSku", event.target.value)} /><small className={product ? "matched" : "unmatched"}>{product ? `已匹配 WB ${product.nmId}` : isDraft ? "待登记" : "修改编号后可重新匹配"}</small></div></td>
                        <td><input className="sheet-text-input" aria-label={`${label} SKU`} value={cost.internalSku} placeholder="内部 SKU" onChange={(event) => updateCost(key, "internalSku", event.target.value)} /></td>
                        <td><span className={`data-status ${product ? "online" : "offline"}`}><i />{product ? "已上线" : isDraft ? "待登记" : "未匹配"}</span></td>
                        <td><div className="sheet-image-editor"><span className={`sheet-product-image ${imageUrl ? "" : "placeholder"}`}>{imageUrl ? <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
                        </> : isDraft ? "+" : "—"}</span><button type="button" onClick={() => editImageUrl(key, cost.imageUrl)}>{cost.imageUrl ? "更换图片" : product?.image ? "自定义图片" : "粘贴链接"}</button></div></td>
                        <td><span className={`image-status ${imageUrl ? "complete" : "missing"}`}>{imageLabel}</span></td>
                        <td><input className="sheet-text-input" aria-label={`${label} 规格`} value={cost.specification} placeholder="型号 / 颜色" onChange={(event) => updateCost(key, "specification", event.target.value)} /></td>
                        <td><NumberCell blankZero label={`${label} 长`} value={cost.lengthCm} onChange={(next) => updateCost(key, "lengthCm", next)} /></td>
                        <td><NumberCell blankZero label={`${label} 宽`} value={cost.widthCm} onChange={(next) => updateCost(key, "widthCm", next)} /></td>
                        <td><NumberCell blankZero label={`${label} 高`} value={cost.heightCm} onChange={(next) => updateCost(key, "heightCm", next)} /></td>
                        <td><NumberCell blankZero label={`${label} 重量`} step="1" value={cost.weightG} onChange={(next) => updateCost(key, "weightG", next)} /></td>
                        <td className="cost-currency-cell"><select aria-label={`${label} 供货商结算币种`} value={costCurrency} onChange={(event) => changeCostCurrency(key, event.target.value as ProductCostCurrency)}><option value="CNY">人民币 ¥</option><option value="RUB">卢布 ₽</option></select></td>
                        <td className={costCurrency === "CNY" ? "formula-cell unused-cost-cell" : ""}>{costCurrency === "RUB" ? <NumberCell blankZero label={`${label} 产品成本卢布`} value={cost.productCostRub} onChange={(next) => updateCost(key, "productCostRub", next)} /> : <span className="computed-value">—</span>}</td>
                        <td><NumberCell label={`${label} 汇率`} value={cost.exchangeRate} onChange={(next) => updateCost(key, "exchangeRate", next)} /></td>
                        <td className={costCurrency === "RUB" ? "formula-cell" : "manual-cost-cell"}>{costCurrency === "RUB" ? <span className="computed-value">{display(value.productCostCny)}</span> : <NumberCell blankZero label={`${label} 人民币产品成本`} value={cost.productCostCny} onChange={(next) => updateCost(key, "productCostCny", next)} />}</td>
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
                        <td className="formula-cell current-selling-price"><span className={currentSellingPrice ? "current-selling-price-value" : "current-selling-price-missing"}>{currentSellingPrice && <small>{currencySymbol(currentSellingPrice.currency)}</small>}{displayCurrentPrice(currentSellingPrice)}</span><small className="current-selling-price-source">{currentSellingPrice ? currentSellingPrice.convertedToCny ? "WB API · ₽ 已按本行汇率换算" : currentSellingPrice.priceCount > 1 ? `${currentSellingPrice.priceCount} 档规格价 · WB API` : priceData?.stale ? "上次成功同步价" : "WB API 折扣后价格" : priceError ? "价格接口暂不可用" : product ? "WB 暂未返回售价" : "未匹配 WB 商品"}</small></td>
                        <td className={`formula-cell current-selling-cost ${currentSellingCost?.status ?? "missing"}`}><span className="current-selling-cost-value">{currentSellingCost ? `¥${Math.abs(currentSellingCost.max - currentSellingCost.min) < 0.005 ? display(currentSellingCost.min) : `${display(currentSellingCost.min)}–${display(currentSellingCost.max)}`}` : "—"}</span><small>{currentSellingCost ? currentCostStatusLabel(currentSellingCost.status) : currentSellingPrice ? currentSellingPrice.currency === "CNY" ? "成本资料待补全" : "售价币种暂不能换算" : "等待当前售价"}</small></td>
                        <td className="formula-cell gross-profit"><span className="result-value">{display(value.grossProfitCny)}</span></td>
                        <td><NumberCell label={`${label} 毛利率`} suffix="%" value={cost.targetMarginRate} onChange={(next) => updateCost(key, "targetMarginRate", next)} /></td>
                        <td className="delete-action-cell">{selected.has(key) && <button type="button" disabled={deleting.has(key)} onClick={() => deleteRow(key, product, cost)}>{deleting.has(key) ? "删除中…" : "删除本行"}</button>}</td>
                      </tr>
                      <tr className="inline-add-row"><td colSpan={33}><button aria-label={`在 ${label} 后添加新产品`} onClick={() => addRowAfter(key)}><span>＋</span>在此处插入新产品</button></td></tr>
                    </Fragment>
                  );
                })}
                {!loading && filteredRows.length === 0 && <tr className="sheet-empty-row"><td colSpan={33}>{query || categoryFilter !== "all" ? "没有找到符合条件的商品" : "还没有产品记录"}</td></tr>}
              </tbody>
            </table>
          </div>
          <footer className="pricing-footer"><div><b>实时定价公式</b><span>基础成本 ÷（1 − 佣金 − 广告 − 折扣 − 退损 − 目标毛利率）</span></div><button className="append-product-button" onClick={() => addRowAfter(rows.at(-1)?.key ?? null)}><span>＋</span>在末尾添加产品</button></footer>
          </> : <><ProductCardView rows={filteredRows} loading={loading} priceData={priceData} priceError={priceError} dirty={dirty} costCurrencies={costCurrencies} onUpdate={updateCost} onCurrencyChange={changeCostCurrency} onEditImage={editImageUrl} /><footer className="product-card-view-footer"><span>当前展示 <b>{filteredRows.length}</b> / {rows.length} 个产品</span><small>白色字段可直接修改，修改后点击右上角“保存修改”；平台数据与公式结果只读。</small></footer></>}
        </section>
      </section>
    </main>
  );
}
