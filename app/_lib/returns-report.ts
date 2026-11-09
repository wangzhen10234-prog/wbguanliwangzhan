export type GoodsReturnRow = {
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

type ItemReturnRow = Omit<GoodsReturnRow, "barcode" | "reason" | "status" | "isStatusActive"> & {
  sku?: string;
  returnReason?: string;
  returnStatus?: string;
};
export type ItemReturnsPage = { count: number; report: ItemReturnRow[] };
const PAGE_SIZE = 1000;
const MAX_ROWS = 100_000;

/** Status is supplied by the query; WB no longer returns isStatusActive. */
export async function loadReturnsReport(
  window: { from: string; to: string },
  requestPage: (url: string) => Promise<ItemReturnsPage | null>,
) {
  const groups = await Promise.all((["active", "archive"] as const).map(async (status) => {
    const rows: GoodsReturnRow[] = [];
    let offset = 0;
    while (offset < MAX_ROWS) {
      const url = new URL("https://seller-analytics-api.wildberries.ru/api/analytics/v1/item-returns");
      url.search = new URLSearchParams({ dateFrom: window.from, dateTo: window.to, status, limit: String(PAGE_SIZE), offset: String(offset) }).toString();
      const page = await requestPage(url.toString());
      if (page === null) {
        if (offset > 0) throw new Error("WB_RETURNS_INCOMPLETE_PAGE");
        return rows;
      }
      if (!Array.isArray(page.report) || !Number.isSafeInteger(page.count) || page.count < 0 || page.count > MAX_ROWS) throw new Error("WB_RETURNS_INVALID_PAGE");
      if (page.report.length === 0 && offset < page.count) throw new Error("WB_RETURNS_INCOMPLETE_PAGE");
      for (const row of page.report) {
        if (!row || typeof row !== "object" || typeof row.returnStatus !== "string") throw new Error("WB_RETURNS_INVALID_ROW");
        rows.push({ ...row, barcode: row.sku, reason: row.returnReason, status: row.returnStatus, isStatusActive: status === "active" ? 1 : 0 });
      }
      offset += page.report.length;
      if (offset >= page.count) return rows;
    }
    throw new Error("WB_RETURNS_TOO_MANY_ROWS");
  }));
  return groups.flat();
}
