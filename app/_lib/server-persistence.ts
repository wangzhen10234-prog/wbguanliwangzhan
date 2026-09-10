import { env } from "cloudflare:workers";

type RuntimeEnv = {
  DB?: D1Database;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

export type SyncSnapshotRecord = {
  payload: string;
  syncSlot: string;
  manualBucket: number;
  updatedAt: string;
};

type WriteSnapshotOptions = {
  preserveManualBucket?: boolean;
};

function runtimeEnv() {
  return env as unknown as RuntimeEnv;
}

function supabaseConfig() {
  const runtime = runtimeEnv();
  const url = String(runtime.SUPABASE_URL || "").trim().replace(/\/$/, "");
  const serviceRoleKey = String(runtime.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  return url && serviceRoleKey ? { url, serviceRoleKey } : null;
}

export async function supabaseRestRequest(path: string, init?: RequestInit) {
  const config = supabaseConfig();
  if (!config) throw new Error("SUPABASE_NOT_CONFIGURED");
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    signal: init?.signal || AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`SUPABASE_${response.status}:${detail.slice(0, 240)}`);
  }
  return response;
}

function quoteFilter(value: string) {
  return `eq.${encodeURIComponent(value)}`;
}

export function persistenceBackend() {
  if (supabaseConfig()) return "supabase" as const;
  if (runtimeEnv().DB) return "d1" as const;
  return "none" as const;
}

export async function readSyncSnapshot(cacheKey: string): Promise<SyncSnapshotRecord | null> {
  const backend = persistenceBackend();
  if (backend === "supabase") {
    const response = await supabaseRestRequest(
      `wb_sync_snapshots?select=payload,sync_slot,manual_bucket,updated_at&cache_key=${quoteFilter(cacheKey)}&limit=1`,
    );
    const [row] = await response.json() as Array<{
      payload?: string;
      sync_slot?: string;
      manual_bucket?: number;
      updated_at?: string;
    }>;
    if (!row?.payload) return null;
    return {
      payload: row.payload,
      syncSlot: row.sync_slot || "",
      manualBucket: Number(row.manual_bucket || 0),
      updatedAt: row.updated_at || "",
    };
  }

  const database = runtimeEnv().DB;
  if (!database) return null;
  const row = await database.prepare(
    "SELECT payload, sync_slot AS syncSlot, manual_bucket AS manualBucket, updated_at AS updatedAt FROM wb_sync_snapshots WHERE cache_key = ?",
  ).bind(cacheKey).first<{ payload?: string; syncSlot?: string; manualBucket?: number; updatedAt?: string }>();
  if (!row?.payload) return null;
  return {
    payload: row.payload,
    syncSlot: row.syncSlot || "",
    manualBucket: Number(row.manualBucket || 0),
    updatedAt: row.updatedAt || "",
  };
}

export async function writeSyncSnapshot(
  cacheKey: string,
  payload: string,
  syncSlot: string,
  manualBucket = 0,
  options: WriteSnapshotOptions = {},
) {
  const backend = persistenceBackend();
  if (backend === "supabase") {
    let resolvedManualBucket = manualBucket;
    if (options.preserveManualBucket && manualBucket <= 0) {
      resolvedManualBucket = (await readSyncSnapshot(cacheKey))?.manualBucket || 0;
    }
    await supabaseRestRequest("wb_sync_snapshots?on_conflict=cache_key", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        cache_key: cacheKey,
        payload,
        sync_slot: syncSlot,
        manual_bucket: resolvedManualBucket,
        updated_at: new Date().toISOString(),
      }),
    });
    return;
  }

  const database = runtimeEnv().DB;
  if (!database) return;
  const manualUpdate = options.preserveManualBucket
    ? "CASE WHEN excluded.manual_bucket > 0 THEN excluded.manual_bucket ELSE wb_sync_snapshots.manual_bucket END"
    : "excluded.manual_bucket";
  await database.prepare(`
    INSERT INTO wb_sync_snapshots (cache_key, payload, sync_slot, manual_bucket, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(cache_key) DO UPDATE SET
      payload = excluded.payload,
      sync_slot = excluded.sync_slot,
      manual_bucket = ${manualUpdate},
      updated_at = CURRENT_TIMESTAMP
  `).bind(cacheKey, payload, syncSlot, manualBucket).run();
}

export async function acquireSyncLock(cacheKey: string, ttlMs = 45_000) {
  const backend = persistenceBackend();
  const now = Date.now();
  if (backend === "supabase") {
    await supabaseRestRequest(
      `wb_sync_locks?cache_key=${quoteFilter(cacheKey)}&expires_at=lte.${now}`,
      { method: "DELETE" },
    );
    const response = await supabaseRestRequest("wb_sync_locks?on_conflict=cache_key", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify({ cache_key: cacheKey, expires_at: now + ttlMs }),
    });
    const rows = await response.json() as unknown[];
    return rows.length > 0;
  }

  const database = runtimeEnv().DB;
  if (!database) return true;
  await database.prepare("DELETE FROM wb_sync_locks WHERE cache_key = ? AND expires_at <= ?").bind(cacheKey, now).run();
  const result = await database.prepare("INSERT OR IGNORE INTO wb_sync_locks (cache_key, expires_at) VALUES (?, ?)")
    .bind(cacheKey, now + ttlMs)
    .run();
  return Number(result.meta.changes || 0) > 0;
}

export async function releaseSyncLock(cacheKey: string) {
  const backend = persistenceBackend();
  if (backend === "supabase") {
    await supabaseRestRequest(`wb_sync_locks?cache_key=${quoteFilter(cacheKey)}`, { method: "DELETE" });
    return;
  }
  const database = runtimeEnv().DB;
  if (database) await database.prepare("DELETE FROM wb_sync_locks WHERE cache_key = ?").bind(cacheKey).run();
}
