export type OrderCompletionOutcome = "success" | "abnormal" | "pending";

export type OrderIdentityRow = {
  nmId?: number;
  rid?: string;
  srid?: string;
  orderUid?: string;
};

export type StatisticsSaleRow = OrderIdentityRow & {
  date?: string;
  saleID?: string;
};

export type StatisticsOrderRow = OrderIdentityRow & {
  cancelDate?: string;
  isCancel?: boolean;
};

export type OrderCompletionEvent = {
  at: string;
  source: "sale" | "return" | "cancel";
};

export type OrderCompletionRecord = {
  success?: OrderCompletionEvent;
  abnormal?: OrderCompletionEvent;
};

function identity(value: unknown) {
  return String(value || "").trim().toLocaleLowerCase();
}

function identityKeys(row: OrderIdentityRow) {
  const nmId = Number(row.nmId || 0);
  return [row.rid, row.srid, row.orderUid]
    .map(identity)
    .filter(Boolean)
    .map((value) => `${value}|${nmId}`);
}

export function normalizeWbStatisticsTime(value?: string) {
  if (!value) return "";
  // WB Statistics timestamps are returned without an offset and use Moscow time (UTC+3).
  const normalized = /(?:z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}+03:00`;
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function keepLatest(current: OrderCompletionEvent | undefined, next: OrderCompletionEvent) {
  return !current || next.at > current.at ? next : current;
}

export function buildOrderCompletionIndex(sales: StatisticsSaleRow[], orders: StatisticsOrderRow[]) {
  const index = new Map<string, OrderCompletionRecord>();

  const record = (row: OrderIdentityRow, outcome: "success" | "abnormal", event: OrderCompletionEvent) => {
    if (!event.at) return;
    for (const key of identityKeys(row)) {
      const current = index.get(key) ?? {};
      current[outcome] = keepLatest(current[outcome], event);
      index.set(key, current);
    }
  };

  for (const sale of sales) {
    const returned = String(sale.saleID || "").toUpperCase().startsWith("R");
    record(sale, returned ? "abnormal" : "success", {
      at: normalizeWbStatisticsTime(sale.date),
      source: returned ? "return" : "sale",
    });
  }

  for (const order of orders) {
    if (!order.isCancel) continue;
    record(order, "abnormal", {
      at: normalizeWbStatisticsTime(order.cancelDate),
      source: "cancel",
    });
  }

  return index;
}

export function completionForOrder(
  order: OrderIdentityRow,
  outcome: OrderCompletionOutcome,
  index: Map<string, OrderCompletionRecord>,
) {
  if (outcome === "pending") return null;
  for (const key of identityKeys(order)) {
    const event = index.get(key)?.[outcome];
    if (event) return event;
  }
  return null;
}
