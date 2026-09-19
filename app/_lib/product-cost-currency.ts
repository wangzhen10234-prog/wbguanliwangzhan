export type ProductCostCurrency = "CNY" | "RUB";

export type ProductCostCurrencyFields = {
  productCostRub: number;
  exchangeRate: number;
  productCostCny: number;
};

const DEFAULT_RUB_TO_CNY_RATE = 11.2;

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function inferProductCostCurrency(cost: ProductCostCurrencyFields): ProductCostCurrency {
  return cost.productCostRub > 0 ? "RUB" : "CNY";
}

export function switchProductCostCurrency(
  cost: ProductCostCurrencyFields,
  currency: ProductCostCurrency,
): ProductCostCurrencyFields {
  if (currency === "CNY") {
    const productCostCny = cost.productCostRub > 0 && cost.exchangeRate > 0
      ? roundCurrency(cost.productCostRub / cost.exchangeRate)
      : cost.productCostCny;
    return { ...cost, productCostRub: 0, productCostCny };
  }

  const exchangeRate = cost.exchangeRate > 0 ? cost.exchangeRate : DEFAULT_RUB_TO_CNY_RATE;
  const productCostRub = cost.productCostRub > 0
    ? cost.productCostRub
    : roundCurrency(cost.productCostCny * exchangeRate);
  return { ...cost, exchangeRate, productCostRub };
}
