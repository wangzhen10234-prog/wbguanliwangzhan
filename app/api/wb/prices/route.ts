import { env } from "cloudflare:workers";

type WbPriceSize = {
  sizeID?: number;
  price?: number;
  discountedPrice?: number;
  clubDiscountedPrice?: number;
  techSizeName?: string;
};

type WbPriceGood = {
  nmID?: number;
  vendorCode?: string;
  currencyIsoCode4217?: string;
  discount?: number;
  clubDiscount?: number;
  editableSizePrice?: boolean;
  isBadTurnover?: boolean | null;
  sizes?: WbPriceSize[];
};

type WbCard = {
  nmID?: number;
  vendorCode?: string;
  title?: string;
  subjectName?: string;
  photos?: Array<{ c246x328?: string; c516x688?: string; big?: string; square?: string }>;
};

type PriceProduct = {
  nmId: number;
  vendorCode: string;
  title: string;
  category: string;
  image: string;
  currency: string;
  discount: number;
  clubDiscount: number;
  editableSizePrice: boolean;
  isBadTurnover: boolean | null;
  sizes: Array<{ sizeId: number; techSizeName: string; price: number; discountedPrice: number; clubDiscountedPrice: number }>;
};

type PriceSnapshot = {
  source: "WB Prices and Discounts API";
  syncedAt: string;
  syncSchedule: { timezone: "Asia/Shanghai"; hours: number[]; currentSlot: string; nextAt: string; mode: "scheduled" | "manual" };
  products: PriceProduct[];
  stale: boolean;
  warning: string;
};

type WorkerError = Error & { status?: number };
type SnapshotRecord = { value: PriceSnapshot; syncSlot: string; manualBucket: number };

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};
const AUTO_SYNC_HOURS = [8, 14, 19, 23] as const;
const BEIJING_OFFSET_MS = 8 * 60 * 60_000;
const MANUAL_REFRESH_MS = 5 * 60_000;
const SNAPSHOT_KEY = "price-management-v1";
let memoryCache: { value: PriceSnapshot; expiresAt: number } | null = null;
let pendingLoad: Promise<PriceSnapshot> | null = null;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function number(value: unknown) {
  const result = Number(value || 0);
  return Number.isFinite(result) ? result : 0;
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function schedule(now = Date.now()) {
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

async function wbRequest<T>(url: string, token: string, body?: unknown) {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) {
    const error = new Error(`WB prices request failed: ${response.status}`) as WorkerError;
    error.status = response.status;
    throw error;
  }
  return response.json() as Promise<T>;
}

async function loadPrices(token: string) {
  const goods: WbPriceGood[] = [];
  for (let offset = 0; offset < 50_000; offset += 1000) {
    const url = new URL("https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter");
    url.searchParams.set("limit", "1000");
    url.searchParams.set("offset", String(offset));
    const response = await wbRequest<{ data?: { listGoods?: WbPriceGood[] }; error?: boolean; errorText?: string }>(url.toString(), token);
    if (response.error) throw new Error(response.errorText || "WB prices response error");
    const batch = response.data?.listGoods ?? [];
    goods.push(...batch);
    if (batch.length < 1000) break;
    await new Promise((resolve) => setTimeout(resolve, 650));
  }
  return goods;
}

async function loadCards(token: string) {
  const cards: WbCard[] = [];
  let cursor: { updatedAt?: string; nmID?: number } = {};
  for (let page = 0; page < 50; page += 1) {
    const response = await wbRequest<{ cards?: WbCard[]; cursor?: { updatedAt?: string; nmID?: number } }>(
      "https://content-api.wildberries.ru/content/v2/get/cards/list",
      token,
      { settings: { sort: { ascending: true }, cursor: { limit: 100, ...cursor }, filter: { withPhoto: -1 } } },
    );
    const batch = response.cards ?? [];
    cards.push(...batch);
    if (batch.length < 100 || !response.cursor?.updatedAt || !response.cursor?.nmID) break;
    cursor = { updatedAt: response.cursor.updatedAt, nmID: response.cursor.nmID };
    await new Promise((resolve) => setTimeout(resolve, 650));
  }
  return cards;
}

async function readSnapshot() {
  try {
    const row = await env.DB.prepare("SELECT payload, sync_slot AS syncSlot, manual_bucket AS manualBucket FROM wb_sync_snapshots WHERE cache_key = ?")
      .bind(SNAPSHOT_KEY)
      .first<{ payload?: string; syncSlot?: string; manualBucket?: number }>();
    if (!row?.payload) return null;
    return { value: JSON.parse(row.payload) as PriceSnapshot, syncSlot: row.syncSlot || "", manualBucket: Number(row.manualBucket || 0) } satisfies SnapshotRecord;
  } catch {
    return null;
  }
}

async function writeSnapshot(value: PriceSnapshot, manual: boolean) {
  try {
    await env.DB.prepare(`
      INSERT INTO wb_sync_snapshots (cache_key, payload, sync_slot, manual_bucket, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, sync_slot = excluded.sync_slot, manual_bucket = excluded.manual_bucket, updated_at = CURRENT_TIMESTAMP
    `).bind(SNAPSHOT_KEY, JSON.stringify(value), schedule().slot, manual ? Math.floor(Date.now() / MANUAL_REFRESH_MS) : 0).run();
  } catch {
    // A cache write must never invalidate fresh WB price data.
  }
}

function normalizeProducts(goods: WbPriceGood[], cards: WbCard[]) {
  const cardByNmId = new Map(cards.map((card) => [Math.trunc(number(card.nmID)), card]));
  return goods.map((good) => {
    const nmId = Math.trunc(number(good.nmID));
    const card = cardByNmId.get(nmId);
    const photo = card?.photos?.[0];
    return {
      nmId,
      vendorCode: text(good.vendorCode || card?.vendorCode, `WB-${nmId}`),
      title: text(card?.title, "WB 商品卡未返回标题"),
      category: text(card?.subjectName, "未分类"),
      image: text(photo?.c246x328 || photo?.c516x688 || photo?.big || photo?.square),
      currency: text(good.currencyIsoCode4217, "CNY").toUpperCase(),
      discount: number(good.discount),
      clubDiscount: number(good.clubDiscount),
      editableSizePrice: Boolean(good.editableSizePrice),
      isBadTurnover: typeof good.isBadTurnover === "boolean" ? good.isBadTurnover : null,
      sizes: (good.sizes ?? []).map((size) => ({
        sizeId: Math.trunc(number(size.sizeID)),
        techSizeName: text(size.techSizeName, "默认"),
        price: number(size.price),
        discountedPrice: number(size.discountedPrice),
        clubDiscountedPrice: number(size.clubDiscountedPrice),
      })),
    } satisfies PriceProduct;
  }).filter((product) => product.nmId > 0).sort((a, b) => a.vendorCode.localeCompare(b.vendorCode, "zh-CN"));
}

async function fetchSnapshot(token: string, manual: boolean) {
  const [goods, cards] = await Promise.all([loadPrices(token), loadCards(token).catch(() => [] as WbCard[])]);
  const current = schedule();
  return {
    source: "WB Prices and Discounts API" as const,
    syncedAt: new Date().toISOString(),
    syncSchedule: { timezone: "Asia/Shanghai" as const, hours: [...AUTO_SYNC_HOURS], currentSlot: current.slot, nextAt: new Date(current.nextAt).toISOString(), mode: manual ? "manual" as const : "scheduled" as const },
    products: normalizeProducts(goods, cards),
    stale: false,
    warning: "",
  } satisfies PriceSnapshot;
}

async function loadSnapshot(token: string, manual: boolean) {
  const current = schedule();
  const manualBucket = Math.floor(Date.now() / MANUAL_REFRESH_MS);
  if (!manual && memoryCache && memoryCache.expiresAt > Date.now()) return memoryCache.value;
  const durable = await readSnapshot();
  if (!manual && durable?.syncSlot === current.slot) {
    memoryCache = { value: durable.value, expiresAt: current.nextAt };
    return durable.value;
  }
  if (manual && durable?.manualBucket === manualBucket) return durable.value;
  if (pendingLoad) return pendingLoad;
  pendingLoad = fetchSnapshot(token, manual)
    .then(async (value) => {
      memoryCache = { value, expiresAt: current.nextAt };
      await writeSnapshot(value, manual);
      return value;
    })
    .catch((error) => {
      if (durable?.value) return { ...durable.value, stale: true, warning: "WB 价格接口本次读取失败，当前展示上一次成功同步的数据" };
      throw error;
    })
    .finally(() => { pendingLoad = null; });
  return pendingLoad;
}

export async function GET(request: Request) {
  try {
    const token = env.WB_API_TOKEN;
    if (!token) return json({ error: "WB API 密钥尚未配置" }, 503);
    const manual = new URL(request.url).searchParams.get("refresh") === "manual";
    return json(await loadSnapshot(token, manual));
  } catch (error) {
    const status = Number((error as WorkerError).status || 0);
    if (status === 401) return json({ error: "WB API 密钥无效，无法读取价格" }, 502);
    if (status === 403) return json({ error: "当前 WB 密钥没有价格与折扣权限" }, 502);
    if (status === 429) return json({ error: "WB 价格接口限流，请稍后重试" }, 429);
    return json({ error: "WB 价格与折扣数据暂时无法读取" }, 502);
  }
}
