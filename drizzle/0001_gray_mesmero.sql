CREATE TABLE `platform_accounts` (
	`id` integer PRIMARY KEY NOT NULL,
	`creator` text NOT NULL,
	`platform` text NOT NULL,
	`handle` text NOT NULL,
	`external_id` text NOT NULL,
	`source_url` text,
	`connected` integer DEFAULT false NOT NULL,
	`last_synced_at` text,
	`last_error` text
);
--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` integer PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`items_found` integer DEFAULT 0 NOT NULL,
	`message` text
);
--> statement-breakpoint
ALTER TABLE `content_items` ADD `external_id` text;--> statement-breakpoint
ALTER TABLE `content_items` ADD `source_url` text;--> statement-breakpoint
ALTER TABLE `content_items` ADD `thumbnail_url` text;--> statement-breakpoint
ALTER TABLE `content_items` ADD `published_at` text;