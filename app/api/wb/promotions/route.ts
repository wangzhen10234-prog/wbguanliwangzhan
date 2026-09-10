import { env } from "cloudflare:workers";
import { readSyncSnapshot, writeSyncSnapshot } from "../../../_lib/server-persistence";
import { resolveWbStore, scopedStoreKey } from "../../../_lib/server-storefront";

type PromotionListItem = {
  id?: number;
  name?: string;
  startDateTime?: string;
  endDateTime?: string;
  type?: string;
};

type PromotionRange = {
  condition?: string;
  participationRate?: number;
  boost?: number;
};

type PromotionDetail = PromotionListItem & {
  description?: string;
  inPromoActionLeftovers?: number;
  inPromoActionTotal?: number;
  notInPromoActionLeftovers?: number;
  notInPromoActionTotal?: number;
  participationPercentage?: number;
  exceptionProductsCount?: number;
  ranging?: PromotionRange[];
};

type PromotionProduct = {
  id?: number;
  inAction?: boolean;
  price?: number;
  currencyCode?: string;
  planPrice?: number;
  discount?: number;
  planDiscount?: number;
};

type PromotionView = {
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
  products: Array<{
    nmId: number;
    inAction: boolean;
    price: number;
    planPrice: number;
    currencyCode: string;
    discount: number;
    planDiscount: number;
  }>;
  productDataAvailable: boolean;
};

type PromotionSnapshot = {
  source: "WB Promotions Calendar API";
  syncedAt: string;
  window: { from: string; to: string };
  promotions: PromotionView[];
  truncated: boolean;
};

type WorkerError = Error & { status?: number };
type CacheEntry = { value: PromotionSnapshot; expiresAt: number };

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};
const BEIJING_OFFSET_MS = 8 * 60 * 60_000;
const AUTO_SYNC_HOURS = [8, 14, 19, 23] as const;
const PROMOTION_WINDOW_DAYS = 90;
const MAX_PROMOTIONS_WITH_PRODUCTS = 30;
const PRODUCT_REQUEST_BATCH = 4;
const PRODUCT_FIRST_PAUSE_MS = 725;
const PRODUCT_BATCH_PAUSE_MS = 3_200;
const SNAPSHOT_KEY = "promotion-calendar-v2";

const memoryCache = new Map<string, CacheEntry>();
const pendingLoads = new Map<string, Promise<PromotionSnapshot>>();

function syncSchedule(now = Date.now()) {
  const beijingNow = new Date(now + BEIJING_OFFSET_MS);
  const year = beijingNow.getUTCFullYear();
  const month = beijingNow.getUTCMonth();
  const day = beijingNow.getUTCDate();
  const hour = beijingNow.getUTCHours();
  const dateKey = beijingNow.toISOString().slice(0, 10);
  const previousDateKey = new Date(Date.UTC(year, month, day - 1)).toISOString().slice(0, 10);
  const currentHour = [...AUTO_SYNC_HOURS].reverse().find((value) => hour >= value);
  const slot = currentHour === undefined ? `${previousDateKey}-23` : `${dateKey}-${String(currentHour).padStart(2, "0")}`;
  const nextHour = AUTO_SYNC_HOURS.find((value) => value > hour);
  const nextAt = nextHour === undefined
    ? Date.UTC(year, month, day + 1, AUTO_SYNC_HOURS[0]) - BEIJING_OFFSET_MS
    : Date.UTC(year, month, day, nextHour) - BEIJING_OFFSET_MS;
  return { slot, nextAt };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function integer(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function number(value: unknown) {
  const result = Number(value || 0);
  return Number.isFinite(result) ? result : 0;
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function dateWindow() {
  const from = new Date();
  from.setUTCHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + PROMOTION_WINDOW_DAYS * 86_400_000 - 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

async function wbRequest<T>(url: string, token: string) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) {
    const error = new Error(`WB promotions request failed: ${response.status}`) as WorkerError;
    error.status = response.status;
    throw error;
  }
  return response.json() as Promise<T>;
}

async function readSnapshot(cacheKey: string) {
  try {
    const row = await readSyncSnapshot(cacheKey);
    return row?.payload ? { value: JSON.parse(row.payload) as PromotionSnapshot, syncSlot: row.syncSlot || "" } : null;
  } catch {
    return null;
  }
}

async function writeSnapshot(cacheKey: string, value: PromotionSnapshot) {
  try {
    await writeSyncSnapshot(cacheKey, JSON.stringify(value), syncSchedule().slot);
  } catch {
    // A cache write must never invalidate fresh WB promotion data.
  }
}

function normalizeProduct(row: PromotionProduct) {
  return {
    nmId: integer(row.id),
    inAction: Boolean(row.inAction),
    price: number(row.price),
    planPrice: number(row.planPrice),
    currencyCode: text(row.currencyCode, "RUB"),
    discount: number(row.discount),
    planDiscount: number(row.planDiscount),
  };
}

async function loadProducts(promotionId: number, inAction: boolean, token: string) {
  const url = new URL("https://dp-calendar-api.wildberries.ru/api/v1/calendar/promotions/nomenclatures");
  url.searchParams.set("promotionID", String(promotionId));
  url.searchParams.set("inAction", String(inAction));
  url.searchParams.set("limit", "1000");
  url.searchParams.set("offset", "0");
  const response = await wbRequest<{ data?: { nomenclatures?: PromotionProduct[] } }>(url.toString(), token);
  return (response.data?.nomenclatures ?? []).map(normalizeProduct).filter((item) => item.nmId > 0);
}

async function fetchPromotionSnapshot(token: string) {
  const window = dateWindow();
  const listUrl = new URL("https://dp-calendar-api.wildberries.ru/api/v1/calendar/promotions");
  listUrl.searchParams.set("startDateTime", window.from);
  listUrl.searchParams.set("endDateTime", window.to);
  listUrl.searchParams.set("allPromo", "false");
  listUrl.searchParams.set("limit", "1000");
  listUrl.searchParams.set("offset", "0");
  const listResponse = await wbRequest<{ data?: { promotions?: PromotionListItem[] } }>(listUrl.toString(), token);
  const listed = (listResponse.data?.promotions ?? [])
    .filter((promotion) => integer(promotion.id) > 0)
    .sort((a, b) => text(a.startDateTime).localeCompare(text(b.startDateTime)));
  const selected = listed.slice(0, MAX_PROMOTIONS_WITH_PRODUCTS);
  const detailById = new Map<number, PromotionDetail>();
  for (let offset = 0; offset < selected.length; offset += 100) {
    const batch = selected.slice(offset, offset + 100);
    const detailUrl = new URL("https://dp-calendar-api.wildberries.ru/api/v1/calendar/promotions/details");
    for (const promotion of batch) detailUrl.searchParams.append("promotionIDs", String(integer(promotion.id)));
    const response = await wbRequest<{ data?: { promotions?: PromotionDetail[] } }>(detailUrl.toString(), token);
    for (const detail of response.data?.promotions ?? []) detailById.set(integer(detail.id), detail);
  }

  const productsByPromotion = new Map<number, ReturnType<typeof normalizeProduct>[]>();
  const productDataUnavailable = new Set<number>();
  const regularPromotions = selected.filter((promotion) => {
    const detail = detailById.get(integer(promotion.id)) ?? promotion;
    return text(detail.type || promotion.type, "regular") !== "auto";
  });
  const productRequests = regularPromotions.flatMap((promotion) => {
    const promotionId = integer(promotion.id);
    const detail = detailById.get(promotionId) ?? promotion;
    return [
      { promotionId, inAction: false },
      ...(integer(detail.inPromoActionTotal) > 0 ? [{ promotionId, inAction: true }] : []),
    ];
  });
  for (let offset = 0; offset < productRequests.length; offset += PRODUCT_REQUEST_BATCH) {
    await new Promise((resolve) => setTimeout(resolve, offset > 0 ? PRODUCT_BATCH_PAUSE_MS : PRODUCT_FIRST_PAUSE_MS));
    const batch = productRequests.slice(offset, offset + PRODUCT_REQUEST_BATCH);
    const results = await Promise.all(batch.map(async ({ promotionId, inAction }) => {
      try {
        return { promotionId, inAction, products: await loadProducts(promotionId, inAction, token), available: true };
      } catch (error) {
        if (Number((error as WorkerError).status || 0) === 422) return { promotionId, inAction, products: [], available: false };
        throw error;
      }
    }));
    for (const result of results) {
      const merged = new Map((productsByPromotion.get(result.promotionId) ?? []).map((product) => [product.nmId, product]));
      for (const product of result.products) {
        if (product.inAction || !merged.has(product.nmId)) merged.set(product.nmId, product);
      }
      productsByPromotion.set(result.promotionId, [...merged.values()]);
      if (!result.available && !result.inAction) productDataUnavailable.add(result.promotionId);
    }
  }

  const promotions: PromotionView[] = [];
  for (const listedPromotion of selected) {
    const promotionId = integer(listedPromotion.id);
    const detail = detailById.get(promotionId) ?? listedPromotion;
    const type = text(detail.type || listedPromotion.type, "regular");
    const products = productsByPromotion.get(promotionId) ?? [];
    const productDataAvailable = type !== "auto" && !productDataUnavailable.has(promotionId);
    promotions.push({
      id: promotionId,
      name: text(detail.name || listedPromotion.name, `活动 ${promotionId}`),
      description: text(detail.description),
      startDateTime: text(detail.startDateTime || listedPromotion.startDateTime),
      endDateTime: text(detail.endDateTime || listedPromotion.endDateTime),
      type,
      participationPercentage: number(detail.participationPercentage),
      inPromoActionTotal: integer(detail.inPromoActionTotal),
      notInPromoActionTotal: integer(detail.notInPromoActionTotal),
      exceptionProductsCount: integer(detail.exceptionProductsCount),
      ranging: (detail.ranging ?? []).map((item) => ({
        condition: text(item.condition),
        participationRate: number(item.participationRate),
        boost: number(item.boost),
      })).sort((a, b) => a.participationRate - b.participationRate),
      products,
      productDataAvailable,
    });
  }
  return {
    source: "WB Promotions Calendar API" as const,
    syncedAt: new Date().toISOString(),
    window,
    promotions,
    truncated: listed.length > selected.length,
  };
}

async function loadPromotions(token: string, storeId: string, forceRefresh: boolean) {
  const cacheKey = scopedStoreKey(storeId, SNAPSHOT_KEY);
  const schedule = syncSchedule();
  const memory = memoryCache.get(cacheKey);
  if (!forceRefresh && memory && memory.expiresAt > Date.now()) return memory.value;
  const durable = await readSnapshot(cacheKey);
  if (!forceRefresh && durable?.syncSlot === schedule.slot) {
    memoryCache.set(cacheKey, { value: durable.value, expiresAt: schedule.nextAt });
    return durable.value;
  }
  const pending = pendingLoads.get(cacheKey);
  if (pending) return pending;
  const load = fetchPromotionSnapshot(token)
    .then(async (snapshot) => {
      memoryCache.set(cacheKey, { value: snapshot, expiresAt: syncSchedule().nextAt });
      await writeSnapshot(cacheKey, snapshot);
      return snapshot;
    })
    .catch((error) => {
      if (durable?.value) return durable.value;
      throw error;
    })
    .finally(() => { pendingLoads.delete(cacheKey); });
  pendingLoads.set(cacheKey, load);
  return load;
}

export async function GET(request: Request) {
  const store = await resolveWbStore(request, env);
  const token = store.token;
  if (!token) return json({ error: "当前店铺的 WB API 尚未配置" }, 503);
  const forceRefresh = new URL(request.url).searchParams.get("refresh") === "manual";
  try {
    const snapshot = await loadPromotions(token, store.id, forceRefresh);
    const schedule = syncSchedule();
    return json({
      ...snapshot,
      syncSchedule: { timezone: "Asia/Shanghai", hours: AUTO_SYNC_HOURS, currentSlot: schedule.slot, nextAt: new Date(schedule.nextAt).toISOString(), mode: forceRefresh ? "manual" : "scheduled" },
    });
  } catch (error) {
    const status = Number((error as WorkerError).status || 0);
    if (status === 401 || status === 403) return json({ error: "WB 密钥缺少“价格与折扣”权限，无法读取促销日历" }, 403);
    if (status === 402) return json({ error: "WB 促销日历接口当前要求付费访问" }, 402);
    if (status === 429) return json({ error: "WB 促销日历请求较多，请稍后再同步" }, 429);
    return json({ error: "WB 促销日历暂时无法读取，请稍后重试" }, 502);
  }
}
