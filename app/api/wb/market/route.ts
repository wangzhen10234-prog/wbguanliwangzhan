import { env } from "cloudflare:workers";
import { addMetrics, conversionsFor, emptyMetrics, groupMarketProducts, marketRecommendations, summarizeMarketProducts, type FunnelMetrics, type MarketProduct } from "../../../_lib/market-analytics";
import { readSyncSnapshot, writeSyncSnapshot } from "../../../_lib/server-persistence";
import { resolveWbStore, scopedStoreKey } from "../../../_lib/server-storefront";

type WorkerError = Error & { status?: number };
type WbMetrics = Partial<FunnelMetrics> & { addToWishlist?: number };
type WbProductRow = {
  product?: { nmId?: number; title?: string; vendorCode?: string; brandName?: string; subjectId?: number; subjectName?: string; productRating?: number; feedbackRating?: number; stocks?: { wb?: number; mp?: number } };
  statistic?: { selected?: WbMetrics; comparison?: { openCountDynamic?: number; cartCountDynamic?: number; orderCountDynamic?: number; orderSumDynamic?: number } };
};
type WbHistoryRow = { date?: string; openCount?: number; cartCount?: number; orderCount?: number; orderSum?: number; buyoutCount?: number; buyoutSum?: number; buyoutPercent?: number; addToCartConversion?: number; cartToOrderConversion?: number; addToWishlistCount?: number };
type WbHistoryGroup = { history?: WbHistoryRow[]; currency?: string };
type BrandSubject = { parentId?: number; parentName?: string };
type BrandSharePoint = { applyDate?: string; brandRating?: number; pricePercent?: number; qtyPercent?: number };
type MarketSnapshot = Awaited<ReturnType<typeof fetchSnapshot>>;

const DAY_MS = 86_400_000;
const BEIJING_OFFSET_MS = 8 * 60 * 60_000;
const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" };
const memoryCache = new Map<string, { value: MarketSnapshot; expiresAt: number }>();
const pendingLoads = new Map<string, Promise<MarketSnapshot>>();

function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS }); }
function number(value: unknown) { const parsed = Number(value || 0); return Number.isFinite(parsed) ? parsed : 0; }
function beijingDateKey(value = Date.now()) { return new Date(value + BEIJING_OFFSET_MS).toISOString().slice(0, 10); }
function dateValue(value: string) { return new Date(`${value}T12:00:00Z`).getTime(); }
function shiftDate(value: string, days: number) { return new Date(dateValue(value) + days * DAY_MS).toISOString().slice(0, 10); }

function periodFromRequest(request: Request) {
  const url = new URL(request.url);
  const today = beijingDateKey();
  const to = url.searchParams.get("to") || today;
  const from = url.searchParams.get("from") || shiftDate(to, -29);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw Object.assign(new Error("DATE_INVALID"), { status: 400 });
  const days = Math.round((dateValue(to) - dateValue(from)) / DAY_MS) + 1;
  if (days < 1 || days > 90 || to > today) throw Object.assign(new Error("DATE_INVALID"), { status: 400 });
  return { from, to, days };
}

async function wbRequest<T>(url: string, token: string, body?: unknown) {
  const response = await fetch(url, { method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(25_000) });
  if (!response.ok) { const error = new Error(`WB market request failed: ${response.status}`) as WorkerError; error.status = response.status; throw error; }
  return response.json() as Promise<T>;
}

function metricShape(value: WbMetrics | undefined): FunnelMetrics {
  return { openCount: number(value?.openCount), cartCount: number(value?.cartCount), orderCount: number(value?.orderCount), orderSum: number(value?.orderSum), buyoutCount: number(value?.buyoutCount), buyoutSum: number(value?.buyoutSum), cancelCount: number(value?.cancelCount), cancelSum: number(value?.cancelSum), addToWishlist: number(value?.addToWishlist) };
}

function normalizeProducts(rows: WbProductRow[]) {
  return rows.map((row) => {
    const selected = metricShape(row.statistic?.selected);
    const comparison = row.statistic?.comparison;
    return {
      nmId: number(row.product?.nmId), sku: String(row.product?.vendorCode || ""), title: String(row.product?.title || "未命名商品"), brand: String(row.product?.brandName || ""), subjectId: number(row.product?.subjectId), subjectName: String(row.product?.subjectName || "未分类"), stock: number(row.product?.stocks?.wb) + number(row.product?.stocks?.mp), productRating: number(row.product?.productRating), feedbackRating: number(row.product?.feedbackRating),
      ...selected, ...conversionsFor(selected),
      openDynamic: comparison?.openCountDynamic === undefined ? null : number(comparison.openCountDynamic), cartDynamic: comparison?.cartCountDynamic === undefined ? null : number(comparison.cartCountDynamic), orderDynamic: comparison?.orderCountDynamic === undefined ? null : number(comparison.orderCountDynamic), orderSumDynamic: comparison?.orderSumDynamic === undefined ? null : number(comparison.orderSumDynamic),
    } satisfies MarketProduct;
  }).filter((item) => item.nmId > 0);
}

function historySummary(groups: WbHistoryGroup[]) {
  const byDate = new Map<string, FunnelMetrics>();
  for (const group of groups) for (const row of group.history ?? []) {
    const date = String(row.date || "").slice(0, 10);
    if (!date) continue;
    const current = byDate.get(date) ?? emptyMetrics();
    addMetrics(current, { openCount: row.openCount, cartCount: row.cartCount, orderCount: row.orderCount, orderSum: row.orderSum, buyoutCount: row.buyoutCount, buyoutSum: row.buyoutSum, addToWishlist: row.addToWishlistCount });
    byDate.set(date, current);
  }
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, metrics]) => ({ date, ...metrics, ...conversionsFor(metrics) }));
}

async function optional<T>(promise: Promise<T>, unavailable: string) {
  try { return { value: await promise, available: true, reason: "" }; }
  catch (error) {
    const status = number((error as WorkerError).status);
    return { value: null, available: false, reason: status === 402 ? "当前店铺未开通所需的 WB 分析权限或订阅" : status === 429 ? "WB 接口当前限流，已保留上次有效数据" : status === 401 || status === 403 ? "当前店铺 API 缺少分析权限" : unavailable };
  }
}

async function fetchSnapshot(token: string, period: { from: string; to: string; days: number }, brand: string, parentId: number, manual: boolean) {
  const pastTo = shiftDate(period.from, -1);
  const pastFrom = shiftDate(pastTo, -(period.days - 1));
  const historyTo = period.to;
  const historyFrom = shiftDate(historyTo, -(Math.min(7, period.days) - 1));
  const productsPromise = wbRequest<{ data?: { products?: WbProductRow[]; currency?: string } }>("https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/products", token, { selectedPeriod: { start: period.from, end: period.to }, pastPeriod: { start: pastFrom, end: pastTo }, nmIds: [], brandNames: [], subjectIds: [], tagIds: [], skipDeletedNm: true, orderBy: { field: "openCard", mode: "desc" }, limit: 1000, offset: 0 });
  const historyPromise = optional(wbRequest<{ data?: WbHistoryGroup[] }>("https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/grouped/history", token, { selectedPeriod: { start: historyFrom, end: historyTo }, brandNames: [], subjectIds: [], tagIds: [], skipDeletedNm: true, aggregationLevel: "day" }), "WB 每日漏斗暂时不可用");
  const brandsPromise = optional(wbRequest<{ data?: string[] }>("https://seller-analytics-api.wildberries.ru/api/v1/analytics/brand-share/brands", token), "WB 品牌份额接口暂时不可用");
  const [productResponse, historyResponse, brandsResponse] = await Promise.all([productsPromise, historyPromise, brandsPromise]);
  const products = normalizeProducts(productResponse.data?.products ?? []);
  const categories = groupMarketProducts(products);
  const summary = summarizeMarketProducts(products);
  const sellerBrands = brandsResponse.value?.data ?? [];
  const selectedBrand = sellerBrands.includes(brand) ? brand : "";
  let parentSubjects: BrandSubject[] = [];
  let shareReport: BrandSharePoint[] = [];
  let shareAvailable = brandsResponse.available && sellerBrands.length > 0;
  let shareReason = brandsResponse.reason || (!sellerBrands.length ? "WB 未返回近 90 天有销量的自有品牌，暂不能计算官方品牌市场份额" : "请选择品牌和一级分类查看份额");
  if (selectedBrand) {
    const url = new URL("https://seller-analytics-api.wildberries.ru/api/v1/analytics/brand-share/parent-subjects");
    url.searchParams.set("brand", selectedBrand); url.searchParams.set("dateFrom", period.from); url.searchParams.set("dateTo", period.to); url.searchParams.set("locale", "zh");
    const subjects = await optional(wbRequest<{ data?: BrandSubject[] }>(url.toString(), token), "WB 品牌分类接口暂时不可用");
    parentSubjects = subjects.value?.data ?? [];
    if (!subjects.available) { shareAvailable = false; shareReason = subjects.reason; }
    if (parentId > 0 && parentSubjects.some((item) => number(item.parentId) === parentId)) {
      const reportUrl = new URL("https://seller-analytics-api.wildberries.ru/api/v1/analytics/brand-share");
      reportUrl.searchParams.set("brand", selectedBrand); reportUrl.searchParams.set("parentId", String(parentId)); reportUrl.searchParams.set("dateFrom", period.from); reportUrl.searchParams.set("dateTo", period.to);
      const report = await optional(wbRequest<{ report?: BrandSharePoint[] }>(reportUrl.toString(), token), "WB 品牌份额报告暂时不可用");
      shareReport = report.value?.report ?? [];
      shareAvailable = report.available;
      shareReason = report.available ? (shareReport.length ? "WB 官方品牌销售份额" : "该品牌与分类在所选周期没有份额数据") : report.reason;
    }
  }
  return {
    source: "wildberries" as const,
    syncedAt: new Date().toISOString(),
    period,
    currency: String(productResponse.data?.currency || historyResponse.value?.data?.[0]?.currency || "RUB"),
    summary,
    categories,
    products,
    daily: historySummary(historyResponse.value?.data ?? []),
    recommendations: marketRecommendations(summary, categories),
    dataAvailability: { productFunnel: true, groupedHistory: historyResponse.available, groupedHistoryReason: historyResponse.reason, brandShare: shareAvailable, brandShareReason: shareReason },
    brandShare: { brands: sellerBrands, selectedBrand, parentSubjects: parentSubjects.map((item) => ({ parentId: number(item.parentId), parentName: String(item.parentName || "未命名分类") })), selectedParentId: parentId, report: shareReport.map((item) => ({ applyDate: String(item.applyDate || ""), brandRating: number(item.brandRating), pricePercent: number(item.pricePercent), qtyPercent: number(item.qtyPercent) })) },
    syncMode: manual ? "manual" as const : "scheduled" as const,
  };
}

async function loadMarket(token: string, storeId: string, period: { from: string; to: string; days: number }, brand: string, parentId: number, manual: boolean) {
  const hourBucket = Math.floor(Date.now() / 3_600_000);
  const key = scopedStoreKey(storeId, `market-v1-${period.from}-${period.to}-${brand || "all"}-${parentId || 0}`);
  const hourlySlot = `hour-${hourBucket}`;
  const memory = memoryCache.get(key);
  if (!manual && memory && memory.expiresAt > Date.now()) return memory.value;
  let durable: { value: MarketSnapshot; syncSlot: string; manualBucket: number } | null = null;
  try { const saved = await readSyncSnapshot(key); if (saved?.payload) durable = { value: JSON.parse(saved.payload) as MarketSnapshot, syncSlot: saved.syncSlot || "", manualBucket: saved.manualBucket || 0 }; } catch { durable = null; }
  if (!manual && durable?.syncSlot === hourlySlot) return durable.value;
  const pendingKey = `${key}-${manual ? "manual" : hourlySlot}`;
  const pending = pendingLoads.get(pendingKey); if (pending) return pending;
  const load = fetchSnapshot(token, period, brand, parentId, manual).then(async (value) => {
    memoryCache.set(key, { value, expiresAt: Date.now() + 3_600_000 });
    try { await writeSyncSnapshot(key, JSON.stringify(value), hourlySlot, 0, { preserveManualBucket: !manual }); } catch { /* Fresh API data remains usable without persistence. */ }
    return value;
  }).catch((error) => { if (!manual && durable?.value) return durable.value; throw error; }).finally(() => pendingLoads.delete(pendingKey));
  pendingLoads.set(pendingKey, load); return load;
}

export async function GET(request: Request) {
  try {
    const store = await resolveWbStore(request, env);
    if (!store.token) return json({ error: "当前店铺的 WB API 密钥尚未配置" }, 503);
    const url = new URL(request.url);
    const period = periodFromRequest(request);
    const brand = (url.searchParams.get("brand") || "").trim().slice(0, 120);
    const parentId = Math.max(0, Math.trunc(number(url.searchParams.get("parentId"))));
    return json(await loadMarket(store.token, store.id, period, brand, parentId, url.searchParams.get("refresh") === "manual"));
  } catch (error) {
    const status = number((error as WorkerError).status);
    if (status === 400) return json({ error: "统计周期需为 1–90 天，且不能晚于今天" }, 400);
    if (status === 401 || status === 403) return json({ error: "WB 密钥无效，或缺少分析权限" }, 502);
    if (status === 402) return json({ error: "当前店铺未开通 WB 销售漏斗权限" }, 402);
    if (status === 429) return json({ error: "WB 分析接口请求频繁，请稍后重试" }, 429);
    return json({ error: "产品行情数据暂时无法同步，请稍后重试" }, 502);
  }
}
