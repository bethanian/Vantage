CREATE TABLE `campaigns` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`state` text NOT NULL,
	`rate` text NOT NULL,
	`niche` text NOT NULL,
	`earned` integer NOT NULL,
	`goal` integer NOT NULL,
	`submitted` integer NOT NULL,
	`allowed` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `clip_tasks` (
	`id` integer PRIMARY KEY NOT NULL,
	`creator` text NOT NULL,
	`platform` text NOT NULL,
	`source` text NOT NULL,
	`timestamp` text NOT NULL,
	`hook` text NOT NULL,
	`score` integer NOT NULL,
	`status` text NOT NULL,
	`targets` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `content_items` (
	`id` integer PRIMARY KEY NOT NULL,
	`creator` text NOT NULL,
	`platform` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`age` text NOT NULL,
	`metric` text NOT NULL,
	`campaign` text NOT NULL,
	`status` text NOT NULL,
	`score` integer NOT NULL,
	`live` integer DEFAULT false NOT NULL,
	`velocity` text
);
--> statement-breakpoint
CREATE TABLE `creators` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`initial` text NOT NULL,
	`platforms` text NOT NULL,
	`campaign` text NOT NULL,
	`live_viewers` text NOT NULL,
	`followers` text NOT NULL,
	`average_score` integer NOT NULL,
	`clips_made` integer NOT NULL,
	`notes` text NOT NULL
);
