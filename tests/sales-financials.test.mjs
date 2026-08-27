import assert from "node:assert/strict";
import test from "node:test";
import { calculateOrderFinancial, isCurrentValidNewOrder, isUnprocessedClientCancellation } from "../app/_lib/sales-financials.ts";

const cost = {
  lengthCm: 10,
  widthCm: 10,
  heightCm: 10,
  productCostRub: 0,
  exchangeRate: 0,
  productCostCny: 40,
  handlingFeeCny: 5,
};

test("treats only a new order declined by the client before processing as zero expenditure", () => {
  const canceledBeforeProcessing = {
    amount: 100,
    outcome: "abnormal",
    supplierStatus: "new",
    wbStatus: "declined_by_client",
    settlement: null,
  };
  assert.equal(isUnprocessedClientCancellation(canceledBeforeProcessing), true);

  const result = calculateOrderFinancial(canceledBeforeProcessing, cost);
  assert.equal(result.billingSource, "zero");
  assert.equal(result.zeroCostReason, "unprocessed-client-cancel");
  assert.equal(result.costExpense, 0);
  assert.equal(result.productCost, 0);
  assert.equal(result.logisticsFee, 0);
  assert.equal(result.profit, 0);
});

test("counts only a still-waiting new order as a current valid new order", () => {
  assert.equal(isCurrentValidNewOrder({ outcome: "pending", supplierStatus: "new", wbStatus: "waiting" }), true);
  assert.equal(isCurrentValidNewOrder({ outcome: "abnormal", supplierStatus: "new", wbStatus: "declined_by_client" }), false);
  assert.equal(isCurrentValidNewOrder({ outcome: "pending", supplierStatus: "confirm", wbStatus: "waiting" }), false);
});

test("does not erase costs for a refusal after the order entered delivery", () => {
  const result = calculateOrderFinancial({
    amount: 100,
    outcome: "abnormal",
    supplierStatus: "complete",
    wbStatus: "canceled_by_client",
    settlement: null,
  }, cost);

  assert.equal(result.zeroCostReason, null);
  assert.equal(result.billingSource, "estimated");
  assert.equal(result.costExpense, 13);
  assert.equal(result.profit, -13);
});

test("uses an actual zero logistics charge instead of replacing it with an estimate", () => {
  const result = calculateOrderFinancial({
    amount: 100,
    outcome: "abnormal",
    supplierStatus: "complete",
    wbStatus: "defect",
    settlement: {
      matched: true,
      transactionAmount: 0,
      forPay: 0,
      logisticsFee: 0,
      acquiringFee: 0,
      penaltyFee: 0,
      deductionFee: 0,
      storageFee: 0,
      acceptanceFee: 0,
      additionalPayment: 0,
      netPayout: 0,
    },
  }, cost);

  assert.equal(result.billingSource, "actual");
  assert.equal(result.costExpense, 5);
  assert.equal(result.profit, -5);
});

test("reconciles a settled order as income minus all platform and product costs", () => {
  const result = calculateOrderFinancial({
    amount: 100,
    outcome: "success",
    supplierStatus: "complete",
    wbStatus: "sold",
    settlement: {
      matched: true,
      transactionAmount: 100,
      forPay: 80,
      logisticsFee: 15,
      acquiringFee: 2,
      penaltyFee: 0,
      deductionFee: 3,
      storageFee: 0,
      acceptanceFee: 0,
      additionalPayment: 0,
      netPayout: 60,
    },
  }, cost);

  assert.equal(result.incomeEstimate, 100);
  assert.equal(result.platformDeduction, 40);
  assert.equal(result.productCost, 45);
  assert.equal(result.costExpense, 85);
  assert.equal(result.profit, 15);
  assert.equal(result.incomeEstimate - result.costExpense, result.profit);
  assert.equal(result.platformPayout - result.productCost, result.profit);
});

test("keeps pending and unbilled orders out of profit and expenditure totals", () => {
  const result = calculateOrderFinancial({
    amount: 100,
    outcome: "pending",
    supplierStatus: "new",
    wbStatus: "waiting",
    settlement: null,
  }, cost);

  assert.equal(result.kind, "waiting");
  assert.equal(result.incomeEstimate, null);
  assert.equal(result.costExpense, null);
  assert.equal(result.profit, null);
});
