import { env } from "cloudflare:workers";
import { inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { wbSyncSnapshots } from "../../../db/schema";
import { persistenceBackend, supabaseRestRequest, writeSyncSnapshot } from "../../_lib/server-persistence";
import { requestedStorefront } from "../../_lib/server-storefront";

const headers = { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8" };
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers });
}
function validId(value: unknown): value is string {
  return typeof value === "string" && /^[\w.-]{1,160}$/.test(value);
}
function noteKey(storeId: string, orderId: string) {
  return `order-note:v1:${storeId}:${orderId}`;
}

export async function GET(request: Request) {
  try {
    const ids = [...new Set(new URL(request.url).searchParams.get("ids")?.split(",").filter(Boolean) ?? [])];
    if (ids.length > 100 || !ids.every(validId)) return json({ error: "订单编号无效" }, 400);
    if (!ids.length) return json({ notes: {} });
    if (persistenceBackend() === "none") throw new Error("PERSISTENCE_UNAVAILABLE");
    const store = await requestedStorefront(request, env);
    const keys = ids.map((id) => noteKey(store.id, id));
    let rows: Array<{ payload: string }>;
    if (persistenceBackend() === "supabase") {
      const filter = encodeURIComponent(`(${keys.map((key) => `"${key}"`).join(",")})`);
      const response = await supabaseRestRequest(`wb_sync_snapshots?select=payload&cache_key=in.${filter}&limit=100`);
      rows = await response.json() as Array<{ payload: string }>;
    } else {
      rows = await getDb().select({ payload: wbSyncSnapshots.payload }).from(wbSyncSnapshots).where(inArray(wbSyncSnapshots.cacheKey, keys));
    }
    const notes: Record<string, string> = {};
    for (const row of rows) {
      const note = JSON.parse(row.payload) as { orderId: string; text: string };
      if (ids.includes(note.orderId) && typeof note.text === "string") notes[note.orderId] = note.text;
    }
    return json({ notes });
  } catch {
    return json({ error: "订单备注读取失败，请重试" }, 503);
  }
}

export async function PUT(request: Request) {
  if (request.headers.get("Origin") !== new URL(request.url).origin) return json({ error: "请求来源无效" }, 403);
  try {
    const body = await request.json() as { orderId?: unknown; text?: unknown };
    if (!validId(body.orderId) || typeof body.text !== "string" || body.text.length > 2000) return json({ error: "备注最多2000字，请检查订单编号和内容" }, 400);
    if (persistenceBackend() === "none") throw new Error("PERSISTENCE_UNAVAILABLE");
    const store = await requestedStorefront(request, env);
    const text = body.text.trim();
    await writeSyncSnapshot(noteKey(store.id, body.orderId), JSON.stringify({ orderId: body.orderId, text }), "order-note-v1");
    return json({ orderId: body.orderId, text });
  } catch {
    return json({ error: "备注保存失败，内容已保留，请重试" }, 503);
  }
}
