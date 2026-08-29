import { normalizeProductSku, productCostSourceKey } from "./product-cost-aliases.ts";

export type MatchableProduct = {
  nmId: number;
  sku: string;
};

export type MatchableCost = {
  sellerSku: string;
  nmId: number | null;
};

export type ProductCostMatch<TCost extends MatchableCost, TProduct extends MatchableProduct> = {
  key: string;
  cost: TCost;
  product: TProduct | null;
  persistedSellerSku: string;
  strategy: "sellerSku" | "nmId" | "costAlias" | "newProduct" | "manual";
};

/**
 * Reconciles the editable product register with the latest WB product list.
 * Exact seller codes win over a stale nmId, while nmId keeps intentionally
 * renamed records connected. Cost aliases may feed multiple WB variants but
 * are cloned as new records so the shared source row is never renamed away.
 */
export function reconcileProductCosts<TCost extends MatchableCost, TProduct extends MatchableProduct>(
  storedRows: TCost[],
  products: TProduct[],
  createCost: (product: TProduct) => TCost,
): ProductCostMatch<TCost, TProduct>[] {
  const stored = storedRows.map((cost, index) => ({
    id: index,
    cost,
    key: normalizeProductSku(cost.sellerSku),
  }));
  const unused = new Set(stored.map((row) => row.id));
  const matchedProducts = new Set<number>();
  const hiddenAliasSources = new Set<number>();
  const matches: ProductCostMatch<TCost, TProduct>[] = [];

  function addDirect(productIndex: number, storedId: number, strategy: "sellerSku" | "nmId") {
    const product = products[productIndex];
    const source = stored[storedId];
    matches.push({
      key: source.key,
      cost: source.cost,
      product,
      persistedSellerSku: source.cost.sellerSku,
      strategy,
    });
    unused.delete(storedId);
    matchedProducts.add(productIndex);
  }

  // First reserve exact seller-code matches so a stale nmId cannot steal them.
  for (let productIndex = 0; productIndex < products.length; productIndex += 1) {
    const sellerKey = normalizeProductSku(products[productIndex].sku);
    const source = stored.find((row) => unused.has(row.id) && row.key === sellerKey);
    if (source) addDirect(productIndex, source.id, "sellerSku");
  }

  // Preserve association when a seller code was intentionally edited.
  for (let productIndex = 0; productIndex < products.length; productIndex += 1) {
    if (matchedProducts.has(productIndex)) continue;
    const product = products[productIndex];
    const source = stored.find((row) => unused.has(row.id) && row.cost.nmId === product.nmId);
    if (source) addDirect(productIndex, source.id, "nmId");
  }

  // Known WB variant codes inherit a source cost row without mutating it.
  for (let productIndex = 0; productIndex < products.length; productIndex += 1) {
    if (matchedProducts.has(productIndex)) continue;
    const product = products[productIndex];
    const sourceKey = productCostSourceKey(product.sku);
    const sellerKey = normalizeProductSku(product.sku);
    const source = stored.find((row) => row.key === sourceKey);
    if (source && sourceKey !== sellerKey) {
      const cloned = { ...source.cost, sellerSku: product.sku, nmId: product.nmId } as TCost;
      matches.push({ key: sellerKey, cost: cloned, product, persistedSellerSku: "", strategy: "costAlias" });
      matchedProducts.add(productIndex);
      hiddenAliasSources.add(source.id);
    }
  }

  // Every newly uploaded WB product becomes immediately visible and editable.
  for (let productIndex = 0; productIndex < products.length; productIndex += 1) {
    if (matchedProducts.has(productIndex)) continue;
    const product = products[productIndex];
    matches.push({
      key: normalizeProductSku(product.sku),
      cost: createCost(product),
      product,
      persistedSellerSku: "",
      strategy: "newProduct",
    });
  }

  // Keep manual records that still require the seller code to be corrected.
  for (const source of stored) {
    if (!unused.has(source.id) || hiddenAliasSources.has(source.id)) continue;
    matches.push({
      key: source.key,
      cost: source.cost,
      product: null,
      persistedSellerSku: source.cost.sellerSku,
      strategy: "manual",
    });
  }

  return matches;
}
