import { normalizeProductSku } from "./product-cost-aliases.ts";

export type SellingPriceSize = {
  discountedPrice: number;
};

export type SellingPriceProduct = {
  nmId: number;
  vendorCode: string;
  currency: string;
  sizes: SellingPriceSize[];
};

export type CurrentSellingPrice = {
  min: number;
  max: number;
  currency: string;
  convertedToCny: boolean;
  priceCount: number;
};

function positiveNumber(value: unknown) {
  const result = Number(value);
  return Number.isFinite(result) && result > 0 ? result : 0;
}

export function findCurrentSellingPrice(
  products: SellingPriceProduct[],
  identity: { nmId?: number | null; sellerSku?: string | null },
  exchangeRate: number,
): CurrentSellingPrice | null {
  const nmId = Math.trunc(positiveNumber(identity.nmId));
  const sellerSku = normalizeProductSku(identity.sellerSku ?? "");
  const product = (nmId ? products.find((item) => Math.trunc(positiveNumber(item.nmId)) === nmId) : null)
    ?? (sellerSku ? products.find((item) => normalizeProductSku(item.vendorCode) === sellerSku) : null);
  if (!product) return null;

  const sourcePrices = [...new Set(product.sizes.map((size) => positiveNumber(size.discountedPrice)).filter(Boolean))]
    .sort((left, right) => left - right);
  if (!sourcePrices.length) return null;

  const sourceCurrency = String(product.currency || "CNY").trim().toUpperCase();
  const canConvertRub = sourceCurrency === "RUB" && Number.isFinite(exchangeRate) && exchangeRate > 0;
  const multiplier = canConvertRub ? 1 / exchangeRate : 1;
  const displayedCurrency = canConvertRub || sourceCurrency === "RMB" ? "CNY" : sourceCurrency;
  const prices = sourcePrices.map((price) => price * multiplier);

  return {
    min: prices[0],
    max: prices.at(-1) ?? prices[0],
    currency: displayedCurrency,
    convertedToCny: canConvertRub,
    priceCount: sourcePrices.length,
  };
}
