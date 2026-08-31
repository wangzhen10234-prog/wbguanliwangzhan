export type SalesOrderSortKey = "createdAt" | "completionAt";
export type SalesOrderSortDirection = "asc" | "desc";

type SortableSalesOrder = {
  id: string;
  createdAt: string;
  completionAt?: string | null;
};

function timestamp(value?: string | null) {
  if (!value) return null;
  const result = new Date(value).getTime();
  return Number.isFinite(result) ? result : null;
}

export function sortSalesOrders<T extends SortableSalesOrder>(
  orders: readonly T[],
  key: SalesOrderSortKey,
  direction: SalesOrderSortDirection,
) {
  return [...orders].sort((left, right) => {
    const leftValue = timestamp(key === "completionAt" ? left.completionAt : left.createdAt);
    const rightValue = timestamp(key === "completionAt" ? right.completionAt : right.createdAt);

    // Orders without the selected timestamp stay at the bottom in both directions.
    if (leftValue === null && rightValue !== null) return 1;
    if (leftValue !== null && rightValue === null) return -1;
    if (leftValue !== null && rightValue !== null && leftValue !== rightValue) {
      return direction === "desc" ? rightValue - leftValue : leftValue - rightValue;
    }

    const createdDifference = (timestamp(right.createdAt) ?? 0) - (timestamp(left.createdAt) ?? 0);
    if (createdDifference) return createdDifference;
    return right.id.localeCompare(left.id, "en", { numeric: true });
  });
}
