CREATE TABLE "activity_events" (
	"id" integer PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer,
	"label" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_credentials" (
	"id" integer PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"state" text NOT NULL,
	"rate" text NOT NULL,
	"niche" text NOT NULL,
	"earned" integer NOT NULL,
	"goal" integer NOT NULL,
	"submitted" integer NOT NULL,
	"allowed" text NOT NULL,
	"rules" text DEFAULT '' NOT NULL,
	"hook_rules" text DEFAULT '' NOT NULL,
	"banned_terms" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clip_tasks" (
	"id" integer PRIMARY KEY NOT NULL,
	"creator" text NOT NULL,
	"platform" text NOT NULL,
	"source" text NOT NULL,
	"source_url" text,
	"timestamp" text NOT NULL,
	"hook" text NOT NULL,
	"score" integer NOT NULL,
	"status" text NOT NULL,
	"targets" text NOT NULL,
	"upload_urls" text DEFAULT '{"TikTok":"","Shorts":"","Reels":""}' NOT NULL,
	"last_action" text,
	"last_action_by" text,
	"last_action_at" text
);
--> statement-breakpoint
CREATE TABLE "content_items" (
	"id" integer PRIMARY KEY NOT NULL,
	"creator" text NOT NULL,
	"external_id" text,
	"platform" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"age" text NOT NULL,
	"metric" text NOT NULL,
	"campaign" text NOT NULL,
	"status" text NOT NULL,
	"score" integer NOT NULL,
	"live" boolean DEFAULT false NOT NULL,
	"velocity" text,
	"source_url" text,
	"thumbnail_url" text,
	"published_at" text,
	"last_action" text,
	"last_action_by" text,
	"last_action_at" text
);
--> statement-breakpoint
CREATE TABLE "creators" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"initial" text NOT NULL,
	"platforms" text NOT NULL,
	"campaign" text NOT NULL,
	"live_viewers" text NOT NULL,
	"followers" text NOT NULL,
	"average_score" integer NOT NULL,
	"clips_made" integer NOT NULL,
	"notes" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_accounts" (
	"id" integer PRIMARY KEY NOT NULL,
	"creator" text NOT NULL,
	"platform" text NOT NULL,
	"handle" text NOT NULL,
	"external_id" text NOT NULL,
	"source_url" text,
	"connected" boolean DEFAULT false NOT NULL,
	"last_synced_at" text,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "saved_searches" (
	"id" integer PRIMARY KEY NOT NULL,
	"query" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" integer PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"started_at" text NOT NULL,
	"finished_at" text,
	"status" text NOT NULL,
	"items_found" integer DEFAULT 0 NOT NULL,
	"message" text
);
