type WbOrder = {
  date?: string;
  nmId?: number;
  warehouseName?: string;
  supplierArticle?: string;
  subject?: string;
  brand?: string;
  category?: string;
  finishedPrice?: number;
  priceWithDisc?: number;
  isCancel?: boolean;
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

type CacheEntry<T> = { value: T; expiresAt: number };
type WorkerCacheStorage = CacheStorage & { default?: Cache };

let statisticsCache: CacheEntry<{ orders: WbOrder[]; sales: WbSale[] }> | null = null;
let stockCache: CacheEntry<WbStock[]> | null = null;
let sellerStockCache: CacheEntry<SellerStockSnapshot> | null = null;
let fbsOrderCache: CacheEntry<FbsOrderSnapshot> | null = null;
let balanceCache: CacheEntry<{ current?: number; for_withdraw?: number }> | null = null;
let cardsCache: CacheEntry<WbCard[]> | null = null;
let feedbacksCache: CacheEntry<WbFeedback[]> | null = null;
const pendingLoads = new Map<string, Promise<unknown>>();

const DAY_MS = 86_400_000;
const BEIJING_OFFSET_MS = 8 * 60 * 60_000;
const AUTO_SYNC_HOURS = [8, 14, 19, 23] as const;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const EDGE_CACHE_BASE = "https://wb-insight-cache.invalid/v2";

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

async function loadStatistics(token: string, forceRefresh = false) {
  if (!forceRefresh && statisticsCache && statisticsCache.expiresAt > Date.now()) return statisticsCache.value;
  return dedupe(forceRefresh ? "statistics-manual" : "statistics", async () => {
    const cached = forceRefresh ? null : await readEdgeCache<{ orders: WbOrder[]; sales: WbSale[] }>("statistics");
    if (cached) {
      statisticsCache = { value: cached, expiresAt: cacheExpiry() };
      return cached;
    }
    const start = new Date(Date.now() - 89 * DAY_MS).toISOString().slice(0, 10);
    const base = "https://statistics-api.wildberries.ru/api/v1/supplier";
    let orders: WbOrder[];
    let sales: WbSale[];
    try {
      [orders, sales] = await Promise.all([
        wbRequest<WbOrder[]>(`${base}/orders?dateFrom=${start}&flag=0`, token),
        wbRequest<WbSale[]>(`${base}/sales?dateFrom=${start}&flag=0`, token),
      ]);
    } catch (error) {
      if (Number((error as { status?: number }).status || 0) === 429) {
        const peerValue = await waitForPeerCache<{ orders: WbOrder[]; sales: WbSale[] }>("statistics");
        if (peerValue) {
          statisticsCache = { value: peerValue, expiresAt: cacheExpiry() };
          return peerValue;
        }
      }
      throw error;
    }
    statisticsCache = { value: { orders, sales }, expiresAt: cacheExpiry() };
    await writeEdgeCache("statistics", statisticsCache.value);
    return statisticsCache.value;
  });
}

async function loadStocks(token: string, forceRefresh = false) {
  if (!forceRefresh && stockCache && stockCache.expiresAt > Date.now()) return stockCache.value;
  return dedupe(forceRefresh ? "stocks-manual" : "stocks", async () => {
    const cached = forceRefresh ? null : await readEdgeCache<WbStock[]>("stocks");
    if (cached) {
      stockCache = { value: cached, expiresAt: cacheExpiry() };
      return cached;
    }
    const response = await wbRequest<{ data?: { items?: WbStock[] } }>(
      "https://seller-analytics-api.wildberries.ru/api/analytics/v1/stocks-report/wb-warehouses",
      token,
      { method: "POST", body: JSON.stringify({ nmIds: [], limit: 250000, offset: 0 }) },
    );
    const stocks = response.data?.items ?? [];
    stockCache = { value: stocks, expiresAt: cacheExpiry() };
    await writeEdgeCache("stocks", stocks);
    return stocks;
  });
}

async function loadSellerStocks(token: string, cards: WbCard[], forceRefresh = false) {
  if (!forceRefresh && sellerStockCache && sellerStockCache.expiresAt > Date.now()) return sellerStockCache.value;
  return dedupe(forceRefresh ? "seller-stocks-manual" : "seller-stocks", async () => {
    const cached = forceRefresh ? null : await readEdgeCache<SellerStockSnapshot>("seller-stocks");
    if (cached) {
      sellerStockCache = { value: cached, expiresAt: cacheExpiry() };
      return cached;
    }

    const base = "https://marketplace-api.wildberries.ru/api/v3";
    const [warehouses, offices] = await Promise.all([
      wbRequest<SellerWarehouse[]>(`${base}/warehouses`, token),
      wbRequest<Array<{ id?: number; name?: string }>>(`${base}/offices`, token),
    ]);
    const officeNames = new Map(offices.map((office) => [Number(office.id || 0), office.name || ""]));
    const chrtIds = [...new Set(cards.flatMap((card) => card.sizes?.map((size) => Number(size.chrtID || 0)) ?? []).filter(Boolean))];
    const result: SellerStockSnapshot = { warehouses: [] };

    for (const warehouse of warehouses) {
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
      result.warehouses.push({ ...warehouse, officeName: officeNames.get(Number(warehouse.officeId || 0)) || "", stocks });
    }

    sellerStockCache = { value: result, expiresAt: cacheExpiry() };
    await writeEdgeCache("seller-stocks", result);
    return result;
  });
}

async function loadFbsOrders(token: string, forceRefresh = false) {
  if (!forceRefresh && fbsOrderCache && fbsOrderCache.expiresAt > Date.now()) return fbsOrderCache.value;
  return dedupe(forceRefresh ? "fbs-orders-180-manual" : "fbs-orders-180", async () => {
    const cached = forceRefresh ? null : await readEdgeCache<FbsOrderSnapshot>("fbs-orders-180-v1");
    if (cached) {
      fbsOrderCache = { value: cached, expiresAt: cacheExpiry() };
      return cached;
    }

    const base = "https://marketplace-api.wildberries.ru/api/v3";
    const now = Date.now();
    const end = new Date(now);
    const start = new Date(now - 179 * DAY_MS);
    start.setUTCHours(0, 0, 0, 0);
    end.setUTCHours(23, 59, 59, 999);
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
        for (const order of batch) byOrder.set(order.orderUid || String(order.id), order);
        if (batch.length < 1000 || !response.next || response.next === next) break;
        next = response.next;
      }
    }

    const orders = [...byOrder.values()];
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

    const result = { available: true, orders };
    fbsOrderCache = { value: result, expiresAt: cacheExpiry() };
    await writeEdgeCache("fbs-orders-180-v1", result);
    return result;
  });
}

const abnormalWbStatuses = new Set(["canceled", "canceled_by_client", "declined_by_client", "defect", "canceled_by_missed_call"]);

function orderOutcome(order: Pick<FbsOrder, "supplierStatus" | "wbStatus">) {
  if (order.wbStatus === "sold") return "success" as const;
  if (order.supplierStatus === "cancel" || abnormalWbStatuses.has(String(order.wbStatus || ""))) return "abnormal" as const;
  return "pending" as const;
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

async function loadBalance(token: string, forceRefresh = false) {
  if (!forceRefresh && balanceCache && balanceCache.expiresAt > Date.now()) return balanceCache.value;
  return dedupe(forceRefresh ? "balance-manual" : "balance", async () => {
    const cached = forceRefresh ? null : await readEdgeCache<{ current?: number; for_withdraw?: number }>("balance");
    if (cached) {
      balanceCache = { value: cached, expiresAt: cacheExpiry() };
      return cached;
    }
    const balance = await wbRequest<{ current?: number; for_withdraw?: number }>(
      "https://finance-api.wildberries.ru/api/v1/account/balance",
      token,
    );
    balanceCache = { value: balance, expiresAt: cacheExpiry() };
    await writeEdgeCache("balance", balance);
    return balance;
  });
}

async function loadCards(token: string, forceRefresh = false) {
  if (!forceRefresh && cardsCache && cardsCache.expiresAt > Date.now()) return cardsCache.value;
  return dedupe(forceRefresh ? "cards-manual" : "cards", async () => {
    const cached = forceRefresh ? null : await readEdgeCache<WbCard[]>("cards");
    if (cached) {
      cardsCache = { value: cached, expiresAt: cacheExpiry() };
      return cached;
    }

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
    cardsCache = { value: cards, expiresAt: cacheExpiry() };
    await writeEdgeCache("cards", cards);
    return cards;
  });
}

async function loadFeedbacks(token: string, forceRefresh = false) {
  if (!forceRefresh && feedbacksCache && feedbacksCache.expiresAt > Date.now()) return feedbacksCache.value;
  return dedupe(forceRefresh ? "feedbacks-manual" : "feedbacks", async () => {
    const cached = forceRefresh ? null : await readEdgeCache<WbFeedback[]>("feedbacks");
    if (cached) {
      feedbacksCache = { value: cached, expiresAt: cacheExpiry() };
      return cached;
    }

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
    feedbacksCache = { value: feedbacks, expiresAt: cacheExpiry() };
    await writeEdgeCache("feedbacks", feedbacks);
    return feedbacks;
  });
}

export async function GET(request: Request) {
  const token = process.env.WB_API_TOKEN?.trim();
  if (!token) return json({ error: "WB API 尚未配置" }, 503);

  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const requestedWarehouse = url.searchParams.get("warehouse")?.trim() ?? "";
  const includeOrderDetails = url.searchParams.get("includeOrders") === "true";
  const forceRefresh = url.searchParams.get("refresh") === "manual";
  if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to)) return json({ error: "日期格式无效" }, 400);
  if (requestedWarehouse.length > 160) return json({ error: "仓库名称无效" }, 400);

  const fromValue = dateValue(from);
  const toValue = dateValue(to);
  const days = Math.round((toValue - fromValue) / DAY_MS) + 1;
  if (!Number.isFinite(days) || days < 1) return json({ error: "开始日期不能晚于结束日期" }, 400);
  const maxDays = includeOrderDetails ? 180 : 90;
  if (days > maxDays || fromValue < Date.now() - (maxDays + 1) * DAY_MS) return json({ error: `当前页面支持查询近 ${maxDays} 天` }, 400);
  if (toValue > Date.now() + DAY_MS) return json({ error: "不能查询未来日期" }, 400);

  try {
    const cardsPromise = loadCards(token, forceRefresh).catch(() => [] as WbCard[]);
    const fbsOrdersPromise = includeOrderDetails
      ? loadFbsOrders(token, forceRefresh).catch(() => ({ available: false, orders: [] } as FbsOrderSnapshot))
      : Promise.resolve({ available: false, orders: [] } as FbsOrderSnapshot);
    const [statistics, stockResult, balanceResult, cardsResult, feedbacksResult, sellerStockResult, fbsOrderResult] = await Promise.all([
      loadStatistics(token, forceRefresh),
      loadStocks(token, forceRefresh).catch(() => [] as WbStock[]),
      loadBalance(token, forceRefresh).catch(() => ({})),
      cardsPromise,
      loadFeedbacks(token, forceRefresh).catch(() => [] as WbFeedback[]),
      cardsPromise.then((cards) => loadSellerStocks(token, cards, forceRefresh)).catch(() => ({ warehouses: [] } as SellerStockSnapshot)),
      fbsOrdersPromise,
    ]);

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
    const allDetailedOrders = fbsOrderResult.orders
      .filter((order) => {
        const date = dayKey(order.createdAt);
        return date >= from && date <= to;
      })
      .map((order) => {
        const outcome = orderOutcome(order);
        return {
          id: order.orderUid || String(order.id || ""),
          orderNumber: String(order.id || ""),
          nmId: Number(order.nmId || 0),
          article: order.article || "—",
          createdAt: order.createdAt || "",
          warehouseName: sellerWarehouseNames.get(Number(order.warehouseId || 0)) || `仓库 ${order.warehouseId}`,
          amount: Number(order.convertedPrice || 0) / 100,
          currency: "CNY",
          supplierStatus: order.supplierStatus || "",
          wbStatus: order.wbStatus || "",
          outcome,
          statusLabel: orderStatusLabel(order),
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const detailedOrders = allDetailedOrders.filter((order) => !requestedWarehouse || order.warehouseName === requestedWarehouse);
    const useDetailedMetrics = includeOrderDetails && fbsOrderResult.available;
    const detailedSummary = detailedOrders.reduce((summary, order) => {
      summary.orders += 1;
      summary.orderAmount += order.amount;
      if (order.outcome === "success") {
        summary.success += 1;
        summary.salesAmount += order.amount;
      } else if (order.outcome === "abnormal") summary.abnormal += 1;
      else summary.pending += 1;
      return summary;
    }, { orders: 0, success: 0, abnormal: 0, pending: 0, orderAmount: 0, salesAmount: 0 });
    const completedDetailedOrders = detailedSummary.success + detailedSummary.abnormal;
    const detailedAbnormalRate = completedDetailedOrders ? (detailedSummary.abnormal / completedDetailedOrders) * 100 : 0;
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
      orders: number;
      grossSalesUnits: number;
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
        orders: 0,
        grossSalesUnits: 0,
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
        orders: 0,
        grossSalesUnits: 0,
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
        orders: 0,
        grossSalesUnits: 0,
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
        } else if (order.outcome === "abnormal") product.returnsCount += 1;
        else product.pendingCount += 1;
      }
      if (days <= 90) {
        for (const sale of completedSales) {
          const product = ensureProduct(sale);
          if (product) product.sales += amount(sale);
        }
        for (const sale of returns) {
          const product = ensureProduct(sale);
          if (product) product.sales -= amount(sale);
        }
      }
    } else {
      for (const order of activeOrders) {
        const product = ensureProduct(order);
        if (product) product.orders += 1;
      }
      for (const sale of completedSales) {
        const product = ensureProduct(sale);
        if (product) { product.sales += amount(sale); product.grossSalesUnits += 1; }
      }
      for (const sale of returns) {
        const product = ensureProduct(sale);
        if (product) { product.sales -= amount(sale); product.returnsCount += 1; }
      }
    }

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
        productCards: cardsResult.length > 0,
        feedbacks: feedbacksResult.length > 0,
        inventory: stockResult.length > 0 || sellerStockResult.warehouses.length > 0,
        orderDetails: fbsOrderResult.available,
      },
      metrics: {
        salesAmount: useDetailedMetrics && days > 90 ? detailedSummary.salesAmount : salesAmount,
        ordersCount: useDetailedMetrics ? detailedSummary.orders : activeOrders.length,
        cancelledOrders: useDetailedMetrics ? detailedSummary.abnormal : cancelledOrders,
        payoutAmount,
        returnsCount: useDetailedMetrics ? detailedSummary.abnormal : returns.length + cancelledOrders,
        returnRate: useDetailedMetrics ? detailedAbnormalRate : ((completedSales.length + returns.length + cancelledOrders) ? ((returns.length + cancelledOrders) / (completedSales.length + returns.length + cancelledOrders)) * 100 : returnRate),
        balanceCurrent: Number(balanceResult.current || 0),
        balanceAvailable: Number(balanceResult.for_withdraw || 0),
      },
      trend: [...trendMap.values()],
      categories,
      products,
      orderSummary: {
        ...detailedSummary,
        abnormalRate: detailedAbnormalRate,
      },
      orderDetails: includeOrderDetails ? detailedOrders : [],
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
