import { normalizeProductSku } from "./product-cost-aliases.ts";

export type ProductDeletionMarker = {
  identityKey: string;
  sellerSkuKey: string;
  nmId: number | null;
};

export function productDeletionIdentity(sellerSku: string, nmId: number | null | undefined) {
  const numericNmId = Number(nmId || 0);
  return numericNmId > 0 ? `nm:${Math.trunc(numericNmId)}` : `sku:${normalizeProductSku(sellerSku)}`;
}

export function matchesProductDeletion(
  product: { sku: string; nmId: number | null | undefined },
  markers: ProductDeletionMarker[],
) {
  const sellerSkuKey = normalizeProductSku(product.sku);
  const nmId = Number(product.nmId || 0);
  return markers.some((marker) => {
    const markerNmId = Number(marker.nmId || 0);

    // A WB-backed deletion is scoped to the immutable WB product id. Falling
    // back to the seller code here can hide a separate manual record that was
    // entered before WB assigned or exposed its nmId.
    if (markerNmId > 0) return nmId > 0 && markerNmId === nmId;

    // Manual products do not have a WB id, so their normalized seller code is
    // the durable identity used to keep an intentionally deleted row hidden.
    return Boolean(sellerSkuKey && marker.sellerSkuKey === sellerSkuKey);
  });
}
