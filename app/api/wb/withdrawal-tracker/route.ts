import { env } from "cloudflare:workers";
import { acquireSyncLock, readSyncSnapshot, releaseSyncLock, writeSyncSnapshot } from "../../../_lib/server-persistence";
import { resolveWbStore, scopedStoreKey } from "../../../_lib/server-storefront";

type RuntimeEnvironment = {
  AUTH_KV?: KVNamespace;
  AUTH_SESSION_SECRET?: string;
  WB_API_TOKEN?: string;
  WB_API_TOKEN_CL?: string;
};

type RawBalance = {
  currency?: string;
  current?: number;
  for_withdraw?: number;
  fetchedAt?: string;
};

type BalanceSnapshot = {
  currency: string;
  current: number | null;
  forWithdraw: number | null;
  rawCurrent: number | null;
  rawForWithdraw: number | null;
  fetchedAt: string;
  source: "WB /api/v1/account/balance";
};

type WithdrawalRecord = {
  id: string;
  amount: number;
  currency: string;
  requestedAt: string;
  note: string;
  status: "tracking" | "arrived" | "cancelled";
  baselineCurrent: number | null;
  baselineForWithdraw: number | null;
  balanceChangeObservedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type WithdrawalState = {
  active: WithdrawalRecord | null;
  history: WithdrawalRecord[];
};

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};
const BALANCE_TTL_MS = 60_000;
const MAX_HISTORY = 12;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function normalizeCurrency(value: unknown) {
  const currency = String(value || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : "CNY";
}

function normalizeBalanceAmount(value: unknown, currency: string) {
  const amount = numberOrNull(value);
  if (amount === null) return null;
  return currency === "CNY" ? amount / 100 : amount;
}

function balanceFromRaw(raw: RawBalance): BalanceSnapshot {
  const currency = normalizeCurrency(raw.currency);
  return {
    currency,
    current: normalizeBalanceAmount(raw.current, currency),
    forWithdraw: normalizeBalanceAmount(raw.for_withdraw, currency),
    rawCurrent: numberOrNull(raw.current),
    rawForWithdraw: numberOrNull(raw.for_withdraw),
    fetchedAt: raw.fetchedAt || new Date().toISOString(),
    source: "WB /api/v1/account/balance",
  };
}

async function readJsonSnapshot<T>(key: string): Promise<T | null> {
  try {
    const row = await readSyncSnapshot(key);
    return row?.payload ? JSON.parse(row.payload) as T : null;
  } catch {
    return null;
  }
}

async function writeJsonSnapshot(key: string, value: unknown) {
  await writeSyncSnapshot(key, JSON.stringify(value), "withdrawal-monitor", 0, { preserveManualBucket: true });
}

function snapshotAge(value?: string | null) {
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(time) ? Date.now() - time : Number.POSITIVE_INFINITY;
}

async function fetchBalance(token: string, storeId: string): Promise<BalanceSnapshot> {
  const trackerKey = scopedStoreKey(storeId, "withdrawal-balance-realtime-v1");
  const dashboardKey = scopedStoreKey(storeId, "balance-v2");
  const [trackerCached, dashboardCached] = await Promise.all([
    readJsonSnapshot<BalanceSnapshot>(trackerKey),
    readJsonSnapshot<RawBalance>(dashboardKey),
  ]);
  if (trackerCached && snapshotAge(trackerCached.fetchedAt) < BALANCE_TTL_MS) return trackerCached;
  if (dashboardCached?.fetchedAt && snapshotAge(dashboardCached.fetchedAt) < BALANCE_TTL_MS) {
    const snapshot = balanceFromRaw(dashboardCached);
    await writeJsonSnapshot(trackerKey, snapshot).catch(() => undefined);
    return snapshot;
  }

  const lockKey = scopedStoreKey(storeId, "withdrawal-balance-realtime-lock-v1");
  const hasLock = await acquireSyncLock(lockKey, 45_000);
  if (!hasLock) {
    if (trackerCached) return trackerCached;
    if (dashboardCached) return balanceFromRaw(dashboardCached);
    throw new Error("BALANCE_REFRESH_IN_PROGRESS");
  }

  try {
    const response = await fetch("https://finance-api.wildberries.ru/api/v1/account/balance", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      const error = new Error(`WB_BALANCE_${response.status}`) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    const raw = { ...await response.json() as RawBalance, fetchedAt: new Date().toISOString() };
    const snapshot = balanceFromRaw(raw);
    // This monitor owns a one-minute snapshot. The dashboard snapshot has
    // separate freshness rules and is only written by the dashboard pipeline.
    await writeJsonSnapshot(trackerKey, snapshot);
    return snapshot;
  } catch (error) {
    if (trackerCached) return trackerCached;
    if (dashboardCached) return balanceFromRaw(dashboardCached);
    throw error;
  } finally {
    await releaseSyncLock(lockKey).catch(() => undefined);
  }
}

function defaultState(): WithdrawalState {
  return { active: null, history: [] };
}

async function readState(storeId: string) {
  return await readJsonSnapshot<WithdrawalState>(scopedStoreKey(storeId, "withdrawal-tracker-v1")) || defaultState();
}

async function writeState(storeId: string, value: WithdrawalState) {
  await writeJsonSnapshot(scopedStoreKey(storeId, "withdrawal-tracker-v1"), {
    active: value.active,
    history: value.history.slice(0, MAX_HISTORY),
  });
}

function closeToRequestedDrop(before: number | null, after: number | null, requested: number) {
  if (before === null || after === null || requested <= 0) return false;
  const drop = before - after;
  const tolerance = Math.max(1, requested * 0.03);
  return drop >= requested - tolerance && drop <= requested + tolerance;
}

async function responsePayload(storeId: string, token: string, state: WithdrawalState) {
  const balance = await fetchBalance(token, storeId);
  let active = state.active;
  const balanceChangeObserved = Boolean(active && (
    closeToRequestedDrop(active.baselineCurrent, balance.current, active.amount)
    || closeToRequestedDrop(active.baselineForWithdraw, balance.forWithdraw, active.amount)
  ));
  if (active && balanceChangeObserved && !active.balanceChangeObservedAt) {
    active = { ...active, balanceChangeObservedAt: balance.fetchedAt, updatedAt: new Date().toISOString() };
    state = { ...state, active };
    await writeState(storeId, state).catch(() => undefined);
  }
  return {
    storeId,
    balance,
    active,
    history: state.history,
    monitor: {
      intervalSeconds: 60,
      balanceChangeObserved: Boolean(active?.balanceChangeObservedAt || balanceChangeObserved),
      stage: !active
        ? "idle"
        : active.balanceChangeObservedAt || balanceChangeObserved
          ? "balance_change_observed"
          : "awaiting_wb_confirmation",
    },
    officialCapability: {
      statusApiAvailable: false,
      balanceApiAvailable: true,
      source: "WB /api/v1/account/balance",
      limitation: "WB 公开 API 仅返回账户余额与可提现余额，不返回提现申请单、付款处理中、银行打款或到账状态。付款状态需在 WB 卖家后台的余额付款历史中确认。",
    },
  };
}

export async function GET(request: Request) {
  const store = await resolveWbStore(request, env as unknown as RuntimeEnvironment);
  if (!store.token) return json({ error: "当前店铺的 WB API 尚未配置" }, 503);
  try {
    return json(await responsePayload(store.id, store.token, await readState(store.id)));
  } catch (error) {
    const status = Number((error as { status?: number }).status || 0);
    if (status === 401 || status === 403) return json({ error: "WB 密钥缺少财务权限，无法读取提现余额" }, 403);
    if (status === 429) return json({ error: "WB 余额接口每分钟仅允许一次请求，请稍后重试" }, 429);
    return json({ error: "提现监测暂时无法读取 WB 余额，请稍后重试" }, 502);
  }
}

export async function POST(request: Request) {
  const store = await resolveWbStore(request, env as unknown as RuntimeEnvironment);
  if (!store.token) return json({ error: "当前店铺的 WB API 尚未配置" }, 503);
  const body = await request.json().catch(() => null) as { amount?: unknown; requestedAt?: unknown; note?: unknown } | null;
  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) return json({ error: "请输入正确的提现金额" }, 400);
  const requestedTime = typeof body?.requestedAt === "string" ? new Date(body.requestedAt) : new Date();
  if (!Number.isFinite(requestedTime.getTime())) return json({ error: "提现申请时间无效" }, 400);

  try {
    const state = await readState(store.id);
    if (state.active) return json({ error: "当前已有一笔提现正在追踪，请先确认到账或结束追踪" }, 409);
    const balance = await fetchBalance(store.token, store.id);
    const now = new Date().toISOString();
    const active: WithdrawalRecord = {
      id: crypto.randomUUID(),
      amount: Number(amount.toFixed(2)),
      currency: balance.currency,
      requestedAt: requestedTime.toISOString(),
      note: String(body?.note || "").trim().slice(0, 200),
      status: "tracking",
      baselineCurrent: balance.current,
      baselineForWithdraw: balance.forWithdraw,
      balanceChangeObservedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const nextState = { ...state, active };
    await writeState(store.id, nextState);
    return json(await responsePayload(store.id, store.token, nextState), 201);
  } catch (error) {
    const status = Number((error as { status?: number }).status || 0);
    if (status === 401 || status === 403) return json({ error: "WB 密钥缺少财务权限，无法开始提现监测" }, 403);
    return json({ error: "暂时无法保存提现追踪，请稍后重试" }, 502);
  }
}

export async function PATCH(request: Request) {
  const store = await resolveWbStore(request, env as unknown as RuntimeEnvironment);
  if (!store.token) return json({ error: "当前店铺的 WB API 尚未配置" }, 503);
  const body = await request.json().catch(() => null) as { action?: unknown } | null;
  const action = String(body?.action || "");
  if (action !== "arrived" && action !== "cancel") return json({ error: "不支持的提现操作" }, 400);
  try {
    const state = await readState(store.id);
    if (!state.active) return json({ error: "当前没有正在追踪的提现" }, 404);
    const now = new Date().toISOString();
    const closed: WithdrawalRecord = {
      ...state.active,
      status: action === "arrived" ? "arrived" : "cancelled",
      completedAt: now,
      updatedAt: now,
    };
    const nextState = { active: null, history: [closed, ...state.history].slice(0, MAX_HISTORY) };
    await writeState(store.id, nextState);
    return json(await responsePayload(store.id, store.token, nextState));
  } catch {
    return json({ error: "暂时无法更新提现追踪，请稍后重试" }, 502);
  }
}
