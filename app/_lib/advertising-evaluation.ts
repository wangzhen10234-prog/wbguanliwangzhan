export type AdvertisingEvaluationCost = {
  productCostRub: number;
  exchangeRate: number;
  productCostCny: number;
  handlingFeeCny: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  commissionRate: number;
  activityDiscountRate: number;
  returnLossRate: number;
};

export type AdvertisingEvaluationInput = {
  paymentType: "cpc" | "cpm";
  currency: string | null;
  currentBid: number | null;
  minimumBid: number | null;
  officialCompetitiveBid: number | null;
  averageProductPriceCny: number;
  stats: {
    views: number;
    clicks: number;
    spend: number;
    orders: number;
    sales: number;
  } | null;
  cost: AdvertisingEvaluationCost | null;
};

function finite(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function evaluateAdvertisingBid(input: AdvertisingEvaluationInput) {
  const currency = input.currency?.toUpperCase() || null;
  const exchangeRate = Number(input.cost?.exchangeRate || 0);
  const currencyPerCny = currency === "CNY" ? 1 : currency === "RUB" && exchangeRate > 0 ? exchangeRate : null;
  const productCostCny = input.cost
    ? input.cost.productCostRub > 0 && exchangeRate > 0
      ? input.cost.productCostRub / exchangeRate
      : Number(input.cost.productCostCny || 0)
    : null;
  const handlingFeeCny = input.cost ? Number(input.cost.handlingFeeCny || 0) : null;
  const lastMileFeeCny = input.cost
    ? (Number(input.cost.lengthCm || 0) * Number(input.cost.widthCm || 0) * Number(input.cost.heightCm || 0) / 1000) * 2 + 6
    : null;
  const fixedCostCny = productCostCny !== null && handlingFeeCny !== null && lastMileFeeCny !== null
    ? productCostCny + handlingFeeCny + lastMileFeeCny
    : null;
  const nonAdvertisingRate = input.cost
    ? Number(input.cost.commissionRate || 0) + Number(input.cost.activityDiscountRate || 0) + Number(input.cost.returnLossRate || 0)
    : null;
  const attributedPriceCurrency = input.stats && input.stats.orders > 0 ? input.stats.sales / input.stats.orders : null;
  const attributedPriceCny = attributedPriceCurrency !== null && currencyPerCny
    ? attributedPriceCurrency / currencyPerCny
    : null;
  const sellingPriceCny = attributedPriceCny && attributedPriceCny > 0
    ? attributedPriceCny
    : Number(input.averageProductPriceCny || 0) > 0 ? Number(input.averageProductPriceCny) : null;
  const priceSource = attributedPriceCny && attributedPriceCny > 0 ? "attributed-sales" as const : sellingPriceCny ? "product-average" as const : "missing" as const;
  const proportionalCostCny = sellingPriceCny !== null && nonAdvertisingRate !== null
    ? sellingPriceCny * nonAdvertisingRate / 100
    : null;
  const preAdProfitPerOrderCny = sellingPriceCny !== null && fixedCostCny !== null && proportionalCostCny !== null
    ? sellingPriceCny - fixedCostCny - proportionalCostCny
    : null;
  const preAdProfitPerOrderCurrency = preAdProfitPerOrderCny !== null && currencyPerCny !== null
    ? preAdProfitPerOrderCny * currencyPerCny
    : null;
  const statsReady = Boolean(input.stats && input.stats.orders > 0 && (
    input.paymentType === "cpc" ? input.stats.clicks >= 10 : input.stats.views >= 100
  ));
  const observedConversionRate = input.stats?.clicks ? input.stats.orders / input.stats.clicks : null;
  const ordersPerThousandViews = input.stats?.views ? input.stats.orders / input.stats.views * 1000 : null;
  const breakEvenBid = preAdProfitPerOrderCurrency !== null && preAdProfitPerOrderCurrency > 0 && input.stats
    ? input.paymentType === "cpc" && observedConversionRate !== null
      ? preAdProfitPerOrderCurrency * observedConversionRate
      : input.paymentType === "cpm" && ordersPerThousandViews !== null
        ? preAdProfitPerOrderCurrency * ordersPerThousandViews
        : null
    : null;
  const safeBidCeiling = breakEvenBid !== null ? breakEvenBid * 0.8 : null;
  const minimumBid = finite(input.minimumBid);
  const officialCompetitiveBid = finite(input.officialCompetitiveBid);
  const suggestedBase = safeBidCeiling !== null
    ? input.paymentType === "cpm" && officialCompetitiveBid !== null && officialCompetitiveBid > 0
      ? Math.min(officialCompetitiveBid, safeBidCeiling)
      : safeBidCeiling
    : null;
  const minimumExceedsSafety = minimumBid !== null && safeBidCeiling !== null && minimumBid > safeBidCeiling;
  const suggestedBid = suggestedBase !== null && !minimumExceedsSafety
    ? Math.max(minimumBid || 0, suggestedBase)
    : null;
  const actualUnitCost = input.paymentType === "cpc"
    ? input.stats?.clicks ? input.stats.spend / input.stats.clicks : null
    : input.stats?.views ? input.stats.spend / input.stats.views * 1000 : null;
  const estimatedNetProfit = input.stats && preAdProfitPerOrderCurrency !== null
    ? preAdProfitPerOrderCurrency * input.stats.orders - input.stats.spend
    : null;

  let decision: "missing" | "learning" | "unviable" | "loss" | "high" | "efficient" = "missing";
  if (preAdProfitPerOrderCurrency !== null && currencyPerCny !== null) {
    if (!statsReady || breakEvenBid === null) decision = "learning";
    else if (minimumExceedsSafety) decision = "unviable";
    else if (actualUnitCost !== null && actualUnitCost > breakEvenBid) decision = "loss";
    else if (input.currentBid !== null && suggestedBid !== null && input.currentBid > suggestedBid * 1.15) decision = "high";
    else decision = "efficient";
  }

  return {
    currency,
    currencyPerCny,
    productCostCny,
    handlingFeeCny,
    lastMileFeeCny,
    fixedCostCny,
    nonAdvertisingRate,
    sellingPriceCny,
    priceSource,
    proportionalCostCny,
    preAdProfitPerOrderCny,
    preAdProfitPerOrderCurrency,
    observedConversionRate,
    ordersPerThousandViews,
    breakEvenBid,
    safeBidCeiling,
    suggestedBid,
    actualUnitCost,
    estimatedNetProfit,
    minimumExceedsSafety,
    statsReady,
    decision,
  };
}
