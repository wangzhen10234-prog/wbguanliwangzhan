import assert from "node:assert/strict";
import test from "node:test";
import { evaluateProductAudit } from "../app/_lib/product-audit.ts";

const strongCard = {
  nmID: 1001,
  subjectID: 10,
  subjectName: "Поводки",
  vendorCode: "wz-test",
  brand: "WB Insight",
  title: "Автоматический поводок рулетка для собак 5 м прочный",
  description: "Удобный автоматический поводок для ежедневных прогулок. Длина 5 м, прочный корпус, надежный механизм. Подходит для собак. Материал и размер указаны в характеристиках.\n— Комплект: поводок 1 шт.\n— Используйте согласно инструкции.".repeat(4),
  dimensions: { width: 13, height: 6, length: 21, weightBrutto: 0.3, isValid: true },
  photos: Array.from({ length: 7 }, (_, index) => ({ big: `https://example.com/${index}.webp`, c246x328: `https://example.com/s-${index}.webp` })),
  characteristics: Array.from({ length: 9 }, (_, index) => ({ id: index, name: `Характеристика ${index}`, value: [`Значение ${index}`] })),
};

const strongFunnel = {
  selected: { openCount: 500, cartCount: 80, orderCount: 20, buyoutCount: 18, conversions: { addToCartPercent: 16, cartToOrderPercent: 25, buyoutPercent: 90 } },
  comparison: { orderCountDynamic: 15 },
};

test("keeps every audit score within 0-100 and explains the score", () => {
  const result = evaluateProductAudit(strongCard, strongFunnel);
  for (const score of Object.values(result.scores)) assert.ok(score >= 0 && score <= 100);
  assert.equal(result.nmId, 1001);
  assert.ok(result.imageEvidence.length >= 3);
  assert.ok(result.titleEvidence.length >= 3);
  assert.ok(result.descriptionEvidence.length >= 3);
  assert.ok(result.attributeEvidence.length >= 3);
});

test("flags empty content and low conversion as high-priority without inventing search data", () => {
  const result = evaluateProductAudit({ nmID: 2002, vendorCode: "empty" }, {
    selected: { openCount: 300, cartCount: 4, orderCount: 1, conversions: { addToCartPercent: 1.3, cartToOrderPercent: 2, buyoutPercent: 40 } },
    comparison: { orderCountDynamic: -60 },
  });
  assert.equal(result.priority, "critical");
  assert.equal(result.photoCount, 0);
  assert.equal(result.descriptionLength, 0);
  assert.ok(result.issues.some((issue) => issue.area === "image" && issue.severity === "high"));
  assert.ok(result.issues.some((issue) => issue.area === "funnel" && issue.severity === "high"));
});

test("uses a neutral funnel score when traffic is too small for a reliable conclusion", () => {
  const result = evaluateProductAudit(strongCard, { selected: { openCount: 8 } });
  assert.equal(result.scores.funnel, 50);
  assert.ok(!result.issues.some((issue) => issue.area === "funnel" && issue.title.includes("偏低")));
});
