import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const productCosts = sqliteTable("product_costs", {
  sellerSku: text("seller_sku").primaryKey(),
  nmId: integer("nm_id"),
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
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
