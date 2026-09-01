import { env } from "cloudflare:workers";
import { matchPromotionCosts, promotionCostRowKey, type PromotionCostInput } from "../../../_lib/promotion-cost-trace";
import { resolveWbStore, scopedStoreKey } from "../../../_lib/server-storefront";

type PromotionCostSnapshot = {
  source: "WB Promotion API /adv/v1/upd";
  date: string;
  fetchedAt: string;
  rows: PromotionCostInput[];
};

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};
const BEIJING_OFFSET_MS = 8 * 60 * 60_000;
const MEMORY_TTL_MS = 10 * 60_000;
const HISTORICAL_TTL_MS = 24 * 60 * 60_000;
const memoryCache = new Map<string, { value: PromotionCostSnapshot; expiresAt: number }>();
const pendingLoads = new Map<string, Promise<PromotionCostSnapshot>>();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function dateKey(value = Date.now()) {
  return new Date(value + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

function validDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  return Number.isFinite(new Date(`${value}T12:00:00+08:00`).getTime()) ? value : "";
}

function finiteAmount(value: string | null) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 && amount <= 1_000_000_000 ? amount : null;
}

function normalizeRow(row: PromotionCostInput): PromotionCostInput {
  return {
    updNum: Math.trunc(Number(row.updNum || 0)),
    updTime: typeof row.updTime === "string" && row.updTime ? row.updTime : null,
    updSum: Number.isFinite(Number(row.updSum)) ? Number(row.updSum) : 0,
    advertId: Math.trunc(Number(row.advertId || 0)),
    campName: typeof row.campName === "string" ? row.campName.trim() : "",
    advertType: Math.trunc(Number(row.advertType || 0)),
    paymentType: typeof row.paymentType === "string" ? row.paymentType.trim() : "",
    advertStatus: Math.trunc(Number(row.advertStatus || 0)),
  };
}

async function readSnapshot(cacheKey: string) {
  try {
    const row = await env.DB.prepare("SELECT payload FROM wb_sync_snapshots WHERE cache_key = ?")
      .bind(cacheKey)
      .first<{ payload?: string }>();
    return row?.payload ? JSON.parse(row.payload) as PromotionCostSnapshot : null;
  } catch {
    return null;
  }
}

async function writeSnapshot(cacheKey: string, value: PromotionCostSnapshot) {
  try {
    await env.DB.prepare(`
      INSERT INTO wb_sync_snapshots (cache_key, payload, sync_slot, manual_bucket, updated_at)
      VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP)
      ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, sync_slot = excluded.sync_slot, updated_at = CURRENT_TIMESTAMP
    `).bind(cacheKey, JSON.stringify(value), value.date).run();
  } catch {
    // The live response remains valid if durable caching is temporarily unavailable.
  }
}

function snapshotFresh(snapshot: PromotionCostSnapshot) {
  const age = Date.now() - new Date(snapshot.fetchedAt).getTime();
  const ttl = snapshot.date === dateKey() ? MEMORY_TTL_MS : HISTORICAL_TTL_MS;
  return Number.isFinite(age) && age >= 0 && age < ttl;
}

async function loadPromotionCosts(token: string, storeId: string, date: string) {
  const cacheKey = scopedStoreKey(storeId, `finance-promotion-costs-v1:${date}`);
  const memory = memoryCache.get(cacheKey);
  if (memory && memory.expiresAt > Date.now()) return memory.value;
  const durable = await readSnapshot(cacheKey);
  if (durable && snapshotFresh(durable)) {
    memoryCache.set(cacheKey, { value: durable, expiresAt: Date.now() + MEMORY_TTL_MS });
    return durable;
  }
  const pending = pendingLoads.get(cacheKey);
  if (pending) return pending;

  const load = (async () => {
    const url = new URL("https://advert-api.wildberries.ru/adv/v1/upd");
    url.searchParams.set("from", date);
    url.searchParams.set("to", date);
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(25_000),
      });
      if (!response.ok) {
        if (durable) return durable;
        const error = new Error(`WB promotion cost request failed: ${response.status}`);
        Object.assign(error, { status: response.status });
        throw error;
      }
      const sourceRows = await response.json() as PromotionCostInput[];
      const snapshot: PromotionCostSnapshot = {
        source: "WB Promotion API /adv/v1/upd",
        date,
        fetchedAt: new Date().toISOString(),
        rows: (Array.isArray(sourceRows) ? sourceRows : []).map(normalizeRow),
      };
      memoryCache.set(cacheKey, { value: snapshot, expiresAt: Date.now() + MEMORY_TTL_MS });
      await writeSnapshot(cacheKey, snapshot);
      return snapshot;
    } finally {
      pendingLoads.delete(cacheKey);
    }
  })();
  pendingLoads.set(cacheKey, load);
  return load;
}

function statusLabel(status: number) {
  return ({ "4": "待启动", "7": "已结束", "8": "已驳回", "9": "投放中", "11": "已暂停" } as Record<string, string>)[String(status)] || (status ? `状态 ${status}` : "状态未返回");
}

export async function GET(request: Request) {
  const { token, id: storeId } = resolveWbStore(request);
  if (!token) return json({ error: "当前店铺尚未配置 WB API" }, 503);
  const url = new URL(request.url);
  const date = validDate(url.searchParams.get("date"));
  const targetAmount = finiteAmount(url.searchParams.get("amount"));
  if (!date || targetAmount === null) return json({ error: "财务日期或扣款金额无效" }, 400);

  try {
    const snapshot = await loadPromotionCosts(token, storeId, date);
    const match = matchPromotionCosts(snapshot.rows, targetAmount);
    const candidateKeys = new Set(match.candidateKeys);
    const entries = snapshot.rows.map((row, index) => ({
      key: promotionCostRowKey(row, index),
      documentNumber: Number(row.updNum || 0),
      chargedAt: row.updTime || null,
      amount: Number(row.updSum || 0),
      campaignId: Number(row.advertId || 0),
      campaignName: row.campName || "未命名推广活动",
      campaignType: Number(row.advertType || 0),
      paymentType: row.paymentType || "WB 未返回支付类型",
      campaignStatus: Number(row.advertStatus || 0),
      campaignStatusLabel: statusLabel(Number(row.advertStatus || 0)),
      candidate: candidateKeys.has(promotionCostRowKey(row, index)),
    })).sort((left, right) => Number(right.candidate) - Number(left.candidate) || String(right.chargedAt || "").localeCompare(String(left.chargedAt || "")));
    return json({
      available: true,
      source: snapshot.source,
      fetchedAt: snapshot.fetchedAt,
      date,
      targetAmount,
      match: {
        level: match.level,
        reason: match.reason,
        candidateCount: match.candidateKeys.length,
        dayTotal: match.dayTotalCents / 100,
        officiallyLinked: false,
      },
      entries,
      limitation: "WB 财务报告与推广费用接口没有返回共同关联键；候选记录仅按官方日期、金额和推广单据合计核对，不能冒充 WB 官方唯一归属。",
    });
  } catch (error) {
    const status = Number((error as { status?: number }).status || 0);
    return json({
      available: false,
      source: "WB Promotion API /adv/v1/upd",
      date,
      targetAmount,
      entries: [],
      error: status === 401 || status === 403 ? "当前 API 密钥没有推广费用读取权限" : status === 429 ? "WB 推广费用接口限频，请稍后重试" : "WB 推广费用明细暂时无法读取",
      limitation: "财务报告本身仍可核对；推广活动归属在官方推广费用接口恢复前不会推测。",
    });
  }
}
