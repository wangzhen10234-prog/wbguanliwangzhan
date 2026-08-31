export type ReturnTrackingStage = "transit" | "ready" | "completed" | "unknown";
export type ReturnPickupSortDirection = "asc" | "desc";

type ReturnWithPickupTime = {
  id: string;
  completedAt?: string | null;
  orderDate?: string | null;
};

function returnTimestamp(value?: string | null) {
  if (!value) return null;
  const result = new Date(value).getTime();
  return Number.isFinite(result) ? result : null;
}

export function sortReturnsByPickupTime<T extends ReturnWithPickupTime>(rows: readonly T[], direction: ReturnPickupSortDirection) {
  return [...rows].sort((left, right) => {
    const leftPickup = returnTimestamp(left.completedAt);
    const rightPickup = returnTimestamp(right.completedAt);
    if (leftPickup === null && rightPickup !== null) return 1;
    if (leftPickup !== null && rightPickup === null) return -1;
    if (leftPickup !== null && rightPickup !== null && leftPickup !== rightPickup) {
      return direction === "desc" ? rightPickup - leftPickup : leftPickup - rightPickup;
    }
    const orderDifference = (returnTimestamp(right.orderDate) ?? 0) - (returnTimestamp(left.orderDate) ?? 0);
    if (orderDifference) return orderDifference;
    return right.id.localeCompare(left.id, "en", { numeric: true });
  });
}

export function classifyReturnTracking(status: string, isStatusActive: boolean, completedAt?: string | null): ReturnTrackingStage {
  const normalized = status.trim().toLocaleLowerCase("ru");
  if (normalized.includes("выдано")) return "completed";
  if (normalized.includes("готов к выдаче")) return "ready";
  if (normalized.includes("в пути")) return "transit";
  if (isStatusActive) return "unknown";
  return completedAt ? "completed" : "unknown";
}

export function returnStatusLabel(status: string, stage: ReturnTrackingStage) {
  const known: Record<string, string> = {
    "В пути в пвз": "运输至取货点",
    "Готов к выдаче": "已到达，可取回",
    "Выдано": "已取回",
    "Статус не определен": "平台状态未明确",
  };
  return known[status] || ({ transit: "运输中", ready: "可取回", completed: "已完成", unknown: "状态待确认" } as const)[stage];
}
