import { sql } from "drizzle-orm";
import { integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const productCosts = sqliteTable("product_costs", {
  storeId: text("store_id").notNull().default("primary"),
  sellerSku: text("seller_sku").notNull(),
  nmId: integer("nm_id"),
  imageUrl: text("image_url").notNull().default(""),
  internalSku: text("internal_sku").notNull().default(""),
  category: text("category").notNull().default(""),
  specification: text("specification").notNull().default(""),
  lengthCm: real("length_cm").notNull().default(0),
  widthCm: real("width_cm").notNull().default(0),
  heightCm: real("height_cm").notNull().default(0),
  weightG: real("weight_g").notNull().default(0),
  productCostRub: real("product_cost_rub").notNull().default(0),
  exchangeRate: real("exchange_rate").notNull().default(11.2),
  productCostCny: real("product_cost_cny").notNull().default(0),
  handlingFeeCny: real("handling_fee_cny").notNull().default(0),
  lastMileFeeCny: real("last_mile_fee_cny").notNull().default(0),
  commissionRate: real("commission_rate").notNull().default(0),
  adRate: real("ad_rate").notNull().default(0),
  activityDiscountRate: real("activity_discount_rate").notNull().default(0),
  returnLossRate: real("return_loss_rate").notNull().default(0),
  referencePriceCny: real("reference_price_cny").notNull().default(0),
  targetMarginRate: real("target_margin_rate").notNull().default(10),
  sortOrder: real("sort_order").notNull().default(0),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ name: "product_costs_store_seller_pk", columns: [table.storeId, table.sellerSku] })]);

export const productCostDeletions = sqliteTable("product_cost_deletions", {
  storeId: text("store_id").notNull().default("primary"),
  identityKey: text("identity_key").notNull(),
  sellerSkuKey: text("seller_sku_key").notNull(),
  nmId: integer("nm_id"),
  deletedAt: text("deleted_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ name: "product_cost_deletions_store_identity_pk", columns: [table.storeId, table.identityKey] })]);

export const wbSyncSnapshots = sqliteTable("wb_sync_snapshots", {
  cacheKey: text("cache_key").primaryKey(),
  payload: text("payload").notNull(),
  syncSlot: text("sync_slot").notNull().default(""),
  manualBucket: integer("manual_bucket").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const wbSyncLocks = sqliteTable("wb_sync_locks", {
  cacheKey: text("cache_key").primaryKey(),
  expiresAt: integer("expires_at").notNull(),
});

export const marketDataSources = sqliteTable("market_data_sources", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  confidence: text("confidence").notNull(),
  sourceFile: text("source_file").notNull().default(""),
  importedAt: text("imported_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  metadata: text("metadata").notNull().default("{}"),
});

export const marketCategories = sqliteTable("market_categories", {
  subjectId: text("subject_id").primaryKey(),
  nameRu: text("name_ru").notNull(),
  nameZh: text("name_zh").notNull().default(""),
  parentId: text("parent_id").notNull().default(""),
  parentName: text("parent_name").notNull().default(""),
  level: integer("level").notNull().default(1),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const marketCategoryMetrics = sqliteTable("market_category_metrics", {
  subjectId: text("subject_id").notNull(),
  periodDays: integer("period_days").notNull(),
  metricDate: text("metric_date").notNull(),
  sourceId: text("source_id").notNull(),
  metrics: text("metrics").notNull().default("{}"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ name: "market_category_metrics_pk", columns: [table.subjectId, table.periodDays, table.metricDate, table.sourceId] })]);

export const marketCategoryHistory = sqliteTable("market_category_history", {
  subjectId: text("subject_id").notNull(),
  periodDays: integer("period_days").notNull(),
  metricDate: text("metric_date").notNull(),
  sourceId: text("source_id").notNull(),
  metrics: text("metrics").notNull().default("{}"),
}, (table) => [primaryKey({ name: "market_category_history_pk", columns: [table.subjectId, table.periodDays, table.metricDate, table.sourceId] })]);

export const marketProducts = sqliteTable("market_products", {
  subjectId: text("subject_id").notNull(),
  nmId: integer("nm_id").notNull(),
  sourceId: text("source_id").notNull(),
  payload: text("payload").notNull().default("{}"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ name: "market_products_pk", columns: [table.subjectId, table.nmId, table.sourceId] })]);

export const marketSellers = sqliteTable("market_sellers", {
  subjectId: text("subject_id").notNull(),
  sellerId: text("seller_id").notNull(),
  sourceId: text("source_id").notNull(),
  payload: text("payload").notNull().default("{}"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ name: "market_sellers_pk", columns: [table.subjectId, table.sellerId, table.sourceId] })]);

export const marketWatchlist = sqliteTable("market_watchlist", {
  subjectId: text("subject_id").primaryKey(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  note: text("note").notNull().default(""),
});
