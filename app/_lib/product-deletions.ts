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
  return markers.some((marker) =>
    (nmId > 0 && marker.nmId === nmId)
    || Boolean(sellerSkuKey && marker.sellerSkuKey === sellerSkuKey),
  );
}
