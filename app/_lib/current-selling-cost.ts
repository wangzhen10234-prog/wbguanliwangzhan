import { calculatePriceManagement, type PriceManagementCost } from "./price-management.ts";
import type { CurrentSellingPrice } from "./current-selling-price.ts";

export type CurrentSellingCostStatus = "profit" | "loss" | "mixed" | "even";

export type CurrentSellingCost = {
  min: number;
  max: number;
  minProfit: number;
  maxProfit: number;
  status: CurrentSellingCostStatus;
};

const MONEY_EPSILON = 0.005;

export function calculateCurrentSellingCost(
  price: CurrentSellingPrice | null,
  cost: PriceManagementCost,
): CurrentSellingCost | null {
  if (!price || price.currency !== "CNY") return null;

  const minimum = calculatePriceManagement("CNY", price.min, cost);
  const maximum = calculatePriceManagement("CNY", price.max, cost);
  if (
    !minimum.ready
    || !maximum.ready
    || minimum.currentTotalCostCny === null
    || maximum.currentTotalCostCny === null
    || minimum.expectedProfitCny === null
    || maximum.expectedProfitCny === null
  ) return null;

  const minProfit = minimum.expectedProfitCny;
  const maxProfit = maximum.expectedProfitCny;
  const status: CurrentSellingCostStatus = minProfit > MONEY_EPSILON
    ? "profit"
    : maxProfit < -MONEY_EPSILON
      ? "loss"
      : minProfit < -MONEY_EPSILON && maxProfit > MONEY_EPSILON
        ? "mixed"
        : minProfit < -MONEY_EPSILON
          ? "loss"
          : maxProfit > MONEY_EPSILON
            ? "profit"
            : "even";

  return {
    min: minimum.currentTotalCostCny,
    max: maximum.currentTotalCostCny,
    minProfit,
    maxProfit,
    status,
  };
}
