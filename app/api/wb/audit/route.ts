import { env } from "cloudflare:workers";
import { evaluateProductAudit, type AuditCard, type AuditFunnel, type ProductAuditResult } from "../../../_lib/product-audit";
import { resolveWbStore, scopedStoreKey } from "../../../_lib/server-storefront";

type WbFunnelProduct = {
  product?: { nmId?: number };
  statistic?: AuditFunnel;
};

type AuditSnapshot = {
  source: "wildberries";
  syncedAt: string;
  period: { from: string; to: string; days: number };
  syncSchedule: { timezone: "Asia/Shanghai"; hours: number[]; currentSlot: string; nextAt: string; mode: "scheduled" | "manual" };
  dataAvailability: {
    productCards: boolean;
    salesFunnel: boolean;
    searchQueries: boolean;
    visualSemantics: false;
    searchReason: string;
  };
  summary: {
    products: number;
    critical: number;
    highPriority: number;
    contentIncomplete: number;
    lowConversion: number;
    healthy: number;
    averageScore: number;
  };
  products: ProductAuditResult[];
};

type WorkerError = Error & { status?: number };
type SnapshotRecord = { value: AuditSnapshot; syncSlot: string; manualBucket: number };

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};
const AUTO_SYNC_HOURS = [8, 14, 19, 23] as const;
const BEIJING_OFFSET_MS = 8 * 60 * 60_000;
const DAY_MS = 86_400_000;
const MANUAL_REFRESH_MS = 5 * 60_000;
const memoryCache = new Map<string, { value: AuditSnapshot; expiresAt: number }>();
const pendingLoads = new Map<string, Promise<AuditSnapshot>>();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function beijingDateKey(value = Date.now()) {
  return new Date(value + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

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

function dateValue(value: string) {
  return new Date(`${value}T12:00:00Z`).getTime();
}

function periodFromRequest(request: Request) {
  const url = new URL(request.url);
  const today = beijingDateKey();
  const to = url.searchParams.get("to") || today;
  const from = url.searchParams.get("from") || new Date(dateValue(to) - 29 * DAY_MS).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw Object.assign(new Error("DATE_INVALID"), { status: 400 });
  const days = Math.round((dateValue(to) - dateValue(from)) / DAY_MS) + 1;
  if (days < 1 || days > 90 || to > today) throw Object.assign(new Error("DATE_RANGE_INVALID"), { status: 400 });
  return { from, to, days };
}

async function wbRequest<T>(url: string, token: string, body?: unknown) {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) {
    const error = new Error(`WB audit request failed: ${response.status}`) as WorkerError;
    error.status = response.status;
    throw error;
  }
  return response.json() as Promise<T>;
}

async function loadCards(token: string) {
  const cards: AuditCard[] = [];
  let cursor: { updatedAt?: string; nmID?: number } = {};
  for (let page = 0; page < 50; page += 1) {
    const response = await wbRequest<{ cards?: AuditCard[]; cursor?: { updatedAt?: string; nmID?: number } }>(
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

async function loadFunnel(token: string, period: { from: string; to: string; days: number }) {
  const pastEnd = new Date(dateValue(period.from) - DAY_MS);
  const pastStart = new Date(pastEnd.getTime() - (period.days - 1) * DAY_MS);
  const response = await wbRequest<{ data?: { products?: WbFunnelProduct[] } }>(
    "https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/products",
    token,
    {
      selectedPeriod: { start: period.from, end: period.to },
      pastPeriod: { start: pastStart.toISOString().slice(0, 10), end: pastEnd.toISOString().slice(0, 10) },
      nmIds: [],
      brandNames: [],
      subjectIds: [],
      tagIds: [],
      skipDeletedNm: true,
      orderBy: { field: "openCard", mode: "desc" },
      limit: 1000,
      offset: 0,
    },
  );
  return response.data?.products ?? [];
}

async function searchAvailability(token: string, nmIds: number[], period: { from: string; to: string }) {
  if (!nmIds.length) return { available: false, reason: "没有可查询的商品" };
  const currentTo = period.to;
  const currentFrom = new Date(Math.max(dateValue(period.from), dateValue(currentTo) - 29 * DAY_MS)).toISOString().slice(0, 10);
  const selectedDays = Math.round((dateValue(currentTo) - dateValue(currentFrom)) / DAY_MS) + 1;
  const pastEnd = new Date(dateValue(currentFrom) - DAY_MS);
  const pastStart = new Date(pastEnd.getTime() - (selectedDays - 1) * DAY_MS);
  try {
    await wbRequest<unknown>(
      "https://seller-analytics-api.wildberries.ru/api/v2/search-report/product/search-texts",
      token,
      {
        currentPeriod: { start: currentFrom, end: currentTo },
        pastPeriod: { start: pastStart.toISOString().slice(0, 10), end: pastEnd.toISOString().slice(0, 10) },
        nmIds: nmIds.slice(0, 50),
        topOrderBy: "orders",
        includeSubstitutedSKUs: true,
        includeSearchTexts: true,
        orderBy: { field: "avgPosition", mode: "asc" },
        limit: 30,
      },
    );
    return { available: true, reason: "WB 搜索词报告已连接" };
  } catch (error) {
    const status = Number((error as WorkerError).status || 0);
    if (status === 402 || status === 403) return { available: false, reason: "WB Jam 搜索词报告未开通或当前密钥无此权限" };
    if (status === 429) return { available: false, reason: "WB 搜索词接口限流，本次保留为空，不计入评分" };
    return { available: false, reason: "WB 搜索词接口暂时不可用，不计入评分" };
  }
}

async function readSnapshot(key: string) {
  try {
    const row = await env.DB.prepare("SELECT payload, sync_slot AS syncSlot, manual_bucket AS manualBucket FROM wb_sync_snapshots WHERE cache_key = ?")
      .bind(key)
      .first<{ payload?: string; syncSlot?: string; manualBucket?: number }>();
    if (!row?.payload) return null;
    return { value: JSON.parse(row.payload) as AuditSnapshot, syncSlot: row.syncSlot || "", manualBucket: Number(row.manualBucket || 0) } satisfies SnapshotRecord;
  } catch {
    return null;
  }
}

async function writeSnapshot(key: string, value: AuditSnapshot, manual: boolean) {
  try {
    await env.DB.prepare(`
      INSERT INTO wb_sync_snapshots (cache_key, payload, sync_slot, manual_bucket, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(cache_key) DO UPDATE SET
        payload = excluded.payload,
        sync_slot = excluded.sync_slot,
        manual_bucket = excluded.manual_bucket,
        updated_at = CURRENT_TIMESTAMP
    `).bind(key, JSON.stringify(value), syncSchedule().slot, manual ? Math.floor(Date.now() / MANUAL_REFRESH_MS) : 0).run();
  } catch {
    // Cache persistence must never invalidate fresh WB data.
  }
}

async function fetchSnapshot(token: string, period: { from: string; to: string; days: number }, manual: boolean) {
  const [cards, funnelRows] = await Promise.all([loadCards(token), loadFunnel(token, period)]);
  const funnelByNmId = new Map(funnelRows.map((row) => [Number(row.product?.nmId || 0), row.statistic]));
  const products = cards
    .map((card) => evaluateProductAudit(card, funnelByNmId.get(Number(card.nmID || 0))))
    .filter((product) => product.nmId > 0)
    .sort((a, b) => a.scores.overall - b.scores.overall || b.funnel.openCount - a.funnel.openCount);
  const search = await searchAvailability(token, products.map((product) => product.nmId), period);
  const averageScore = products.length ? products.reduce((sum, product) => sum + product.scores.overall, 0) / products.length : 0;
  const schedule = syncSchedule();
  return {
    source: "wildberries",
    syncedAt: new Date().toISOString(),
    period,
    syncSchedule: {
      timezone: "Asia/Shanghai",
      hours: [...AUTO_SYNC_HOURS],
      currentSlot: schedule.slot,
      nextAt: new Date(schedule.nextAt).toISOString(),
      mode: manual ? "manual" : "scheduled",
    },
    dataAvailability: {
      productCards: cards.length > 0,
      salesFunnel: funnelRows.length > 0,
      searchQueries: search.available,
      visualSemantics: false,
      searchReason: search.reason,
    },
    summary: {
      products: products.length,
      critical: products.filter((product) => product.priority === "critical").length,
      highPriority: products.filter((product) => product.priority === "critical" || product.priority === "high").length,
      contentIncomplete: products.filter((product) => Math.min(product.scores.image, product.scores.title, product.scores.description, product.scores.attributes) < 60).length,
      lowConversion: products.filter((product) => product.funnel.openCount >= 20 && product.scores.funnel < 55).length,
      healthy: products.filter((product) => product.priority === "healthy").length,
      averageScore: Math.round(averageScore * 10) / 10,
    },
    products,
  } satisfies AuditSnapshot;
}

async function loadAudit(token: string, storeId: string, period: { from: string; to: string; days: number }, manual: boolean) {
  const key = scopedStoreKey(storeId, `product-audit-v1-${period.from}-${period.to}`);
  const schedule = syncSchedule();
  const manualBucket = Math.floor(Date.now() / MANUAL_REFRESH_MS);
  const memory = memoryCache.get(key);
  if (!manual && memory && memory.expiresAt > Date.now()) return memory.value;
  const durable = await readSnapshot(key);
  if (!manual && durable?.syncSlot === schedule.slot) {
    memoryCache.set(key, { value: durable.value, expiresAt: schedule.nextAt });
    return durable.value;
  }
  if (manual && durable?.manualBucket === manualBucket) return durable.value;
  const pendingKey = `${key}-${manual ? "manual" : schedule.slot}`;
  const pending = pendingLoads.get(pendingKey);
  if (pending) return pending;
  const load = fetchSnapshot(token, period, manual)
    .then(async (value) => {
      memoryCache.set(key, { value, expiresAt: schedule.nextAt });
      await writeSnapshot(key, value, manual);
      return value;
    })
    .catch((error) => {
      if (durable?.value) return durable.value;
      throw error;
    })
    .finally(() => pendingLoads.delete(pendingKey));
  pendingLoads.set(pendingKey, load);
  return load;
}

export async function GET(request: Request) {
  try {
    const store = resolveWbStore(request, env);
    const token = store.token;
    if (!token) return json({ error: "当前店铺的 WB API 密钥尚未配置" }, 503);
    const period = periodFromRequest(request);
    const manual = new URL(request.url).searchParams.get("refresh") === "manual";
    return json(await loadAudit(token, store.id, period, manual));
  } catch (error) {
    const status = Number((error as WorkerError).status || 0);
    if (status === 400) return json({ error: "诊断周期需为 1–90 天，且不能晚于今天" }, 400);
    if (status === 401 || status === 403) return json({ error: "WB 密钥无效，或缺少内容/分析权限" }, 502);
    if (status === 429) return json({ error: "WB 分析接口请求频繁，请稍后手动同步" }, 429);
    return json({ error: "商品诊断数据暂时无法同步，请稍后重试" }, 502);
  }
}
