import { env } from "cloudflare:workers";
import { averageAdvertisingPosition, campaignDailyStatistics } from "../../../_lib/advertising-statistics";
import { resolveWbStore, scopedStoreKey } from "../../../_lib/server-storefront";

type WorkerError = Error & { status?: number };
type CampaignGroup = { type?: number; status?: number; advert_list?: Array<{ advertId?: number; changeTime?: string }> };
type CampaignProduct = {
  nm_id?: number;
  bids_kopecks?: { search?: number; recommendations?: number };
  subject?: { id?: number; name?: string };
};
type CampaignInfo = {
  id?: number;
  status?: number;
  bid_type?: string;
  nm_settings?: CampaignProduct[];
  settings?: {
    name?: string;
    payment_type?: string;
    placements?: { search?: boolean; recommendations?: boolean };
  };
  timestamps?: { created?: string; started?: string | null; updated?: string; deleted?: string };
};
type CampaignStat = {
  advertId?: number;
  views?: number;
  clicks?: number;
  ctr?: number;
  cpc?: number;
  sum?: number;
  atbs?: number;
  orders?: number;
  cr?: number;
  shks?: number;
  sum_price?: number;
  boosterStats?: Array<{ avg_position?: number; date?: string; nm?: number }>;
  days?: Array<{
    date?: string;
    views?: number;
    clicks?: number;
    sum?: number;
    atbs?: number;
    orders?: number;
    shks?: number;
    sum_price?: number;
    apps?: Array<{
      nm?: Array<{
        nmId?: number;
        name?: string;
        views?: number;
        clicks?: number;
        sum?: number;
        atbs?: number;
        orders?: number;
        shks?: number;
        sum_price?: number;
      }>;
    }>;
  }>;
};
type MinimumBidResponse = {
  bids?: Array<{
    nm_id?: number;
    bids?: Array<{ currency?: string; type?: string; value?: number }>;
  }>;
};
type RecommendedBidResponse = {
  advertId?: number;
  nmId?: number;
  base?: {
    competitiveBid?: { bidKopecks?: number };
    leadersBid?: { bidKopecks?: number };
    top2?: { bidKopecks?: number };
  };
  normQueries?: Array<{
    normQuery?: string;
    reachMax?: { bidKopecks?: number; bidKopecksMin?: number };
    reachMedium?: { bidKopecks?: number; bidKopecksMin?: number };
    reachMin?: { bidKopecks?: number; bidKopecksMin?: number };
  }>;
};
type MetricTotals = {
  views: number;
  clicks: number;
  spend: number;
  addToCart: number;
  orders: number;
  sales: number;
  buyouts: number;
};
type AdvertisingSnapshot = {
  source: "WB Promotion API";
  syncedAt: string;
  window: { from: string; to: string; maxDays: number };
  accountCurrency: string | null;
  campaigns: Array<Record<string, unknown>>;
  daily: Array<Record<string, unknown>>;
  summary: Record<string, unknown>;
  warnings: string[];
  recommendationCoverage: { eligible: number; loaded: number; limited: boolean };
};
type CacheEntry = { value: AdvertisingSnapshot; expiresAt: number };

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};
const DAY_MS = 86_400_000;
const BEIJING_OFFSET_MS = 8 * 60 * 60_000;
const AUTO_SYNC_HOURS = [8, 14, 19, 23] as const;
const MAX_DAYS = 31;
const MAX_CAMPAIGNS = 50;
const MAX_RECOMMENDATION_CALLS = 5;
const MANUAL_REFRESH_COOLDOWN_MS = 60_000;
const SNAPSHOT_VERSION = "advertising-v2";

const memoryCache = new Map<string, CacheEntry>();
const pendingLoads = new Map<string, Promise<AdvertisingSnapshot>>();

function number(value: unknown) {
  const result = Number(value || 0);
  return Number.isFinite(result) ? result : 0;
}

function integer(value: unknown) {
  return Math.trunc(number(value));
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function dateKey(value = Date.now()) {
  return new Date(value + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

function parseDate(value: string | null, fallback: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  const stamp = new Date(`${value}T12:00:00+08:00`).getTime();
  return Number.isFinite(stamp) ? value : fallback;
}

function dateStamp(value: string) {
  return new Date(`${value}T12:00:00+08:00`).getTime();
}

function shiftDate(value: string, days: number) {
  return dateKey(dateStamp(value) + days * DAY_MS);
}

function requestWindow(url: URL) {
  const today = dateKey();
  let to = parseDate(url.searchParams.get("to"), today);
  let from = parseDate(url.searchParams.get("from"), shiftDate(to, -6));
  if (dateStamp(to) > dateStamp(today)) to = today;
  if (dateStamp(from) > dateStamp(to)) from = to;
  const days = Math.floor((dateStamp(to) - dateStamp(from)) / DAY_MS) + 1;
  if (days > MAX_DAYS) from = shiftDate(to, -(MAX_DAYS - 1));
  return { from, to, maxDays: MAX_DAYS };
}

function syncSchedule(now = Date.now()) {
  const beijingNow = new Date(now + BEIJING_OFFSET_MS);
  const year = beijingNow.getUTCFullYear();
  const month = beijingNow.getUTCMonth();
  const day = beijingNow.getUTCDate();
  const hour = beijingNow.getUTCHours();
  const currentDate = beijingNow.toISOString().slice(0, 10);
  const previousDate = new Date(Date.UTC(year, month, day - 1)).toISOString().slice(0, 10);
  const currentHour = [...AUTO_SYNC_HOURS].reverse().find((value) => hour >= value);
  const slot = currentHour === undefined ? `${previousDate}-23` : `${currentDate}-${String(currentHour).padStart(2, "0")}`;
  const nextHour = AUTO_SYNC_HOURS.find((value) => value > hour);
  const nextAt = nextHour === undefined
    ? Date.UTC(year, month, day + 1, AUTO_SYNC_HOURS[0]) - BEIJING_OFFSET_MS
    : Date.UTC(year, month, day, nextHour) - BEIJING_OFFSET_MS;
  return { slot, nextAt };
}

function statusLabel(status: number) {
  return ({ "-1": "已删除", "4": "待启动", "7": "已结束", "8": "已驳回", "9": "投放中", "11": "已暂停" } as Record<string, string>)[String(status)] || `状态 ${status}`;
}

function metricTotals(source?: Partial<CampaignStat> | Partial<MetricTotals>): MetricTotals {
  return {
    views: number(source?.views),
    clicks: number(source?.clicks),
    spend: number("sum" in (source || {}) ? (source as CampaignStat).sum : (source as MetricTotals | undefined)?.spend),
    addToCart: number("atbs" in (source || {}) ? (source as CampaignStat).atbs : (source as MetricTotals | undefined)?.addToCart),
    orders: number(source?.orders),
    sales: number("sum_price" in (source || {}) ? (source as CampaignStat).sum_price : (source as MetricTotals | undefined)?.sales),
    buyouts: number("shks" in (source || {}) ? (source as CampaignStat).shks : (source as MetricTotals | undefined)?.buyouts),
  };
}

function addMetrics(target: MetricTotals, source: MetricTotals) {
  target.views += source.views;
  target.clicks += source.clicks;
  target.spend += source.spend;
  target.addToCart += source.addToCart;
  target.orders += source.orders;
  target.sales += source.sales;
  target.buyouts += source.buyouts;
  return target;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function metricView(values: MetricTotals) {
  return {
    ...values,
    ctr: values.views ? values.clicks / values.views * 100 : 0,
    cpc: values.clicks ? values.spend / values.clicks : 0,
    cr: values.clicks ? values.orders / values.clicks * 100 : 0,
    cpo: values.orders ? values.spend / values.orders : 0,
    roas: values.spend ? values.sales / values.spend : 0,
  };
}

async function wbRequest<T>(url: string, token: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  if (response.status === 204) return null as T;
  if (!response.ok) {
    const error = new Error(`WB advertising request failed: ${response.status}`) as WorkerError;
    error.status = response.status;
    throw error;
  }
  return response.json() as Promise<T>;
}

async function readSnapshot(cacheKey: string) {
  try {
    const row = await env.DB.prepare("SELECT payload, sync_slot AS syncSlot FROM wb_sync_snapshots WHERE cache_key = ?")
      .bind(cacheKey)
      .first<{ payload: string; syncSlot: string }>();
    return row?.payload ? { value: JSON.parse(row.payload) as AdvertisingSnapshot, syncSlot: row.syncSlot || "" } : null;
  } catch {
    return null;
  }
}

async function writeSnapshot(cacheKey: string, value: AdvertisingSnapshot) {
  try {
    await env.DB.prepare(`
      INSERT INTO wb_sync_snapshots (cache_key, payload, sync_slot, manual_bucket, updated_at)
      VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP)
      ON CONFLICT(cache_key) DO UPDATE SET
        payload = excluded.payload,
        sync_slot = excluded.sync_slot,
        updated_at = CURRENT_TIMESTAMP
    `).bind(cacheKey, JSON.stringify(value), syncSchedule().slot).run();
  } catch {
    // Fresh WB data remains valid even if the durable cache write fails.
  }
}

function normalizedProductStats(campaign: CampaignInfo, stats: CampaignStat | undefined, nmId: number) {
  if (!stats) return { scope: "unavailable", values: null };
  const aggregate = metricTotals();
  let found = false;
  for (const day of stats.days || []) {
    for (const app of day.apps || []) {
      for (const item of app.nm || []) {
        if (integer(item.nmId) !== nmId) continue;
        found = true;
        addMetrics(aggregate, {
          views: number(item.views), clicks: number(item.clicks), spend: number(item.sum),
          addToCart: number(item.atbs), orders: number(item.orders), sales: number(item.sum_price), buyouts: number(item.shks),
        });
      }
    }
  }
  const averagePosition = averageAdvertisingPosition(stats.boosterStats, nmId);
  if (found) return { scope: "product", values: { ...metricView(aggregate), averagePosition } };
  if ((campaign.nm_settings || []).length === 1) return { scope: "campaign-single-product", values: { ...metricView(metricTotals(stats)), averagePosition } };
  return { scope: "unavailable", values: null };
}

async function fetchAdvertisingSnapshot(token: string, window: { from: string; to: string; maxDays: number }) {
  const warnings: string[] = [];
  const count = await wbRequest<{ adverts?: CampaignGroup[] }>("https://advert-api.wildberries.ru/adv/v1/promotion/count", token);
  const listed = (count?.adverts || []).flatMap((group) => (group.advert_list || []).map((item) => ({
    id: integer(item.advertId),
    status: integer(group.status),
    type: integer(group.type),
    changedAt: text(item.changeTime),
  }))).filter((item) => item.id > 0);
  const priority = (status: number) => status === 9 ? 0 : status === 11 ? 1 : status === 4 ? 2 : status === 7 ? 3 : 4;
  const selected = [...listed].sort((a, b) => priority(a.status) - priority(b.status) || b.changedAt.localeCompare(a.changedAt)).slice(0, MAX_CAMPAIGNS);
  if (listed.length > selected.length) warnings.push(`推广活动超过 ${MAX_CAMPAIGNS} 个，本次优先读取投放中、暂停和最近更新的活动。`);

  const infoUrl = new URL("https://advert-api.wildberries.ru/api/advert/v2/adverts");
  if (selected.length) infoUrl.searchParams.set("ids", selected.map((item) => item.id).join(","));
  const info = selected.length
    ? await wbRequest<{ adverts?: CampaignInfo[] }>(infoUrl.toString(), token)
    : { adverts: [] };
  const campaigns = info?.adverts || [];

  const statsCampaigns = campaigns.filter((campaign) => [7, 9, 11].includes(integer(campaign.status)));
  const statsUrl = new URL("https://advert-api.wildberries.ru/adv/v3/fullstats");
  statsUrl.searchParams.set("ids", statsCampaigns.map((campaign) => integer(campaign.id)).join(","));
  statsUrl.searchParams.set("beginDate", window.from);
  statsUrl.searchParams.set("endDate", window.to);
  const stats = statsCampaigns.length
    ? await wbRequest<CampaignStat[]>(statsUrl.toString(), token)
    : [];
  const statsByCampaign = new Map((stats || []).map((item) => [integer(item.advertId), item]));

  const currentCampaigns = campaigns.filter((campaign) => [4, 9, 11].includes(integer(campaign.status)));
  const minimumByKey = new Map<string, Array<{ currency: string; type: string; valueKopecks: number }>>();
  for (let index = 0; index < currentCampaigns.length; index += 5) {
    const batch = currentCampaigns.slice(index, index + 5);
    await Promise.all(batch.map(async (campaign) => {
      const nmIds = (campaign.nm_settings || []).map((item) => integer(item.nm_id)).filter(Boolean).slice(0, 100);
      if (!nmIds.length) return;
      const manual = text(campaign.bid_type, "manual") === "manual";
      const placements = manual
        ? [campaign.settings?.placements?.search ? "search" : "", campaign.settings?.placements?.recommendations ? "recommendation" : ""].filter(Boolean)
        : ["combined"];
      try {
        const result = await wbRequest<MinimumBidResponse>("https://advert-api.wildberries.ru/api/advert/v1/bids/min", token, {
          method: "POST",
          body: JSON.stringify({
            advert_id: integer(campaign.id), nm_ids: nmIds,
            payment_type: text(campaign.settings?.payment_type, "cpm"),
            placement_types: placements.length ? placements : ["search"],
          }),
        });
        for (const product of result?.bids || []) {
          minimumByKey.set(`${integer(campaign.id)}:${integer(product.nm_id)}`, (product.bids || []).map((bid) => ({
            currency: text(bid.currency), type: text(bid.type), valueKopecks: integer(bid.value),
          })));
        }
      } catch (error) {
        const status = Number((error as WorkerError).status || 0);
        if (status === 400 || status === 404) warnings.push(`活动 ${integer(campaign.id)} 暂未返回最低出价。`);
        else throw error;
      }
    }));
    if (index + 5 < currentCampaigns.length) await wait(3_100);
  }

  const recommendationCandidates = currentCampaigns.flatMap((campaign) => {
    if (text(campaign.settings?.payment_type) !== "cpm") return [];
    return (campaign.nm_settings || []).map((product) => ({ advertId: integer(campaign.id), nmId: integer(product.nm_id) })).filter((item) => item.nmId > 0);
  });
  const recommendationByKey = new Map<string, RecommendedBidResponse>();
  await Promise.all(recommendationCandidates.slice(0, MAX_RECOMMENDATION_CALLS).map(async ({ advertId, nmId }) => {
    const url = new URL("https://advert-api.wildberries.ru/api/advert/v0/bids/recommendations");
    url.searchParams.set("advertId", String(advertId));
    url.searchParams.set("nmId", String(nmId));
    try {
      const result = await wbRequest<RecommendedBidResponse>(url.toString(), token);
      if (result) recommendationByKey.set(`${advertId}:${nmId}`, result);
    } catch (error) {
      const status = Number((error as WorkerError).status || 0);
      if (![400, 404, 422].includes(status)) throw error;
    }
  }));
  if (recommendationCandidates.length > MAX_RECOMMENDATION_CALLS) warnings.push("WB 官方推荐出价接口限频，本次仅读取前 5 个 CPM 商品，其余明确显示暂无官方推荐价。");

  const currencies = new Set<string>();
  for (const bids of minimumByKey.values()) for (const bid of bids) if (bid.currency) currencies.add(bid.currency);
  const accountCurrency = currencies.size === 1 ? [...currencies][0] : null;

  const campaignViews = campaigns.map((campaign) => {
    const id = integer(campaign.id);
    const campaignStats = statsByCampaign.get(id);
    const status = integer(campaign.status);
    const products = (campaign.nm_settings || []).map((product) => {
      const nmId = integer(product.nm_id);
      const minimumBids = minimumByKey.get(`${id}:${nmId}`) || [];
      const currency = minimumBids.find((bid) => bid.currency)?.currency || accountCurrency;
      const officialRecommendation = recommendationByKey.get(`${id}:${nmId}`) || null;
      const productStats = normalizedProductStats(campaign, campaignStats, nmId);
      return {
        nmId,
        subjectId: integer(product.subject?.id),
        subjectName: text(product.subject?.name),
        currentBidsKopecks: {
          search: integer(product.bids_kopecks?.search),
          recommendation: integer(product.bids_kopecks?.recommendations),
        },
        minimumBids,
        currency,
        statsScope: productStats.scope,
        stats: productStats.values,
        officialRecommendation,
      };
    });
    return {
      id,
      name: text(campaign.settings?.name, `推广活动 ${id}`),
      status,
      statusLabel: statusLabel(status),
      bidType: text(campaign.bid_type, "manual"),
      paymentType: text(campaign.settings?.payment_type, "cpm"),
      placements: {
        search: Boolean(campaign.settings?.placements?.search),
        recommendations: Boolean(campaign.settings?.placements?.recommendations),
      },
      timestamps: {
        created: text(campaign.timestamps?.created),
        started: text(campaign.timestamps?.started),
        updated: text(campaign.timestamps?.updated),
        deleted: text(campaign.timestamps?.deleted),
      },
      currency: products.find((product) => product.currency)?.currency || accountCurrency,
      stats: campaignStats ? { ...metricView(metricTotals(campaignStats)), averagePosition: averageAdvertisingPosition(campaignStats.boosterStats) } : null,
      daily: campaignDailyStatistics(campaignStats?.days),
      products,
    };
  });

  const dailyMap = new Map<string, MetricTotals>();
  for (const item of stats || []) {
    for (const day of item.days || []) {
      const key = text(day.date).slice(0, 10);
      if (!key) continue;
      const current = dailyMap.get(key) || metricTotals();
      addMetrics(current, {
        views: number(day.views), clicks: number(day.clicks), spend: number(day.sum), addToCart: number(day.atbs),
        orders: number(day.orders), sales: number(day.sum_price), buyouts: number(day.shks),
      });
      dailyMap.set(key, current);
    }
  }
  const daily = [...dailyMap.entries()].map(([date, values]) => ({ date, ...metricView(values) })).sort((a, b) => a.date.localeCompare(b.date));
  const allMetrics = (stats || []).reduce((total, item) => addMetrics(total, metricTotals(item)), metricTotals());
  const currentProducts = new Set(currentCampaigns.flatMap((campaign) => (campaign.nm_settings || []).map((item) => integer(item.nm_id)).filter(Boolean)));
  const summary = {
    campaigns: campaignViews.length,
    activeCampaigns: campaignViews.filter((campaign) => campaign.status === 9).length,
    pausedCampaigns: campaignViews.filter((campaign) => campaign.status === 11).length,
    currentProducts: currentProducts.size,
    ...metricView(allMetrics),
  };
  return {
    source: "WB Promotion API" as const,
    syncedAt: new Date().toISOString(),
    window,
    accountCurrency,
    campaigns: campaignViews,
    daily,
    summary,
    warnings,
    recommendationCoverage: {
      eligible: recommendationCandidates.length,
      loaded: recommendationByKey.size,
      limited: recommendationCandidates.length > MAX_RECOMMENDATION_CALLS,
    },
  };
}

async function loadAdvertising(token: string, storeId: string, window: { from: string; to: string; maxDays: number }, forceRefresh: boolean) {
  const cacheKey = scopedStoreKey(storeId, `${SNAPSHOT_VERSION}:${window.from}:${window.to}`);
  const now = Date.now();
  const schedule = syncSchedule(now);
  const memory = memoryCache.get(cacheKey);
  if (!forceRefresh && memory && memory.expiresAt > now) return memory.value;
  const durable = await readSnapshot(cacheKey);
  const durableAge = durable?.value?.syncedAt ? now - new Date(durable.value.syncedAt).getTime() : Number.POSITIVE_INFINITY;
  if (forceRefresh && durable?.value && durableAge < MANUAL_REFRESH_COOLDOWN_MS) return durable.value;
  if (!forceRefresh && durable?.syncSlot === schedule.slot) {
    memoryCache.set(cacheKey, { value: durable.value, expiresAt: schedule.nextAt });
    return durable.value;
  }
  const pending = pendingLoads.get(cacheKey);
  if (pending) return pending;
  const load = fetchAdvertisingSnapshot(token, window)
    .then(async (snapshot) => {
      memoryCache.set(cacheKey, { value: snapshot, expiresAt: syncSchedule().nextAt });
      await writeSnapshot(cacheKey, snapshot);
      return snapshot;
    })
    .catch((error) => {
      if (durable?.value) return { ...durable.value, warnings: [...durable.value.warnings, "WB 推广接口本次刷新失败，当前显示最近一次完整快照。"] };
      throw error;
    })
    .finally(() => pendingLoads.delete(cacheKey));
  pendingLoads.set(cacheKey, load);
  return load;
}

export async function GET(request: Request) {
  const store = resolveWbStore(request, env);
  const token = store.token;
  if (!token) return json({ error: "当前店铺的 WB API 尚未配置" }, 503);
  const url = new URL(request.url);
  const window = requestWindow(url);
  const forceRefresh = url.searchParams.get("refresh") === "manual";
  try {
    const snapshot = await loadAdvertising(token, store.id, window, forceRefresh);
    const schedule = syncSchedule();
    return json({
      ...snapshot,
      syncSchedule: {
        timezone: "Asia/Shanghai", hours: AUTO_SYNC_HOURS, currentSlot: schedule.slot,
        nextAt: new Date(schedule.nextAt).toISOString(), mode: forceRefresh ? "manual" : "scheduled",
      },
    });
  } catch (error) {
    const status = Number((error as WorkerError).status || 0);
    if (status === 401 || status === 403) return json({ error: "WB 密钥缺少“推广”权限，无法读取推广活动" }, 403);
    if (status === 429) return json({ error: "WB 推广接口已限频，系统将在缓存窗口结束后自动重试" }, 429);
    return json({ error: "WB 推广数据暂时无法读取，请稍后重试" }, 502);
  }
}
