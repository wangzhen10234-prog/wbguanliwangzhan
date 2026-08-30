PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_product_cost_deletions` (
	`store_id` text DEFAULT 'primary' NOT NULL,
	`identity_key` text NOT NULL,
	`seller_sku_key` text NOT NULL,
	`nm_id` integer,
	`deleted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`store_id`, `identity_key`)
);
--> statement-breakpoint
INSERT INTO `__new_product_cost_deletions`("store_id", "identity_key", "seller_sku_key", "nm_id", "deleted_at") SELECT 'primary', "identity_key", "seller_sku_key", "nm_id", "deleted_at" FROM `product_cost_deletions`;--> statement-breakpoint
DROP TABLE `product_cost_deletions`;--> statement-breakpoint
ALTER TABLE `__new_product_cost_deletions` RENAME TO `product_cost_deletions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_product_costs` (
	`store_id` text DEFAULT 'primary' NOT NULL,
	`seller_sku` text NOT NULL,
	`nm_id` integer,
	`image_url` text DEFAULT '' NOT NULL,
	`internal_sku` text DEFAULT '' NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`specification` text DEFAULT '' NOT NULL,
	`length_cm` real DEFAULT 0 NOT NULL,
	`width_cm` real DEFAULT 0 NOT NULL,
	`height_cm` real DEFAULT 0 NOT NULL,
	`weight_g` real DEFAULT 0 NOT NULL,
	`product_cost_rub` real DEFAULT 0 NOT NULL,
	`exchange_rate` real DEFAULT 11.2 NOT NULL,
	`product_cost_cny` real DEFAULT 0 NOT NULL,
	`handling_fee_cny` real DEFAULT 0 NOT NULL,
	`last_mile_fee_cny` real DEFAULT 0 NOT NULL,
	`commission_rate` real DEFAULT 0 NOT NULL,
	`ad_rate` real DEFAULT 0 NOT NULL,
	`activity_discount_rate` real DEFAULT 0 NOT NULL,
	`return_loss_rate` real DEFAULT 0 NOT NULL,
	`reference_price_cny` real DEFAULT 0 NOT NULL,
	`target_margin_rate` real DEFAULT 10 NOT NULL,
	`sort_order` real DEFAULT 0 NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`store_id`, `seller_sku`)
);
--> statement-breakpoint
INSERT INTO `__new_product_costs`("store_id", "seller_sku", "nm_id", "image_url", "internal_sku", "category", "specification", "length_cm", "width_cm", "height_cm", "weight_g", "product_cost_rub", "exchange_rate", "product_cost_cny", "handling_fee_cny", "last_mile_fee_cny", "commission_rate", "ad_rate", "activity_discount_rate", "return_loss_rate", "reference_price_cny", "target_margin_rate", "sort_order", "notes", "created_at", "updated_at") SELECT 'primary', "seller_sku", "nm_id", "image_url", "internal_sku", "category", "specification", "length_cm", "width_cm", "height_cm", "weight_g", "product_cost_rub", "exchange_rate", "product_cost_cny", "handling_fee_cny", "last_mile_fee_cny", "commission_rate", "ad_rate", "activity_discount_rate", "return_loss_rate", "reference_price_cny", "target_margin_rate", "sort_order", "notes", "created_at", "updated_at" FROM `product_costs`;--> statement-breakpoint
DROP TABLE `product_costs`;--> statement-breakpoint
ALTER TABLE `__new_product_costs` RENAME TO `product_costs`;
