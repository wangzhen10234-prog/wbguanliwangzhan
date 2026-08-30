CREATE TABLE `product_cost_deletions` (
	`identity_key` text PRIMARY KEY NOT NULL,
	`seller_sku_key` text NOT NULL,
	`nm_id` integer,
	`deleted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
