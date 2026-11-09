// Shared by the screen, CSV export and saved quantity statements. Dates never
// depend on the browser/Worker's local timezone. No retail sales or money mixed in.
export type ReportZone = "Europe/Moscow" | "Asia/Shanghai";
export type CountBasis = "supply";
export type GroupProduct = { sellerSku: string; internalSku: string; specification: string; nmId: number | null };
export type GroupOrder = { id: string; createdAt: string; sellerSku: string; nmId: number; supplierStatus: string; wbStatus: string; rid: string };
export type GroupReturn = { id: string; orderId: string; srid: string; nmId: number; completedAt: string; requestedAt: string; status: string; reason: string; barcode: string; active: boolean };
export type SourceState = "fresh" | "cached" | "error";
export type GroupSupply = { id: string; name: string; createdAt: string; closedAt: string; done: boolean; orderIds: string[]; loaded: boolean };
export type GroupStoreData = {
  storeId: string; storeName: string; orders: GroupOrder[]; returns: GroupReturn[]; products: GroupProduct[];
  ordersState: SourceState; returnsState: SourceState; catalogState: SourceState;
  ordersAt: string | null; returnsAt: string | null; coverageStart: string | null; warnings: string[];
  supplies: GroupSupply[]; suppliesState: SourceState; suppliesAt: string | null;
  supplyWindow: { from: string; to: string };
};
export type GroupSettings = {
  version: string; zone: ReportZone; basis: CountBasis;
  mappings: Record<string, string>;
};
export type ReportEvent = {
  key: string; kind: "order" | "return"; storeId: string; storeName: string; orderId: string;
  sourceKey: string; sellerSku: string; sku: string; nmId: number; at: string; day: string;
  status: string; excluded: boolean; reason: string;
  supplyId: string; orderedAt: string;
};
export const DEFAULT_GROUP_SETTINGS: GroupSettings = { version: "", zone: "Asia/Shanghai", basis: "supply", mappings: {} };
const DAY = 86_400_000;
export function validDay(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export function shiftDay(value: string, days: number) { return new Date(Date.parse(`${value}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10); }
export function dayInZone(at: string | number, zone: ReportZone) {
  const date = new Date(at);
  return Number.isFinite(date.getTime()) ? new Date(date.getTime() + (zone === "Europe/Moscow" ? 3 : 8) * 3_600_000).toISOString().slice(0, 10) : "";
}
export function mondayOf(day: string) { return shiftDay(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7)); }
export function nextGroupSyncAt(now: number) {
  const day = dayInZone(now, "Asia/Shanghai");
  for (const hour of [14, 16, 22]) {
    const at = Date.parse(`${day}T${hour}:10:00+08:00`);
    if (at > now) return new Date(at).toISOString();
  }
  return new Date(`${shiftDay(day, 1)}T14:10:00+08:00`).toISOString();
}
export function reportDays(from: string, to: string) {
  if (!validDay(from) || !validDay(to) || from > to || (Date.parse(to) - Date.parse(from)) / DAY > 365) throw new Error("日期范围无效，最多查询 366 天");
  const days: string[] = [];
  for (let day = from; day <= to; day = shiftDay(day, 1)) days.push(day);
  return days;
}
export function sourceSkuKey(storeId: string, sellerSku: string) { return JSON.stringify([storeId, sellerSku]); }
function normalized(value: string) { return value.trim().normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " "); }
function eventTime(value: string, allowMoscow: boolean) {
  let text = value.trim().replace(" ", "T");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text) || !validDay(text.slice(0, 10))) return "";
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    if (!allowMoscow) return "";
    text += "+03:00";
  }
  return Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : "";
}
export function invalidNewOrder(order: Pick<GroupOrder, "supplierStatus" | "wbStatus">) {
  return order.supplierStatus.toLowerCase() === "new" && ["declined_by_client", "canceled_by_client"].includes(order.wbStatus.toLowerCase());
}

export function buildAllStoresReport(stores: GroupStoreData[], from: string, to: string, settings: GroupSettings) {
  const days = reportDays(from, to);
  const problems: string[] = [];
  const sources = new Map<string, { key: string; storeId: string; storeName: string; sellerSku: string; internalSku: string; specification: string; sku: string; automatic: boolean }>();
  const productIndex = new Map<string, GroupProduct>();
  const normalizedProductIndex = new Map<string, GroupProduct[]>();
  const nmIndex = new Map<string, GroupProduct[]>();
  const variants = new Map<string, Set<string>>();
  for (const store of stores) for (const product of store.products) {
    productIndex.set(sourceSkuKey(store.storeId, product.sellerSku), product);
    const sellerKey = sourceSkuKey(store.storeId, normalized(product.sellerSku));
    normalizedProductIndex.set(sellerKey, [...(normalizedProductIndex.get(sellerKey) || []), product]);
    if (product.nmId) { const key = `${store.storeId}:${product.nmId}`; nmIndex.set(key, [...(nmIndex.get(key) || []), product]); }
    if (product.internalSku) {
      const key = normalized(product.internalSku);
      if (!variants.has(key)) variants.set(key, new Set());
      variants.get(key)!.add(normalized(product.specification));
    }
  }
  function resolve(store: GroupStoreData, sellerSku: string, nmId: number) {
    const byId = nmIndex.get(`${store.storeId}:${nmId}`) || [];
    const byNormalizedSku = normalizedProductIndex.get(sourceSkuKey(store.storeId, normalized(sellerSku))) || [];
    const product = productIndex.get(sourceSkuKey(store.storeId, sellerSku)) || (byNormalizedSku.length === 1 ? byNormalizedSku[0] : undefined) || (byId.length === 1 ? byId[0] : undefined);
    const sourceSku = sellerSku || product?.sellerSku || `未匹配WB-${nmId || "未知"}`;
    const key = sourceSkuKey(store.storeId, sourceSku);
    const custom = settings.mappings[key]?.trim();
    const automatic = Boolean(product?.internalSku && variants.get(normalized(product.internalSku))?.size === 1);
    // Only equal internal SKU AND equal specification can merge automatically.
    // Other store seller codes remain separate until explicitly mapped.
    const sku = custom || (automatic ? normalized(product!.internalSku).toUpperCase() : `${store.storeName} / ${sourceSku}`);
    sources.set(key, { key, storeId: store.storeId, storeName: store.storeName, sellerSku: sourceSku, internalSku: product?.internalSku || "", specification: product?.specification || "", sku, automatic: Boolean(custom) || automatic });
    return { key, sku, sellerSku: sourceSku, matched: Boolean(sellerSku || product || custom) };
  }
  const events: ReportEvent[] = [];
  let pendingReturns = 0;
  const pendingOrders: Array<{ storeName: string; storeId: string; orderId: string; sku: string; createdAt: string }> = [];
  for (const store of stores) {
    for (const warning of store.warnings) problems.push(`${store.storeName}：${warning}`);
    if (store.ordersState === "error") problems.push(`${store.storeName}：订单未读取成功`);
    else if (!store.ordersAt) problems.push(`${store.storeName}：订单缺少可核验的同步时间，请同步本页`);
    if (store.ordersState === "cached") problems.push(`${store.storeName}：订单使用上次数据，本次未完成更新`);
    if (store.returnsState !== "fresh") problems.push(`${store.storeName}：退货${store.returnsState === "error" ? "未读取成功" : "使用上次数据，本次未完成更新"}`);
    if (store.catalogState === "error") problems.push(`${store.storeName}：产品资料读取失败，SKU 对应待核对`);
    if (store.suppliesState !== "fresh") problems.push(`${store.storeName}：供货单${store.suppliesState === "error" ? "未读取成功" : "使用上次数据，本次未完成更新"}`);
    if (store.supplyWindow.from > from || store.supplyWindow.to < to) problems.push(`${store.storeName}：供货单明细未覆盖所选日期，请查询该周期`);
    const uniqueOrders = new Map(store.orders.map((order) => [order.id, order]));
    const byRid = new Map(store.orders.filter((order) => order.rid).map((order) => [order.rid, order]));
    const assigned = new Set<string>();
    const seen = new Set<string>();
    const supplies = [...store.supplies].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    for (const supply of supplies) {
      for (const id of supply.orderIds) assigned.add(id);
      const at = eventTime(supply.createdAt, false);
      if (!at) { problems.push(`${store.storeName}：供货单 ${supply.id} 创建时间无效，未计入`); continue; }
      const day = dayInZone(at, settings.zone);
      if (day < from || day > to) continue;
      if (!supply.loaded) { problems.push(`${store.storeName}：供货单 ${supply.id} 订单明细未完整读取`); continue; }
      for (const id of supply.orderIds) {
      if (seen.has(id)) { problems.push(`${store.storeName}：订单 ${id} 出现在多张供货单中，已避免重复计数，请核对`); continue; }
      seen.add(id);
      const order = uniqueOrders.get(id);
      if (!order) { problems.push(`${store.storeName}：供货单 ${supply.id} 中的订单 ${id} 尚未取到商品资料，未计入`); continue; }
      if (!order.supplierStatus || !order.wbStatus) problems.push(`${store.storeName}：订单 ${order.id} 缺少实时状态`);
      const source = resolve(store, order.sellerSku, order.nmId);
      if (!source.matched) problems.push(`${store.storeName}：订单 ${order.id} 无法对应 SKU`);
      const excluded = invalidNewOrder(order);
      events.push({ key: `${store.storeId}:order:${order.id}`, kind: "order", storeId: store.storeId, storeName: store.storeName, orderId: order.id, sourceKey: source.key, sellerSku: source.sellerSku, sku: source.sku, nmId: order.nmId, at, day, status: `${order.supplierStatus} / ${order.wbStatus}`, excluded, reason: excluded ? "新订单阶段客户取消，无效订单" : "按实际所属供货单的创建日期计入", supplyId: supply.id, orderedAt: order.createdAt });
      }
    }
    for (const order of uniqueOrders.values()) {
      if (!assigned.has(order.id) && order.supplierStatus.toLowerCase() === "new" && !invalidNewOrder(order) && !/cancel|declined|defect/.test(order.wbStatus)) {
        const source = resolve(store, order.sellerSku, order.nmId);
        pendingOrders.push({ storeId: store.storeId, storeName: store.storeName, orderId: order.id, sku: source.sku, createdAt: order.createdAt });
      }
    }
    const uniqueReturns = new Map<string, GroupReturn>();
    for (const item of store.returns) {
      if (!item.id) { problems.push(`${store.storeName}：有退货缺少唯一标识，未计入`); continue; }
      uniqueReturns.set(item.id, item);
    }
    for (const item of uniqueReturns.values()) {
      if (!item.completedAt) { if (item.active) pendingReturns += 1; continue; }
      const at = eventTime(item.completedAt, true);
      if (!at) { problems.push(`${store.storeName}：退货 ${item.id} 取回时间无法解析，未计入`); continue; }
      const day = dayInZone(at, settings.zone);
      if (day < from || day > to) continue;
      const order = uniqueOrders.get(item.orderId) || byRid.get(item.srid);
      const source = resolve(store, order?.sellerSku || "", item.nmId);
      if (!source.matched) problems.push(`${store.storeName}：退货 ${item.id} 未匹配商品，需核对 WB 货号 ${item.nmId}`);
      events.push({ key: `${store.storeId}:return:${item.id}`, kind: "return", storeId: store.storeId, storeName: store.storeName, orderId: item.orderId, sourceKey: source.key, sellerSku: source.sellerSku, sku: source.sku, nmId: item.nmId, at, day, status: item.status, excluded: false, reason: item.reason || "按实际取回时间计入；无时区的 WB 退货时间按莫斯科解释", supplyId: "", orderedAt: order?.createdAt || "" });
    }
  }
  const skuList = [...new Set(events.filter((event) => !event.excluded).map((event) => event.sku))].sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));
  const grid = (kind: "order" | "return", dates: string[]) => dates.map((day) => {
    const counts: Record<string, number> = {};
    for (const event of events) if (event.kind === kind && !event.excluded && event.day === day) counts[event.sku] = (counts[event.sku] || 0) + 1;
    return { day, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
  });
  const daily = grid("order", days);
  const returnsDaily = grid("return", days);
  const weeks = [...new Set(days.map(mondayOf))].map((monday) => {
    const sunday = shiftDay(monday, 6);
    const selected = events.filter((event) => !event.excluded && event.day >= monday && event.day <= sunday);
    return { monday, sunday, partial: from > monday || to < sunday, rows: skuList.map((sku) => ({ sku, orders: selected.filter((event) => event.sku === sku && event.kind === "order").length, returns: selected.filter((event) => event.sku === sku && event.kind === "return").length })) };
  });
  const totals = skuList.map((sku) => ({ sku, orders: events.filter((event) => event.sku === sku && event.kind === "order" && !event.excluded).length, returns: events.filter((event) => event.sku === sku && event.kind === "return").length }));
  return { from, to, zone: settings.zone, basis: settings.basis, days, skuList, sources: [...sources.values()], events, daily, returnsDaily, weeks, totals, pendingReturns, pendingOrders, excluded: events.filter((event) => event.excluded).length, problems: [...new Set(problems)], complete: stores.length > 0 && problems.length === 0 };
}
export type AllStoresReport = ReturnType<typeof buildAllStoresReport>;
export function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
