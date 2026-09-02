import { and, asc, eq, inArray, or } from "drizzle-orm";
import { getDb } from "../../../db";
import { productCostDeletions, productCosts, wbSyncSnapshots } from "../../../db/schema";
import { normalizeProductSku } from "../../_lib/product-cost-aliases";
import { matchesProductDeletion, productDeletionIdentity } from "../../_lib/product-deletions";
import { DEFAULT_STOREFRONT_ID } from "../../_lib/storefronts";
import { requestedStorefront } from "../../_lib/server-storefront";

const LEGACY_SHARED_PRODUCT_SCOPE_ID = "shared-product-register";
const SECONDARY_STOREFRONT_ID = "cl";
const SEPARATION_MIGRATION_KEY = "product-register-separation-v1:cl";

const JSON_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

const SEED_ROWS: Array<typeof productCosts.$inferInsert> = [
  { sellerSku: "wz311B", internalSku: "311B", category: "宠物牵引绳", specification: "5米黑色", lengthCm: 21, widthCm: 13, heightCm: 6, weightG: 270, productCostRub: 220, exchangeRate: 11.2, productCostCny: 19.64, handlingFeeCny: 5, lastMileFeeCny: 9.28, commissionRate: 19, adRate: 0, activityDiscountRate: 5, returnLossRate: 10, referencePriceCny: 87, targetMarginRate: 10, sortOrder: 100 },
  { sellerSku: "wz311P", internalSku: "311P", category: "宠物牵引绳", specification: "5米粉色", lengthCm: 21, widthCm: 13, heightCm: 6, weightG: 270, productCostRub: 220, exchangeRate: 11.2, productCostCny: 19.64, handlingFeeCny: 5, lastMileFeeCny: 9.28, commissionRate: 19, adRate: 0, activityDiscountRate: 5, returnLossRate: 10, referencePriceCny: 87, targetMarginRate: 10, sortOrder: 200 },
  { sellerSku: "wz310B", internalSku: "310B", category: "宠物牵引绳", specification: "5米黑色", lengthCm: 21, widthCm: 13, heightCm: 6, weightG: 270, productCostRub: 0, exchangeRate: 0, productCostCny: 21.5, handlingFeeCny: 5, lastMileFeeCny: 9.28, commissionRate: 19, adRate: 0, activityDiscountRate: 5, returnLossRate: 10, referencePriceCny: 91, targetMarginRate: 10, sortOrder: 300 },
  { sellerSku: "wz810B", internalSku: "810B", category: "宠物牵引绳", specification: "5米", lengthCm: 21, widthCm: 13, heightCm: 6, weightG: 330, productCostRub: 350, exchangeRate: 11.2, productCostCny: 31.25, handlingFeeCny: 5, lastMileFeeCny: 9.28, commissionRate: 19, adRate: 0, activityDiscountRate: 5, returnLossRate: 10, referencePriceCny: 116, targetMarginRate: 10, sortOrder: 400 },
  { sellerSku: "wz810G", internalSku: "810G", category: "宠物牵引绳", specification: "5米", lengthCm: 21, widthCm: 13, heightCm: 6, weightG: 330, productCostRub: 350, exchangeRate: 11.2, productCostCny: 31.25, handlingFeeCny: 5, lastMileFeeCny: 9.28, commissionRate: 19, adRate: 0, activityDiscountRate: 5, returnLossRate: 10, referencePriceCny: 116, targetMarginRate: 10, sortOrder: 500 },
  { sellerSku: "wz810P", internalSku: "810P", category: "宠物牵引绳", specification: "5米", lengthCm: 21, widthCm: 13, heightCm: 6, weightG: 330, productCostRub: 350, exchangeRate: 11.2, productCostCny: 31.25, handlingFeeCny: 5, lastMileFeeCny: 9.28, commissionRate: 19, adRate: 0, activityDiscountRate: 5, returnLossRate: 10, referencePriceCny: 116, targetMarginRate: 10, sortOrder: 600 },
  { sellerSku: "wz708-8", internalSku: "708-8", category: "宠物牵引绳", specification: "8米", lengthCm: 23, widthCm: 13, heightCm: 6, weightG: 480, productCostRub: 550, exchangeRate: 11.2, productCostCny: 49.11, handlingFeeCny: 5, lastMileFeeCny: 9.59, commissionRate: 19, adRate: 0, activityDiscountRate: 5, returnLossRate: 10, referencePriceCny: 162, targetMarginRate: 10, sortOrder: 700 },
  { sellerSku: "wz8286", internalSku: "8286", category: "宠物牵引绳", specification: "5米", lengthCm: 23, widthCm: 24, heightCm: 6, weightG: 410, productCostRub: 450, exchangeRate: 11.2, productCostCny: 40.18, handlingFeeCny: 5, lastMileFeeCny: 12.62, commissionRate: 19, adRate: 0, activityDiscountRate: 5, returnLossRate: 10, referencePriceCny: 147, targetMarginRate: 10, sortOrder: 800 },
  { sellerSku: "wz316", internalSku: "316", category: "宠物牵引绳", specification: "黑色", lengthCm: 21, widthCm: 13, heightCm: 6, weightG: 300, productCostRub: 250, exchangeRate: 11.2, productCostCny: 22.32, handlingFeeCny: 5, lastMileFeeCny: 9.28, commissionRate: 19, adRate: 0, activityDiscountRate: 5, returnLossRate: 10, referencePriceCny: 93, targetMarginRate: 10, sortOrder: 900 },
  { sellerSku: "wz313", internalSku: "313", category: "宠物牵引绳", specification: "黑色", lengthCm: 21, widthCm: 13, heightCm: 6, weightG: 300, productCostRub: 250, exchangeRate: 11.2, productCostCny: 22.32, handlingFeeCny: 5, lastMileFeeCny: 9.28, commissionRate: 19, adRate: 0, activityDiscountRate: 5, returnLossRate: 10, referencePriceCny: 93, targetMarginRate: 10, sortOrder: 1000 },
  { sellerSku: "wzC15", internalSku: "C15", category: "宠物牵引绳", specification: "黑色", lengthCm: 21, widthCm: 19, heightCm: 8, weightG: 620, productCostRub: 400, exchangeRate: 11.2, productCostCny: 35.71, handlingFeeCny: 5, lastMileFeeCny: 12.38, commissionRate: 19, adRate: 0, activityDiscountRate: 5, returnLossRate: 10, referencePriceCny: 135, targetMarginRate: 10, sortOrder: 1100 },
  { sellerSku: "wz708-8套装", internalSku: "708-8", category: "宠物牵引绳", specification: "8米", lengthCm: 23, widthCm: 13, heightCm: 8, weightG: 610, productCostRub: 600, exchangeRate: 11.2, productCostCny: 53.57, handlingFeeCny: 5, lastMileFeeCny: 10.78, commissionRate: 19, adRate: 0, activityDiscountRate: 5, returnLossRate: 10, referencePriceCny: 177, targetMarginRate: 10, sortOrder: 1200 },
  { sellerSku: "wzP1", internalSku: "p1", category: "拖把", specification: "白色", lengthCm: 43, widthCm: 29, heightCm: 26, weightG: 1825, productCostRub: 550, exchangeRate: 11.2, productCostCny: 49.11, handlingFeeCny: 5, lastMileFeeCny: 70.84, commissionRate: 23, adRate: 0, activityDiscountRate: 5, returnLossRate: 10, referencePriceCny: 343, targetMarginRate: 10, sortOrder: 1300 },
  { sellerSku: "wzz2", internalSku: "z2", category: "拖把", specification: "灰色", lengthCm: 43, widthCm: 29, heightCm: 26, weightG: 2075, productCostRub: 750, exchangeRate: 11.2, productCostCny: 66.96, handlingFeeCny: 5, lastMileFeeCny: 70.84, commissionRate: 23, adRate: 0, activityDiscountRate: 5, returnLossRate: 10, referencePriceCny: 392, targetMarginRate: 10, sortOrder: 1400 },
  { sellerSku: "wzg10", internalSku: "g10", category: "拖把", specification: "蓝色", lengthCm: 43, widthCm: 29, heightCm: 26, weightG: 2210, productCostRub: 800, exchangeRate: 11.2, productCostCny: 71.43, handlingFeeCny: 5, lastMileFeeCny: 70.84, commissionRate: 23, adRate: 0, activityDiscountRate: 5, returnLossRate: 10, referencePriceCny: 405, targetMarginRate: 10, sortOrder: 1500 },
  { sellerSku: "wzL2", internalSku: "L2", category: "拖把", specification: "白色", lengthCm: 30, widthCm: 25, heightCm: 49, weightG: 1646, productCostRub: 550, exchangeRate: 11.2, productCostCny: 49.11, handlingFeeCny: 5, lastMileFeeCny: 79.5, commissionRate: 23, adRate: 0, activityDiscountRate: 5, returnLossRate: 10, referencePriceCny: 367, targetMarginRate: 10, sortOrder: 1600 },
  { sellerSku: "wzP6", internalSku: "P6", category: "拖把", specification: "灰色", lengthCm: 29, widthCm: 26, heightCm: 44, weightG: 2016, productCostRub: 700, exchangeRate: 11.2, productCostCny: 62.5, handlingFeeCny: 5, lastMileFeeCny: 72.35, commissionRate: 23, adRate: 0, activityDiscountRate: 5, returnLossRate: 10, referencePriceCny: 384, targetMarginRate: 10, sortOrder: 1700 },
  { sellerSku: "wzgs01", internalSku: "gs01", category: "拖把", specification: "灰色", lengthCm: 50, widthCm: 41, heightCm: 10, weightG: 1295, productCostRub: 400, exchangeRate: 11.2, productCostCny: 35.71, handlingFeeCny: 5, lastMileFeeCny: 47, commissionRate: 23, adRate: 0, activityDiscountRate: 5, returnLossRate: 10, referencePriceCny: 241, targetMarginRate: 10, sortOrder: 1800 },
  { sellerSku: "wzL5", internalSku: "L5", category: "拖把", specification: "白色", lengthCm: 32, widthCm: 31, heightCm: 12, weightG: 1300, productCostRub: 600, exchangeRate: 11.2, productCostCny: 53.57, handlingFeeCny: 5, lastMileFeeCny: 29.81, commissionRate: 23, adRate: 0, activityDiscountRate: 5, returnLossRate: 10, referencePriceCny: 243, targetMarginRate: 10, sortOrder: 1900 },
  { sellerSku: "wzS2", internalSku: "s2", category: "扫把", specification: "白，蓝", lengthCm: 34, widthCm: 28, heightCm: 12, weightG: 664, productCostRub: 250, exchangeRate: 11.2, productCostCny: 22.32, handlingFeeCny: 5, lastMileFeeCny: 28.85, commissionRate: 23, adRate: 0, activityDiscountRate: 5, returnLossRate: 20, referencePriceCny: 191, targetMarginRate: 10, sortOrder: 2000 },
  { sellerSku: "wzS3", internalSku: "S3", category: "扫把", specification: "灰白", lengthCm: 34, widthCm: 28, heightCm: 12, weightG: 1068, productCostRub: 500, exchangeRate: 11.2, productCostCny: 44.64, handlingFeeCny: 5, lastMileFeeCny: 28.85, commissionRate: 23, adRate: 0, activityDiscountRate: 5, returnLossRate: 10, referencePriceCny: 216, targetMarginRate: 10, sortOrder: 2100 },
  { sellerSku: "wzS4", internalSku: "S4", category: "扫把", specification: "灰白", lengthCm: 34, widthCm: 28, heightCm: 12, weightG: 1180, productCostRub: 550, exchangeRate: 11.2, productCostCny: 49.11, handlingFeeCny: 5, lastMileFeeCny: 28.85, commissionRate: 23, adRate: 0, activityDiscountRate: 5, returnLossRate: 10, referencePriceCny: 228, targetMarginRate: 10, sortOrder: 2200 },
  { sellerSku: "wz X型架B", internalSku: "X型架B", category: "衣架", specification: "黑色", lengthCm: 54, widthCm: 44, heightCm: 9, weightG: 2.145, productCostRub: 750, exchangeRate: 11.2, productCostCny: 66.96, handlingFeeCny: 5, lastMileFeeCny: 48.77, commissionRate: 24, adRate: 0, activityDiscountRate: 5, returnLossRate: 10, referencePriceCny: 338, targetMarginRate: 10, sortOrder: 2300 },
  { sellerSku: "wz X型架w", internalSku: "X型架w", category: "衣架", specification: "白色", lengthCm: 54, widthCm: 44, heightCm: 9, weightG: 2.145, productCostRub: 750, exchangeRate: 11.2, productCostCny: 66.96, handlingFeeCny: 5, lastMileFeeCny: 48.77, commissionRate: 24, adRate: 0, activityDiscountRate: 5, returnLossRate: 10, referencePriceCny: 338, targetMarginRate: 10, sortOrder: 2400 },
  { sellerSku: "wzTW-016彩色", internalSku: "TW-016彩色", category: "衣架", specification: "白色", lengthCm: 93, widthCm: 9, heightCm: 9, weightG: 1500, productCostRub: 550, exchangeRate: 11.2, productCostCny: 49.11, handlingFeeCny: 5, lastMileFeeCny: 21.07, commissionRate: 24, adRate: 0, activityDiscountRate: 5, returnLossRate: 10, referencePriceCny: 211, targetMarginRate: 10, sortOrder: 2500 },
  { sellerSku: "wzK804", internalSku: "K804", category: "风扇", specification: "紫色、白色", lengthCm: 19, widthCm: 16, heightCm: 24, weightG: 753, productCostRub: 650, exchangeRate: 11.2, productCostCny: 58.04, handlingFeeCny: 5, lastMileFeeCny: 20.59, commissionRate: 18, adRate: 0, activityDiscountRate: 5, returnLossRate: 10, referencePriceCny: 210, targetMarginRate: 10, sortOrder: 2600 },
  { sellerSku: "wzK801", internalSku: "K801", category: "风扇", specification: "灰紫色、白灰色、粉红色", lengthCm: 19, widthCm: 7, heightCm: 7, weightG: 281, productCostRub: 450, exchangeRate: 11.2, productCostCny: 40.18, handlingFeeCny: 5, lastMileFeeCny: 7.86, commissionRate: 18, adRate: 0, activityDiscountRate: 5, returnLossRate: 10, referencePriceCny: 133, targetMarginRate: 10, sortOrder: 2700 },
  { sellerSku: "垃圾袋", internalSku: "垃圾袋1", category: "垃圾袋", specification: "彩色", lengthCm: 18, widthCm: 7, heightCm: 2, weightG: 95, productCostRub: 50, exchangeRate: 11.2, productCostCny: 4.46, handlingFeeCny: 5, lastMileFeeCny: 6.5, commissionRate: 19, adRate: 0, activityDiscountRate: 5, returnLossRate: 10, referencePriceCny: 41, targetMarginRate: 10, sortOrder: 2800 },
  { sellerSku: "wz0090", internalSku: "0090", category: "置物架", specification: "白色", lengthCm: 92, widthCm: 27, heightCm: 7, weightG: 2345, productCostRub: 650, exchangeRate: 11.2, productCostCny: 58.04, handlingFeeCny: 5, lastMileFeeCny: 40.78, commissionRate: 20, adRate: 0, activityDiscountRate: 5, returnLossRate: 10, referencePriceCny: 270, targetMarginRate: 10, sortOrder: 2900 },
  { sellerSku: "wz0091", internalSku: "0091", category: "置物架", specification: "白色", lengthCm: 92, widthCm: 27, heightCm: 7, weightG: 2610, productCostRub: 650, exchangeRate: 11.2, productCostCny: 58.04, handlingFeeCny: 5, lastMileFeeCny: 40.78, commissionRate: 20, adRate: 0, activityDiscountRate: 5, returnLossRate: 10, referencePriceCny: 270, targetMarginRate: 10, sortOrder: 3000 },
  { sellerSku: "wzA73", internalSku: "A73", category: "置物架", specification: "白色，黑色", lengthCm: 43, widthCm: 31, heightCm: 9, weightG: 2200, productCostRub: 650, exchangeRate: 11.2, productCostCny: 58.04, handlingFeeCny: 5, lastMileFeeCny: 29.99, commissionRate: 20, adRate: 0, activityDiscountRate: 5, returnLossRate: 10, referencePriceCny: 242, targetMarginRate: 10, sortOrder: 3100 },
  { sellerSku: "wzA75", internalSku: "A75", category: "置物架", specification: "白色，黑色", lengthCm: 46, widthCm: 32, heightCm: 9, weightG: 2900, productCostRub: 750, exchangeRate: 11.2, productCostCny: 66.96, handlingFeeCny: 5, lastMileFeeCny: 32.5, commissionRate: 20, adRate: 0, activityDiscountRate: 5, returnLossRate: 10, referencePriceCny: 271, targetMarginRate: 10, sortOrder: 3200 },
  { sellerSku: "wzA70", internalSku: "A70", category: "置物架", specification: "白色，黑色", lengthCm: 53, widthCm: 33, heightCm: 14, weightG: 3000, productCostRub: 0, exchangeRate: 0, productCostCny: 72, handlingFeeCny: 5, lastMileFeeCny: 54.97, commissionRate: 20, adRate: 0, activityDiscountRate: 5, returnLossRate: 10, referencePriceCny: 343, targetMarginRate: 10, sortOrder: 3300 },
  { sellerSku: "wz0055", internalSku: "0055", category: "落地衣架", specification: "黑色，白色", lengthCm: 120, widthCm: 35, heightCm: 5, weightG: 4300, productCostRub: 1250, exchangeRate: 11.2, productCostCny: 111.61, handlingFeeCny: 5, lastMileFeeCny: 48, commissionRate: 20, adRate: 0, activityDiscountRate: 5, returnLossRate: 10, referencePriceCny: 428, targetMarginRate: 10, sortOrder: 3400 },
  { sellerSku: "wz603", internalSku: "603", category: "落地衣架", specification: "白色", lengthCm: 63, widthCm: 25, heightCm: 6, weightG: 2950, productCostRub: 700, exchangeRate: 11.2, productCostCny: 62.5, handlingFeeCny: 5, lastMileFeeCny: 24.9, commissionRate: 20, adRate: 0, activityDiscountRate: 5, returnLossRate: 10, referencePriceCny: 240, targetMarginRate: 10, sortOrder: 3500 },
  { sellerSku: "wz8006", internalSku: "8006", category: "落地衣架", specification: "黑色", lengthCm: 67, widthCm: 12, heightCm: 8, weightG: 1400, productCostRub: 400, exchangeRate: 11.2, productCostCny: 35.71, handlingFeeCny: 5, lastMileFeeCny: 18.86, commissionRate: 20, adRate: 0, activityDiscountRate: 5, returnLossRate: 10, referencePriceCny: 155, targetMarginRate: 10, sortOrder: 3600 },
];

type CostPayload = {
  previousSellerSku?: unknown;
  sellerSku?: unknown;
  nmId?: unknown;
  imageUrl?: unknown;
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
  targetMarginRate?: unknown;
  sortOrder?: unknown;
  notes?: unknown;
};

type DeletePayload = {
  sellerSku?: unknown;
  persistedSellerSku?: unknown;
  nmId?: unknown;
};

type RestorePayload = {
  sellerSku?: unknown;
  nmId?: unknown;
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

function imageUrlField(value: unknown) {
  const imageUrl = stringField(value, 2048);
  if (!imageUrl) return "";
  try {
    const parsed = new URL(imageUrl);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("IMAGE_URL_INVALID");
    return parsed.href;
  } catch {
    throw new Error("IMAGE_URL_INVALID");
  }
}

function normalizePayload(payload: CostPayload, storeId: string): typeof productCosts.$inferInsert {
  const sellerSku = stringField(payload.sellerSku, 120);
  if (!sellerSku) throw new Error("SELLER_SKU_REQUIRED");
  const exchangeRate = numericField(payload.exchangeRate, 10_000);
  const productCostRub = numericField(payload.productCostRub);
  if (productCostRub > 0 && exchangeRate === 0) throw new Error("EXCHANGE_RATE_REQUIRED");
  const nmId = numericField(payload.nmId, Number.MAX_SAFE_INTEGER);
  return {
    storeId,
    sellerSku,
    nmId: nmId ? Math.trunc(nmId) : null,
    imageUrl: imageUrlField(payload.imageUrl),
    internalSku: stringField(payload.internalSku, 120),
    category: stringField(payload.category, 120),
    specification: stringField(payload.specification, 240),
    lengthCm: numericField(payload.lengthCm, 100_000),
    widthCm: numericField(payload.widthCm, 100_000),
    heightCm: numericField(payload.heightCm, 100_000),
    weightG: numericField(payload.weightG, 100_000_000),
    productCostRub,
    exchangeRate,
    productCostCny: numericField(payload.productCostCny),
    handlingFeeCny: numericField(payload.handlingFeeCny),
    lastMileFeeCny: numericField(payload.lastMileFeeCny),
    commissionRate: numericField(payload.commissionRate, 100),
    adRate: numericField(payload.adRate, 100),
    activityDiscountRate: numericField(payload.activityDiscountRate, 100),
    returnLossRate: numericField(payload.returnLossRate, 100),
    referencePriceCny: numericField(payload.referencePriceCny),
    targetMarginRate: numericField(payload.targetMarginRate, 100),
    sortOrder: numericField(payload.sortOrder, 1_000_000_000),
    notes: stringField(payload.notes, 1000),
    updatedAt: new Date().toISOString(),
  };
}

function databaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("no such table")) return json({ error: "产品成本表正在初始化，请稍后刷新" }, 503);
  return json({ error: "产品成本数据暂时无法保存" }, 500);
}

async function separateSecondaryProductRegister(db: ReturnType<typeof getDb>, storeId: string) {
  if (storeId !== SECONDARY_STOREFRONT_ID) return;
  const migration = await db.select({ cacheKey: wbSyncSnapshots.cacheKey }).from(wbSyncSnapshots)
    .where(eq(wbSyncSnapshots.cacheKey, SEPARATION_MIGRATION_KEY));
  if (migration.length > 0) return;

  // The short-lived shared register contains the user's completed CL matching.
  // Copy it atomically into CL, while leaving the untouched primary rows as-is.
  const sharedRows = await db.select().from(productCosts)
    .where(eq(productCosts.storeId, LEGACY_SHARED_PRODUCT_SCOPE_ID))
    .orderBy(asc(productCosts.sortOrder), asc(productCosts.sellerSku));
  const primaryRows = await db.select().from(productCosts)
    .where(eq(productCosts.storeId, DEFAULT_STOREFRONT_ID))
    .orderBy(asc(productCosts.sortOrder), asc(productCosts.sellerSku));
  const sourceRows = sharedRows.length > 0 ? sharedRows : primaryRows;
  const sharedDeletions = await db.select().from(productCostDeletions)
    .where(eq(productCostDeletions.storeId, LEGACY_SHARED_PRODUCT_SCOPE_ID));
  const primaryDeletions = await db.select().from(productCostDeletions)
    .where(eq(productCostDeletions.storeId, DEFAULT_STOREFRONT_ID));
  const sourceDeletions = sharedDeletions.length > 0 ? sharedDeletions : primaryDeletions;
  const migratedAt = new Date().toISOString();

  await db.batch([
    db.delete(productCosts).where(eq(productCosts.storeId, SECONDARY_STOREFRONT_ID)),
    db.delete(productCostDeletions).where(eq(productCostDeletions.storeId, SECONDARY_STOREFRONT_ID)),
    ...sourceRows.map((row) => db.insert(productCosts).values({ ...row, storeId: SECONDARY_STOREFRONT_ID })),
    ...sourceDeletions.map((row) => db.insert(productCostDeletions).values({ ...row, storeId: SECONDARY_STOREFRONT_ID })),
    db.insert(wbSyncSnapshots).values({
      cacheKey: SEPARATION_MIGRATION_KEY,
      payload: JSON.stringify({ source: sharedRows.length > 0 ? LEGACY_SHARED_PRODUCT_SCOPE_ID : DEFAULT_STOREFRONT_ID, rows: sourceRows.length, migratedAt }),
      syncSlot: "product-register-separation-v1",
      manualBucket: 0,
      updatedAt: migratedAt,
    }).onConflictDoNothing(),
  ]);
}

export async function GET(request: Request) {
  try {
    const store = requestedStorefront(request);
    const db = getDb();
    await separateSecondaryProductRegister(db, store.id);
    let rows = await db.select().from(productCosts)
      .where(eq(productCosts.storeId, store.id))
      .orderBy(asc(productCosts.sortOrder), asc(productCosts.sellerSku));
    // Seed only a completely new primary store. Re-seeding on every read would
    // recreate an old primary key after the user renames a saved seller code.
    if (rows.length === 0 && store.id === DEFAULT_STOREFRONT_ID) {
      for (const seedRow of SEED_ROWS) {
        await db.insert(productCosts).values({ ...seedRow, storeId: store.id }).onConflictDoNothing();
      }
      rows = await db.select().from(productCosts)
        .where(eq(productCosts.storeId, store.id))
        .orderBy(asc(productCosts.sortOrder), asc(productCosts.sellerSku));
    }
    const deletedProducts = await db.select().from(productCostDeletions)
      .where(eq(productCostDeletions.storeId, store.id))
      .orderBy(asc(productCostDeletions.deletedAt));
    const activeRows = rows.filter((row) => !matchesProductDeletion({
      sku: row.sellerSku,
      nmId: row.nmId,
    }, deletedProducts));
    return json({ rows: activeRows, deletedProducts, shared: false, activeStoreId: store.id });
  } catch (error) {
    return databaseError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as CostPayload;
    const store = requestedStorefront(request);
    const value = normalizePayload(body, store.id);
    const previousSellerSku = stringField(body.previousSellerSku, 120);
    const db = getDb();
    await separateSecondaryProductRegister(db, store.id);
    const existingKeys = await db.select({ sellerSku: productCosts.sellerSku }).from(productCosts)
      .where(eq(productCosts.storeId, store.id));
    const normalizedSellerSku = normalizeProductSku(value.sellerSku);
    const conflict = existingKeys.find((entry) =>
      normalizeProductSku(entry.sellerSku) === normalizedSellerSku
      && entry.sellerSku !== previousSellerSku,
    );
    if (conflict) throw new Error("SELLER_SKU_CONFLICT");

    if (previousSellerSku && previousSellerSku !== value.sellerSku) {
      const [renamed] = await db
        .update(productCosts)
        .set(value)
        .where(and(eq(productCosts.storeId, store.id), eq(productCosts.sellerSku, previousSellerSku)))
        .returning();
      if (renamed) {
        await db.delete(productCostDeletions).where(and(
          eq(productCostDeletions.storeId, store.id),
          or(
            eq(productCostDeletions.sellerSkuKey, normalizedSellerSku),
            eq(productCostDeletions.identityKey, productDeletionIdentity(value.sellerSku, value.nmId)),
          ),
        ));
        return json({ row: renamed });
      }
    }

    const [row] = await db
      .insert(productCosts)
      .values(value)
      .onConflictDoUpdate({
        target: [productCosts.storeId, productCosts.sellerSku],
        set: {
          nmId: value.nmId,
          imageUrl: value.imageUrl,
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
          targetMarginRate: value.targetMarginRate,
          sortOrder: value.sortOrder,
          notes: value.notes,
          updatedAt: value.updatedAt,
        },
      })
      .returning();
    await db.delete(productCostDeletions).where(and(
      eq(productCostDeletions.storeId, store.id),
      or(
        eq(productCostDeletions.sellerSkuKey, normalizedSellerSku),
        eq(productCostDeletions.identityKey, productDeletionIdentity(value.sellerSku, value.nmId)),
      ),
    ));
    return json({ row });
  } catch (error) {
    if (error instanceof Error && error.message === "SELLER_SKU_REQUIRED") return json({ error: "卖家商品编号不能为空" }, 400);
    if (error instanceof Error && error.message === "SELLER_SKU_CONFLICT") return json({ error: "卖家商品编号已存在，请使用唯一编号" }, 409);
    if (error instanceof Error && error.message === "EXCHANGE_RATE_REQUIRED") return json({ error: "填写卢布产品成本时，汇率必须大于 0" }, 400);
    if (error instanceof Error && error.message === "IMAGE_URL_INVALID") return json({ error: "商品图片必须使用有效的 HTTPS 链接" }, 400);
    if (error instanceof Error && error.message === "NUMERIC_FIELD_INVALID") return json({ error: "金额、比例或尺寸输入无效" }, 400);
    return databaseError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as DeletePayload;
    const store = requestedStorefront(request);
    const sellerSku = stringField(body.sellerSku, 120);
    const persistedSellerSku = stringField(body.persistedSellerSku, 120);
    const nmId = Math.trunc(numericField(body.nmId, Number.MAX_SAFE_INTEGER));
    const sellerSkuKey = normalizeProductSku(sellerSku || persistedSellerSku);
    if (!sellerSkuKey && !nmId) return json({ error: "缺少要删除的商品编号" }, 400);

    const db = getDb();
    await separateSecondaryProductRegister(db, store.id);
    const identityKey = productDeletionIdentity(sellerSku || persistedSellerSku, nmId || null);
    const storedKeys = await db.select({
      sellerSku: productCosts.sellerSku,
      nmId: productCosts.nmId,
    }).from(productCosts).where(eq(productCosts.storeId, store.id));
    const normalizedPersistedSku = normalizeProductSku(persistedSellerSku);
    const storedSellerSkus = storedKeys.filter((row) =>
      Boolean(persistedSellerSku && row.sellerSku === persistedSellerSku)
      || Boolean(sellerSkuKey && normalizeProductSku(row.sellerSku) === sellerSkuKey)
      || Boolean(normalizedPersistedSku && normalizeProductSku(row.sellerSku) === normalizedPersistedSku)
      || Boolean(nmId && row.nmId === nmId),
    ).map((row) => row.sellerSku);

    const markerQuery = db.insert(productCostDeletions).values({
      storeId: store.id,
      identityKey,
      sellerSkuKey,
      nmId: nmId || null,
      deletedAt: new Date().toISOString(),
    }).onConflictDoUpdate({
      target: [productCostDeletions.storeId, productCostDeletions.identityKey],
      set: { sellerSkuKey, nmId: nmId || null, deletedAt: new Date().toISOString() },
    });

    if (storedSellerSkus.length > 0) {
      await db.batch([
        db.delete(productCosts).where(and(
          eq(productCosts.storeId, store.id),
          inArray(productCosts.sellerSku, storedSellerSkus),
        )),
        markerQuery,
      ]);
    } else {
      await markerQuery;
    }
    return json({ deleted: true, identityKey, deletedStoredRows: storedSellerSkus.length });
  } catch (error) {
    if (error instanceof Error && error.message === "NUMERIC_FIELD_INVALID") return json({ error: "商品 ID 无效" }, 400);
    return databaseError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as RestorePayload;
    const store = requestedStorefront(request);
    const sellerSku = stringField(body.sellerSku, 120);
    const sellerSkuKey = normalizeProductSku(sellerSku);
    const nmId = Math.trunc(numericField(body.nmId, Number.MAX_SAFE_INTEGER));
    if (!sellerSkuKey && !nmId) return json({ error: "缺少要恢复的商品编号" }, 400);

    const predicates = [];
    if (sellerSkuKey) predicates.push(eq(productCostDeletions.sellerSkuKey, sellerSkuKey));
    if (nmId) predicates.push(eq(productCostDeletions.nmId, nmId));
    const identityPredicate = predicates.length === 1 ? predicates[0] : or(...predicates);
    const db = getDb();
    await separateSecondaryProductRegister(db, store.id);
    const restored = await db.delete(productCostDeletions)
      .where(and(eq(productCostDeletions.storeId, store.id), identityPredicate))
      .returning({ identityKey: productCostDeletions.identityKey });
    return json({ restored: true, restoredMarkers: restored.length });
  } catch (error) {
    if (error instanceof Error && error.message === "NUMERIC_FIELD_INVALID") return json({ error: "商品 ID 无效" }, 400);
    return databaseError(error);
  }
}
