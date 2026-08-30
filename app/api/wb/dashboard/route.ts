import { env } from "cloudflare:workers";
import { buildOrderCompletionIndex, completionForOrder, normalizeWbStatisticsTime } from "../../../_lib/order-completion";
import { fbsStatusOutcome, updateFbsCompletionObservations, type FbsCompletionObservation } from "../../../_lib/fbs-completion-observations";
import { fbsOrderKey } from "../../../_lib/fbs-order-identity";
import { isUnprocessedClientCancellation, returnRateSummary } from "../../../_lib/sales-financials";
import { resolveWbStore, scopedStoreKey } from "../../../_lib/server-storefront";

type WbOrder = {
  date?: string;
  cancelDate?: string;
  nmId?: number;
  warehouseName?: string;
  supplierArticle?: string;
  subject?: string;
  brand?: string;
  category?: string;
  finishedPrice?: number;
  priceWithDisc?: number;
  isCancel?: boolean;
  srid?: string;
  gNumber?: string;
  orderUid?: string;
  rid?: string;
};

type WbSale = WbOrder & {
  saleID?: string;
  forPay?: number;
};

type WbStock = {
  nmId?: number;
  warehouseId?: number;
  warehouseName?: string;
  regionName?: string;
  quantity?: number;
  inWayToClient?: number;
  inWayFromClient?: number;
};

type SellerWarehouse = {
  id?: number;
  name?: string;
  officeId?: number;
};

type SellerStock = {
  chrtId?: number;
  amount?: number;
};

type SellerStockSnapshot = {
  warehouses: Array<SellerWarehouse & { officeName?: string; stocks: SellerStock[] }>;
};

type FbsOrder = {
  id?: number;
  orderUid?: string;
  rid?: string;
  createdAt?: string;
  nmId?: number;
  article?: string;
  warehouseId?: number;
  convertedPrice?: number;
  price?: number;
  supplierStatus?: string;
  wbStatus?: string;
};

type FbsOrderSnapshot = {
  available: boolean;
  orders: FbsOrder[];
  completionObservations?: Record<string, FbsCompletionObservation>;
};

type WbCard = {
  nmID?: number;
  vendorCode?: string;
  brand?: string;
  title?: string;
  subjectName?: string;
  sizes?: Array<{ chrtID?: number }>;
  photos?: Array<{ big?: string; c516x688?: string; c246x328?: string; square?: string }>;
};

type WbFeedback = {
  id?: string;
  productValuation?: number;
  createdDate?: string;
  productDetails?: { nmId?: number };
};

type WbFinanceRow = {
  rrdId?: number;
  reportId?: number;
  shkId?: number;
  nmId?: number;
  orderUid?: string;
  srid?: string;
  currency?: string;
  vendorCode?: string;
  title?: string;
  docTypeName?: string;
  sellerOperName?: string;
  rrDate?: string;
  saleDt?: string;
  orderDt?: string;
  quantity?: number;
  retailPriceWithDisc?: string | number;
  retailAmount?: string | number;
  forPay?: string | number;
  deliveryService?: string | number;
  acquiringFee?: string | number;
  penalty?: string | number;
  deduction?: string | number;
  storageFee?: string | number;
  paidStorage?: string | number;
  acceptance?: string | number;
  paidAcceptance?: string | number;
  additionalPayment?: string | number;
};

type WbBalance = {
  currency?: string;
  current?: number;
  for_withdraw?: number;
  fetchedAt?: string;
};

type FinanceProduct = {
  nmId: number;
  sellerSku: string;
  title: string;
  settledUnits: number;
  transactionAmount: number;
  forPay: number;
  wbExpenses: number;
  netPayout: number;
};

type FinanceSnapshot = {
  available: boolean;
  rowsCount: number;
  products: FinanceProduct[];
  unallocatedExpenses: number;
};

type FinanceRowsSnapshot = { available: boolean; rows: WbFinanceRow[]; fetchedAt?: string };

type OrderFinance = {
  matched: boolean;
  rowsCount: number;
  transactionAmount: number;
  forPay: number;
  logisticsFee: number;
  acquiringFee: number;
  penaltyFee: number;
  deductionFee: number;
  storageFee: number;
  acceptanceFee: number;
  additionalPayment: number;
  wbExpenses: number;
  netPayout: number;
  currency: string;
};

type CacheEntry<T> = { value: T; expiresAt: number };
type WorkerCacheStorage = CacheStorage & { default?: Cache };

const statisticsCache = new Map<string, CacheEntry<{ orders: WbOrder[]; sales: WbSale[] }>>();
const stockCache = new Map<string, CacheEntry<WbStock[]>>();
const sellerStockCache = new Map<string, CacheEntry<SellerStockSnapshot>>();
const sellerWarehouseDirectoryCache = new Map<string, CacheEntry<SellerStockSnapshot>>();
const fbsOrderCache = new Map<string, CacheEntry<FbsOrderSnapshot>>();
const balanceCache = new Map<string, CacheEntry<WbBalance>>();
const cardsCache = new Map<string, CacheEntry<WbCard[]>>();
const feedbacksCache = new Map<string, CacheEntry<WbFeedback[]>>();
const financeRowsCache = new Map<string, CacheEntry<FinanceRowsSnapshot>>();
const pendingLoads = new Map<string, Promise<unknown>>();

const DAY_MS = 86_400_000;
const BEIJING_OFFSET_MS = 8 * 60 * 60_000;
const AUTO_SYNC_HOURS = [8, 14, 19, 23] as const;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ALL_HISTORY_START = "2024-01-29";
const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const EDGE_CACHE_BASE = "https://wb-insight-cache.invalid/v2";
const STABLE_CACHE_BASE = "https://wb-insight-cache.invalid/stable-v1";
const RECENT_CACHE_BASE = "https://wb-insight-cache.invalid/recent-v1";
const HISTORY_REFRESH_DAYS = 120;
const RECENT_REFRESH_TTL_SECONDS = 90;

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

function cacheExpiry() {
  return syncSchedule().nextAt;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function dateValue(value: string) {
  return new Date(`${value}T12:00:00Z`).getTime();
}

function dayKey(value?: string) {
  return typeof value === "string" ? value.slice(0, 10) : "";
}

function beijingDateKey(value: string | number | Date = new Date()) {
  if (value === null || value === "") return "";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return typeof value === "string" ? dayKey(value) : "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function wbStatisticsBeijingDateKey(value?: string) {
  if (!value) return "";
  // WB statistics timestamps omit the offset and use Moscow time (UTC+3).
  const normalized = /(?:z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}+03:00`;
  return beijingDateKey(normalized);
}

function orderIdentity(value: unknown) {
  return String(value || "").trim().toLocaleLowerCase();
}

function statisticsOrderIdentities(row: WbOrder) {
  return [row.srid, row.rid, row.gNumber, row.orderUid]
    .map(orderIdentity)
    .filter(Boolean);
}

function amount(row: WbOrder) {
  return Number(row.finishedPrice || row.priceWithDisc || 0);
}

function isReturn(row: WbSale) {
  return String(row.saleID || "").toUpperCase().startsWith("R");
}

function edgeCache() {
  return (globalThis.caches as WorkerCacheStorage | undefined)?.default;
}

async function readEdgeCache<T>(key: string): Promise<T | null> {
  try {
    const cache = edgeCache();
    if (!cache) return null;
    const response = await cache.match(new Request(`${EDGE_CACHE_BASE}/${syncSchedule().slot}/${key}`));
    return response ? await response.json() as T : null;
  } catch {
    return null;
  }
}

async function writeEdgeCache(key: string, value: unknown) {
  try {
    const cache = edgeCache();
    if (!cache) return;
    const schedule = syncSchedule();
    const maxAge = Math.max(60, Math.floor((schedule.nextAt - Date.now()) / 1000));
    await cache.put(new Request(`${EDGE_CACHE_BASE}/${schedule.slot}/${key}`), new Response(JSON.stringify(value), {
      headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${maxAge}` },
    }));
  } catch {
    // Local development runtimes may not expose the Cloudflare default cache.
  }
}

async function readNamedEdgeCache<T>(base: string, key: string): Promise<T | null> {
  try {
    const cache = edgeCache();
    if (!cache) return null;
    const response = await cache.match(new Request(`${base}/${key}`));
    return response ? await response.json() as T : null;
  } catch {
    return null;
  }
}

async function writeNamedEdgeCache(base: string, key: string, value: unknown, maxAge: number) {
  try {
    const cache = edgeCache();
    if (!cache) return;
    await cache.put(new Request(`${base}/${key}`), new Response(JSON.stringify(value), {
      headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${maxAge}` },
    }));
  } catch {
    // Local development runtimes may not expose the Cloudflare default cache.
  }
}

function readStableEdgeCache<T>(key: string) {
  return readNamedEdgeCache<T>(STABLE_CACHE_BASE, key);
}

function writeStableEdgeCache(key: string, value: unknown) {
  return writeNamedEdgeCache(STABLE_CACHE_BASE, key, value, 35 * 24 * 60 * 60);
}

function readRecentEdgeCache<T>(key: string) {
  return readNamedEdgeCache<T>(RECENT_CACHE_BASE, key);
}

function writeRecentEdgeCache(key: string, value: unknown) {
  return writeNamedEdgeCache(RECENT_CACHE_BASE, key, value, RECENT_REFRESH_TTL_SECONDS);
}

type DurableSnapshot<T> = { value: T; syncSlot: string; manualBucket: number };

function manualRefreshBucket() {
  return Math.floor(Date.now() / (RECENT_REFRESH_TTL_SECONDS * 1000));
}

async function readDurableRecord<T>(key: string): Promise<DurableSnapshot<T> | null> {
  try {
    const row = await env.DB.prepare("SELECT payload, sync_slot AS syncSlot, manual_bucket AS manualBucket FROM wb_sync_snapshots WHERE cache_key = ?")
      .bind(key)
      .first<{ payload: string; syncSlot: string; manualBucket: number }>();
    return row?.payload ? { value: JSON.parse(row.payload) as T, syncSlot: row.syncSlot || "", manualBucket: Number(row.manualBucket || 0) } : null;
  } catch {
    return null;
  }
}

async function readDurableSnapshot<T>(key: string): Promise<T | null> {
  return (await readDurableRecord<T>(key))?.value ?? null;
}

function durableRecordIsFresh(record: DurableSnapshot<unknown> | null, forceRefresh: boolean) {
  return forceRefresh
    ? record?.manualBucket === manualRefreshBucket()
    : record?.syncSlot === syncSchedule().slot;
}

async function writeDurableSnapshot(key: string, value: unknown, forceRefresh = false) {
  try {
    await env.DB.prepare(`
      INSERT INTO wb_sync_snapshots (cache_key, payload, sync_slot, manual_bucket, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(cache_key) DO UPDATE SET
        payload = excluded.payload,
        sync_slot = excluded.sync_slot,
        manual_bucket = CASE WHEN excluded.manual_bucket > 0 THEN excluded.manual_bucket ELSE wb_sync_snapshots.manual_bucket END,
        updated_at = CURRENT_TIMESTAMP
    `).bind(key, JSON.stringify(value), syncSchedule().slot, forceRefresh ? manualRefreshBucket() : 0).run();
  } catch {
    // A cache write must never make a successful WB response fail.
  }
}

async function acquireDurableRefreshLock(key: string, ttlMs = 45_000) {
  try {
    const now = Date.now();
    await env.DB.prepare("DELETE FROM wb_sync_locks WHERE cache_key = ? AND expires_at <= ?").bind(key, now).run();
    const result = await env.DB.prepare("INSERT OR IGNORE INTO wb_sync_locks (cache_key, expires_at) VALUES (?, ?)")
      .bind(key, now + ttlMs)
      .run();
    return Number(result.meta.changes || 0) > 0;
  } catch {
    return true;
  }
}

async function releaseDurableRefreshLock(key: string) {
  try {
    await env.DB.prepare("DELETE FROM wb_sync_locks WHERE cache_key = ?").bind(key).run();
  } catch {
    // Local development may not have a D1 binding.
  }
}

async function waitForDurableSnapshot<T>(key: string): Promise<T | null> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 750));
    const snapshot = await readDurableSnapshot<T>(key);
    if (snapshot) return snapshot;
  }
  return null;
}

async function dedupe<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const existing = pendingLoads.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const pending = loader();
  pendingLoads.set(key, pending);
  try {
    return await pending;
  } finally {
    if (pendingLoads.get(key) === pending) pendingLoads.delete(key);
  }
}

async function waitForPeerCache<T>(key: string): Promise<T | null> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 750));
    const cached = await readEdgeCache<T>(key);
    if (cached) return cached;
  }
  return null;
}

async function wbRequest<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(25_000),
  });

  if (!response.ok) {
    const error = new Error(`WB request failed with status ${response.status}`);
    Object.assign(error, { status: response.status });
    throw error;
  }
  return response.json() as Promise<T>;
}

async function loadStatistics(token: string, storeId: string, forceRefresh = false) {
  const cacheKey = scopedStoreKey(storeId, "statistics");
  const memory = statisticsCache.get(storeId);
  if (!forceRefresh && memory && memory.expiresAt > Date.now()) return memory.value;
  return dedupe(forceRefresh ? `${cacheKey}-manual` : cacheKey, async () => {
    const cached = await readEdgeCache<{ orders: WbOrder[]; sales: WbSale[] }>(cacheKey);
    const durableRecord = await readDurableRecord<{ orders: WbOrder[]; sales: WbSale[] }>(cacheKey);
    const durable = durableRecord?.value ?? null;
    const fallback = statisticsCache.get(storeId)?.value ?? cached ?? durable;
    if (!forceRefresh && cached) {
      statisticsCache.set(storeId, { value: cached, expiresAt: cacheExpiry() });
      await writeDurableSnapshot(cacheKey, cached);
      return cached;
    }
    if (durable && durableRecordIsFresh(durableRecord, forceRefresh)) {
      statisticsCache.set(storeId, { value: durable, expiresAt: cacheExpiry() });
      await writeEdgeCache(cacheKey, durable);
      return durable;
    }
    const hasLease = await acquireDurableRefreshLock(cacheKey);
    if (!hasLease) {
      if (fallback) return fallback;
      const peerValue = await waitForDurableSnapshot<{ orders: WbOrder[]; sales: WbSale[] }>(cacheKey);
      if (peerValue) return peerValue;
    }
    const start = new Date(Date.now() - 89 * DAY_MS).toISOString().slice(0, 10);
    const base = "https://statistics-api.wildberries.ru/api/v1/supplier";
    let orders: WbOrder[];
    let sales: WbSale[];
    try {
      try {
        [orders, sales] = await Promise.all([
          wbRequest<WbOrder[]>(`${base}/orders?dateFrom=${start}&flag=0`, token),
          wbRequest<WbSale[]>(`${base}/sales?dateFrom=${start}&flag=0`, token),
        ]);
      } catch (error) {
        if (Number((error as { status?: number }).status || 0) === 429 && !fallback) {
          const peerValue = await waitForPeerCache<{ orders: WbOrder[]; sales: WbSale[] }>(cacheKey);
          if (peerValue) {
            statisticsCache.set(storeId, { value: peerValue, expiresAt: cacheExpiry() });
            return peerValue;
          }
        }
        if (fallback) {
          statisticsCache.set(storeId, { value: fallback, expiresAt: cacheExpiry() });
          await Promise.all([writeEdgeCache(cacheKey, fallback), writeDurableSnapshot(cacheKey, fallback, forceRefresh)]);
          return fallback;
        }
        throw error;
      }
      const value = { orders, sales };
      statisticsCache.set(storeId, { value, expiresAt: cacheExpiry() });
      await Promise.all([writeEdgeCache(cacheKey, value), writeDurableSnapshot(cacheKey, value, forceRefresh)]);
      return value;
    } finally {
      if (hasLease) await releaseDurableRefreshLock(cacheKey);
    }
  });
}

async function loadStocks(token: string, storeId: string, forceRefresh = false) {
  const cacheKey = scopedStoreKey(storeId, "stocks");
  const memory = stockCache.get(storeId);
  if (!forceRefresh && memory && memory.expiresAt > Date.now()) return memory.value;
  return dedupe(forceRefresh ? `${cacheKey}-manual` : cacheKey, async () => {
    const cached = await readEdgeCache<WbStock[]>(cacheKey);
    const durableRecord = await readDurableRecord<WbStock[]>(cacheKey);
    const durable = durableRecord?.value ?? null;
    const fallback = stockCache.get(storeId)?.value ?? cached ?? durable;
    if (!forceRefresh && cached) {
      stockCache.set(storeId, { value: cached, expiresAt: cacheExpiry() });
      await writeDurableSnapshot(cacheKey, cached);
      return cached;
    }
    if (durable && durableRecordIsFresh(durableRecord, forceRefresh)) {
      stockCache.set(storeId, { value: durable, expiresAt: cacheExpiry() });
      await writeEdgeCache(cacheKey, durable);
      return durable;
    }
    try {
      const response = await wbRequest<{ data?: { items?: WbStock[] } }>(
        "https://seller-analytics-api.wildberries.ru/api/analytics/v1/stocks-report/wb-warehouses",
        token,
        { method: "POST", body: JSON.stringify({ nmIds: [], limit: 250000, offset: 0 }) },
      );
      const stocks = response.data?.items ?? [];
      stockCache.set(storeId, { value: stocks, expiresAt: cacheExpiry() });
      await Promise.all([writeEdgeCache(cacheKey, stocks), writeDurableSnapshot(cacheKey, stocks, forceRefresh)]);
      return stocks;
    } catch (error) {
      if (fallback) {
        stockCache.set(storeId, { value: fallback, expiresAt: cacheExpiry() });
        await writeEdgeCache(cacheKey, fallback);
        return fallback;
      }
      throw error;
    }
  });
}

async function loadSellerWarehouseDirectory(token: string, storeId: string, forceRefresh = false) {
  const memory = sellerWarehouseDirectoryCache.get(storeId);
  if (!forceRefresh && memory && memory.expiresAt > Date.now()) return memory.value;
  const cacheKey = scopedStoreKey(storeId, "seller-warehouses");
  return dedupe(forceRefresh ? `${cacheKey}-manual` : cacheKey, async () => {
    const cached = await readEdgeCache<SellerStockSnapshot>(cacheKey);
    const durableRecord = await readDurableRecord<SellerStockSnapshot>(cacheKey);
    const durable = durableRecord?.value ?? null;
    if (!forceRefresh && cached) {
      sellerWarehouseDirectoryCache.set(storeId, { value: cached, expiresAt: cacheExpiry() });
      await writeDurableSnapshot(cacheKey, cached);
      return cached;
    }
    if (durable && durableRecordIsFresh(durableRecord, forceRefresh)) {
      sellerWarehouseDirectoryCache.set(storeId, { value: durable, expiresAt: cacheExpiry() });
      await writeEdgeCache(cacheKey, durable);
      return durable;
    }
    const fallback = sellerWarehouseDirectoryCache.get(storeId)?.value ?? cached ?? durable;
    try {
      const base = "https://marketplace-api.wildberries.ru/api/v3";
      const [warehouses, offices] = await Promise.all([
        wbRequest<SellerWarehouse[]>(`${base}/warehouses`, token),
        wbRequest<Array<{ id?: number; name?: string }>>(`${base}/offices`, token),
      ]);
      const officeNames = new Map(offices.map((office) => [Number(office.id || 0), office.name || ""]));
      const result = { warehouses: warehouses.map((warehouse) => ({ ...warehouse, officeName: officeNames.get(Number(warehouse.officeId || 0)) || "", stocks: [] })) };
      sellerWarehouseDirectoryCache.set(storeId, { value: result, expiresAt: cacheExpiry() });
      await Promise.all([writeEdgeCache(cacheKey, result), writeDurableSnapshot(cacheKey, result, forceRefresh)]);
      return result;
    } catch (error) {
      if (fallback) {
        sellerWarehouseDirectoryCache.set(storeId, { value: fallback, expiresAt: cacheExpiry() });
        await writeEdgeCache(cacheKey, fallback);
        return fallback;
      }
      throw error;
    }
  });
}

async function loadSellerStocks(token: string, cards: WbCard[], storeId: string, forceRefresh = false) {
  const cacheKey = scopedStoreKey(storeId, "seller-stocks");
  const memory = sellerStockCache.get(storeId);
  if (!forceRefresh && memory && memory.expiresAt > Date.now()) return memory.value;
  return dedupe(forceRefresh ? `${cacheKey}-manual` : cacheKey, async () => {
    const cached = await readEdgeCache<SellerStockSnapshot>(cacheKey);
    const durableRecord = await readDurableRecord<SellerStockSnapshot>(cacheKey);
    const durable = durableRecord?.value ?? null;
    const fallback = sellerStockCache.get(storeId)?.value ?? cached ?? durable;
    if (!forceRefresh && cached) {
      sellerStockCache.set(storeId, { value: cached, expiresAt: cacheExpiry() });
      await writeDurableSnapshot(cacheKey, cached);
      return cached;
    }
    if (durable && durableRecordIsFresh(durableRecord, forceRefresh)) {
      sellerStockCache.set(storeId, { value: durable, expiresAt: cacheExpiry() });
      await writeEdgeCache(cacheKey, durable);
      return durable;
    }
    try {
      const base = "https://marketplace-api.wildberries.ru/api/v3";
      const directory = await loadSellerWarehouseDirectory(token, storeId, forceRefresh);
      const chrtIds = [...new Set(cards.flatMap((card) => card.sizes?.map((size) => Number(size.chrtID || 0)) ?? []).filter(Boolean))];
      const result: SellerStockSnapshot = { warehouses: [] };

      for (const warehouse of directory.warehouses) {
        const warehouseId = Number(warehouse.id || 0);
        if (!warehouseId) continue;
        const stocks: SellerStock[] = [];
        for (let offset = 0; offset < chrtIds.length; offset += 1000) {
          const response = await wbRequest<{ stocks?: SellerStock[] }>(
            `${base}/stocks/${warehouseId}`,
            token,
            { method: "POST", body: JSON.stringify({ chrtIds: chrtIds.slice(offset, offset + 1000) }) },
          );
          stocks.push(...(response.stocks ?? []));
          if (offset + 1000 < chrtIds.length) await new Promise((resolve) => setTimeout(resolve, 220));
        }
        result.warehouses.push({ ...warehouse, stocks });
      }

      sellerStockCache.set(storeId, { value: result, expiresAt: cacheExpiry() });
      await Promise.all([writeEdgeCache(cacheKey, result), writeDurableSnapshot(cacheKey, result, forceRefresh)]);
      return result;
    } catch (error) {
      if (fallback) {
        sellerStockCache.set(storeId, { value: fallback, expiresAt: cacheExpiry() });
        await writeEdgeCache(cacheKey, fallback);
        return fallback;
      }
      throw error;
    }
  });
}

async function fetchFbsOrders(token: string, start: Date, end: Date) {
  const base = "https://marketplace-api.wildberries.ru/api/v3";
  const byOrder = new Map<string, FbsOrder>();
  let requestCount = 0;
  for (let chunkStart = start.getTime(); chunkStart <= end.getTime(); chunkStart += 30 * DAY_MS) {
    const chunkEnd = Math.min(chunkStart + 30 * DAY_MS - 1, end.getTime());
    let next = 0;
    for (let page = 0; page < 100; page += 1) {
      if (requestCount > 0) await new Promise((resolve) => setTimeout(resolve, 220));
      requestCount += 1;
      const params = new URLSearchParams({
        limit: "1000",
        next: String(next),
        dateFrom: String(Math.floor(chunkStart / 1000)),
        dateTo: String(Math.floor(chunkEnd / 1000)),
      });
      const response = await wbRequest<{ next?: number; orders?: FbsOrder[] }>(`${base}/orders?${params}`, token);
      const batch = response.orders ?? [];
      for (const [index, order] of batch.entries()) {
        const key = fbsOrderKey(order) || `anonymous:${chunkStart}:${page}:${index}`;
        byOrder.set(key, order);
      }
      if (batch.length < 1000 || !response.next || response.next === next) break;
      next = response.next;
    }
  }

  const orders = [...byOrder.values()];
  if (orders.length) {
    const statusById = new Map<string, { supplierStatus?: string; wbStatus?: string }>();
    for (let offset = 0; offset < orders.length; offset += 1000) {
      if (requestCount > 0) await new Promise((resolve) => setTimeout(resolve, 220));
      requestCount += 1;
      const ids = orders.slice(offset, offset + 1000).map((order) => Number(order.id || 0)).filter(Boolean);
      if (!ids.length) continue;
      const response = await wbRequest<{ orders?: Array<{ id?: number; supplierStatus?: string; wbStatus?: string }> }>(
        `${base}/orders/status`,
        token,
        { method: "POST", body: JSON.stringify({ orders: ids }) },
      );
      for (const status of response.orders ?? []) statusById.set(String(status.id), status);
    }
    for (const order of orders) Object.assign(order, statusById.get(String(order.id)) ?? {});
  }
  return orders;
}

async function loadFbsOrders(token: string, storeId: string, forceRefresh = false) {
  const memory = fbsOrderCache.get(storeId);
  if (!forceRefresh && memory && memory.expiresAt > Date.now()) return memory.value;
  const cacheKey = scopedStoreKey(storeId, "fbs-orders-all-v3");
  return dedupe(forceRefresh ? `${cacheKey}-manual` : cacheKey, async () => {
    const slotCached = await readEdgeCache<FbsOrderSnapshot>(cacheKey);
    const stableCached = await readStableEdgeCache<FbsOrderSnapshot>(cacheKey);
    const durableRecord = await readDurableRecord<FbsOrderSnapshot>(cacheKey);
    const durableCached = durableRecord?.value ?? null;
    const fallback = fbsOrderCache.get(storeId)?.value ?? slotCached ?? stableCached ?? durableCached;
    if (!forceRefresh && slotCached) {
      fbsOrderCache.set(storeId, { value: slotCached, expiresAt: cacheExpiry() });
      await Promise.all([writeStableEdgeCache(cacheKey, slotCached), writeDurableSnapshot(cacheKey, slotCached)]);
      return slotCached;
    }
    if (durableCached && durableRecordIsFresh(durableRecord, forceRefresh)) {
      fbsOrderCache.set(storeId, { value: durableCached, expiresAt: cacheExpiry() });
      await writeEdgeCache(cacheKey, durableCached);
      return durableCached;
    }
    if (forceRefresh) {
      const recentCached = await readRecentEdgeCache<FbsOrderSnapshot>(cacheKey);
      if (recentCached) {
        fbsOrderCache.set(storeId, { value: recentCached, expiresAt: cacheExpiry() });
        await writeDurableSnapshot(cacheKey, recentCached, true);
        return recentCached;
      }
    }
    const hasLease = await acquireDurableRefreshLock(cacheKey);
    if (!hasLease) {
      if (fallback) return fallback;
      const peerValue = await waitForDurableSnapshot<FbsOrderSnapshot>(cacheKey);
      if (peerValue) return peerValue;
    }

    const end = new Date();
    end.setUTCHours(23, 59, 59, 999);
    const start = fallback
      ? new Date(Math.max(new Date(`${ALL_HISTORY_START}T00:00:00Z`).getTime(), end.getTime() - (HISTORY_REFRESH_DAYS - 1) * DAY_MS))
      : new Date(`${ALL_HISTORY_START}T00:00:00Z`);
    start.setUTCHours(0, 0, 0, 0);

    try {
      const refreshedOrders = await fetchFbsOrders(token, start, end);
      const byOrder = new Map<string, FbsOrder>();
      for (const order of fallback?.orders ?? []) {
        if (new Date(order.createdAt || 0).getTime() < start.getTime()) byOrder.set(fbsOrderKey(order), order);
      }
      for (const order of refreshedOrders) byOrder.set(fbsOrderKey(order), order);
      const orders = [...byOrder.values()];
      const completionObservations = updateFbsCompletionObservations(
        fallback?.orders ?? [],
        orders,
        fallback?.completionObservations ?? {},
      );
      const result: FbsOrderSnapshot = { available: true, orders, completionObservations };
      fbsOrderCache.set(storeId, { value: result, expiresAt: cacheExpiry() });
      await Promise.all([writeEdgeCache(cacheKey, result), writeStableEdgeCache(cacheKey, result), writeRecentEdgeCache(cacheKey, result), writeDurableSnapshot(cacheKey, result, forceRefresh)]);
      return result;
    } catch (error) {
      if (fallback) {
        fbsOrderCache.set(storeId, { value: fallback, expiresAt: cacheExpiry() });
        await Promise.all([writeEdgeCache(cacheKey, fallback), writeDurableSnapshot(cacheKey, fallback, forceRefresh)]);
        return fallback;
      }
      throw error;
    } finally {
      if (hasLease) await releaseDurableRefreshLock(cacheKey);
    }
  });
}

function orderOutcome(order: Pick<FbsOrder, "supplierStatus" | "wbStatus">) {
  return fbsStatusOutcome(order);
}

function orderStatusLabel(order: Pick<FbsOrder, "supplierStatus" | "wbStatus">) {
  const labels: Record<string, string> = {
    sold: "正常签收",
    canceled: "卖家取消",
    canceled_by_client: "签收时拒收",
    declined_by_client: "客户取消",
    defect: "瑕疵取消",
    canceled_by_missed_call: "联系不上客户",
    ready_for_pickup: "待客户取件",
    sorted: "已入仓分拣",
    waiting: "运输处理中",
    postponed_delivery: "延期配送",
    accepted_by_carrier: "承运商已接收",
    sent_to_carrier: "已发往承运商",
  };
  return labels[String(order.wbStatus || "")] || (order.supplierStatus === "cancel" ? "卖家取消" : "处理中");
}

function warehouseKey(value?: string) {
  const ignoredWords = new Set(["москва", "московская", "область", "склад", "продавца", "wb", "мп", "рф"]);
  return String(value || "")
    .toLocaleLowerCase("ru")
    .split(/[^\p{L}\p{N}]+/gu)
    .filter((word) => word && !ignoredWords.has(word))
    .join("");
}

function resolveSellerWarehouseName(warehouse: SellerWarehouse & { officeName?: string }, observedNames: string[]) {
  const candidateKeys = [warehouse.officeName, warehouse.name].map(warehouseKey).filter((key) => key.length >= 3);
  const exact = observedNames.find((name) => candidateKeys.includes(warehouseKey(name)));
  if (exact) return exact;
  const partial = observedNames.find((name) => {
    const observedKey = warehouseKey(name);
    return observedKey.length >= 4 && candidateKeys.some((key) => key.includes(observedKey) || observedKey.includes(key));
  });
  return partial || warehouse.name?.trim() || `仓库 ${warehouse.id}`;
}

async function loadBalance(token: string, storeId: string, forceRefresh = false) {
  const memory = balanceCache.get(storeId);
  if (!forceRefresh && memory && memory.expiresAt > Date.now()) return memory.value;
  const cacheKey = scopedStoreKey(storeId, "balance-v2");
  return dedupe(forceRefresh ? `${cacheKey}-manual` : cacheKey, async () => {
    const cached = await readEdgeCache<WbBalance>(cacheKey);
    const durableRecord = await readDurableRecord<WbBalance>(cacheKey);
    const durable = durableRecord?.value ?? null;
    const fallback = balanceCache.get(storeId)?.value ?? cached ?? durable;
    if (!forceRefresh && cached) {
      balanceCache.set(storeId, { value: cached, expiresAt: cacheExpiry() });
      await writeDurableSnapshot(cacheKey, cached);
      return cached;
    }
    if (durable && durableRecordIsFresh(durableRecord, forceRefresh)) {
      balanceCache.set(storeId, { value: durable, expiresAt: cacheExpiry() });
      await writeEdgeCache(cacheKey, durable);
      return durable;
    }
    try {
      const response = await wbRequest<WbBalance>(
        "https://finance-api.wildberries.ru/api/v1/account/balance",
        token,
      );
      const balance = { ...response, fetchedAt: new Date().toISOString() };
      balanceCache.set(storeId, { value: balance, expiresAt: cacheExpiry() });
      await Promise.all([writeEdgeCache(cacheKey, balance), writeDurableSnapshot(cacheKey, balance, forceRefresh)]);
      return balance;
    } catch (error) {
      if (fallback) {
        balanceCache.set(storeId, { value: fallback, expiresAt: cacheExpiry() });
        await writeEdgeCache(cacheKey, fallback);
        return fallback;
      }
      throw error;
    }
  });
}

async function loadCards(token: string, storeId: string, forceRefresh = false) {
  const cacheKey = scopedStoreKey(storeId, "cards");
  const memory = cardsCache.get(storeId);
  if (!forceRefresh && memory && memory.expiresAt > Date.now()) return memory.value;
  return dedupe(forceRefresh ? `${cacheKey}-manual` : cacheKey, async () => {
    const cached = await readEdgeCache<WbCard[]>(cacheKey);
    const durableRecord = await readDurableRecord<WbCard[]>(cacheKey);
    const durable = durableRecord?.value ?? null;
    const fallback = cardsCache.get(storeId)?.value ?? cached ?? durable;
    if (!forceRefresh && cached) {
      cardsCache.set(storeId, { value: cached, expiresAt: cacheExpiry() });
      await writeDurableSnapshot(cacheKey, cached);
      return cached;
    }
    if (durable && durableRecordIsFresh(durableRecord, forceRefresh)) {
      cardsCache.set(storeId, { value: durable, expiresAt: cacheExpiry() });
      await writeEdgeCache(cacheKey, durable);
      return durable;
    }

    try {
      const cards: WbCard[] = [];
      let cursor: { updatedAt?: string; nmID?: number } = {};
      for (let page = 0; page < 50; page += 1) {
        const response = await wbRequest<{ cards?: WbCard[]; cursor?: { updatedAt?: string; nmID?: number; total?: number } }>(
          "https://content-api.wildberries.ru/content/v2/get/cards/list",
          token,
          {
            method: "POST",
            body: JSON.stringify({
              settings: {
                sort: { ascending: true },
                cursor: { limit: 100, ...cursor },
                filter: { withPhoto: -1 },
              },
            }),
          },
        );
        const batch = response.cards ?? [];
        cards.push(...batch);
        if (batch.length < 100 || !response.cursor?.updatedAt || !response.cursor?.nmID) break;
        cursor = { updatedAt: response.cursor.updatedAt, nmID: response.cursor.nmID };
      }
      cardsCache.set(storeId, { value: cards, expiresAt: cacheExpiry() });
      await Promise.all([writeEdgeCache(cacheKey, cards), writeDurableSnapshot(cacheKey, cards, forceRefresh)]);
      return cards;
    } catch (error) {
      if (fallback) {
        cardsCache.set(storeId, { value: fallback, expiresAt: cacheExpiry() });
        await writeEdgeCache(cacheKey, fallback);
        return fallback;
      }
      throw error;
    }
  });
}

async function loadFeedbacks(token: string, storeId: string, forceRefresh = false) {
  const cacheKey = scopedStoreKey(storeId, "feedbacks");
  const memory = feedbacksCache.get(storeId);
  if (!forceRefresh && memory && memory.expiresAt > Date.now()) return memory.value;
  return dedupe(forceRefresh ? `${cacheKey}-manual` : cacheKey, async () => {
    const cached = await readEdgeCache<WbFeedback[]>(cacheKey);
    const durableRecord = await readDurableRecord<WbFeedback[]>(cacheKey);
    const durable = durableRecord?.value ?? null;
    const fallback = feedbacksCache.get(storeId)?.value ?? cached ?? durable;
    if (!forceRefresh && cached) {
      feedbacksCache.set(storeId, { value: cached, expiresAt: cacheExpiry() });
      await writeDurableSnapshot(cacheKey, cached);
      return cached;
    }
    if (durable && durableRecordIsFresh(durableRecord, forceRefresh)) {
      feedbacksCache.set(storeId, { value: durable, expiresAt: cacheExpiry() });
      await writeEdgeCache(cacheKey, durable);
      return durable;
    }

    try {
      const base = "https://feedbacks-api.wildberries.ru/api/v1/feedbacks";
      const [answered, unanswered] = await Promise.all([
        wbRequest<{ data?: { feedbacks?: WbFeedback[] } }>(`${base}?isAnswered=true&take=5000&skip=0&order=dateDesc`, token),
        wbRequest<{ data?: { feedbacks?: WbFeedback[] } }>(`${base}?isAnswered=false&take=5000&skip=0&order=dateDesc`, token),
      ]);
      const byId = new Map<string, WbFeedback>();
      for (const feedback of [...(answered.data?.feedbacks ?? []), ...(unanswered.data?.feedbacks ?? [])]) {
        const key = feedback.id || `${feedback.productDetails?.nmId}-${feedback.createdDate}-${feedback.productValuation}`;
        byId.set(key, feedback);
      }
      const feedbacks = [...byId.values()];
      feedbacksCache.set(storeId, { value: feedbacks, expiresAt: cacheExpiry() });
      await Promise.all([writeEdgeCache(cacheKey, feedbacks), writeDurableSnapshot(cacheKey, feedbacks, forceRefresh)]);
      return feedbacks;
    } catch (error) {
      if (fallback) {
        feedbacksCache.set(storeId, { value: fallback, expiresAt: cacheExpiry() });
        await writeEdgeCache(cacheKey, fallback);
        return fallback;
      }
      throw error;
    }
  });
}

function financeNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function isFinanceReturn(row: WbFinanceRow) {
  return /возврат|return/i.test(`${row.docTypeName || ""} ${row.sellerOperName || ""}`);
}

function signedFinanceValue(value: unknown, returned: boolean) {
  const number = financeNumber(value);
  return returned ? -Math.abs(number) : number;
}

function financeRowKey(row: WbFinanceRow) {
  return String(row.rrdId || `${row.srid || row.orderUid || ""}|${row.nmId || 0}|${row.rrDate || row.saleDt || row.orderDt || ""}|${row.sellerOperName || row.docTypeName || ""}`);
}

async function loadFinanceRows(token: string, storeId: string, forceRefresh = false): Promise<FinanceRowsSnapshot> {
  const memory = financeRowsCache.get(storeId);
  if (!forceRefresh && memory && memory.expiresAt > Date.now()) return memory.value;
  const cacheKey = scopedStoreKey(storeId, "finance-details-all-v5");
  return dedupe(forceRefresh ? `${cacheKey}-manual` : cacheKey, async () => {
    const slotCached = await readEdgeCache<FinanceRowsSnapshot>(cacheKey);
    const stableCached = await readStableEdgeCache<FinanceRowsSnapshot>(cacheKey);
    const durableRecord = await readDurableRecord<FinanceRowsSnapshot>(cacheKey);
    const durableCached = durableRecord?.value ?? null;
    const fallback = financeRowsCache.get(storeId)?.value ?? slotCached ?? stableCached ?? durableCached;
    if (!forceRefresh && slotCached) {
      financeRowsCache.set(storeId, { value: slotCached, expiresAt: cacheExpiry() });
      await Promise.all([writeStableEdgeCache(cacheKey, slotCached), writeDurableSnapshot(cacheKey, slotCached)]);
      return slotCached;
    }
    if (durableCached && durableRecordIsFresh(durableRecord, forceRefresh)) {
      financeRowsCache.set(storeId, { value: durableCached, expiresAt: cacheExpiry() });
      await writeEdgeCache(cacheKey, durableCached);
      return durableCached;
    }
    if (forceRefresh) {
      const recentCached = await readRecentEdgeCache<FinanceRowsSnapshot>(cacheKey);
      if (recentCached) {
        financeRowsCache.set(storeId, { value: recentCached, expiresAt: cacheExpiry() });
        await writeDurableSnapshot(cacheKey, recentCached, true);
        return recentCached;
      }
    }
    const hasLease = await acquireDurableRefreshLock(cacheKey, 60_000);
    if (!hasLease) {
      if (fallback) return fallback;
      const peerValue = await waitForDurableSnapshot<FinanceRowsSnapshot>(cacheKey);
      if (peerValue) return peerValue;
    }

    const dateTo = new Date().toISOString().slice(0, 10);
    const dateFrom = fallback
      ? new Date(Math.max(new Date(`${ALL_HISTORY_START}T00:00:00Z`).getTime(), Date.now() - (HISTORY_REFRESH_DAYS - 1) * DAY_MS)).toISOString().slice(0, 10)
      : ALL_HISTORY_START;

    try {
      let response: Response;
      try {
        response = await fetch("https://finance-api.wildberries.ru/api/finance/v1/sales-reports/detailed", {
          method: "POST",
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ dateFrom, dateTo, limit: 100000, rrdId: 0, period: "daily" }),
          signal: AbortSignal.timeout(25_000),
        });
      } catch (error) {
        if (fallback) {
          financeRowsCache.set(storeId, { value: fallback, expiresAt: cacheExpiry() });
          await Promise.all([writeEdgeCache(cacheKey, fallback), writeDurableSnapshot(cacheKey, fallback, forceRefresh)]);
          return fallback;
        }
        throw error;
      }

      if (!response.ok) {
        if (fallback) {
          financeRowsCache.set(storeId, { value: fallback, expiresAt: cacheExpiry() });
          await Promise.all([writeEdgeCache(cacheKey, fallback), writeDurableSnapshot(cacheKey, fallback, forceRefresh)]);
          return fallback;
        } else if (response.status === 429) {
          const peerValue = await waitForPeerCache<FinanceRowsSnapshot>(cacheKey);
          if (peerValue) return peerValue;
          const error = new Error("WB finance request failed with status 429");
          Object.assign(error, { status: 429 });
          throw error;
        } else {
          const error = new Error(`WB finance request failed with status ${response.status}`);
          Object.assign(error, { status: response.status });
          throw error;
        }
      }

      const refreshedRows = response.status === 204 ? [] : await response.json() as WbFinanceRow[];
      const byRow = new Map<string, WbFinanceRow>();
      for (const row of fallback?.rows ?? []) {
        const rowDate = dayKey(row.rrDate || row.saleDt || row.orderDt);
        if (rowDate && rowDate < dateFrom) byRow.set(financeRowKey(row), row);
      }
      for (const row of refreshedRows) byRow.set(financeRowKey(row), row);
      const snapshot = { available: true, rows: [...byRow.values()], fetchedAt: new Date().toISOString() };
      financeRowsCache.set(storeId, { value: snapshot, expiresAt: cacheExpiry() });
      await Promise.all([writeEdgeCache(cacheKey, snapshot), writeStableEdgeCache(cacheKey, snapshot), writeRecentEdgeCache(cacheKey, snapshot), writeDurableSnapshot(cacheKey, snapshot, forceRefresh)]);
      return snapshot;
    } finally {
      if (hasLease) await releaseDurableRefreshLock(cacheKey);
    }
  });
}

function financeRowValues(row: WbFinanceRow) {
  const returned = isFinanceReturn(row);
  const transactionAmount = signedFinanceValue(row.retailPriceWithDisc ?? row.retailAmount, returned);
  const forPay = signedFinanceValue(row.forPay, returned);
  const logisticsFee = Math.abs(financeNumber(row.deliveryService));
  const acquiringFee = Math.abs(financeNumber(row.acquiringFee));
  const penaltyFee = Math.abs(financeNumber(row.penalty));
  const deductionFee = Math.abs(financeNumber(row.deduction));
  const storageFee = Math.abs(financeNumber(row.storageFee ?? row.paidStorage));
  const acceptanceFee = Math.abs(financeNumber(row.acceptance ?? row.paidAcceptance));
  const wbExpenses = logisticsFee + acquiringFee + penaltyFee + deductionFee + storageFee + acceptanceFee;
  const additionalPayment = financeNumber(row.additionalPayment);
  return { transactionAmount, forPay, logisticsFee, acquiringFee, penaltyFee, deductionFee, storageFee, acceptanceFee, additionalPayment, wbExpenses, netPayout: forPay - wbExpenses + additionalPayment };
}

function financeCurrency(value?: string) {
  const currency = String(value || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : "CNY";
}

function normalizedBalanceAmount(value: unknown, currency: string) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  // WB's China seller balance widget returns CNY in fen, while the seller portal renders yuan.
  return currency === "CNY" ? amount / 100 : amount;
}

function roundedMoney(value: number) {
  return Number(value.toFixed(2));
}

function financeOperationLabel(row: WbFinanceRow, netPayout: number) {
  const raw = `${row.sellerOperName || ""} ${row.docTypeName || ""}`.trim();
  if (/退货|退款|возврат|return/i.test(raw)) return "退货退款";
  if (/销售|售出|продаж|sale/i.test(raw)) return "订单销售结算";
  if (/物流|配送|логист|delivery/i.test(raw)) return "物流费用";
  if (/罚款|штраф|penalt/i.test(raw)) return "平台罚款";
  if (/仓储|保管|хранен|storag/i.test(raw)) return "仓储费用";
  if (/入库|验收|прием|accept/i.test(raw)) return "入库费用";
  if (/扣款|扣除|удерж|deduct/i.test(raw)) return "平台扣款";
  if (/补款|补偿|доплат|additional/i.test(raw)) return "平台补款";
  if (raw) return raw;
  return netPayout < 0 ? "平台扣款" : row.nmId ? "订单结算" : "平台入账";
}

function financeIdentity(value?: string) {
  const normalized = String(value || "").trim().toLocaleLowerCase();
  const embeddedId = normalized.match(/[a-f0-9]{32}/)?.[0];
  return embeddedId || normalized;
}

function orderFinanceMap(snapshot: FinanceRowsSnapshot) {
  const byOrderProduct = new Map<string, OrderFinance>();
  const byRidProduct = new Map<string, OrderFinance>();

  const add = (map: Map<string, OrderFinance>, key: string, row: WbFinanceRow) => {
    if (!key) return;
    const values = financeRowValues(row);
    const current = map.get(key) ?? {
      matched: true,
      rowsCount: 0,
      transactionAmount: 0,
      forPay: 0,
      logisticsFee: 0,
      acquiringFee: 0,
      penaltyFee: 0,
      deductionFee: 0,
      storageFee: 0,
      acceptanceFee: 0,
      additionalPayment: 0,
      wbExpenses: 0,
      netPayout: 0,
      currency: row.currency || "CNY",
    };
    current.rowsCount += 1;
    current.transactionAmount += values.transactionAmount;
    current.forPay += values.forPay;
    current.logisticsFee += values.logisticsFee;
    current.acquiringFee += values.acquiringFee;
    current.penaltyFee += values.penaltyFee;
    current.deductionFee += values.deductionFee;
    current.storageFee += values.storageFee;
    current.acceptanceFee += values.acceptanceFee;
    current.additionalPayment += values.additionalPayment;
    current.wbExpenses += values.wbExpenses;
    current.netPayout += values.netPayout;
    if (row.currency) current.currency = row.currency;
    map.set(key, current);
  };

  for (const row of snapshot.rows) {
    const nmId = Number(row.nmId || 0);
    const orderUid = String(row.orderUid || "").trim();
    const rid = financeIdentity(row.srid);
    if (orderUid) add(byOrderProduct, `${orderUid}|${nmId}`, row);
    if (rid) add(byRidProduct, `${rid}|${nmId}`, row);
  }
  return { byOrderProduct, byRidProduct };
}

function splitOrderFinance(finance: OrderFinance, divisor: number): OrderFinance {
  if (divisor <= 1) return finance;
  return {
    ...finance,
    transactionAmount: finance.transactionAmount / divisor,
    forPay: finance.forPay / divisor,
    logisticsFee: finance.logisticsFee / divisor,
    acquiringFee: finance.acquiringFee / divisor,
    penaltyFee: finance.penaltyFee / divisor,
    deductionFee: finance.deductionFee / divisor,
    storageFee: finance.storageFee / divisor,
    acceptanceFee: finance.acceptanceFee / divisor,
    additionalPayment: finance.additionalPayment / divisor,
    wbExpenses: finance.wbExpenses / divisor,
    netPayout: finance.netPayout / divisor,
  };
}

function aggregateFinanceRows(snapshot: FinanceRowsSnapshot, from: string, to: string): FinanceSnapshot {
    const rows = snapshot.rows.filter((row) => {
      const date = dayKey(row.rrDate || row.saleDt || row.orderDt);
      return date >= from && date <= to;
    });
    const byProduct = new Map<number, FinanceProduct>();
    let unallocatedExpenses = 0;
    for (const row of rows) {
      const returned = isFinanceReturn(row);
      const nmId = Number(row.nmId || 0);
      const { transactionAmount, forPay, wbExpenses, netPayout } = financeRowValues(row);
      const additionalPayment = netPayout - forPay + wbExpenses;
      if (!nmId) {
        unallocatedExpenses += wbExpenses - additionalPayment;
        continue;
      }
      const product = byProduct.get(nmId) ?? {
        nmId,
        sellerSku: row.vendorCode || String(nmId),
        title: row.title || row.vendorCode || `WB ${nmId}`,
        settledUnits: 0,
        transactionAmount: 0,
        forPay: 0,
        wbExpenses: 0,
        netPayout: 0,
      };
      product.settledUnits += returned ? -Math.abs(Number(row.quantity || 1)) : Math.abs(Number(row.quantity || 1));
      product.transactionAmount += transactionAmount;
      product.forPay += forPay;
      product.wbExpenses += wbExpenses;
      product.netPayout += forPay - wbExpenses + additionalPayment;
      if (!product.sellerSku || product.sellerSku === String(nmId)) product.sellerSku = row.vendorCode || product.sellerSku;
      if (!product.title || product.title === `WB ${nmId}`) product.title = row.title || product.title;
      byProduct.set(nmId, product);
    }
    return { available: snapshot.available, rowsCount: rows.length, products: [...byProduct.values()], unallocatedExpenses };
}

export async function GET(request: Request) {
  const store = resolveWbStore(request, env);
  const token = store.token;
  if (!token) return json({ error: "当前店铺的 WB API 尚未配置" }, 503);

  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const requestedWarehouse = url.searchParams.get("warehouse")?.trim() ?? "";
  const includeOrderDetails = url.searchParams.get("includeOrders") === "true";
  const includeFinanceDetails = url.searchParams.get("includeFinance") === "true";
  const forceRefresh = url.searchParams.get("refresh") === "manual";
  const view = url.searchParams.get("view") || "overview";
  const needsStockReport = view === "overview" || view === "products" || view === "stock";
  const needsBalance = view === "overview" || view === "finance";
  const needsCards = view !== "finance";
  const needsFeedbacks = view === "overview" || view === "products";
  const needsSellerStocks = view === "overview" || view === "products" || view === "stock";
  const needsSellerWarehouseDirectory = view === "sales";
  if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to)) return json({ error: "日期格式无效" }, 400);
  if (requestedWarehouse.length > 160) return json({ error: "仓库名称无效" }, 400);

  const fromValue = dateValue(from);
  const toValue = dateValue(to);
  const days = Math.round((toValue - fromValue) / DAY_MS) + 1;
  if (!Number.isFinite(days) || days < 1) return json({ error: "开始日期不能晚于结束日期" }, 400);
  if (includeOrderDetails) {
    if (from < ALL_HISTORY_START) return json({ error: `订单与财务账单支持查询 ${ALL_HISTORY_START} 至今的数据` }, 400);
  } else {
    const maxDays = 90;
    if (days > maxDays || fromValue < Date.now() - (maxDays + 1) * DAY_MS) return json({ error: `当前页面支持查询近 ${maxDays} 天` }, 400);
  }
  if (toValue > Date.now() + DAY_MS) return json({ error: "不能查询未来日期" }, 400);

  try {
    const cardsPromise = needsCards
      ? loadCards(token, store.id, forceRefresh).catch(() => [] as WbCard[])
      : Promise.resolve([] as WbCard[]);
    const fbsOrdersPromise = includeOrderDetails
      ? loadFbsOrders(token, store.id, forceRefresh).catch(() => ({ available: false, orders: [] } as FbsOrderSnapshot))
      : Promise.resolve({ available: false, orders: [] } as FbsOrderSnapshot);
    const financeRowsPromise = includeFinanceDetails
      ? loadFinanceRows(token, store.id, forceRefresh)
          .catch(() => ({ available: false, rows: [] } as FinanceRowsSnapshot))
      : Promise.resolve({ available: false, rows: [] } as FinanceRowsSnapshot);
    const [statistics, stockResult, balanceResult, cardsResult, feedbacksResult, sellerStockResult, fbsOrderResult, financeRowsResult] = await Promise.all([
      loadStatistics(token, store.id, forceRefresh),
      needsStockReport ? loadStocks(token, store.id, forceRefresh).catch(() => [] as WbStock[]) : Promise.resolve([] as WbStock[]),
      needsBalance ? loadBalance(token, store.id, forceRefresh).catch(() => ({} as WbBalance)) : Promise.resolve({} as WbBalance),
      cardsPromise,
      needsFeedbacks ? loadFeedbacks(token, store.id, forceRefresh).catch(() => [] as WbFeedback[]) : Promise.resolve([] as WbFeedback[]),
      needsSellerStocks
        ? cardsPromise.then((cards) => loadSellerStocks(token, cards, store.id, forceRefresh)).catch(() => ({ warehouses: [] } as SellerStockSnapshot))
        : needsSellerWarehouseDirectory
          ? loadSellerWarehouseDirectory(token, store.id, forceRefresh).catch(() => ({ warehouses: [] } as SellerStockSnapshot))
          : Promise.resolve({ warehouses: [] } as SellerStockSnapshot),
      fbsOrdersPromise,
      financeRowsPromise,
    ]);
    const financeDetailsResult = aggregateFinanceRows(financeRowsResult, from, to);

    const inPeriod = (row: { date?: string }) => {
      const date = dayKey(row.date);
      return date >= from && date <= to;
    };
    const observedWarehouseNames = [...new Set([
      ...statistics.orders.map((row) => row.warehouseName?.trim()),
      ...statistics.sales.map((row) => row.warehouseName?.trim()),
      ...stockResult.map((row) => row.warehouseName?.trim()),
    ].filter((name): name is string => Boolean(name)))];

    const chrtToProduct = new Map<number, number>();
    for (const card of cardsResult) {
      const nmId = Number(card.nmID || 0);
      if (!nmId) continue;
      for (const size of card.sizes ?? []) {
        const chrtId = Number(size.chrtID || 0);
        if (chrtId) chrtToProduct.set(chrtId, nmId);
      }
    }
    const sellerWarehouseNames = new Map<number, string>();
    const sellerStocks: WbStock[] = [];
    for (const sellerWarehouse of sellerStockResult.warehouses) {
      const warehouseId = Number(sellerWarehouse.id || 0);
      const warehouseName = resolveSellerWarehouseName(sellerWarehouse, observedWarehouseNames);
      sellerWarehouseNames.set(warehouseId, warehouseName);
      for (const stock of sellerWarehouse.stocks) {
        const nmId = chrtToProduct.get(Number(stock.chrtId || 0));
        if (!nmId) continue;
        sellerStocks.push({ nmId, warehouseId, warehouseName, quantity: Number(stock.amount || 0) });
      }
    }
    const combinedStocks = [...stockResult, ...sellerStocks];
    const warehouseNames = [...new Set([
      ...observedWarehouseNames,
      ...sellerWarehouseNames.values(),
    ])].sort((a, b) => a.localeCompare(b, "ru"));
    if (requestedWarehouse && !warehouseNames.includes(requestedWarehouse)) return json({ error: "未找到所选仓库，请重新选择" }, 400);

    const matchesWarehouse = (row: { warehouseName?: string }) => !requestedWarehouse || row.warehouseName?.trim() === requestedWarehouse;
    const periodFbsOrders = fbsOrderResult.orders.filter((order) => {
        const date = dayKey(order.createdAt);
        return date >= from && date <= to;
      });
    const financeMaps = orderFinanceMap(financeRowsResult);
    const orderProductCounts = new Map<string, number>();
    for (const order of periodFbsOrders) {
      const key = `${String(order.orderUid || "").trim()}|${Number(order.nmId || 0)}`;
      if (order.orderUid) orderProductCounts.set(key, (orderProductCounts.get(key) ?? 0) + 1);
    }
    const completionIndex = buildOrderCompletionIndex(statistics.sales, statistics.orders);
    const allDetailedOrders = periodFbsOrders
      .map((order) => {
        const outcome = orderOutcome(order);
        const invalid = isUnprocessedClientCancellation({
          outcome,
          supplierStatus: order.supplierStatus || "",
          wbStatus: order.wbStatus || "",
        });
        const completion = completionForOrder(order, outcome, completionIndex);
        const detectedCompletion = fbsOrderResult.completionObservations?.[fbsOrderKey(order)];
        const matchedDetection = detectedCompletion?.outcome === outcome ? detectedCompletion : null;
        const nmId = Number(order.nmId || 0);
        const orderUid = String(order.orderUid || "").trim();
        const rid = financeIdentity(order.rid);
        const ridFinance = rid ? financeMaps.byRidProduct.get(`${rid}|${nmId}`) : undefined;
        const orderFinance = orderUid ? financeMaps.byOrderProduct.get(`${orderUid}|${nmId}`) : undefined;
        const settlement = ridFinance ?? (orderFinance
          ? splitOrderFinance(orderFinance, orderProductCounts.get(`${orderUid}|${nmId}`) ?? 1)
          : null);
        return {
          id: String(order.id || order.orderUid || ""),
          orderUid,
          rid: order.rid || "",
          orderNumber: String(order.id || ""),
          nmId,
          article: order.article || "—",
          createdAt: order.createdAt || "",
          warehouseName: sellerWarehouseNames.get(Number(order.warehouseId || 0)) || `仓库 ${order.warehouseId}`,
          amount: Number(order.convertedPrice || 0) / 100,
          currency: "CNY",
          supplierStatus: order.supplierStatus || "",
          wbStatus: order.wbStatus || "",
          outcome,
          invalid,
          statusLabel: orderStatusLabel(order),
          completionAt: completion?.at || matchedDetection?.detectedAt || null,
          completionSource: completion?.source || (matchedDetection ? "status_detected" : null),
          settlement,
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const detailedOrders = allDetailedOrders.filter((order) => !requestedWarehouse || order.warehouseName === requestedWarehouse);
    const orderByIdentity = new Map<string, (typeof allDetailedOrders)[number]>();
    for (const order of allDetailedOrders) {
      for (const identity of [order.id, order.orderUid, order.rid].map(orderIdentity).filter(Boolean)) {
        orderByIdentity.set(identity, order);
      }
    }
    const orderNumberByFinanceKey = new Map<string, string>();
    for (const order of allDetailedOrders) {
      const nmId = Number(order.nmId || 0);
      const orderUid = String(order.orderUid || "").trim();
      const rid = financeIdentity(order.rid);
      if (orderUid) orderNumberByFinanceKey.set(`order|${orderUid}|${nmId}`, order.orderNumber);
      if (rid) orderNumberByFinanceKey.set(`rid|${rid}|${nmId}`, order.orderNumber);
    }
    const financeMovements = view === "finance"
      ? financeRowsResult.rows
          .filter((row) => {
            const date = dayKey(row.rrDate || row.saleDt || row.orderDt);
            return date >= from && date <= to;
          })
          .map((row) => {
            const values = financeRowValues(row);
            const nmId = Number(row.nmId || 0);
            const orderUid = String(row.orderUid || "").trim();
            const rid = financeIdentity(row.srid);
            const orderNumber = (orderUid && orderNumberByFinanceKey.get(`order|${orderUid}|${nmId}`))
              || (rid && orderNumberByFinanceKey.get(`rid|${rid}|${nmId}`))
              || "";
            return {
              id: financeRowKey(row),
              reportRowId: row.rrdId ? String(row.rrdId) : "",
              reportId: row.reportId ? String(row.reportId) : "",
              date: dayKey(row.rrDate || row.saleDt || row.orderDt),
              operation: financeOperationLabel(row, values.netPayout),
              rawOperation: row.sellerOperName || row.docTypeName || "",
              direction: values.netPayout > 0 ? "credit" : values.netPayout < 0 ? "debit" : "neutral",
              orderNumber,
              orderUid,
              srid: row.srid || "",
              nmId,
              sellerSku: row.vendorCode || "",
              title: row.title || "",
              transactionAmount: values.transactionAmount,
              settlementAmount: values.forPay,
              platformFees: values.wbExpenses,
              additionalPayment: values.additionalPayment,
              netChange: values.netPayout,
              currency: financeCurrency(row.currency || balanceResult.currency),
              feeBreakdown: {
                logistics: values.logisticsFee,
                acquiring: values.acquiringFee,
                penalty: values.penaltyFee,
                deduction: values.deductionFee,
                storage: values.storageFee,
                acceptance: values.acceptanceFee,
              },
            };
          })
          .sort((a, b) => b.date.localeCompare(a.date) || b.reportRowId.localeCompare(a.reportRowId, "en", { numeric: true }))
      : [];
    const movementCurrency = financeCurrency(financeMovements.find((row) => row.currency)?.currency || balanceResult.currency);
    const financeMovementSummary = financeMovements.reduce((summary, row) => {
      summary.netChange += row.netChange;
      if (row.netChange > 0) {
        summary.credits += row.netChange;
        summary.creditEntries += 1;
      } else if (row.netChange < 0) {
        summary.debits += Math.abs(row.netChange);
        summary.debitEntries += 1;
      }
      if (row.orderNumber) summary.matchedOrderEntries += 1;
      return summary;
    }, { entries: financeMovements.length, creditEntries: 0, debitEntries: 0, matchedOrderEntries: 0, credits: 0, debits: 0, netChange: 0, currency: movementCurrency });
    const todayDate = beijingDateKey();
    const todayActiveSuccessOrderIds = new Set<string>();
    const todayActiveAbnormalOrderIds = new Set<string>();
    const todayActiveUnmatchedSuccessKeys = new Set<string>();
    const todayActiveUnmatchedAbnormalKeys = new Set<string>();
    const recordTodayActive = (
      row: WbOrder,
      eventDate: string | undefined,
      outcome: "success" | "abnormal",
      source: "sale" | "return" | "cancel",
      eventKey: string,
    ) => {
      if (todayDate < from || todayDate > to || wbStatisticsBeijingDateKey(eventDate) !== todayDate) return;
      const identities = statisticsOrderIdentities(row);
      let matchedOrder: (typeof allDetailedOrders)[number] | undefined;
      for (const identity of identities) {
        matchedOrder = orderByIdentity.get(identity);
        if (!matchedOrder) continue;
        break;
      }
      if (matchedOrder) {
        if (requestedWarehouse && matchedOrder.warehouseName !== requestedWarehouse) return;
        // The statistics event is the authoritative outcome for today's activity.
        // This also keeps the clicked list consistent if the FBS status cache lags behind.
        matchedOrder.outcome = outcome;
        matchedOrder.completionAt = normalizeWbStatisticsTime(eventDate) || matchedOrder.completionAt;
        matchedOrder.completionSource = source;
        if (outcome === "abnormal") {
          todayActiveAbnormalOrderIds.add(matchedOrder.id);
          todayActiveSuccessOrderIds.delete(matchedOrder.id);
        } else if (!todayActiveAbnormalOrderIds.has(matchedOrder.id)) {
          todayActiveSuccessOrderIds.add(matchedOrder.id);
        }
        return;
      }
      if (!matchesWarehouse(row)) return;
      const fallbackKey = identities[0] || `${Number(row.nmId || 0)}|${row.warehouseName || ""}|${eventDate || ""}|${eventKey}`;
      if (outcome === "abnormal") {
        todayActiveUnmatchedAbnormalKeys.add(fallbackKey);
        todayActiveUnmatchedSuccessKeys.delete(fallbackKey);
      } else if (!todayActiveUnmatchedAbnormalKeys.has(fallbackKey)) {
        todayActiveUnmatchedSuccessKeys.add(fallbackKey);
      }
    };
    for (const sale of statistics.sales) {
      const returned = isReturn(sale);
      recordTodayActive(sale, sale.date, returned ? "abnormal" : "success", returned ? "return" : "sale", sale.saleID || "sale");
    }
    for (const order of statistics.orders) {
      if (!order.isCancel) continue;
      recordTodayActive(order, order.cancelDate, "abnormal", "cancel", "cancel");
    }
    // WB Statistics can lag behind the live marketplace status by several hours.
    // Count a persisted pending -> completed status transition immediately, then
    // let the official sale/cancel event above replace its timestamp when available.
    for (const order of detailedOrders) {
      if (order.completionSource !== "status_detected" || beijingDateKey(order.completionAt || "") !== todayDate) continue;
      if (order.outcome === "abnormal") {
        todayActiveAbnormalOrderIds.add(order.id);
        todayActiveSuccessOrderIds.delete(order.id);
      } else if (order.outcome === "success" && !todayActiveAbnormalOrderIds.has(order.id)) {
        todayActiveSuccessOrderIds.add(order.id);
      }
    }
    const todayActiveOrderIds = [...todayActiveSuccessOrderIds, ...todayActiveAbnormalOrderIds];
    const todayActiveUnmatched = todayActiveUnmatchedSuccessKeys.size + todayActiveUnmatchedAbnormalKeys.size;
    const useDetailedMetrics = includeOrderDetails && fbsOrderResult.available;
    const detailedSummary = detailedOrders.reduce((summary, order) => {
      summary.orders += 1;
      summary.orderAmount += order.amount;
      if (order.outcome === "success") {
        summary.success += 1;
        summary.salesAmount += order.amount;
      } else if (order.outcome === "abnormal") {
        summary.abnormal += 1;
        if (order.invalid) summary.invalid += 1;
        else summary.rateAbnormal += 1;
      }
      else summary.pending += 1;
      return summary;
    }, { orders: 0, success: 0, abnormal: 0, invalid: 0, rateAbnormal: 0, pending: 0, orderAmount: 0, salesAmount: 0 });
    const detailedRate = returnRateSummary(detailedSummary.success, detailedSummary.abnormal, detailedSummary.invalid);
    const detailedAbnormalRate = detailedRate.returnRate;
    const allPeriodOrders = statistics.orders.filter(inPeriod);
    const allPeriodSales = statistics.sales.filter(inPeriod);
    const periodOrders = allPeriodOrders.filter(matchesWarehouse);
    const activeOrders = periodOrders.filter((order) => !order.isCancel);
    const cancelledOrders = periodOrders.length - activeOrders.length;
    const periodSales = allPeriodSales.filter(matchesWarehouse);
    const completedSales = periodSales.filter((sale) => !isReturn(sale));
    const returns = periodSales.filter(isReturn);
    const salesAmount = completedSales.reduce((sum, sale) => sum + amount(sale), 0) - returns.reduce((sum, sale) => sum + amount(sale), 0);
    const payoutAmount = completedSales.reduce((sum, sale) => sum + Number(sale.forPay || 0), 0) - returns.reduce((sum, sale) => sum + Number(sale.forPay || 0), 0);
    const returnRate = periodSales.length ? (returns.length / periodSales.length) * 100 : 0;

    const trendMap = new Map<string, { date: string; sales: number; orders: number }>();
    for (let index = 0; index < days; index += 1) {
      const date = new Date(fromValue + index * DAY_MS).toISOString().slice(0, 10);
      trendMap.set(date, { date, sales: 0, orders: 0 });
    }
    for (const order of activeOrders) {
      const item = trendMap.get(dayKey(order.date));
      if (item) item.orders += 1;
    }
    for (const sale of completedSales) {
      const item = trendMap.get(dayKey(sale.date));
      if (item) item.sales += amount(sale);
    }
    for (const sale of returns) {
      const item = trendMap.get(dayKey(sale.date));
      if (item) item.sales -= amount(sale);
    }

    const stockByProduct = new Map<number, number>();
    const selectedStocks = combinedStocks.filter(matchesWarehouse);
    for (const stock of selectedStocks) {
      if (!stock.nmId) continue;
      stockByProduct.set(stock.nmId, (stockByProduct.get(stock.nmId) ?? 0) + Number(stock.quantity || 0));
    }

    type ProductAccumulator = {
      nmId: number;
      name: string;
      sku: string;
      category: string;
      brand: string;
      image: string | null;
      sales: number;
      preliminaryPayout: number;
      orders: number;
      grossSalesUnits: number;
      abnormalOrdersCount: number;
      invalidOrdersCount: number;
      returnsCount: number;
      pendingCount: number;
      stock: number;
    };
    const productMap = new Map<number, ProductAccumulator>();
    for (const card of cardsResult) {
      const id = Number(card.nmID || 0);
      if (!id) continue;
      productMap.set(id, {
        nmId: id,
        name: card.title || card.subjectName || card.vendorCode || `WB ${id}`,
        sku: card.vendorCode || String(id),
        category: card.subjectName || "其他",
        brand: card.brand || "—",
        image: card.photos?.[0]?.c246x328 || card.photos?.[0]?.c516x688 || card.photos?.[0]?.big || card.photos?.[0]?.square || null,
        sales: 0,
        preliminaryPayout: 0,
        orders: 0,
        grossSalesUnits: 0,
        abnormalOrdersCount: 0,
        invalidOrdersCount: 0,
        returnsCount: 0,
        pendingCount: 0,
        stock: stockByProduct.get(id) ?? 0,
      });
    }
    for (const [id, stock] of stockByProduct) {
      if (productMap.has(id)) continue;
      productMap.set(id, {
        nmId: id,
        name: `WB ${id}`,
        sku: String(id),
        category: "其他",
        brand: "—",
        image: null,
        sales: 0,
        preliminaryPayout: 0,
        orders: 0,
        grossSalesUnits: 0,
        abnormalOrdersCount: 0,
        invalidOrdersCount: 0,
        returnsCount: 0,
        pendingCount: 0,
        stock,
      });
    }
    const ensureProduct = (row: WbOrder) => {
      const id = Number(row.nmId || 0);
      if (!id) return null;
      if (!productMap.has(id)) productMap.set(id, {
        nmId: id,
        name: row.subject || row.supplierArticle || `WB ${id}`,
        sku: row.supplierArticle || String(id),
        category: row.category || row.brand || "其他",
        brand: row.brand || "—",
        image: null,
        sales: 0,
        preliminaryPayout: 0,
        orders: 0,
        grossSalesUnits: 0,
        abnormalOrdersCount: 0,
        invalidOrdersCount: 0,
        returnsCount: 0,
        pendingCount: 0,
        stock: stockByProduct.get(id) ?? 0,
      });
      return productMap.get(id)!;
    };
    if (useDetailedMetrics) {
      for (const order of detailedOrders) {
        const product = ensureProduct({ nmId: order.nmId, supplierArticle: order.article });
        if (!product) continue;
        product.orders += 1;
        if (order.outcome === "success") {
          product.grossSalesUnits += 1;
          if (days > 90) product.sales += order.amount;
        } else if (order.outcome === "abnormal") {
          product.abnormalOrdersCount += 1;
          if (order.invalid) product.invalidOrdersCount += 1;
          else product.returnsCount += 1;
        }
        else product.pendingCount += 1;
      }
      if (days <= 90) {
        for (const sale of completedSales) {
          const product = ensureProduct(sale);
          if (product) {
            product.sales += amount(sale);
            product.preliminaryPayout += Number(sale.forPay || 0);
          }
        }
        for (const sale of returns) {
          const product = ensureProduct(sale);
          if (product) {
            product.sales -= amount(sale);
            product.preliminaryPayout -= Math.abs(Number(sale.forPay || 0));
          }
        }
      }
    } else {
      for (const order of activeOrders) {
        const product = ensureProduct(order);
        if (product) product.orders += 1;
      }
      for (const sale of completedSales) {
        const product = ensureProduct(sale);
        if (product) { product.sales += amount(sale); product.preliminaryPayout += Number(sale.forPay || 0); product.grossSalesUnits += 1; }
      }
      for (const sale of returns) {
        const product = ensureProduct(sale);
        if (product) { product.sales -= amount(sale); product.preliminaryPayout -= Math.abs(Number(sale.forPay || 0)); product.abnormalOrdersCount += 1; product.returnsCount += 1; }
      }
    }

    for (const financeProduct of financeDetailsResult.products) {
      const product = ensureProduct({ nmId: financeProduct.nmId, supplierArticle: financeProduct.sellerSku, subject: financeProduct.title });
      if (product && product.name === `WB ${financeProduct.nmId}`) product.name = financeProduct.title;
    }
    const financeByProduct = new Map(financeDetailsResult.products.map((item) => [item.nmId, item]));

    const reviewsByProduct = new Map<number, { total: number; sum: number; positive: number; period: number; periodSum: number; periodPositive: number }>();
    for (const feedback of feedbacksResult) {
      const id = Number(feedback.productDetails?.nmId || 0);
      const valuation = Number(feedback.productValuation || 0);
      if (!id || valuation < 1 || valuation > 5) continue;
      const item = reviewsByProduct.get(id) ?? { total: 0, sum: 0, positive: 0, period: 0, periodSum: 0, periodPositive: 0 };
      item.total += 1;
      item.sum += valuation;
      if (valuation >= 4) item.positive += 1;
      const feedbackDate = dayKey(feedback.createdDate);
      if (feedbackDate >= from && feedbackDate <= to) {
        item.period += 1;
        item.periodSum += valuation;
        if (valuation >= 4) item.periodPositive += 1;
      }
      reviewsByProduct.set(id, item);
    }

    const products = [...productMap.values()]
      .map((product) => {
        const netUnits = useDetailedMetrics ? product.grossSalesUnits : Math.max(0, product.grossSalesUnits - product.returnsCount);
        const saleEvents = product.grossSalesUnits + product.returnsCount;
        const returnRate = saleEvents ? (product.returnsCount / saleEvents) * 100 : 0;
        const buyoutRate = saleEvents ? (product.grossSalesUnits / saleEvents) * 100 : 0;
        const dailyUnits = netUnits / days;
        const stockCoverDays = dailyUnits > 0 ? product.stock / dailyUnits : null;
        const reviews = reviewsByProduct.get(product.nmId) ?? { total: 0, sum: 0, positive: 0, period: 0, periodSum: 0, periodPositive: 0 };
        const averageRating = reviews.total ? reviews.sum / reviews.total : null;
        const positiveRate = reviews.total ? (reviews.positive / reviews.total) * 100 : null;
        const periodAverageRating = reviews.period ? reviews.periodSum / reviews.period : null;
        const periodPositiveRate = reviews.period ? (reviews.periodPositive / reviews.period) * 100 : null;
        let status = "稳定";
        if (product.returnsCount > 0 && returnRate >= 15) status = "高退货";
        else if (reviews.period >= 3 && periodAverageRating !== null && periodAverageRating < 4.2) status = "低评分";
        else if (combinedStocks.length && product.stock === 0) status = "缺货";
        else if (product.stock > 0 && netUnits === 0) status = "滞销";
        else if (dailyUnits >= 1) status = "热销";
        return {
          ...product,
          settlement: financeByProduct.get(product.nmId) ?? {
            nmId: product.nmId,
            sellerSku: product.sku,
            title: product.name,
            settledUnits: netUnits,
            transactionAmount: product.sales,
            forPay: product.preliminaryPayout,
            wbExpenses: 0,
            netPayout: product.preliminaryPayout,
          },
          units: netUnits,
          netUnits,
          returnRate,
          buyoutRate,
          averagePrice: netUnits ? product.sales / netUnits : 0,
          dailyUnits,
          stockCoverDays,
          reviewsCount: reviews.total,
          periodReviewsCount: reviews.period,
          averageRating,
          positiveRate,
          periodAverageRating,
          periodPositiveRate,
          status,
        };
      })
      .sort((a, b) => b.sales - a.sales);

    const categoryMap = new Map<string, number>();
    for (const product of productMap.values()) categoryMap.set(product.category, (categoryMap.get(product.category) ?? 0) + Math.max(0, product.sales));
    const categoryTotal = [...categoryMap.values()].reduce((sum, value) => sum + value, 0);
    const categories = [...categoryMap.entries()]
      .map(([name, value]) => ({ name, value, share: categoryTotal ? (value / categoryTotal) * 100 : 0 }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 4);

    let critical = 0;
    let low = 0;
    let slow = 0;
    if (combinedStocks.length) {
      for (const product of productMap.values()) {
        const dailyOrders = product.orders / days;
        const coverDays = dailyOrders > 0 ? product.stock / dailyOrders : Number.POSITIVE_INFINITY;
        if (product.stock === 0 || coverDays < 5) critical += 1;
        else if (coverDays <= 10) low += 1;
        else if (product.stock > 0 && product.orders === 0) slow += 1;
      }
    }

    const warehouses = warehouseNames.map((name) => {
      const warehouseOrders = useDetailedMetrics
        ? allDetailedOrders.filter((row) => row.warehouseName === name).length
        : allPeriodOrders.filter((row) => row.warehouseName?.trim() === name && !row.isCancel).length;
      const warehouseSales = allPeriodSales.filter((row) => row.warehouseName?.trim() === name);
      const warehouseReturns = warehouseSales.filter(isReturn).length;
      const warehouseStock = combinedStocks
        .filter((row) => row.warehouseName?.trim() === name)
        .reduce((sum, row) => sum + Number(row.quantity || 0), 0);
      return { name, orders: warehouseOrders, returns: warehouseReturns, stock: warehouseStock };
    });

    const schedule = syncSchedule();
    const financePayoutAmount = financeDetailsResult.products.reduce((sum, item) => sum + item.netPayout, 0);
    const balanceCurrency = financeCurrency(balanceResult.currency || movementCurrency);
    const balanceCurrent = normalizedBalanceAmount(balanceResult.current, balanceCurrency);
    const balanceAvailable = normalizedBalanceAmount(balanceResult.for_withdraw, balanceCurrency);
    const balanceTraceAvailable = balanceCurrent !== null && financeDetailsResult.available && to === beijingDateKey();
    let balanceCursor = balanceCurrent;
    const financeMovementsWithBalance = financeMovements.map((movement) => {
      if (!balanceTraceAvailable || balanceCursor === null) return { ...movement, balanceBefore: null, balanceAfter: null };
      const balanceAfter = roundedMoney(balanceCursor);
      const balanceBefore = roundedMoney(balanceAfter - movement.netChange);
      balanceCursor = balanceBefore;
      return { ...movement, balanceBefore, balanceAfter };
    });
    return json({
      source: "wildberries",
      syncedAt: new Date().toISOString(),
      syncSchedule: {
        timezone: "Asia/Shanghai",
        hours: [...AUTO_SYNC_HOURS],
        currentSlot: schedule.slot,
        nextAt: new Date(schedule.nextAt).toISOString(),
        mode: forceRefresh ? "manual" : "scheduled",
      },
      period: { from, to, days },
      currency: useDetailedMetrics && days > 90 ? "CNY" : "RUB",
      selectedWarehouse: requestedWarehouse || null,
      warehouses,
      dataAvailability: {
        balance: balanceCurrent !== null && balanceAvailable !== null,
        productCards: cardsResult.length > 0,
        feedbacks: feedbacksResult.length > 0,
        inventory: stockResult.length > 0 || sellerStockResult.warehouses.length > 0,
        orderDetails: fbsOrderResult.available,
        financeReport: financeDetailsResult.available,
      },
      metrics: {
        salesAmount: useDetailedMetrics && days > 90 ? detailedSummary.salesAmount : salesAmount,
        ordersCount: useDetailedMetrics ? detailedSummary.orders : activeOrders.length,
        cancelledOrders: useDetailedMetrics ? detailedSummary.abnormal : cancelledOrders,
        payoutAmount: financeDetailsResult.available
          ? (view === "finance" ? financeMovementSummary.netChange : financePayoutAmount)
          : (view === "finance" ? null : payoutAmount),
        returnsCount: useDetailedMetrics ? detailedSummary.rateAbnormal : returns.length + cancelledOrders,
        returnRate: useDetailedMetrics ? detailedAbnormalRate : ((completedSales.length + returns.length + cancelledOrders) ? ((returns.length + cancelledOrders) / (completedSales.length + returns.length + cancelledOrders)) * 100 : returnRate),
        balanceCurrent,
        balanceAvailable,
      },
      accountBalance: {
        available: balanceCurrent !== null && balanceAvailable !== null,
        source: "WB /api/v1/account/balance",
        currency: balanceCurrency,
        current: balanceCurrent,
        forWithdraw: balanceAvailable,
        rawCurrent: balanceResult.current ?? null,
        rawForWithdraw: balanceResult.for_withdraw ?? null,
        unitScale: balanceCurrency === "CNY" ? 100 : 1,
        fetchedAt: balanceResult.fetchedAt || null,
      },
      trend: [...trendMap.values()],
      categories,
      products,
      settlement: {
        available: financeDetailsResult.available,
        source: financeDetailsResult.available ? "WB /api/finance/v1/sales-reports/detailed" : "WB 正式财务结算明细暂不可用",
        currency: movementCurrency,
        fetchedAt: financeRowsResult.fetchedAt || null,
        rowsCount: financeDetailsResult.rowsCount,
        unallocatedExpenses: financeDetailsResult.unallocatedExpenses,
      },
      financeMovementSummary,
      financeBalanceTrace: {
        available: balanceTraceAvailable,
        mode: "derived_from_current_balance",
        source: "WB 当前余额快照＋WB 正式财务结算明细",
        anchorBalance: balanceCurrent,
        anchorAt: balanceResult.fetchedAt || null,
        calculatedOpeningBalance: balanceTraceAvailable ? balanceCursor : null,
        includesWithdrawalsOrUnpublishedChanges: false,
      },
      financeMovements: financeMovementsWithBalance,
      orderSummary: {
        ...detailedSummary,
        abnormalRate: detailedAbnormalRate,
        todayActive: todayActiveOrderIds.length,
        todayActiveSuccess: todayActiveSuccessOrderIds.size,
        todayActiveAbnormal: todayActiveAbnormalOrderIds.size,
        todayActiveDate: todayDate,
        todayActiveOrderIds,
        todayActiveUnmatched,
      },
      orderDetails: includeOrderDetails && view !== "finance" ? detailedOrders : [],
      inventory: {
        available: stockResult.length > 0 || sellerStockResult.warehouses.length > 0,
        totalQuantity: [...stockByProduct.values()].reduce((sum, value) => sum + value, 0),
        productCount: stockByProduct.size,
        critical,
        low,
        slow,
      },
    });
  } catch (error) {
    const status = Number((error as { status?: number }).status || 0);
    if (status === 401 || status === 403) return json({ error: "WB 密钥无效或权限不足" }, 502);
    if (status === 429) return json({ error: "WB 接口请求过于频繁，请稍后重试" }, 429);
    return json({ error: "暂时无法同步 WB 数据，请稍后重试" }, 502);
  }
}
