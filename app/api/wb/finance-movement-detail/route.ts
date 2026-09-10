import { env } from "cloudflare:workers";
import { matchPromotionCosts, promotionCostRowKey, type PromotionCostInput } from "../../../_lib/promotion-cost-trace";
import { readSyncSnapshot, writeSyncSnapshot } from "../../../_lib/server-persistence";
import { resolveWbStore, scopedStoreKey } from "../../../_lib/server-storefront";

type PromotionCostSnapshot = {
  source: "WB Promotion API /adv/v1/upd";
  from: string;
  to: string;
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

function shiftDate(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
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
    const row = await readSyncSnapshot(cacheKey);
    return row?.payload ? JSON.parse(row.payload) as PromotionCostSnapshot : null;
  } catch {
    return null;
  }
}

async function writeSnapshot(cacheKey: string, value: PromotionCostSnapshot) {
  try {
    await writeSyncSnapshot(cacheKey, JSON.stringify(value), `${value.from}:${value.to}`);
  } catch {
    // The live response remains valid if durable caching is temporarily unavailable.
  }
}

function snapshotFresh(snapshot: PromotionCostSnapshot) {
  const age = Date.now() - new Date(snapshot.fetchedAt).getTime();
  const ttl = snapshot.to === dateKey() ? MEMORY_TTL_MS : HISTORICAL_TTL_MS;
  return Number.isFinite(age) && age >= 0 && age < ttl;
}

async function loadPromotionCosts(token: string, storeId: string, from: string, to: string) {
  const cacheKey = scopedStoreKey(storeId, `finance-promotion-costs-v2:${from}:${to}`);
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
    url.searchParams.set("from", from);
    url.searchParams.set("to", to);
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
        from,
        to,
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
  const { token, id: storeId } = await resolveWbStore(request, env);
  if (!token) return json({ error: "当前店铺尚未配置 WB API" }, 503);
  const url = new URL(request.url);
  const date = validDate(url.searchParams.get("date"));
  const targetAmount = finiteAmount(url.searchParams.get("amount"));
  if (!date || targetAmount === null) return json({ error: "财务日期或扣款金额无效" }, 400);

  try {
    // WB promotion costs can be consolidated into one finance deduction several days later.
    // /adv/v1/upd accepts at most 31 days, so inspect the full supported settlement window.
    const queriedFrom = shiftDate(date, -30);
    const snapshot = await loadPromotionCosts(token, storeId, queriedFrom, date);
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
    const candidateRows = entries.filter((entry) => entry.candidate);
    const candidateTotal = Math.round(candidateRows.reduce((sum, entry) => sum + entry.amount, 0) * 100) / 100;
    const otherRows = entries.filter((entry) => !entry.candidate);
    const candidateCampaigns = new Set(candidateRows.map((entry) => entry.campaignId).filter(Boolean));
    return json({
      available: true,
      source: snapshot.source,
      fetchedAt: snapshot.fetchedAt,
      date,
      queriedFrom: snapshot.from,
      queriedTo: snapshot.to,
      targetAmount,
      match: {
        level: match.level,
        reason: match.reason,
        candidateCount: match.candidateKeys.length,
        candidateTotal,
        candidateCampaignCount: candidateCampaigns.size,
        matchedDocumentNumber: match.matchedDocumentNumber,
        periodTotal: match.periodTotalCents / 100,
        otherCount: otherRows.length,
        otherTotal: Math.round(otherRows.reduce((sum, entry) => sum + entry.amount, 0) * 100) / 100,
        confidence: match.level === "document_total" ? "high" : match.level === "single_amount" || match.level === "period_total" ? "medium" : "none",
        officiallyLinked: false,
      },
      entries,
      limitation: "WB 财务报告与推广费用接口没有返回共同关联键；系统查询结算日前 31 天的官方推广费用，按 UPD 单据归组并核对总额。合计完全一致属于高可信账务匹配，但不冒充 WB 官方直接关联。",
    });
  } catch (error) {
    const status = Number((error as { status?: number }).status || 0);
    return json({
      available: false,
      source: "WB Promotion API /adv/v1/upd",
      date,
      queriedFrom: shiftDate(date, -30),
      queriedTo: date,
      targetAmount,
      entries: [],
      error: status === 401 || status === 403 ? "当前 API 密钥没有推广费用读取权限" : status === 429 ? "WB 推广费用接口限频，请稍后重试" : "WB 推广费用明细暂时无法读取",
      limitation: "财务报告本身仍可核对；推广活动归属在官方推广费用接口恢复前不会推测。",
    });
  }
}
