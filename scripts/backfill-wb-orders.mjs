const required = ["WB_API_TOKEN", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
for (const name of required) {
  if (!process.env[name]?.trim()) throw new Error(`Missing ${name}`);
}

const token = process.env.WB_API_TOKEN.trim();
const supabaseUrl = process.env.SUPABASE_URL.trim().replace(/\/$/, "");
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY.trim();
const historyStart = "2024-01-29";
const dayMs = 86_400_000;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function wbRequest(url, init = {}) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    if (response.ok) return response.json();
    if (response.status !== 429 || attempt === 4) {
      throw new Error(`WB request failed with status ${response.status}`);
    }
    const retryAfter = Number(response.headers.get("retry-after") || 1);
    await delay(Math.max(1_000, retryAfter * 1_000));
  }
}

function orderKey(order) {
  return String(order.id || order.orderUid || `${order.rid || ""}|${order.nmId || 0}|${order.createdAt || ""}`);
}

const ordersByKey = new Map();
let requestCount = 0;
const end = new Date();
end.setUTCHours(23, 59, 59, 999);

for (let chunkStart = Date.parse(`${historyStart}T00:00:00Z`); chunkStart <= end.getTime(); chunkStart += 30 * dayMs) {
  const chunkEnd = Math.min(chunkStart + 30 * dayMs - 1, end.getTime());
  let next = 0;
  for (let page = 0; page < 100; page += 1) {
    if (requestCount > 0) await delay(220);
    requestCount += 1;
    const params = new URLSearchParams({
      limit: "1000",
      next: String(next),
      dateFrom: String(Math.floor(chunkStart / 1000)),
      dateTo: String(Math.floor(chunkEnd / 1000)),
    });
    const response = await wbRequest(`https://marketplace-api.wildberries.ru/api/v3/orders?${params}`);
    const batch = response.orders || [];
    for (const order of batch) ordersByKey.set(orderKey(order), order);
    if (batch.length < 1000 || !response.next || response.next === next) break;
    next = response.next;
  }
}

const orders = [...ordersByKey.values()];
for (let offset = 0; offset < orders.length; offset += 1000) {
  if (requestCount > 0) await delay(220);
  requestCount += 1;
  const ids = orders.slice(offset, offset + 1000).map((order) => Number(order.id || 0)).filter(Boolean);
  if (!ids.length) continue;
  const response = await wbRequest("https://marketplace-api.wildberries.ru/api/v3/orders/status", {
    method: "POST",
    body: JSON.stringify({ orders: ids }),
  });
  const statusById = new Map((response.orders || []).map((status) => [String(status.id), status]));
  for (const order of orders.slice(offset, offset + 1000)) Object.assign(order, statusById.get(String(order.id)) || {});
}

const beijingNow = new Date(Date.now() + 8 * 60 * 60_000);
const dateKey = beijingNow.toISOString().slice(0, 10);
const hour = beijingNow.getUTCHours();
const scheduleHours = [8, 14, 19, 23];
const currentHour = [...scheduleHours].reverse().find((value) => hour >= value) ?? 23;
const slotDate = hour < 8
  ? new Date(Date.UTC(beijingNow.getUTCFullYear(), beijingNow.getUTCMonth(), beijingNow.getUTCDate() - 1)).toISOString().slice(0, 10)
  : dateKey;
const syncSlot = `${slotDate}-${String(currentHour).padStart(2, "0")}`;
const payload = JSON.stringify({ available: true, orders, completionObservations: {}, coverageStart: historyStart });

const response = await fetch(`${supabaseUrl}/rest/v1/wb_sync_snapshots?on_conflict=cache_key`, {
  method: "POST",
  headers: {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates,return=minimal",
  },
  body: JSON.stringify({
    cache_key: "fbs-orders-all-v3",
    payload,
    sync_slot: syncSlot,
    manual_bucket: 0,
    updated_at: new Date().toISOString(),
  }),
});

if (!response.ok) throw new Error(`Supabase write failed with status ${response.status}`);
process.stdout.write(`Backfilled ${orders.length} unique primary-store orders across ${requestCount} WB requests.\n`);
