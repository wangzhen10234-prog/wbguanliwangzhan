import type { GroupSupply } from "./all-stores-report.ts";

type SupplyPage = { supplies?: Array<{ id?: string; name?: string; createdAt?: string; closedAt?: string | null; done?: boolean }>; next?: number };
export async function loadSupplyList(request: (path: string) => Promise<unknown>) {
  const result = new Map<string, GroupSupply>();
  let next = 0;
  const cursors = new Set<number>();
  for (let pageNumber = 0; pageNumber < 1000; pageNumber += 1) {
    const page = await request(`/api/v3/supplies?limit=1000&next=${next}`) as SupplyPage;
    if (!Array.isArray(page.supplies)) throw new Error("SUPPLIES_INVALID_PAGE");
    for (const row of page.supplies) {
      if (typeof row.id !== "string" || !row.id || typeof row.createdAt !== "string" || !/(Z|[+-]\d{2}:?\d{2})$/.test(row.createdAt) || !Number.isFinite(Date.parse(row.createdAt))) throw new Error("SUPPLIES_INVALID_ROW");
      result.set(row.id, { id: row.id, name: row.name || row.id, createdAt: row.createdAt, closedAt: row.closedAt || "", done: row.done === true, loaded: false, orderIds: [] });
    }
    // WB may return only 100 even when limit=1000. A short page is not EOF.
    if (page.supplies.length === 0 || page.next === 0) return [...result.values()];
    if (!Number.isSafeInteger(page.next) || page.next! < 0 || cursors.has(page.next!)) throw new Error("SUPPLIES_INCOMPLETE_PAGINATION");
    next = page.next!;
    cursors.add(next);
  }
  throw new Error("SUPPLIES_TOO_MANY_PAGES");
}
export function supplyOrderIds(value: unknown) {
  const ids = (value as { orderIds?: unknown })?.orderIds;
  if (!Array.isArray(ids) || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw new Error("SUPPLY_ORDERS_INVALID");
  return [...new Set(ids.map(String))];
}
