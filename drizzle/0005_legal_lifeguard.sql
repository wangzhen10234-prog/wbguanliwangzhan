ALTER TABLE `wb_sync_snapshots` ADD `sync_slot` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `wb_sync_snapshots` ADD `manual_bucket` integer DEFAULT 0 NOT NULL;