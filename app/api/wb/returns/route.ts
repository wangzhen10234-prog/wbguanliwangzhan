import { env } from "cloudflare:workers";
import { classifyReturnTracking, returnStatusLabel } from "../../../_lib/return-tracking";

type WorkerError = Error & { status?: number };
type GoodsReturnRow = {
  barcode?: string;
  brand?: string;
  completedDt?: string | null;
  dstOfficeAddress?: string;
  dstOfficeId?: number;
  expiredDt?: string | null;
  isStatusActive?: number;
  nmId?: number;
  orderDt?: string;
  orderId?: number;
  readyToReturnDt?: string | null;
  reason?: string;
  returnType?: string;
  shkId?: number;
  srid?: string;
  status?: string;
  stickerId?: string | number;
  subjectName?: string;
  techSize?: string;
};
type ReturnClaim = {
  id?: string;
  claim_type?: number;
  status?: number;
  status_ex?: number;
  nm_id?: number;
  user_comment?: string;
  wb_comment?: string;
  actions?: string[];
  photos?: string[];
  video_paths?: string[];
  created_at?: string;
  updated_at?: string;
  delivery_dt?: string;
  [key: string]: unknown;
};
type ReturnsSnapshot = {
  source: "WB Analytics Goods Return + Buyers Returns API";
  syncedAt: string;
  window: { from: string; to: string; maxDays: number };
  returns: Array<Record<string, unknown>>;
  claims: Array<Record<string, unknown>>;
  summary: Record<string, number>;
  dataAvailability: { logisticsReport: boolean; buyerClaims: boolean };
  warnings: string[];
};
type CacheEntry = { value: ReturnsSnapshot; expiresAt: number };

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};
const DAY_MS = 86_400_000;
const BEIJING_OFFSET_MS = 8 * 60 * 60_000;
const AUTO_SYNC_HOURS = [8, 14, 19, 23] as const;
const MAX_DAYS = 180;
const REPORT_CHUNK_DAYS = 31;
const MAX_CLAIMS = 1_000;
const MANUAL_REFRESH_COOLDOWN_MS = 60_000;
const SNAPSHOT_VERSION = "returns-v1";

const memoryCache = new Map<string, CacheEntry>();
const pendingLoads = new Map<string, Promise<ReturnsSnapshot>>();

function number(value: unknown) {
  const result = Number(value || 0);
  return Number.isFinite(result) ? result : 0;
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

function dateStamp(value: string) {
  return new Date(`${value}T12:00:00+08:00`).getTime();
}

function shiftDate(value: string, days: number) {
  return dateKey(dateStamp(value) + days * DAY_MS);
}

function parseDate(value: string | null, fallback: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  return Number.isFinite(dateStamp(value)) ? value : fallback;
}

function requestWindow(url: URL) {
  const today = dateKey();
  let to = parseDate(url.searchParams.get("to"), today);
  let from = parseDate(url.searchParams.get("from"), shiftDate(to, -(MAX_DAYS - 1)));
  if (dateStamp(to) > dateStamp(today)) to = today;
  if (dateStamp(from) > dateStamp(to)) from = to;
  const days = Math.floor((dateStamp(to) - dateStamp(from)) / DAY_MS) + 1;
  if (days > MAX_DAYS) from = shiftDate(to, -(MAX_DAYS - 1));
  return { from, to, maxDays: MAX_DAYS };
}

function dateChunks(from: string, to: string) {
  const chunks: Array<{ from: string; to: string }> = [];
  for (let cursor = from; dateStamp(cursor) <= dateStamp(to); cursor = shiftDate(chunks[chunks.length - 1].to, 1)) {
    const chunkTo = shiftDate(cursor, REPORT_CHUNK_DAYS - 1);
    chunks.push({ from: cursor, to: dateStamp(chunkTo) < dateStamp(to) ? chunkTo : to });
  }
  return chunks;
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

async function wbRequest<T>(url: string, token: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
    if (response.status === 204) return null as T;
    if (response.ok) return response.json() as Promise<T>;
    if (response.status === 429 && attempt < 2) {
      const retrySeconds = Math.max(1, Math.min(30, number(response.headers.get("X-RateLimit-Retry") || response.headers.get("Retry-After") || 10)));
      await new Promise((resolve) => setTimeout(resolve, retrySeconds * 1_000 + 500));
      continue;
    }
    const error = new Error(`WB returns request failed: ${response.status}`) as WorkerError;
    error.status = response.status;
    throw error;
  }
  throw new Error("WB returns request retry exhausted");
}

async function readSnapshot(cacheKey: string) {
  try {
    const row = await env.DB.prepare("SELECT payload, sync_slot AS syncSlot FROM wb_sync_snapshots WHERE cache_key = ?")
      .bind(cacheKey)
      .first<{ payload: string; syncSlot: string }>();
    return row?.payload ? { value: JSON.parse(row.payload) as ReturnsSnapshot, syncSlot: row.syncSlot || "" } : null;
  } catch {
    return null;
  }
}

async function writeSnapshot(cacheKey: string, value: ReturnsSnapshot) {
  try {
    await env.DB.prepare(`
      INSERT INTO wb_sync_snapshots (cache_key, payload, sync_slot, manual_bucket, updated_at)
      VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP)
      ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, sync_slot = excluded.sync_slot, updated_at = CURRENT_TIMESTAMP
    `).bind(cacheKey, JSON.stringify(value), syncSchedule().slot).run();
  } catch {
    // The WB response remains valid even if durable snapshot persistence is temporarily unavailable.
  }
}

async function loadClaims(token: string, isArchive: boolean) {
  const claims: ReturnClaim[] = [];
  let total = 0;
  for (let offset = 0; offset < MAX_CLAIMS; offset += 200) {
    const url = new URL("https://returns-api.wildberries.ru/api/v1/claims");
    url.searchParams.set("is_archive", String(isArchive));
    url.searchParams.set("limit", "200");
    url.searchParams.set("offset", String(offset));
    const response = await wbRequest<{ claims?: ReturnClaim[]; total?: number }>(url.toString(), token);
    const page = response?.claims || [];
    total = number(response?.total);
    claims.push(...page);
    if (claims.length >= total || page.length < 200) break;
  }
  return { claims, total };
}

async function fetchReturnsSnapshot(token: string, window: { from: string; to: string; maxDays: number }) {
  const warnings: string[] = [];
  const chunks = dateChunks(window.from, window.to);
  const reportsPromise = (async () => {
    const reports: GoodsReturnRow[][] = [];
    for (const chunk of chunks) {
      const url = new URL("https://seller-analytics-api.wildberries.ru/api/v1/analytics/goods-return");
      url.searchParams.set("dateFrom", chunk.from);
      url.searchParams.set("dateTo", chunk.to);
      const response = await wbRequest<{ report?: GoodsReturnRow[] }>(url.toString(), token);
      reports.push(response?.report || []);
    }
    return reports;
  })();
  const [reports, activeClaimsResult, archivedClaimsResult] = await Promise.all([
    reportsPromise,
    loadClaims(token, false).catch((error) => ({ error: error as WorkerError, claims: [] as ReturnClaim[], total: 0 })),
    loadClaims(token, true).catch((error) => ({ error: error as WorkerError, claims: [] as ReturnClaim[], total: 0 })),
  ]);

  const activeClaimsError = "error" in activeClaimsResult ? activeClaimsResult.error : null;
  const archivedClaimsError = "error" in archivedClaimsResult ? archivedClaimsResult.error : null;
  const claimsAvailable = !activeClaimsError && !archivedClaimsError;
  if (!claimsAvailable) {
    const status = number(activeClaimsError?.status || archivedClaimsError?.status);
    warnings.push(status === 401 || status === 403
      ? "当前密钥未开放“买家退货申请”权限，退货物流仍已正常读取。"
      : "买家退货申请接口本次未返回，退货物流仍已正常读取。");
  }

  const uniqueReturns = new Map<string, GoodsReturnRow>();
  for (const row of reports.flat()) {
    const key = `${number(row.shkId)}|${text(String(row.stickerId || ""))}|${number(row.orderId)}|${text(row.srid)}`;
    uniqueReturns.set(key, row);
  }
  const returns = [...uniqueReturns.values()].map((row) => {
    const rawStatus = text(row.status, "Статус не определен");
    const isStatusActive = number(row.isStatusActive) === 1;
    const stage = classifyReturnTracking(rawStatus, isStatusActive, row.completedDt);
    return {
      id: `${number(row.shkId)}-${text(String(row.stickerId || "0"))}`,
      orderId: number(row.orderId),
      srid: text(row.srid),
      nmId: number(row.nmId),
      subjectName: text(row.subjectName, `WB ${number(row.nmId)}`),
      brand: text(row.brand, "—"),
      barcode: text(row.barcode, "—"),
      size: text(row.techSize, "—"),
      shkId: number(row.shkId),
      stickerId: text(String(row.stickerId || ""), "—"),
      orderDate: text(row.orderDt),
      returnType: text(row.returnType, "平台未注明"),
      reason: text(row.reason, "平台未注明"),
      rawStatus,
      statusLabel: returnStatusLabel(rawStatus, stage),
      trackingStage: stage,
      isStatusActive,
      destinationOfficeId: number(row.dstOfficeId),
      destinationAddress: text(row.dstOfficeAddress, "平台未返回取货地址"),
      readyToReturnAt: text(row.readyToReturnDt),
      completedAt: text(row.completedDt),
      expiredAt: text(row.expiredDt),
    };
  }).sort((a, b) => Number(b.isStatusActive) - Number(a.isStatusActive) || b.orderDate.localeCompare(a.orderDate));

  const activeClaims = activeClaimsResult.claims || [];
  const archivedClaims = archivedClaimsResult.claims || [];
  const claims = [
    ...activeClaims.map((claim) => ({ ...claim, isArchive: false })),
    ...archivedClaims.map((claim) => ({ ...claim, isArchive: true })),
  ].map((claim) => ({
    id: text(claim.id),
    nmId: number(claim.nm_id),
    claimType: number(claim.claim_type),
    status: number(claim.status),
    statusExtended: number(claim.status_ex),
    userComment: text(claim.user_comment, "买家未填写说明"),
    wbComment: text(claim.wb_comment, "平台暂无说明"),
    actions: Array.isArray(claim.actions) ? claim.actions.map(String) : [],
    photos: Array.isArray(claim.photos) ? claim.photos.map(String) : [],
    videos: Array.isArray(claim.video_paths) ? claim.video_paths.map(String) : [],
    createdAt: text(claim.created_at),
    updatedAt: text(claim.updated_at),
    deliveredAt: text(claim.delivery_dt),
    isArchive: Boolean(claim.isArchive),
  }));

  const summary = returns.reduce((result, row) => {
    result.total += 1;
    result[row.trackingStage] += 1;
    if (row.isStatusActive) result.active += 1;
    return result;
  }, { total: 0, active: 0, transit: 0, ready: 0, completed: 0, unknown: 0, activeClaims: activeClaims.length, archivedClaims: archivedClaims.length });
  if (activeClaimsResult.total > MAX_CLAIMS || archivedClaimsResult.total > MAX_CLAIMS) warnings.push(`退货申请超过 ${MAX_CLAIMS} 条，本次仅展示最近 ${MAX_CLAIMS} 条。`);

  return {
    source: "WB Analytics Goods Return + Buyers Returns API" as const,
    syncedAt: new Date().toISOString(),
    window,
    returns,
    claims,
    summary,
    dataAvailability: { logisticsReport: true, buyerClaims: claimsAvailable },
    warnings,
  };
}

async function loadReturns(token: string, window: { from: string; to: string; maxDays: number }, forceRefresh: boolean) {
  const cacheKey = `${SNAPSHOT_VERSION}:${window.from}:${window.to}`;
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
  const load = fetchReturnsSnapshot(token, window)
    .then(async (snapshot) => {
      memoryCache.set(cacheKey, { value: snapshot, expiresAt: syncSchedule().nextAt });
      await writeSnapshot(cacheKey, snapshot);
      return snapshot;
    })
    .catch((error) => {
      if (durable?.value) return { ...durable.value, warnings: [...durable.value.warnings, "WB 退货接口本次刷新失败，当前显示最近一次完整快照。"] };
      throw error;
    })
    .finally(() => pendingLoads.delete(cacheKey));
  pendingLoads.set(cacheKey, load);
  return load;
}

export async function GET(request: Request) {
  const token = process.env.WB_API_TOKEN?.trim();
  if (!token) return json({ error: "WB API 尚未配置" }, 503);
  const url = new URL(request.url);
  const window = requestWindow(url);
  const forceRefresh = url.searchParams.get("refresh") === "manual";
  try {
    const snapshot = await loadReturns(token, window, forceRefresh);
    const schedule = syncSchedule();
    return json({
      ...snapshot,
      syncSchedule: {
        timezone: "Asia/Shanghai",
        hours: AUTO_SYNC_HOURS,
        currentSlot: schedule.slot,
        nextAt: new Date(schedule.nextAt).toISOString(),
        mode: forceRefresh ? "manual" : "scheduled",
      },
    });
  } catch (error) {
    const status = number((error as WorkerError).status);
    if (status === 401 || status === 403) return json({ error: "WB 密钥缺少“分析”权限，无法读取退货物流报告" }, 403);
    if (status === 429) return json({ error: "WB 退货接口已限频，系统将使用缓存并在下个同步点重试" }, 429);
    return json({ error: "WB 退货数据暂时无法读取，请稍后重试" }, 502);
  }
}
