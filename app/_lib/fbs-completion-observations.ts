import { fbsOrderKey } from "./fbs-order-identity.ts";

export type FbsCompletionOutcome = "success" | "abnormal" | "pending";

export type FbsCompletionOrder = {
  id?: number | string | null;
  rid?: string | null;
  orderUid?: string | null;
  createdAt?: string | null;
  supplierStatus?: string | null;
  wbStatus?: string | null;
};

export type FbsCompletionObservation = {
  outcome: Exclude<FbsCompletionOutcome, "pending">;
  detectedAt: string;
  supplierStatus: string;
  wbStatus: string;
};

export type FbsCompletionObservations = Record<string, FbsCompletionObservation>;

const abnormalWbStatuses = new Set([
  "canceled",
  "canceled_by_client",
  "declined_by_client",
  "defect",
  "canceled_by_missed_call",
]);

export function fbsStatusOutcome(order: Pick<FbsCompletionOrder, "supplierStatus" | "wbStatus">): FbsCompletionOutcome {
  const supplierStatus = String(order.supplierStatus || "").toLocaleLowerCase();
  const wbStatus = String(order.wbStatus || "").toLocaleLowerCase();
  if (wbStatus === "sold") return "success";
  if (supplierStatus === "cancel" || abnormalWbStatuses.has(wbStatus)) return "abnormal";
  return "pending";
}

export function beijingDateKey(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function updateFbsCompletionObservations(
  previousOrders: FbsCompletionOrder[],
  currentOrders: FbsCompletionOrder[],
  existing: FbsCompletionObservations = {},
  detectedAt = new Date().toISOString(),
) {
  const result: FbsCompletionObservations = { ...existing };
  const previousByKey = new Map(previousOrders.map((order) => [fbsOrderKey(order), order]).filter(([key]) => Boolean(key)));
  const detectedDate = beijingDateKey(detectedAt);

  for (const order of currentOrders) {
    const key = fbsOrderKey(order);
    if (!key) continue;
    const outcome = fbsStatusOutcome(order);
    if (outcome === "pending") continue;

    const previous = previousByKey.get(key);
    const previousOutcome = previous ? fbsStatusOutcome(previous) : null;
    const currentObservation = result[key];
    const firstSeenCompletedToday = !previous
      && !currentObservation
      && Boolean(detectedDate)
      && beijingDateKey(String(order.createdAt || "")) === detectedDate;
    const changedToCompleted = previousOutcome === "pending";
    const changedCompletionOutcome = previousOutcome !== null && previousOutcome !== "pending" && previousOutcome !== outcome;
    const observationOutcomeChanged = Boolean(currentObservation && currentObservation.outcome !== outcome);

    if (!firstSeenCompletedToday && !changedToCompleted && !changedCompletionOutcome && !observationOutcomeChanged) continue;
    result[key] = {
      outcome,
      detectedAt,
      supplierStatus: String(order.supplierStatus || ""),
      wbStatus: String(order.wbStatus || ""),
    };
  }

  return result;
}
