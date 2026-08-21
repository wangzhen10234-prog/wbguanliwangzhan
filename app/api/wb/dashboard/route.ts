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

type CacheEntry<T> = { value: T; expiresAt: number };
type WorkerCacheStorage = CacheStorage & { default?: Cache };

let statisticsCache: CacheEntry<{ orders: WbOrder[]; sales: WbSale[] }> | null = null;
let stockCache: CacheEntry<WbStock[]> | null = null;
let balanceCache: CacheEntry<{ current?: number; for_withdraw?: number }> | null = null;

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
}

async function loadStocks(token: string) {
  if (stockCache && stockCache.expiresAt > Date.now()) return stockCache.value;
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
}

async function loadBalance(token: string) {
  if (balanceCache && balanceCache.expiresAt > Date.now()) return balanceCache.value;
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
    const [statistics, stockResult, balanceResult] = await Promise.all([
      loadStatistics(token),
      loadStocks(token).catch(() => [] as WbStock[]),
      loadBalance(token).catch(() => ({})),
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

    const productMap = new Map<number, { nmId: number; name: string; sku: string; category: string; sales: number; orders: number; units: number; stock: number }>();
    const ensureProduct = (row: WbOrder) => {
      const id = Number(row.nmId || 0);
      if (!id) return null;
      if (!productMap.has(id)) productMap.set(id, {
        nmId: id,
        name: row.subject || row.supplierArticle || `WB ${id}`,
        sku: row.supplierArticle || String(id),
        category: row.category || row.brand || "其他",
        sales: 0,
        orders: 0,
        units: 0,
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
      if (product) { product.sales += amount(sale); product.units += 1; }
    }
    for (const sale of returns) {
      const product = ensureProduct(sale);
      if (product) { product.sales -= amount(sale); product.units = Math.max(0, product.units - 1); }
    }
    const products = [...productMap.values()]
      .map((product) => ({ ...product, buyoutRate: product.orders ? Math.min(100, (product.units / product.orders) * 100) : 0 }))
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 20);

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
