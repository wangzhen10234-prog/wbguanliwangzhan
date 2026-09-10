export type InventorySegment = "critical" | "low" | "slow" | "healthy";

export function inventorySegmentFor(product: { stock: number; stockCoverDays: number | null }): InventorySegment {
  if (product.stock <= 0 || (product.stockCoverDays !== null && product.stockCoverDays < 5)) return "critical";
  if (product.stockCoverDays !== null && product.stockCoverDays <= 10) return "low";
  if (product.stock > 0 && product.stockCoverDays === null) return "slow";
  return "healthy";
}
