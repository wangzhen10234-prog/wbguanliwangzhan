ALTER TABLE `product_costs` ADD `sort_order` real DEFAULT 0 NOT NULL;
UPDATE `product_costs`
SET `sort_order` = CASE lower(`seller_sku`)
	WHEN 'wz311b' THEN 100
	WHEN 'wz311p' THEN 200
	WHEN 'wz310b' THEN 300
	WHEN 'wz810b' THEN 400
	WHEN 'wz810g' THEN 500
	ELSE `sort_order`
END
WHERE lower(`seller_sku`) IN ('wz311b', 'wz311p', 'wz310b', 'wz810b', 'wz810g');
