type WbOrder = {
  date?: string;
  nmId?: number;
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
  quantity?: number;
  inWayToClient?: number;
  inWayFromClient?: number;
};

type WbCard = {
  nmID?: number;
  vendorCode?: string;
  brand?: string;
  title?: string;
  subjectName?: string;
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
let balanceCache: CacheEntry<{ current?: number; for_withdraw?: number }> | null = null;
let cardsCache: CacheEntry<WbCard[]> | null = null;
let feedbacksCache: CacheEntry<WbFeedback[]> | null = null;
const pendingLoads = new Map<string, Promise<unknown>>();

const DAY_MS = 86_400_000;
const CACHE_MS = 5 * 60_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const EDGE_CACHE_BASE = "https://wb-insight-cache.invalid/v1";

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
    const response = await cache.match(new Request(`${EDGE_CACHE_BASE}/${key}`));
    return response ? await response.json() as T : null;
  } catch {
    return null;
  }
}

async function writeEdgeCache(key: string, value: unknown) {
  try {
    const cache = edgeCache();
    if (!cache) return;
    await cache.put(new Request(`${EDGE_CACHE_BASE}/${key}`), new Response(JSON.stringify(value), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
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

async function loadStatistics(token: string) {
  if (statisticsCache && statisticsCache.expiresAt > Date.now()) return statisticsCache.value;
  return dedupe("statistics", async () => {
    const cached = await readEdgeCache<{ orders: WbOrder[]; sales: WbSale[] }>("statistics");
    if (cached) {
      statisticsCache = { value: cached, expiresAt: Date.now() + CACHE_MS };
      return cached;
    }
    const start = new Date(Date.now() - 89 * DAY_MS).toISOString().slice(0, 10);
    const base = "https://statistics-api.wildberries.ru/api/v1/supplier";
    const [orders, sales] = await Promise.all([
      wbRequest<WbOrder[]>(`${base}/orders?dateFrom=${start}&flag=0`, token),
      wbRequest<WbSale[]>(`${base}/sales?dateFrom=${start}&flag=0`, token),
    ]);
    statisticsCache = { value: { orders, sales }, expiresAt: Date.now() + CACHE_MS };
    await writeEdgeCache("statistics", statisticsCache.value);
    return statisticsCache.value;
  });
}

async function loadStocks(token: string) {
  if (stockCache && stockCache.expiresAt > Date.now()) return stockCache.value;
  return dedupe("stocks", async () => {
    const cached = await readEdgeCache<WbStock[]>("stocks");
    if (cached) {
      stockCache = { value: cached, expiresAt: Date.now() + CACHE_MS };
      return cached;
    }
    const response = await wbRequest<{ data?: { items?: WbStock[] } }>(
      "https://seller-analytics-api.wildberries.ru/api/analytics/v1/stocks-report/wb-warehouses",
      token,
      { method: "POST", body: JSON.stringify({ nmIds: [], limit: 250000, offset: 0 }) },
    );
    const stocks = response.data?.items ?? [];
    stockCache = { value: stocks, expiresAt: Date.now() + CACHE_MS };
    await writeEdgeCache("stocks", stocks);
    return stocks;
  });
}

async function loadBalance(token: string) {
  if (balanceCache && balanceCache.expiresAt > Date.now()) return balanceCache.value;
  return dedupe("balance", async () => {
    const cached = await readEdgeCache<{ current?: number; for_withdraw?: number }>("balance");
    if (cached) {
      balanceCache = { value: cached, expiresAt: Date.now() + CACHE_MS };
      return cached;
    }
    const balance = await wbRequest<{ current?: number; for_withdraw?: number }>(
      "https://finance-api.wildberries.ru/api/v1/account/balance",
      token,
    );
    balanceCache = { value: balance, expiresAt: Date.now() + CACHE_MS };
    await writeEdgeCache("balance", balance);
    return balance;
  });
}

async function loadCards(token: string) {
  if (cardsCache && cardsCache.expiresAt > Date.now()) return cardsCache.value;
  return dedupe("cards", async () => {
    const cached = await readEdgeCache<WbCard[]>("cards");
    if (cached) {
      cardsCache = { value: cached, expiresAt: Date.now() + CACHE_MS };
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
    cardsCache = { value: cards, expiresAt: Date.now() + CACHE_MS };
    await writeEdgeCache("cards", cards);
    return cards;
  });
}

async function loadFeedbacks(token: string) {
  if (feedbacksCache && feedbacksCache.expiresAt > Date.now()) return feedbacksCache.value;
  return dedupe("feedbacks", async () => {
    const cached = await readEdgeCache<WbFeedback[]>("feedbacks");
    if (cached) {
      feedbacksCache = { value: cached, expiresAt: Date.now() + CACHE_MS };
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
    feedbacksCache = { value: feedbacks, expiresAt: Date.now() + CACHE_MS };
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
  if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to)) return json({ error: "日期格式无效" }, 400);

  const fromValue = dateValue(from);
  const toValue = dateValue(to);
  const days = Math.round((toValue - fromValue) / DAY_MS) + 1;
  if (!Number.isFinite(days) || days < 1) return json({ error: "开始日期不能晚于结束日期" }, 400);
  if (days > 90 || fromValue < Date.now() - 91 * DAY_MS) return json({ error: "订单与销售统计目前支持查询近 90 天" }, 400);
  if (toValue > Date.now() + DAY_MS) return json({ error: "不能查询未来日期" }, 400);

  try {
    const [statistics, stockResult, balanceResult, cardsResult, feedbacksResult] = await Promise.all([
      loadStatistics(token),
      loadStocks(token).catch(() => [] as WbStock[]),
      loadBalance(token).catch(() => ({})),
      loadCards(token).catch(() => [] as WbCard[]),
      loadFeedbacks(token).catch(() => [] as WbFeedback[]),
    ]);

    const inPeriod = (row: { date?: string }) => {
      const date = dayKey(row.date);
      return date >= from && date <= to;
    };
    const periodOrders = statistics.orders.filter(inPeriod);
    const activeOrders = periodOrders.filter((order) => !order.isCancel);
    const cancelledOrders = periodOrders.length - activeOrders.length;
    const periodSales = statistics.sales.filter(inPeriod);
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
    for (const stock of stockResult) {
      if (!stock.nmId) continue;
      stockByProduct.set(stock.nmId, (stockByProduct.get(stock.nmId) ?? 0) + Number(stock.quantity || 0));
    }

    type ProductAccumulator = {
      nmId: number;
      name: string;
      sku: string;
      category: string;
      brand: string;
      sales: number;
      orders: number;
      grossSalesUnits: number;
      returnsCount: number;
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
        sales: 0,
        orders: 0,
        grossSalesUnits: 0,
        returnsCount: 0,
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
        sales: 0,
        orders: 0,
        grossSalesUnits: 0,
        returnsCount: 0,
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
        sales: 0,
        orders: 0,
        grossSalesUnits: 0,
        returnsCount: 0,
        stock: stockByProduct.get(id) ?? 0,
      });
      return productMap.get(id)!;
    };
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
        const netUnits = Math.max(0, product.grossSalesUnits - product.returnsCount);
        const saleEvents = product.grossSalesUnits + product.returnsCount;
        const returnRate = saleEvents ? (product.returnsCount / saleEvents) * 100 : 0;
        const buyoutRate = product.orders ? Math.min(100, (netUnits / product.orders) * 100) : 0;
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
        else if (stockResult.length && product.stock === 0) status = "缺货";
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
    if (stockResult.length) {
      for (const product of productMap.values()) {
        const dailyOrders = product.orders / days;
        const coverDays = dailyOrders > 0 ? product.stock / dailyOrders : Number.POSITIVE_INFINITY;
        if (product.stock === 0 || coverDays < 5) critical += 1;
        else if (coverDays <= 10) low += 1;
        else if (product.stock > 0 && product.orders === 0) slow += 1;
      }
    }

    return json({
      source: "wildberries",
      syncedAt: new Date().toISOString(),
      period: { from, to, days },
      dataAvailability: {
        productCards: cardsResult.length > 0,
        feedbacks: feedbacksResult.length > 0,
        inventory: stockResult.length > 0,
      },
      metrics: {
        salesAmount,
        ordersCount: activeOrders.length,
        cancelledOrders,
        payoutAmount,
        returnsCount: returns.length,
        returnRate,
        balanceCurrent: Number(balanceResult.current || 0),
        balanceAvailable: Number(balanceResult.for_withdraw || 0),
      },
      trend: [...trendMap.values()],
      categories,
      products,
      inventory: {
        available: stockResult.length > 0,
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
