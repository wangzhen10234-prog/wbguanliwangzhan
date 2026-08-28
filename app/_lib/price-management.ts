export type PriceManagementCost = {
  productCostRub: number;
  exchangeRate: number;
  productCostCny: number;
  handlingFeeCny: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  commissionRate: number;
  adRate: number;
  activityDiscountRate: number;
  returnLossRate: number;
  targetMarginRate: number;
};

function finite(value: unknown) {
  const result = Number(value || 0);
  return Number.isFinite(result) ? result : 0;
}

export function calculatePriceManagement(currencyCode: string, discountedPrice: number, cost: PriceManagementCost | null) {
  const sourceCurrency = currencyCode.trim().toUpperCase();
  const sourcePrice = finite(discountedPrice);
  const exchangeRate = finite(cost?.exchangeRate);
  const currentPriceCny = sourcePrice > 0
    ? sourceCurrency === "CNY"
      ? sourcePrice
      : sourceCurrency === "RUB" && exchangeRate > 0
        ? sourcePrice / exchangeRate
        : null
    : null;
  const productCostCny = cost
    ? finite(cost.productCostRub) > 0 && exchangeRate > 0
      ? finite(cost.productCostRub) / exchangeRate
      : finite(cost.productCostCny)
    : null;
  const handlingFeeCny = cost ? finite(cost.handlingFeeCny) : null;
  const lastMileFeeCny = cost ? finite(cost.lengthCm) * finite(cost.widthCm) * finite(cost.heightCm) / 1000 * 2 + 6 : null;
  const commissionRate = finite(cost?.commissionRate);
  const adRate = finite(cost?.adRate);
  const activityDiscountRate = finite(cost?.activityDiscountRate);
  const returnLossRate = finite(cost?.returnLossRate);
  const targetMarginRate = finite(cost?.targetMarginRate);
  const variableRate = commissionRate + adRate + activityDiscountRate + returnLossRate;
  const targetRate = variableRate + targetMarginRate;
  const productCostReady = productCostCny !== null && productCostCny > 0 && (!cost || finite(cost.productCostRub) <= 0 || exchangeRate > 0);
  const fixedCostCny = productCostReady && handlingFeeCny !== null && lastMileFeeCny !== null
    ? productCostCny + handlingFeeCny + lastMileFeeCny
    : null;
  const ready = Boolean(cost && currentPriceCny !== null && fixedCostCny !== null && variableRate < 100 && targetRate < 100);
  const commissionFeeCny = ready && currentPriceCny !== null ? currentPriceCny * commissionRate / 100 : null;
  const adFeeCny = ready && currentPriceCny !== null ? currentPriceCny * adRate / 100 : null;
  const activityDiscountFeeCny = ready && currentPriceCny !== null ? currentPriceCny * activityDiscountRate / 100 : null;
  const returnLossFeeCny = ready && currentPriceCny !== null ? currentPriceCny * returnLossRate / 100 : null;
  const currentTotalCostCny = ready && fixedCostCny !== null && commissionFeeCny !== null && adFeeCny !== null && activityDiscountFeeCny !== null && returnLossFeeCny !== null
    ? fixedCostCny + commissionFeeCny + adFeeCny + activityDiscountFeeCny + returnLossFeeCny
    : null;
  const expectedProfitCny = ready && currentPriceCny !== null && currentTotalCostCny !== null ? currentPriceCny - currentTotalCostCny : null;
  const profitRate = expectedProfitCny !== null && currentPriceCny ? expectedProfitCny / currentPriceCny * 100 : null;
  const targetFinalSalePriceCny = ready && fixedCostCny !== null ? fixedCostCny / (1 - targetRate / 100) : null;
  const registeredTotalCostCny = targetFinalSalePriceCny !== null ? targetFinalSalePriceCny * (1 - targetMarginRate / 100) : null;
  const priceGapCny = currentPriceCny !== null && targetFinalSalePriceCny !== null ? currentPriceCny - targetFinalSalePriceCny : null;
  return {
    sourceCurrency,
    currentPriceCny,
    productCostCny,
    handlingFeeCny,
    lastMileFeeCny,
    fixedCostCny,
    commissionFeeCny,
    adFeeCny,
    activityDiscountFeeCny,
    returnLossFeeCny,
    currentTotalCostCny,
    expectedProfitCny,
    profitRate,
    targetFinalSalePriceCny,
    registeredTotalCostCny,
    priceGapCny,
    variableRate,
    targetMarginRate,
    ready,
  };
}
