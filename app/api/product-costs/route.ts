import { asc } from "drizzle-orm";
import { getDb } from "../../../db";
import { productCosts } from "../../../db/schema";

const JSON_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

const SEED_ROWS: Array<typeof productCosts.$inferInsert> = [
  { sellerSku: "wz311B", internalSku: "311B", category: "宠物牵引绳", specification: "5米黑色", lengthCm: 21, widthCm: 13, heightCm: 6, weightG: 270, productCostRub: 220, exchangeRate: 11.2, productCostCny: 19.64, handlingFeeCny: 5, lastMileFeeCny: 9.28, commissionRate: 19, activityDiscountRate: 5, returnLossRate: 10, referencePriceCny: 87 },
  { sellerSku: "wz311P", internalSku: "311P", category: "宠物牵引绳", specification: "5米粉色", lengthCm: 21, widthCm: 13, heightCm: 6, weightG: 270, productCostRub: 220, exchangeRate: 11.2, productCostCny: 19.64, handlingFeeCny: 5, lastMileFeeCny: 9.28, commissionRate: 19, activityDiscountRate: 5, returnLossRate: 10, referencePriceCny: 87 },
  { sellerSku: "wz310B", internalSku: "310B", category: "宠物牵引绳", specification: "5米黑色", lengthCm: 21, widthCm: 13, heightCm: 6, weightG: 270, exchangeRate: 11.2, productCostCny: 21.5, handlingFeeCny: 5, lastMileFeeCny: 9.28, commissionRate: 19, activityDiscountRate: 5, returnLossRate: 10, referencePriceCny: 91 },
  { sellerSku: "wz810B", internalSku: "810B", category: "宠物牵引绳", specification: "5米", lengthCm: 21, widthCm: 13, heightCm: 6, weightG: 330, productCostRub: 350, exchangeRate: 11.2, productCostCny: 31.25, handlingFeeCny: 5, lastMileFeeCny: 9.28, commissionRate: 19, activityDiscountRate: 5, returnLossRate: 10, referencePriceCny: 116 },
  { sellerSku: "wz810G", internalSku: "810G", category: "宠物牵引绳", specification: "5米", lengthCm: 21, widthCm: 13, heightCm: 6, weightG: 330, productCostRub: 350, exchangeRate: 11.2, productCostCny: 31.25, handlingFeeCny: 5, lastMileFeeCny: 9.28, commissionRate: 19, activityDiscountRate: 5, returnLossRate: 10, referencePriceCny: 116 },
];

type CostPayload = {
  sellerSku?: unknown;
  nmId?: unknown;
  internalSku?: unknown;
  category?: unknown;
  specification?: unknown;
  lengthCm?: unknown;
  widthCm?: unknown;
  heightCm?: unknown;
  weightG?: unknown;
  productCostRub?: unknown;
  exchangeRate?: unknown;
  productCostCny?: unknown;
  handlingFeeCny?: unknown;
  lastMileFeeCny?: unknown;
  commissionRate?: unknown;
  adRate?: unknown;
  activityDiscountRate?: unknown;
  returnLossRate?: unknown;
  referencePriceCny?: unknown;
  notes?: unknown;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function stringField(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function numericField(value: unknown, max = 1_000_000_000) {
  const number = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0 || number > max) throw new Error("NUMERIC_FIELD_INVALID");
  return Math.round(number * 10_000) / 10_000;
}

function normalizePayload(payload: CostPayload): typeof productCosts.$inferInsert {
  const sellerSku = stringField(payload.sellerSku, 120);
  if (!sellerSku) throw new Error("SELLER_SKU_REQUIRED");
  const exchangeRate = numericField(payload.exchangeRate, 10_000);
  if (exchangeRate === 0) throw new Error("EXCHANGE_RATE_REQUIRED");
  const nmId = numericField(payload.nmId, Number.MAX_SAFE_INTEGER);
  return {
    sellerSku,
    nmId: nmId ? Math.trunc(nmId) : null,
    internalSku: stringField(payload.internalSku, 120),
    category: stringField(payload.category, 120),
    specification: stringField(payload.specification, 240),
    lengthCm: numericField(payload.lengthCm, 100_000),
    widthCm: numericField(payload.widthCm, 100_000),
    heightCm: numericField(payload.heightCm, 100_000),
    weightG: numericField(payload.weightG, 100_000_000),
    productCostRub: numericField(payload.productCostRub),
    exchangeRate,
    productCostCny: numericField(payload.productCostCny),
    handlingFeeCny: numericField(payload.handlingFeeCny),
    lastMileFeeCny: numericField(payload.lastMileFeeCny),
    commissionRate: numericField(payload.commissionRate, 100),
    adRate: numericField(payload.adRate, 100),
    activityDiscountRate: numericField(payload.activityDiscountRate, 100),
    returnLossRate: numericField(payload.returnLossRate, 100),
    referencePriceCny: numericField(payload.referencePriceCny),
    notes: stringField(payload.notes, 1000),
    updatedAt: new Date().toISOString(),
  };
}

function databaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("no such table")) return json({ error: "产品成本表正在初始化，请稍后刷新" }, 503);
  return json({ error: "产品成本数据暂时无法保存" }, 500);
}

export async function GET() {
  try {
    const db = getDb();
    await db.insert(productCosts).values(SEED_ROWS).onConflictDoNothing();
    const rows = await db.select().from(productCosts).orderBy(asc(productCosts.sellerSku));
    return json({ rows });
  } catch (error) {
    return databaseError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as CostPayload;
    const value = normalizePayload(body);
    const db = getDb();
    const [row] = await db
      .insert(productCosts)
      .values(value)
      .onConflictDoUpdate({
        target: productCosts.sellerSku,
        set: {
          nmId: value.nmId,
          internalSku: value.internalSku,
          category: value.category,
          specification: value.specification,
          lengthCm: value.lengthCm,
          widthCm: value.widthCm,
          heightCm: value.heightCm,
          weightG: value.weightG,
          productCostRub: value.productCostRub,
          exchangeRate: value.exchangeRate,
          productCostCny: value.productCostCny,
          handlingFeeCny: value.handlingFeeCny,
          lastMileFeeCny: value.lastMileFeeCny,
          commissionRate: value.commissionRate,
          adRate: value.adRate,
          activityDiscountRate: value.activityDiscountRate,
          returnLossRate: value.returnLossRate,
          referencePriceCny: value.referencePriceCny,
          notes: value.notes,
          updatedAt: value.updatedAt,
        },
      })
      .returning();
    return json({ row });
  } catch (error) {
    if (error instanceof Error && error.message === "SELLER_SKU_REQUIRED") return json({ error: "卖家商品编号不能为空" }, 400);
    if (error instanceof Error && error.message === "EXCHANGE_RATE_REQUIRED") return json({ error: "汇率必须大于 0" }, 400);
    if (error instanceof Error && error.message === "NUMERIC_FIELD_INVALID") return json({ error: "金额、比例或尺寸输入无效" }, 400);
    return databaseError(error);
  }
}
