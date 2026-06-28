import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const CreatorsTable = sqliteTable('creators', {
	Id: integer('id').primaryKey(),
	Name: text('name').notNull(),
	Initial: text('initial').notNull(),
	Platforms: text('platforms').notNull(),
	Campaign: text('campaign').notNull(),
	LiveViewers: text('live_viewers').notNull(),
	Followers: text('followers').notNull(),
	AverageScore: integer('average_score').notNull(),
	ClipsMade: integer('clips_made').notNull(),
	Notes: text('notes').notNull()
});

export const CampaignsTable = sqliteTable('campaigns', {
	Id: integer('id').primaryKey(),
	Name: text('name').notNull(),
	State: text('state').notNull(),
	Rate: text('rate').notNull(),
	Niche: text('niche').notNull(),
	Earned: integer('earned').notNull(),
	Goal: integer('goal').notNull(),
	Submitted: integer('submitted').notNull(),
	Allowed: text('allowed').notNull(),
	Rules: text('rules').notNull().default(''),
	HookRules: text('hook_rules').notNull().default(''),
	BannedTerms: text('banned_terms').notNull().default('')
});

export const ContentItemsTable = sqliteTable('content_items', {
	Id: integer('id').primaryKey(),
	Creator: text('creator').notNull(),
	ExternalId: text('external_id'),
	Platform: text('platform').notNull(),
	Kind: text('kind').notNull(),
	Title: text('title').notNull(),
	Age: text('age').notNull(),
	Metric: text('metric').notNull(),
	Campaign: text('campaign').notNull(),
	Status: text('status').notNull(),
	Score: integer('score').notNull(),
	Live: integer('live', { mode: 'boolean' }).notNull().default(false),
	Velocity: text('velocity'),
	SourceUrl: text('source_url'),
	ThumbnailUrl: text('thumbnail_url'),
	PublishedAt: text('published_at'),
	LastAction: text('last_action'),
	LastActionBy: text('last_action_by'),
	LastActionAt: text('last_action_at')
});

export const ClipTasksTable = sqliteTable('clip_tasks', {
	Id: integer('id').primaryKey(),
	Creator: text('creator').notNull(),
	Platform: text('platform').notNull(),
	Source: text('source').notNull(),
	SourceUrl: text('source_url'),
	Timestamp: text('timestamp').notNull(),
	Hook: text('hook').notNull(),
	Score: integer('score').notNull(),
	Status: text('status').notNull(),
	Targets: text('targets').notNull(),
	UploadUrls: text('upload_urls').notNull().default('{"TikTok":"","Shorts":"","Reels":""}'),
	LastAction: text('last_action'),
	LastActionBy: text('last_action_by'),
	LastActionAt: text('last_action_at')
});

export const PlatformAccountsTable = sqliteTable('platform_accounts', {
	Id: integer('id').primaryKey(),
	Creator: text('creator').notNull(),
	Platform: text('platform').notNull(),
	Handle: text('handle').notNull(),
	ExternalId: text('external_id').notNull(),
	SourceUrl: text('source_url'),
	Connected: integer('connected', { mode: 'boolean' }).notNull().default(false),
	LastSyncedAt: text('last_synced_at'),
	LastError: text('last_error')
});

export const SyncRunsTable = sqliteTable('sync_runs', {
	Id: integer('id').primaryKey(),
	Platform: text('platform').notNull(),
	StartedAt: text('started_at').notNull(),
	FinishedAt: text('finished_at'),
	Status: text('status').notNull(),
	ItemsFound: integer('items_found').notNull().default(0),
	Message: text('message')
});

export const SavedSearchesTable = sqliteTable('saved_searches', {
	Id: integer('id').primaryKey(),
	Query: text('query').notNull(),
	CreatedAt: text('created_at').notNull()
});

export const ApiCredentialsTable = sqliteTable('api_credentials', {
	Id: integer('id').primaryKey(),
	Key: text('key').notNull(),
	Value: text('value').notNull(),
	UpdatedAt: text('updated_at').notNull()
});

export const AppSettingsTable = sqliteTable('app_settings', {
	Id: integer('id').primaryKey(),
	Key: text('key').notNull(),
	Value: text('value').notNull()
});

export const ActivityEventsTable = sqliteTable('activity_events', {
	Id: integer('id').primaryKey(),
	Actor: text('actor').notNull(),
	Action: text('action').notNull(),
	EntityType: text('entity_type').notNull(),
	EntityId: integer('entity_id'),
	Label: text('label').notNull(),
	CreatedAt: text('created_at').notNull()
});
