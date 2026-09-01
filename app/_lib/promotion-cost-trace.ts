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

export type PromotionCostMatchLevel = "document_total" | "single_amount" | "period_total" | "multiple_documents" | "multiple_amounts" | "none";

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
  const periodTotalCents = normalized.reduce((sum, row) => sum + row.amountCents, 0);
  const byDocument = new Map<number, typeof normalized>();
  for (const row of normalized) {
    const documentNumber = Number(row.updNum || 0);
    if (documentNumber <= 0) continue;
    const group = byDocument.get(documentNumber) || [];
    group.push(row);
    byDocument.set(documentNumber, group);
  }

  // A finance deduction can settle several campaign charges from several days in one UPD.
  // Therefore a complete UPD total is always a stronger match than one coincidentally equal row.
  const exactDocumentGroups = [...byDocument.entries()].filter(([, group]) => target > 0 && group.reduce((sum, row) => sum + row.amountCents, 0) === target);
  if (exactDocumentGroups.length === 1) {
    const [matchedDocumentNumber, group] = exactDocumentGroups[0];
    return {
      level: "document_total" as const,
      candidateKeys: group.map((row) => row.key),
      reason: `完整账期内 UPD ${matchedDocumentNumber} 的推广费用合计与本笔扣款完全一致`,
      targetCents: target,
      periodTotalCents,
      matchedDocumentNumber,
    };
  }
  if (exactDocumentGroups.length > 1) {
    return {
      level: "multiple_documents" as const,
      candidateKeys: exactDocumentGroups.flatMap(([, group]) => group.map((row) => row.key)),
      reason: "完整账期内有多组 UPD 单据合计与本笔扣款相同，无法唯一归属",
      targetCents: target,
      periodTotalCents,
      matchedDocumentNumber: 0,
    };
  }

  // A single exact row is only safe as a fallback when it has no multi-row UPD group.
  const exactRows = normalized.filter((row) => target > 0 && row.amountCents === target && (Number(row.updNum || 0) <= 0 || (byDocument.get(Number(row.updNum))?.length || 0) === 1));
  if (exactRows.length === 1) {
    return {
      level: "single_amount" as const,
      candidateKeys: exactRows.map((row) => row.key),
      reason: "完整账期内仅一条独立推广费用金额与本笔财务扣款一致",
      targetCents: target,
      periodTotalCents,
      matchedDocumentNumber: Number(exactRows[0].updNum || 0),
    };
  }
  if (exactRows.length > 1) {
    return {
      level: "multiple_amounts" as const,
      candidateKeys: exactRows.map((row) => row.key),
      reason: "完整账期内有多条独立推广费用金额相同，无法唯一定位",
      targetCents: target,
      periodTotalCents,
      matchedDocumentNumber: 0,
    };
  }

  if (target > 0 && normalized.length > 0 && periodTotalCents === target) {
    return {
      level: "period_total" as const,
      candidateKeys: normalized.map((row) => row.key),
      reason: "完整查询账期内全部推广费用合计与本笔扣款一致",
      targetCents: target,
      periodTotalCents,
      matchedDocumentNumber: 0,
    };
  }

  return {
    level: "none" as const,
    candidateKeys: [] as string[],
    reason: normalized.length ? "完整账期内未找到金额一致的独立记录或 UPD 单据组" : "完整账期内未返回推广费用记录",
    targetCents: target,
    periodTotalCents,
    matchedDocumentNumber: 0,
  };
}
