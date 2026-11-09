import { and, asc, eq, inArray, or } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { productCostDeletions, productCosts, wbSyncSnapshots } from "../../../db/schema";
import { normalizeProductSku } from "../../_lib/product-cost-aliases";
import { matchesProductDeletion, productDeletionIdentity } from "../../_lib/product-deletions";
import { persistenceBackend, readSyncSnapshot, supabaseRestRequest, writeSyncSnapshot } from "../../_lib/server-persistence";
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

type ImportProductPayload = {
  sellerSku?: unknown;
  nmId?: unknown;
  imageUrl?: unknown;
};

type ImportMatchedPayload = {
  action?: unknown;
  sourceStoreId?: unknown;
  products?: unknown;
};

const STORE_PRODUCT_IMPORT_ALIASES: Record<string, string> = {
  xb: "xzhiwujiab",
  xw: "xzhiwujiaw",
  yijiab: "yib",
  yijiabl: "yic",
  yijiah: "yig",
  "810b": "810h",
  "603w": "603",
  "806": "8006",
  sbd5: "cwljd",
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

function importProductKey(value: unknown) {
  return stringField(value, 120)
    .toLocaleLowerCase()
    .replace(/^(cl|wz)/, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

function importSourceKey(value: unknown) {
  const key = importProductKey(value);
  return STORE_PRODUCT_IMPORT_ALIASES[key] ?? key;
}

function normalizeImportProducts(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 500) throw new Error("IMPORT_PRODUCTS_INVALID");
  const seen = new Set<string>();
  return value.map((entry) => {
    const product = (entry && typeof entry === "object" ? entry : {}) as ImportProductPayload;
    const sellerSku = stringField(product.sellerSku, 120);
    const nmId = Math.trunc(numericField(product.nmId, Number.MAX_SAFE_INTEGER));
    const imageUrl = imageUrlField(product.imageUrl);
    const key = normalizeProductSku(sellerSku);
    if (!sellerSku || !key || !nmId || seen.has(key)) throw new Error("IMPORT_PRODUCTS_INVALID");
    seen.add(key);
    return { sellerSku, nmId, imageUrl };
  });
}

function hasEnteredProductDetails(row: ProductCostRow) {
  return Boolean(
    row.internalSku
    || row.category
    || row.specification
    || row.notes
    || row.lengthCm
    || row.widthCm
    || row.heightCm
    || row.weightG
    || row.productCostRub
    || row.productCostCny
    || row.handlingFeeCny
    || row.lastMileFeeCny
    || row.commissionRate
    || row.adRate
    || row.activityDiscountRate
    || row.returnLossRate
    || row.referencePriceCny
    || row.targetMarginRate
  );
}

function buildMatchedImport(
  sourceRows: ProductCostRow[],
  targetRows: ProductCostRow[],
  targetProducts: ReturnType<typeof normalizeImportProducts>,
  targetStoreId: string,
  sourceStoreId: string,
) {
  const existingBySku = new Map(targetRows.map((row) => [normalizeProductSku(row.sellerSku), row]));
  const existingByNmId = new Map(targetRows.filter((row) => row.nmId).map((row) => [row.nmId as number, row]));
  const sourcePrefix = sourceStoreId.toLocaleLowerCase();
  const now = new Date().toISOString();
  const values: ProductCostValue[] = [];
  const matches: Array<{ sellerSku: string; nmId: number; sourceSellerSku: string }> = [];
  const unmatched: Array<{ sellerSku: string; nmId: number }> = [];
  const skipped: Array<{ sellerSku: string; nmId: number; reason: string }> = [];

  for (const product of targetProducts) {
    const existing = existingBySku.get(normalizeProductSku(product.sellerSku)) ?? existingByNmId.get(product.nmId);
    if (existing && hasEnteredProductDetails(existing)) {
      skipped.push({ sellerSku: product.sellerSku, nmId: product.nmId, reason: "目标商品已有详情" });
      continue;
    }

    const wantedKey = importSourceKey(product.sellerSku);
    const candidates = sourceRows.filter((row) => importProductKey(row.sellerSku) === wantedKey);
    candidates.sort((left, right) => {
      const leftPreferred = left.sellerSku.toLocaleLowerCase().startsWith(sourcePrefix) ? 1 : 0;
      const rightPreferred = right.sellerSku.toLocaleLowerCase().startsWith(sourcePrefix) ? 1 : 0;
      return rightPreferred - leftPreferred || left.sortOrder - right.sortOrder;
    });
    const source = candidates[0];
    if (!source) {
      unmatched.push({ sellerSku: product.sellerSku, nmId: product.nmId });
      continue;
    }

    values.push({
      ...source,
      storeId: targetStoreId,
      sellerSku: product.sellerSku,
      nmId: product.nmId,
      imageUrl: product.imageUrl || source.imageUrl,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    });
    matches.push({ sellerSku: product.sellerSku, nmId: product.nmId, sourceSellerSku: source.sellerSku });
  }

  return { values, matches, unmatched, skipped };
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

type ProductCostRow = typeof productCosts.$inferSelect;
type ProductCostValue = typeof productCosts.$inferInsert;
type ProductDeletionRow = typeof productCostDeletions.$inferSelect;

function supabaseFilter(value: string) {
  return `eq.${encodeURIComponent(value)}`;
}

function productToSupabase(value: ProductCostValue) {
  return {
    store_id: value.storeId,
    seller_sku: value.sellerSku,
    nm_id: value.nmId ?? null,
    image_url: value.imageUrl ?? "",
    internal_sku: value.internalSku ?? "",
    category: value.category ?? "",
    specification: value.specification ?? "",
    length_cm: value.lengthCm ?? 0,
    width_cm: value.widthCm ?? 0,
    height_cm: value.heightCm ?? 0,
    weight_g: value.weightG ?? 0,
    product_cost_rub: value.productCostRub ?? 0,
    exchange_rate: value.exchangeRate ?? 0,
    product_cost_cny: value.productCostCny ?? 0,
    handling_fee_cny: value.handlingFeeCny ?? 0,
    last_mile_fee_cny: value.lastMileFeeCny ?? 0,
    commission_rate: value.commissionRate ?? 0,
    ad_rate: value.adRate ?? 0,
    activity_discount_rate: value.activityDiscountRate ?? 0,
    return_loss_rate: value.returnLossRate ?? 0,
    reference_price_cny: value.referencePriceCny ?? 0,
    target_margin_rate: value.targetMarginRate ?? 0,
    sort_order: value.sortOrder ?? 0,
    notes: value.notes ?? "",
    ...(value.createdAt ? { created_at: value.createdAt } : {}),
    ...(value.updatedAt ? { updated_at: value.updatedAt } : {}),
  };
}

function productFromSupabase(row: Record<string, unknown>): ProductCostRow {
  return {
    storeId: String(row.store_id || DEFAULT_STOREFRONT_ID),
    sellerSku: String(row.seller_sku || ""),
    nmId: row.nm_id === null ? null : Number(row.nm_id || 0),
    imageUrl: String(row.image_url || ""),
    internalSku: String(row.internal_sku || ""),
    category: String(row.category || ""),
    specification: String(row.specification || ""),
    lengthCm: Number(row.length_cm || 0),
    widthCm: Number(row.width_cm || 0),
    heightCm: Number(row.height_cm || 0),
    weightG: Number(row.weight_g || 0),
    productCostRub: Number(row.product_cost_rub || 0),
    exchangeRate: Number(row.exchange_rate || 0),
    productCostCny: Number(row.product_cost_cny || 0),
    handlingFeeCny: Number(row.handling_fee_cny || 0),
    lastMileFeeCny: Number(row.last_mile_fee_cny || 0),
    commissionRate: Number(row.commission_rate || 0),
    adRate: Number(row.ad_rate || 0),
    activityDiscountRate: Number(row.activity_discount_rate || 0),
    returnLossRate: Number(row.return_loss_rate || 0),
    referencePriceCny: Number(row.reference_price_cny || 0),
    targetMarginRate: Number(row.target_margin_rate || 0),
    sortOrder: Number(row.sort_order || 0),
    notes: String(row.notes || ""),
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || ""),
  };
}

function deletionFromSupabase(row: Record<string, unknown>): ProductDeletionRow {
  return {
    storeId: String(row.store_id || DEFAULT_STOREFRONT_ID),
    identityKey: String(row.identity_key || ""),
    sellerSkuKey: String(row.seller_sku_key || ""),
    nmId: row.nm_id === null ? null : Number(row.nm_id || 0),
    deletedAt: String(row.deleted_at || ""),
  };
}

async function supabaseProductRows(storeId: string) {
  const response = await supabaseRestRequest(
    `product_costs?select=*&store_id=${supabaseFilter(storeId)}&order=sort_order.asc,seller_sku.asc`,
  );
  return ((await response.json()) as Record<string, unknown>[]).map(productFromSupabase);
}

async function supabaseDeletionRows(storeId: string) {
  const response = await supabaseRestRequest(
    `product_cost_deletions?select=*&store_id=${supabaseFilter(storeId)}&order=deleted_at.asc`,
  );
  return ((await response.json()) as Record<string, unknown>[]).map(deletionFromSupabase);
}

async function supabaseUpsertProducts(values: ProductCostValue[]) {
  if (!values.length) return [];
  const response = await supabaseRestRequest("product_costs?on_conflict=store_id,seller_sku&select=*", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(values.map(productToSupabase)),
  });
  return ((await response.json()) as Record<string, unknown>[]).map(productFromSupabase);
}

async function supabaseDeleteProduct(storeId: string, sellerSku: string) {
  await supabaseRestRequest(
    `product_costs?store_id=${supabaseFilter(storeId)}&seller_sku=${supabaseFilter(sellerSku)}`,
    { method: "DELETE" },
  );
}

async function supabaseDeleteMarker(storeId: string, identityKey: string) {
  await supabaseRestRequest(
    `product_cost_deletions?store_id=${supabaseFilter(storeId)}&identity_key=${supabaseFilter(identityKey)}`,
    { method: "DELETE" },
  );
}

async function supabaseUpsertMarker(value: ProductDeletionRow) {
  await supabaseRestRequest("product_cost_deletions?on_conflict=store_id,identity_key", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      store_id: value.storeId,
      identity_key: value.identityKey,
      seller_sku_key: value.sellerSkuKey,
      nm_id: value.nmId,
      deleted_at: value.deletedAt,
    }),
  });
}

async function separateSecondarySupabaseProductRegister(storeId: string) {
  if (storeId !== SECONDARY_STOREFRONT_ID) return;
  if (await readSyncSnapshot(SEPARATION_MIGRATION_KEY)) return;

  const sharedRows = await supabaseProductRows(LEGACY_SHARED_PRODUCT_SCOPE_ID);
  const primaryRows = await supabaseProductRows(DEFAULT_STOREFRONT_ID);
  const sourceRows = sharedRows.length > 0 ? sharedRows : primaryRows;
  const sharedDeletions = await supabaseDeletionRows(LEGACY_SHARED_PRODUCT_SCOPE_ID);
  const primaryDeletions = await supabaseDeletionRows(DEFAULT_STOREFRONT_ID);
  const sourceDeletions = sharedDeletions.length > 0 ? sharedDeletions : primaryDeletions;
  const migratedAt = new Date().toISOString();

  await supabaseRestRequest(`product_costs?store_id=${supabaseFilter(SECONDARY_STOREFRONT_ID)}`, { method: "DELETE" });
  await supabaseRestRequest(`product_cost_deletions?store_id=${supabaseFilter(SECONDARY_STOREFRONT_ID)}`, { method: "DELETE" });
  await supabaseUpsertProducts(sourceRows.map((row) => ({ ...row, storeId: SECONDARY_STOREFRONT_ID })));
  for (const row of sourceDeletions) await supabaseUpsertMarker({ ...row, storeId: SECONDARY_STOREFRONT_ID });
  await writeSyncSnapshot(
    SEPARATION_MIGRATION_KEY,
    JSON.stringify({ source: sharedRows.length > 0 ? LEGACY_SHARED_PRODUCT_SCOPE_ID : DEFAULT_STOREFRONT_ID, rows: sourceRows.length, migratedAt }),
    "product-register-separation-v1",
  );
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

async function deleteMatchingSupabaseMarkers(storeId: string, sellerSkuKey: string, identityKey: string) {
  const markers = await supabaseDeletionRows(storeId);
  const matches = markers.filter((row) => row.sellerSkuKey === sellerSkuKey || row.identityKey === identityKey);
  for (const marker of matches) await supabaseDeleteMarker(storeId, marker.identityKey);
}

async function supabaseGet(request: Request) {
  const store = await requestedStorefront(request, env);
  await separateSecondarySupabaseProductRegister(store.id);
  let rows = await supabaseProductRows(store.id);
  if (rows.length === 0 && store.id === DEFAULT_STOREFRONT_ID) {
    await supabaseUpsertProducts(SEED_ROWS.map((row) => ({ ...row, storeId: store.id })));
    rows = await supabaseProductRows(store.id);
  }
  const deletedProducts = await supabaseDeletionRows(store.id);
  const activeRows = rows.filter((row) => !matchesProductDeletion({ sku: row.sellerSku, nmId: row.nmId }, deletedProducts));
  return json({ rows: activeRows, deletedProducts, shared: false, activeStoreId: store.id });
}

async function supabasePut(request: Request, body: CostPayload) {
  const store = await requestedStorefront(request, env);
  const value = normalizePayload(body, store.id);
  const previousSellerSku = stringField(body.previousSellerSku, 120);
  await separateSecondarySupabaseProductRegister(store.id);
  const existingRows = await supabaseProductRows(store.id);
  const normalizedSellerSku = normalizeProductSku(value.sellerSku);
  const conflict = existingRows.find((entry) =>
    normalizeProductSku(entry.sellerSku) === normalizedSellerSku
    && entry.sellerSku !== previousSellerSku,
  );
  if (conflict) throw new Error("SELLER_SKU_CONFLICT");

  if (previousSellerSku && previousSellerSku !== value.sellerSku) {
    const response = await supabaseRestRequest(
      `product_costs?store_id=${supabaseFilter(store.id)}&seller_sku=${supabaseFilter(previousSellerSku)}&select=*`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(productToSupabase(value)),
      },
    );
    const [renamedRaw] = await response.json() as Record<string, unknown>[];
    if (renamedRaw) {
      const renamed = productFromSupabase(renamedRaw);
      await deleteMatchingSupabaseMarkers(store.id, normalizedSellerSku, productDeletionIdentity(value.sellerSku, value.nmId));
      return json({ row: renamed });
    }
  }

  const [row] = await supabaseUpsertProducts([value]);
  await deleteMatchingSupabaseMarkers(store.id, normalizedSellerSku, productDeletionIdentity(value.sellerSku, value.nmId));
  return json({ row });
}

async function supabaseDelete(request: Request, body: DeletePayload) {
  const store = await requestedStorefront(request, env);
  const sellerSku = stringField(body.sellerSku, 120);
  const persistedSellerSku = stringField(body.persistedSellerSku, 120);
  const nmId = Math.trunc(numericField(body.nmId, Number.MAX_SAFE_INTEGER));
  const sellerSkuKey = normalizeProductSku(sellerSku || persistedSellerSku);
  if (!sellerSkuKey && !nmId) return json({ error: "缺少要删除的商品编号" }, 400);

  await separateSecondarySupabaseProductRegister(store.id);
  const identityKey = productDeletionIdentity(sellerSku || persistedSellerSku, nmId || null);
  const rows = await supabaseProductRows(store.id);
  const normalizedPersistedSku = normalizeProductSku(persistedSellerSku);
  const storedSellerSkus = rows.filter((row) =>
    Boolean(persistedSellerSku && row.sellerSku === persistedSellerSku)
    || Boolean(sellerSkuKey && normalizeProductSku(row.sellerSku) === sellerSkuKey)
    || Boolean(normalizedPersistedSku && normalizeProductSku(row.sellerSku) === normalizedPersistedSku)
    || Boolean(nmId && row.nmId === nmId),
  ).map((row) => row.sellerSku);
  for (const storedSellerSku of storedSellerSkus) await supabaseDeleteProduct(store.id, storedSellerSku);
  await supabaseUpsertMarker({
    storeId: store.id,
    identityKey,
    sellerSkuKey,
    nmId: nmId || null,
    deletedAt: new Date().toISOString(),
  });
  return json({ deleted: true, identityKey, deletedStoredRows: storedSellerSkus.length });
}

async function supabaseRestore(request: Request, body: RestorePayload) {
  const store = await requestedStorefront(request, env);
  const sellerSkuKey = normalizeProductSku(stringField(body.sellerSku, 120));
  const nmId = Math.trunc(numericField(body.nmId, Number.MAX_SAFE_INTEGER));
  if (!sellerSkuKey && !nmId) return json({ error: "缺少要恢复的商品编号" }, 400);
  await separateSecondarySupabaseProductRegister(store.id);
  const markers = await supabaseDeletionRows(store.id);
  const matches = markers.filter((row) =>
    Boolean(sellerSkuKey && row.sellerSkuKey === sellerSkuKey) || Boolean(nmId && row.nmId === nmId),
  );
  for (const marker of matches) await supabaseDeleteMarker(store.id, marker.identityKey);
  return json({ restored: true, restoredMarkers: matches.length });
}

async function supabaseImportMatched(request: Request, body: ImportMatchedPayload) {
  if (body.action !== "importMatchedProducts") return json({ error: "不支持的产品导入操作" }, 400);
  const store = await requestedStorefront(request, env);
  const sourceStoreId = stringField(body.sourceStoreId, 80);
  if (!sourceStoreId || sourceStoreId === store.id) return json({ error: "来源店铺与目标店铺无效" }, 400);
  const targetProducts = normalizeImportProducts(body.products);
  await separateSecondarySupabaseProductRegister(sourceStoreId);
  const [sourceRows, targetRows] = await Promise.all([
    supabaseProductRows(sourceStoreId),
    supabaseProductRows(store.id),
  ]);
  if (sourceRows.length === 0) return json({ error: "来源店铺没有可对应的产品详情" }, 404);
  const result = buildMatchedImport(sourceRows, targetRows, targetProducts, store.id, sourceStoreId);
  const rows = await supabaseUpsertProducts(result.values);
  return json({
    imported: rows.length,
    matched: result.matches,
    unmatched: result.unmatched,
    skipped: result.skipped,
    activeStoreId: store.id,
    sourceStoreId,
  });
}

function d1UpsertProduct(db: ReturnType<typeof getDb>, value: ProductCostValue) {
  return db.insert(productCosts).values(value).onConflictDoUpdate({
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
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as ImportMatchedPayload;
    if (persistenceBackend() === "supabase") return await supabaseImportMatched(request, body);
    if (body.action !== "importMatchedProducts") return json({ error: "不支持的产品导入操作" }, 400);
    const store = await requestedStorefront(request, env);
    const sourceStoreId = stringField(body.sourceStoreId, 80);
    if (!sourceStoreId || sourceStoreId === store.id) return json({ error: "来源店铺与目标店铺无效" }, 400);
    const targetProducts = normalizeImportProducts(body.products);
    const db = getDb();
    await separateSecondaryProductRegister(db, sourceStoreId);
    const [sourceRows, targetRows] = await Promise.all([
      db.select().from(productCosts).where(eq(productCosts.storeId, sourceStoreId)).orderBy(asc(productCosts.sortOrder), asc(productCosts.sellerSku)),
      db.select().from(productCosts).where(eq(productCosts.storeId, store.id)).orderBy(asc(productCosts.sortOrder), asc(productCosts.sellerSku)),
    ]);
    if (sourceRows.length === 0) return json({ error: "来源店铺没有可对应的产品详情" }, 404);
    const result = buildMatchedImport(sourceRows, targetRows, targetProducts, store.id, sourceStoreId);
    if (result.values.length > 0) await db.batch(result.values.map((value) => d1UpsertProduct(db, value)));
    return json({
      imported: result.values.length,
      matched: result.matches,
      unmatched: result.unmatched,
      skipped: result.skipped,
      activeStoreId: store.id,
      sourceStoreId,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "IMPORT_PRODUCTS_INVALID") return json({ error: "目标店铺商品列表无效，未执行导入" }, 400);
    if (error instanceof Error && error.message === "IMAGE_URL_INVALID") return json({ error: "目标商品图片链接无效，未执行导入" }, 400);
    if (error instanceof Error && error.message === "NUMERIC_FIELD_INVALID") return json({ error: "目标商品 ID 无效，未执行导入" }, 400);
    return databaseError(error);
  }
}

export async function GET(request: Request) {
  try {
    if (persistenceBackend() === "supabase") return await supabaseGet(request);
    const store = await requestedStorefront(request, env);
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
    if (persistenceBackend() === "supabase") return await supabasePut(request, body);
    const store = await requestedStorefront(request, env);
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
    if (persistenceBackend() === "supabase") return await supabaseDelete(request, body);
    const store = await requestedStorefront(request, env);
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
    if (persistenceBackend() === "supabase") return await supabaseRestore(request, body);
    const store = await requestedStorefront(request, env);
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
