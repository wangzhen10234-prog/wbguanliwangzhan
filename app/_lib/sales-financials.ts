export type SalesSettlementInput = {
  matched: boolean;
  transactionAmount: number;
  forPay: number;
  logisticsFee: number;
  acquiringFee: number;
  penaltyFee: number;
  deductionFee: number;
  storageFee: number;
  acceptanceFee: number;
  additionalPayment: number;
  netPayout: number;
};

export type SalesCostInput = {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  productCostRub: number;
  exchangeRate: number;
  productCostCny: number;
  handlingFeeCny: number;
};

export type SalesFinancialOrderInput = {
  amount: number;
  outcome: "success" | "abnormal" | "pending";
  supplierStatus: string;
  wbStatus: string;
  settlement: SalesSettlementInput | null;
};

export type OrderFinancial = {
  kind: "settled" | "waiting" | "abnormal";
  billingSource: "actual" | "estimated" | "pending" | "zero";
  costReady: boolean;
  zeroCostReason: "unprocessed-client-cancel" | null;
  settlementGross: number | null;
  postCommissionPayout: number | null;
  platformPayout: number | null;
  platformDeduction: number | null;
  commissionFee: number;
  logisticsFee: number;
  acquiringFee: number;
  penaltyFee: number;
  deductionFee: number;
  storageFee: number;
  acceptanceFee: number;
  additionalPayment: number;
  productPrincipal: number;
  handlingFee: number;
  productCost: number | null;
  incomeEstimate: number | null;
  costExpense: number | null;
  profit: number | null;
  profitRate: number | null;
};

export function isUnprocessedClientCancellation(
  order: Pick<SalesFinancialOrderInput, "outcome" | "supplierStatus" | "wbStatus">,
) {
  return order.outcome === "abnormal"
    && order.supplierStatus.trim().toLowerCase() === "new"
    && order.wbStatus.trim().toLowerCase() === "declined_by_client";
}

export function returnRateSummary(success: number, abnormal: number, invalid: number) {
  const safeSuccess = Math.max(0, Number(success || 0));
  const safeAbnormal = Math.max(0, Number(abnormal || 0));
  const safeInvalid = Math.min(safeAbnormal, Math.max(0, Number(invalid || 0)));
  const rateAbnormal = safeAbnormal - safeInvalid;
  const completedForRate = safeSuccess + rateAbnormal;
  return {
    success: safeSuccess,
    abnormal: safeAbnormal,
    invalid: safeInvalid,
    rateAbnormal,
    completedForRate,
    returnRate: completedForRate ? (rateAbnormal / completedForRate) * 100 : 0,
  };
}

export function isCurrentValidNewOrder(
  order: Pick<SalesFinancialOrderInput, "outcome" | "supplierStatus" | "wbStatus">,
) {
  return order.outcome === "pending"
    && order.supplierStatus.trim().toLowerCase() === "new"
    && order.wbStatus.trim().toLowerCase() === "waiting";
}

export function waitingFinancial(costReady = false): OrderFinancial {
  return {
    kind: "waiting",
    billingSource: "pending",
    costReady,
    zeroCostReason: null,
    settlementGross: null,
    postCommissionPayout: null,
    platformPayout: null,
    platformDeduction: null,
    commissionFee: 0,
    logisticsFee: 0,
    acquiringFee: 0,
    penaltyFee: 0,
    deductionFee: 0,
    storageFee: 0,
    acceptanceFee: 0,
    additionalPayment: 0,
    productPrincipal: 0,
    handlingFee: 0,
    productCost: null,
    incomeEstimate: null,
    costExpense: null,
    profit: null,
    profitRate: null,
  };
}

export function calculateOrderFinancial(
  order: SalesFinancialOrderInput,
  cost: SalesCostInput | null | undefined,
): OrderFinancial {
  const costReady = Boolean(cost);
  const principal = cost
    ? cost.productCostRub > 0 && cost.exchangeRate > 0
      ? cost.productCostRub / cost.exchangeRate
      : Number(cost.productCostCny || 0)
    : 0;
  const handling = Number(cost?.handlingFeeCny || 0);
  const estimatedLastMile = cost
    ? (Number(cost.lengthCm || 0) * Number(cost.widthCm || 0) * Number(cost.heightCm || 0) / 1000) * 2 + 6
    : 0;

  if (order.outcome === "abnormal") {
    if (isUnprocessedClientCancellation(order)) {
      return {
        kind: "abnormal",
        billingSource: "zero",
        costReady: true,
        zeroCostReason: "unprocessed-client-cancel",
        settlementGross: null,
        postCommissionPayout: null,
        platformPayout: 0,
        platformDeduction: 0,
        commissionFee: 0,
        logisticsFee: 0,
        acquiringFee: 0,
        penaltyFee: 0,
        deductionFee: 0,
        storageFee: 0,
        acceptanceFee: 0,
        additionalPayment: 0,
        productPrincipal: 0,
        handlingFee: 0,
        productCost: 0,
        incomeEstimate: 0,
        costExpense: 0,
        profit: 0,
        profitRate: 0,
      };
    }

    const hasActualSettlement = Boolean(order.settlement?.matched);
    const logistics = hasActualSettlement
      ? Math.abs(Number(order.settlement?.logisticsFee || 0))
      : estimatedLastMile;
    const costExpense = costReady ? logistics + handling : null;
    const loss = costExpense === null ? null : -costExpense;
    return {
      kind: "abnormal",
      billingSource: hasActualSettlement ? "actual" : "estimated",
      costReady,
      zeroCostReason: null,
      settlementGross: null,
      postCommissionPayout: null,
      platformPayout: hasActualSettlement ? -logistics : null,
      platformDeduction: hasActualSettlement || costReady ? -logistics : null,
      commissionFee: 0,
      logisticsFee: -logistics,
      acquiringFee: 0,
      penaltyFee: 0,
      deductionFee: 0,
      storageFee: 0,
      acceptanceFee: 0,
      additionalPayment: 0,
      productPrincipal: 0,
      handlingFee: costReady ? -handling : 0,
      productCost: costReady ? -handling : null,
      incomeEstimate: 0,
      costExpense,
      profit: loss,
      profitRate: loss !== null && order.amount > 0 ? (loss / order.amount) * 100 : null,
    };
  }

  if (order.outcome !== "success" || !order.settlement?.matched) {
    return waitingFinancial(costReady);
  }

  const settlementGross = Number(order.settlement.transactionAmount || order.amount || 0);
  const postCommissionPayout = Number(order.settlement.forPay || 0);
  const platformPayout = Number(order.settlement.netPayout || 0);
  const commissionFee = settlementGross - postCommissionPayout;
  const logisticsFee = Math.abs(Number(order.settlement.logisticsFee || 0));
  const acquiringFee = Math.abs(Number(order.settlement.acquiringFee || 0));
  const penaltyFee = Math.abs(Number(order.settlement.penaltyFee || 0));
  const deductionFee = Math.abs(Number(order.settlement.deductionFee || 0));
  const storageFee = Math.abs(Number(order.settlement.storageFee || 0));
  const acceptanceFee = Math.abs(Number(order.settlement.acceptanceFee || 0));
  const additionalPayment = Number(order.settlement.additionalPayment || 0);
  const productCost = costReady ? principal + handling : null;
  const platformDeduction = settlementGross - platformPayout;
  const costExpense = productCost === null ? null : platformDeduction + productCost;
  const profit = costExpense === null ? null : settlementGross - costExpense;

  return {
    kind: "settled",
    billingSource: "actual",
    costReady,
    zeroCostReason: null,
    settlementGross,
    postCommissionPayout,
    platformPayout,
    platformDeduction,
    commissionFee,
    logisticsFee,
    acquiringFee,
    penaltyFee,
    deductionFee,
    storageFee,
    acceptanceFee,
    additionalPayment,
    productPrincipal: costReady ? principal : 0,
    handlingFee: costReady ? handling : 0,
    productCost,
    incomeEstimate: settlementGross,
    costExpense,
    profit,
    profitRate: profit !== null && order.amount > 0 ? (profit / order.amount) * 100 : null,
  };
}
