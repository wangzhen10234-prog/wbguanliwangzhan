export type PromotionCostInput = {
  updNum?: number;
  updTime?: string | null;
  updSum?: number;
  advertId?: number;
  campName?: string;
  advertType?: number;
  paymentType?: string;
  advertStatus?: number;
};

export type PromotionCostMatchLevel = "single_amount" | "document_total" | "day_total" | "multiple_amounts" | "none";

function cents(value: unknown) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.round(Math.abs(amount) * 100) : 0;
}

export function promotionCostRowKey(row: PromotionCostInput, index: number) {
  return `${Number(row.updNum || 0)}:${Number(row.advertId || 0)}:${String(row.updTime || "pending")}:${cents(row.updSum)}:${index}`;
}

export function matchPromotionCosts(rows: PromotionCostInput[], targetAmount: number) {
  const target = cents(targetAmount);
  const normalized = rows.map((row, index) => ({ ...row, key: promotionCostRowKey(row, index), amountCents: cents(row.updSum) }));
  const exactRows = normalized.filter((row) => target > 0 && row.amountCents === target);
  if (exactRows.length === 1) {
    return {
      level: "single_amount" as const,
      candidateKeys: exactRows.map((row) => row.key),
      reason: "同一查询日内有且仅有一条推广费用金额与本笔财务扣款一致",
      targetCents: target,
      dayTotalCents: normalized.reduce((sum, row) => sum + row.amountCents, 0),
    };
  }

  const byDocument = new Map<number, typeof normalized>();
  for (const row of normalized) {
    const documentNumber = Number(row.updNum || 0);
    if (documentNumber <= 0) continue;
    const group = byDocument.get(documentNumber) || [];
    group.push(row);
    byDocument.set(documentNumber, group);
  }
  const exactDocumentGroups = [...byDocument.values()].filter((group) => target > 0 && group.reduce((sum, row) => sum + row.amountCents, 0) === target);
  if (exactDocumentGroups.length === 1) {
    return {
      level: "document_total" as const,
      candidateKeys: exactDocumentGroups[0].map((row) => row.key),
      reason: "同一查询日内有且仅有一组推广单据合计与本笔财务扣款一致",
      targetCents: target,
      dayTotalCents: normalized.reduce((sum, row) => sum + row.amountCents, 0),
    };
  }

  const dayTotal = normalized.reduce((sum, row) => sum + row.amountCents, 0);
  if (target > 0 && normalized.length > 0 && dayTotal === target) {
    return {
      level: "day_total" as const,
      candidateKeys: normalized.map((row) => row.key),
      reason: "该查询日全部推广费用合计与本笔财务扣款一致",
      targetCents: target,
      dayTotalCents: dayTotal,
    };
  }

  if (exactRows.length > 1) {
    return {
      level: "multiple_amounts" as const,
      candidateKeys: exactRows.map((row) => row.key),
      reason: "同一查询日有多条推广费用金额相同，无法唯一定位",
      targetCents: target,
      dayTotalCents: dayTotal,
    };
  }

  return {
    level: "none" as const,
    candidateKeys: [] as string[],
    reason: normalized.length ? "同一查询日未找到金额一致的推广费用记录" : "该查询日未返回推广费用记录",
    targetCents: target,
    dayTotalCents: dayTotal,
  };
}
