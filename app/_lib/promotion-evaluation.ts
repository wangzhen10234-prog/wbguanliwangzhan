export type PromotionEvaluationCost = {
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
};

export function calculatePromotionProfit(currencyCode: string, promoPrice: number, cost: PromotionEvaluationCost | null) {
  const sourceCurrency = currencyCode.toUpperCase() === "CNY" ? "CNY" as const : "RUB" as const;
  const exchangeRate = Number(cost?.exchangeRate || 0);
  const productCostCny = cost
    ? cost.productCostRub > 0 && exchangeRate > 0 ? cost.productCostRub / exchangeRate : Number(cost.productCostCny || 0)
    : 0;
  const lastMileFeeCny = cost ? (cost.lengthCm * cost.widthCm * cost.heightCm / 1000) * 2 + 6 : 0;
  const fixedCostCny = cost ? productCostCny + Number(cost.handlingFeeCny || 0) + lastMileFeeCny : null;
  const variableRate = cost
    ? cost.commissionRate + cost.adRate + cost.activityDiscountRate + cost.returnLossRate
    : null;
  const promoPriceCny = promoPrice > 0
    ? sourceCurrency === "CNY" ? promoPrice : exchangeRate > 0 ? promoPrice / exchangeRate : null
    : null;
  const productCostReady = Boolean(cost && productCostCny > 0 && (cost.productCostRub <= 0 || exchangeRate > 0));
  const ready = Boolean(cost && productCostReady && promoPriceCny !== null && variableRate !== null && variableRate < 100);
  const breakEvenPriceCny = ready && fixedCostCny !== null && variableRate !== null
    ? fixedCostCny / (1 - variableRate / 100)
    : null;
  const totalCostCny = ready && promoPriceCny !== null && fixedCostCny !== null && variableRate !== null
    ? fixedCostCny + promoPriceCny * variableRate / 100
    : null;
  const profitCny = ready && promoPriceCny !== null && totalCostCny !== null ? promoPriceCny - totalCostCny : null;
  const profitRate = profitCny !== null && promoPriceCny ? profitCny / promoPriceCny * 100 : null;
  return { sourceCurrency, productCostCny, lastMileFeeCny, fixedCostCny, variableRate, promoPriceCny, ready, breakEvenPriceCny, totalCostCny, profitCny, profitRate };
}
