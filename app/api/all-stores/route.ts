import { env } from "cloudflare:workers";
import { GET as readProductCosts } from "../product-costs/route";
import { loadFbsOrders } from "../wb/dashboard/route";
import { allEnabledWbStores, resolveWbStore } from "../../_lib/server-storefront";
import { STOREFRONT_COOKIE_KEY } from "../../_lib/storefronts";
import { loadReturnsReport, type ItemReturnsPage, type GoodsReturnRow } from "../../_lib/returns-report";
import { acquireSyncLock, releaseSyncLock, persistenceBackend, readSyncSnapshot, writeSyncSnapshot } from "../../_lib/server-persistence";
import { withSyncDeadline } from "../../_lib/sync-deadline";
import { DEFAULT_GROUP_SETTINGS, buildAllStoresReport, dayInZone, reportDays, type GroupSettings, type GroupStoreData } from "../../_lib/all-stores-report";
import { loadSupplyList, supplyOrderIds } from "../../_lib/supply-report";

const SETTINGS_KEY = "all-stores-settings:v1";
const STATEMENT_INDEX_PREFIX = "all-stores-statement-summary:v1:";
const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: HEADERS }); }
const pending = new Map<string, Promise<GroupStoreData>>();
async function recentStatements() {
  if (!env.AUTH_KV) return [];
  let cursor: string | undefined;
  const names: string[] = [];
  do {
    const page = await env.AUTH_KV.list({ prefix: STATEMENT_INDEX_PREFIX, limit: 1000, cursor });
    names.push(...page.keys.map((key: { name: string }) => key.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  const records = await Promise.all(names.sort().slice(-30).reverse().map((name) => env.AUTH_KV!.get(name, "json")));
  return records.filter(Boolean);
}
async function settings() {
  const record = await readSyncSnapshot(SETTINGS_KEY);
  return record ? JSON.parse(record.payload) as GroupSettings : { ...DEFAULT_GROUP_SETTINGS };
}
function storeRequest(request: Request, id: string) {
  const headers = new Headers(request.headers);
  // Use the requested registry ID explicitly, never the currently selected store.
  headers.set("cookie", `${STOREFRONT_COOKIE_KEY}=${encodeURIComponent(id)}`);
  return new Request(request.url, { headers });
}
function returnsId(row: GoodsReturnRow) {
  if (row.shkId || row.stickerId) return `${row.shkId || ""}:${row.stickerId || ""}`;
  return row.srid ? `${row.srid}:${row.nmId || ""}:${row.orderDt || ""}` : "";
}
function sourceError(error: unknown) {
  const status = (error as { status?: number })?.status;
  if (status === 429) return "WB 限流，请稍后重试";
  if (status === 401 || status === 403) return "API 过期或缺少接口权限，请检查店铺 API";
  return "接口未完成读取，请稍后同步重试";
}
async function readStore(request: Request, storeId: string, force: boolean, from: string, to: string): Promise<GroupStoreData> {
  const registry = await allEnabledWbStores(env);
  const metadata = registry.find((store) => store.id === storeId);
  if (!metadata) throw new Error("店铺不存在或已停用");
  const cacheKey = `all-stores-source:v2:${storeId}`;
  const record = await readSyncSnapshot(cacheKey);
  const previous = record ? JSON.parse(record.payload) as GroupStoreData : null;
  const age = record ? Date.now() - Date.parse(record.updatedAt) : Infinity;
  if (previous && previous.supplyWindow.from <= from && previous.supplyWindow.to >= to && age < (force ? 45_000 : 300_000) && previous.ordersState === "fresh" && previous.returnsState === "fresh" && previous.suppliesState === "fresh" && previous.catalogState === "fresh") return { ...previous, storeName: metadata.name };
  const scopedRequest = storeRequest(request, storeId);
  const store = await resolveWbStore(scopedRequest, env);
  const result: GroupStoreData = { storeId, storeName: metadata.name, orders: previous?.orders || [], returns: previous?.returns || [], products: previous?.products || [], ordersAt: previous?.ordersAt || null, returnsAt: previous?.returnsAt || null, coverageStart: previous?.coverageStart || null, ordersState: previous ? "cached" : "error", returnsState: previous ? "cached" : "error", catalogState: "error", warnings: [], supplies: previous?.supplies || [], suppliesState: previous ? "cached" : "error", suppliesAt: previous?.suppliesAt || null, supplyWindow: previous?.supplyWindow || { from, to } };
  if (!store.token) {
    result.warnings.push("未配置有效 API，请在系统设置中添加或更换");
    return result;
  }
  const diagnostics = { fresh: new Set<string>(), stale: new Set<string>() };
  await Promise.all([
    (async () => {
      const controller = new AbortController();
      try {
        let lastRequest = 0;
        async function supplyRequest(path: string): Promise<unknown> {
          const delay = 230 - (Date.now() - lastRequest);
          if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
          lastRequest = Date.now();
          const response = await fetch(`https://marketplace-api.wildberries.ru${path}`, { headers: { Authorization: `Bearer ${store.token}`, Accept: "application/json" }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
          if (!response.ok) throw Object.assign(new Error("SUPPLY_ERROR"), { status: response.status });
          return response.json();
        }
        await withSyncDeadline((async () => {
          const supplies = await loadSupplyList(supplyRequest);
          const retained = new Map(result.supplies.map((supply) => [supply.id, supply]));
          const completeList = new Map(result.supplies.filter((supply) => supply.done).map((supply) => [supply.id, supply]));
          for (const supply of supplies) completeList.set(supply.id, { ...supply, orderIds: retained.get(supply.id)?.orderIds || [], loaded: retained.get(supply.id)?.loaded || false });
          result.supplies = [...completeList.values()];
          for (const supply of result.supplies) {
            controller.signal.throwIfAborted();
            const day = dayInZone(supply.createdAt, "Asia/Shanghai");
            if (day < from || day > to) continue;
            const key = `all-stores-supply:v1:${storeId}:${supply.id}`;
            const cached = await readSyncSnapshot(key);
            if (cached && Date.now() - Date.parse(cached.updatedAt) < (force ? 45_000 : 300_000)) supply.orderIds = supplyOrderIds(JSON.parse(cached.payload));
            else {
              supply.orderIds = supplyOrderIds(await supplyRequest(`/api/marketplace/v3/supplies/${encodeURIComponent(supply.id)}/order-ids`));
              // Store each success separately. Long custom periods can resume
              // from these rows after a bounded request, without losing work.
              if (persistenceBackend() !== "none") await writeSyncSnapshot(key, JSON.stringify({ orderIds: supply.orderIds.map(Number) }), new Date().toISOString());
            }
            supply.loaded = true;
          }
          result.supplyWindow = { from, to };
          result.suppliesAt = new Date().toISOString();
          result.suppliesState = "fresh";
        })(), 50_000, "供货单明细");
      } catch (error) { controller.abort(); result.warnings.push(`供货单：${sourceError(error)}`); }
    })(),
    (async () => {
      try {
        const snapshot = await withSyncDeadline(loadFbsOrders(store.token, storeId, true, diagnostics), 50_000, "全部店铺订单");
        if (!snapshot.available) throw new Error("ORDER_UNAVAILABLE");
        result.orders = snapshot.orders.map((row) => ({ id: row.id ? String(row.id) : row.orderUid || row.rid || "", createdAt: row.createdAt || "", sellerSku: row.article || "", nmId: Number(row.nmId || 0), supplierStatus: row.supplierStatus || "", wbStatus: row.wbStatus || "", rid: row.rid || row.orderUid || "" }));
        result.coverageStart = snapshot.coverageStart || null;
        result.ordersAt = snapshot.fetchedAt || previous?.ordersAt || null;
        result.ordersState = diagnostics.stale.size || !result.ordersAt || Date.now() - Date.parse(result.ordersAt) > 300_000 ? "cached" : "fresh";
      } catch (error) { result.warnings.push(`订单：${sourceError(error)}`); }
    })(),
    (async () => {
      try {
        // Fetch the full return-request window, then filter by completedDt in
        // the report. A weekly dateFrom here would miss older orders picked up
        // this week. Retain previously collected rows if WB expires history.
        const rows = await withSyncDeadline(loadReturnsReport({ from: "2024-01-01", to: new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10) }, async (url) => {
          const response = await fetch(url, { headers: { Authorization: `Bearer ${store.token}`, Accept: "application/json" }, signal: AbortSignal.timeout(25_000) });
          if (!response.ok) throw Object.assign(new Error("WB_RETURNS_ERROR"), { status: response.status });
          return response.status === 204 ? null : await response.json() as ItemReturnsPage;
        }), 50_000, "全部店铺退货");
        const retained = new Map((previous?.returns || []).filter((row) => row.completedAt).map((row) => [row.id, row]));
        for (const row of rows) {
          const id = returnsId(row);
          if (!id) result.warnings.push("有退货缺少唯一标识，未计入");
          else retained.set(id, { id, orderId: row.orderId ? String(row.orderId) : "", srid: row.srid || "", nmId: Number(row.nmId || 0), completedAt: row.completedDt || retained.get(id)?.completedAt || "", requestedAt: row.orderDt || "", status: row.status || "", reason: row.reason || "", barcode: row.barcode || "", active: row.isStatusActive === 1 });
        }
        result.returns = [...retained.values()];
        result.returnsAt = new Date().toISOString();
        result.returnsState = "fresh";
      } catch (error) { result.warnings.push(`退货：${sourceError(error)}`); }
    })(),
    (async () => {
      try {
        const response = await withSyncDeadline(readProductCosts(scopedRequest), 20_000, "全部店铺产品资料");
        if (!response.ok) throw new Error("CATALOG_UNAVAILABLE");
        const body = await response.json() as { rows: Array<{ sellerSku: string; internalSku: string; specification: string; nmId: number | null }> };
        if (!Array.isArray(body.rows)) throw new Error("CATALOG_INVALID");
        result.products = body.rows.map((row) => ({ sellerSku: row.sellerSku, internalSku: row.internalSku, specification: row.specification, nmId: row.nmId }));
        result.catalogState = "fresh";
      } catch { result.warnings.push("产品详情未能读取，SKU 对应需要核对"); }
    })(),
  ]);
  // A failed refresh cannot advance either source's successful sync timestamp.
  if (persistenceBackend() !== "none") await writeSyncSnapshot(cacheKey, JSON.stringify(result), new Date().toISOString());
  return result;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const statementId = url.searchParams.get("statement");
    if (statementId) {
      if (!/^[0-9a-f-]{36}$/.test(statementId)) return json({ error: "结算快照编号无效" }, 400);
      const record = await readSyncSnapshot(`all-stores-statement:v2:${statementId}`);
      return record ? json(JSON.parse(record.payload)) : json({ error: "结算快照不存在" }, 404);
    }
    const id = url.searchParams.get("storeId");
    if (id) {
      const from = url.searchParams.get("from") || dayInZone(Date.now(), "Asia/Shanghai");
      const to = url.searchParams.get("to") || from;
      reportDays(from, to);
      const key = `${id}:${from}:${to}`;
      const operation = pending.get(key) || readStore(request, id, url.searchParams.get("refresh") === "manual", from, to);
      pending.set(key, operation);
      try { return json(await operation); } finally { if (pending.get(key) === operation) pending.delete(key); }
    }
    const [stores, config, statements] = await Promise.all([allEnabledWbStores(env), settings(), recentStatements()]);
    return json({ stores: stores.map(({ id, name }) => ({ id, name })), settings: config, statements });
  } catch { return json({ error: "全部店铺数据未能读取，请稍后重试" }, 503); }
}

function validateSettings(value: GroupSettings) {
  if (value.zone !== "Asia/Shanghai" || value.basis !== "supply") throw new Error("统计口径无效");
  if (!value.mappings || typeof value.mappings !== "object" || Array.isArray(value.mappings)) throw new Error("SKU 设置无效");
  if (Object.keys(value.mappings).length > 10_000) throw new Error("设置数量超过限制");
  for (const [key, sku] of Object.entries(value.mappings)) if (key.length > 300 || typeof sku !== "string" || !sku.trim() || sku.length > 100 || [...sku].some((character) => character.charCodeAt(0) < 32)) throw new Error("汇总 SKU 不能为空或包含换行");
}
export async function PUT(request: Request) {
  let locked = false;
  try {
    if (persistenceBackend() === "none") return json({ error: "资料存储尚未配置，未保存" }, 503);
    const body = await request.json() as GroupSettings;
    validateSettings(body);
    locked = await acquireSyncLock(`${SETTINGS_KEY}:lock`, 30_000);
    if (!locked) return json({ error: "另一页面正在保存，请稍后重试" }, 409);
    const current = await settings();
    if (body.version !== current.version) return json({ error: "设置已在另一页面修改，请刷新后再保存" }, 409);
    const next: GroupSettings = { version: crypto.randomUUID(), zone: body.zone, basis: body.basis, mappings: body.mappings };
    await writeSyncSnapshot(SETTINGS_KEY, JSON.stringify(next), new Date().toISOString());
    return json({ settings: next });
  } catch { return json({ error: "保存失败，请核对 SKU 后重试" }, 400); }
  finally { if (locked) await releaseSyncLock(`${SETTINGS_KEY}:lock`); }
}

// Preserve a server-calculated, immutable copy of the quantities used
// for a supplier reconciliation. Future cancellation/status changes cannot
// silently rewrite this period's saved statement.
export async function POST(request: Request) {
  try {
    if (persistenceBackend() === "none") return json({ error: "尚未配置存储，无法保存结算快照" }, 503);
    const body = await request.json() as { from: string; to: string; version: string; sourceTimes: Record<string, string> };
    reportDays(body.from, body.to);
    const config = await settings();
    if (config.version !== body.version) return json({ error: "请先保存 SKU 设置，再保存数量快照" }, 409);
    const registry = await allEnabledWbStores(env);
    const records = await Promise.all(registry.map((store) => readSyncSnapshot(`all-stores-source:v2:${store.id}`)));
    if (records.some((record) => !record)) return json({ error: "还有店铺尚未完成同步，不能保存完整结算快照" }, 409);
    const sources = records.map((record, index) => ({ ...JSON.parse(record!.payload) as GroupStoreData, storeName: registry[index].name }));
    if (sources.some((source) => !source.ordersAt || !source.returnsAt || !source.suppliesAt || [source.ordersAt, source.returnsAt, source.suppliesAt].some((at) => Date.now() - Date.parse(at) > 300_000) || body.sourceTimes[source.storeId] !== `${source.ordersAt}|${source.returnsAt}|${source.suppliesAt}`)) return json({ error: "数据已更新或超过 5 分钟，请同步核对后再保存" }, 409);
    const report = buildAllStoresReport(sources, body.from, body.to, config);
    if (!report.complete || report.sources.some((source) => !source.automatic && report.events.some((event) => !event.excluded && event.sourceKey === source.key))) return json({ error: "仍有同步或 SKU 对应待核对，不能保存完整结算快照" }, 409);
    const id = crypto.randomUUID();
    const savedAt = new Date().toISOString();
    await writeSyncSnapshot(`all-stores-statement:v2:${id}`, JSON.stringify({ id, savedAt, report, settings: config, sourceTimes: body.sourceTimes }), savedAt);
    if (env.AUTH_KV) await env.AUTH_KV.put(`${STATEMENT_INDEX_PREFIX}${savedAt}:${id}`, JSON.stringify({ id, savedAt, from: body.from, to: body.to, orders: report.totals.reduce((sum, row) => sum + row.orders, 0), returns: report.totals.reduce((sum, row) => sum + row.returns, 0) })).catch(() => console.warn("ALL_STORES_STATEMENT_INDEX_FAILED"));
    return json({ id, savedAt });
  } catch { return json({ error: "结算快照保存失败，未确认成功前请重试" }, 503); }
}
