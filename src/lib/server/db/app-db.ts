import { Campaigns, ClipTasks, ContentItems, Creators } from '$lib/vantage-data';
import { ImportTables } from '$lib/server/db/metadata';
import { PostgresClient } from '$lib/server/db/postgres';

type SqliteDatabase = typeof import('$lib/server/db').Sqlite;

let SqliteClient: SqliteDatabase | null = null;
let Ready = false;

export const IsPostgresRuntime = Boolean(process.env.POSTGRES_URL);

export async function EnsureAppDatabaseReady() {
	if (Ready) return;
	if (IsPostgresRuntime) {
		await EnsurePostgresSchema();
		await EnsurePostgresSeeded();
	} else {
		const { EnsureDatabaseReady } = await import('$lib/server/db/seed');
		EnsureDatabaseReady();
	}
	Ready = true;
}

export async function All<T>(Sql: string, Params: unknown[] = []) {
	const Values = NormalizeParams(Params);
	if (IsPostgresRuntime) return PgRows<T>(Sql, Values);
	return GetSqlite().prepare(Sql).all(...Values) as T[];
}

export async function Get<T>(Sql: string, Params: unknown[] = []) {
	const Values = NormalizeParams(Params);
	if (IsPostgresRuntime) return (await PgRows<T>(Sql, Values))[0];
	return GetSqlite().prepare(Sql).get(...Values) as T | undefined;
}

export async function Run(Sql: string, Params: unknown[] = []) {
	const Values = NormalizeParams(Params);
	if (IsPostgresRuntime) {
		await PgRows(Sql, Values);
		return;
	}
	GetSqlite().prepare(Sql).run(...Values);
}

export async function NextId(Table: string) {
	const Row = await Get<{ Id: number }>(`select coalesce(max(id), 0) + 1 as "Id" from ${Table}`);
	return Row?.Id ?? 1;
}

async function PgRows<T>(Sql: string, Params: unknown[] = []) {
	if (!PostgresClient) throw new Error('POSTGRES_URL is required for Postgres runtime');
	return (await PostgresClient.unsafe(ToPostgresSql(Sql), Params as never[])) as T[];
}

function NormalizeParams(Params: unknown[]) {
	return Params.map((Value) => {
		if (Value === undefined) return null;
		if (typeof Value === 'boolean') return Value ? 1 : 0;
		if (Value instanceof Date) return Value.toISOString();
		if (typeof Value === 'object' && Value !== null && !Buffer.isBuffer(Value)) return JSON.stringify(Value);
		return Value;
	});
}

function GetSqlite() {
	if (SqliteClient) return SqliteClient;
	throw new Error('SQLite client not loaded; call EnsureAppDatabaseReady first');
}

async function LoadSqlite() {
	if (!SqliteClient) SqliteClient = (await import('$lib/server/db')).Sqlite;
	return SqliteClient;
}

async function EnsurePostgresSeeded() {
	const Count = await Get<{ count: string | number }>('select count(*) as count from creators');
	if (Number(Count?.count ?? 0) > 0) return;
	await SeedPostgres();
}

async function EnsurePostgresSchema() {
	if (!PostgresClient) throw new Error('POSTGRES_URL is required for Postgres runtime');
	await PostgresClient.unsafe(`
		create table if not exists media_jobs (
			id integer primary key,
			clip_task_id integer,
			source_url text not null,
			source_platform text not null,
			video_title text not null,
			thumbnail_url text,
			creator text not null,
			duration text not null default 'unknown',
			media_status text not null default 'unknown',
			progress integer not null default 0,
			priority integer not null default 0,
			stage text not null default 'waiting',
			estimated_file_size text not null default 'unknown',
			error_message text,
			manual_review_status text not null default 'Not required',
			transcript_text text,
			transcript_format text,
			transcript_language text,
			transcript_confidence real,
			transcript_model text,
			transcript_source text,
			transcript_segments_json text,
			transcript_words_json text,
			transcript_translation_text text,
			transcript_translation_language text,
			transcript_translation_source text,
			transcript_translation_updated_at text,
			transcript_updated_at text,
			output_path text,
			audio_path text,
			manual_context text,
			source_validation_status text,
			live_recording_mode text,
			live_chunk_seconds integer,
			live_analyze_while_recording integer not null default 0,
			live_generate_periodic_clips integer not null default 0,
			live_marked_moments_json text,
			analysis_report_json text,
			analysis_request_json text,
			analysis_updated_at text,
			metadata_json text,
			downloaded_at text,
			cancelled_at text,
			claimed_by text,
			claimed_at text,
			claim_expires_at text,
			created_at text not null,
			updated_at text
		)
	`);
	for (const Column of [
		['transcript_language', 'text'],
		['transcript_confidence', 'real'],
		['transcript_model', 'text'],
		['transcript_source', 'text'],
		['transcript_segments_json', 'text'],
		['transcript_words_json', 'text'],
		['transcript_translation_text', 'text'],
		['transcript_translation_language', 'text'],
		['transcript_translation_source', 'text'],
		['transcript_translation_updated_at', 'text'],
		['transcript_updated_at', 'text'],
		['output_path', 'text'],
		['audio_path', 'text'],
		['manual_context', 'text'],
		['source_validation_status', 'text'],
		['priority', 'integer not null default 0'],
		['live_recording_mode', 'text'],
		['live_chunk_seconds', 'integer'],
		['live_analyze_while_recording', 'integer not null default 0'],
		['live_generate_periodic_clips', 'integer not null default 0'],
		['live_marked_moments_json', 'text'],
		['analysis_report_json', 'text'],
		['analysis_request_json', 'text'],
		['analysis_updated_at', 'text'],
		['metadata_json', 'text'],
		['downloaded_at', 'text'],
		['cancelled_at', 'text'],
		['claimed_by', 'text'],
		['claimed_at', 'text'],
		['claim_expires_at', 'text']
	]) {
		await PostgresClient.unsafe(`alter table media_jobs add column if not exists ${Column[0]} ${Column[1]}`);
	}
	await PostgresClient.unsafe(`
		create table if not exists clip_candidates (
			id integer primary key,
			media_job_id integer not null,
			clip_number integer not null,
			title text,
			start_time text not null,
			end_time text not null,
			duration text not null,
			viral_score integer not null,
			category text not null,
			explanation text not null,
			hook_score integer not null,
			context_score integer not null,
			emotion_score integer not null,
			humor_score integer not null,
			controversy_score integer not null,
			payoff_score integer not null,
			retention_score integer not null,
			shareability_score integer not null,
			originality_score integer not null,
			status text not null default 'Suggested',
			variant text not null default 'strongest hook',
			cut_segments_json text,
			caption_text text,
			caption_json text,
			caption_status text,
			review_notes text,
			created_at text not null
		)
	`);
	for (const Column of [
		['title', 'text'],
		['cut_segments_json', 'text'],
		['caption_text', 'text'],
		['caption_json', 'text'],
		['caption_status', 'text'],
		['review_notes', 'text']
	]) {
		await PostgresClient.unsafe(`alter table clip_candidates add column if not exists ${Column[0]} ${Column[1]}`);
	}
	await PostgresClient.unsafe(`
		create table if not exists clip_exports (
			id integer primary key,
			media_job_id integer not null,
			clip_candidate_id integer,
			preset text not null,
			status text not null default 'waiting',
			progress integer not null default 0,
			output_path text,
			file_size text,
			error_message text,
			claimed_by text,
			claimed_at text,
			claim_expires_at text,
			created_at text not null,
			updated_at text,
			completed_at text
		)
	`);
	for (const Column of [
		['claimed_by', 'text'],
		['claimed_at', 'text'],
		['claim_expires_at', 'text']
	]) {
		await PostgresClient.unsafe(`alter table clip_exports add column if not exists ${Column[0]} ${Column[1]}`);
	}
	await PostgresClient.unsafe(`
		create table if not exists clip_previews (
			id integer primary key,
			media_job_id integer not null,
			clip_candidate_id integer not null,
			status text not null default 'waiting',
			progress integer not null default 0,
			preview_path text,
			thumbnail_path text,
			file_size text,
			error_message text,
			claimed_by text,
			claimed_at text,
			claim_expires_at text,
			created_at text not null,
			updated_at text,
			completed_at text
		)
	`);
	for (const Column of [
		['claimed_by', 'text'],
		['claimed_at', 'text'],
		['claim_expires_at', 'text']
	]) {
		await PostgresClient.unsafe(`alter table clip_previews add column if not exists ${Column[0]} ${Column[1]}`);
	}
	await PostgresClient.unsafe(`
		create table if not exists worker_heartbeats (
			id integer primary key,
			instance_id text not null,
			role text not null,
			workers text not null,
			status text not null,
			pid integer,
			host text,
			started_at text not null,
			last_seen_at text not null,
			message text
		)
	`);
	for (const Column of [
		['instance_id', 'text'],
		['role', 'text'],
		['workers', 'text'],
		['status', 'text'],
		['pid', 'integer'],
		['host', 'text'],
		['started_at', 'text'],
		['last_seen_at', 'text'],
		['message', 'text']
	]) {
		await PostgresClient.unsafe(`alter table worker_heartbeats add column if not exists ${Column[0]} ${Column[1]}`);
	}
}

async function SeedPostgres() {
	await InsertRows(
		'creators',
		Creators.map((Creator, Index) => ({
			id: Index + 1,
			name: Creator.Name,
			initial: Creator.Initial,
			platforms: JSON.stringify(Creator.Platforms),
			campaign: Creator.Campaign,
			live_viewers: Creator.LiveViewers,
			followers: Creator.Followers,
			average_score: Creator.AverageScore,
			clips_made: Creator.ClipsMade,
			notes: Creator.Notes
		}))
	);
	await InsertRows(
		'campaigns',
		Campaigns.map((Campaign, Index) => ({
			id: Index + 1,
			name: Campaign.Name,
			state: Campaign.State,
			rate: Campaign.Rate,
			niche: Campaign.Niche,
			earned: Campaign.Earned,
			goal: Campaign.Goal,
			submitted: Campaign.Submitted,
			allowed: JSON.stringify(Campaign.Allowed),
			rules: Campaign.Rules,
			hook_rules: Campaign.HookRules,
			banned_terms: Campaign.BannedTerms
		}))
	);
	await InsertRows(
		'content_items',
		ContentItems.map((Item) => ({
			id: Item.Id,
			creator: Item.Creator,
			external_id: Item.ExternalId ?? null,
			platform: Item.Platform,
			kind: Item.Kind,
			title: Item.Title,
			age: Item.Age,
			metric: Item.Metric,
			campaign: Item.Campaign,
			status: Item.Status,
			score: Item.Score,
			live: Boolean(Item.Live),
			velocity: Item.Velocity ?? null,
			source_url: Item.SourceUrl ?? null,
			thumbnail_url: Item.ThumbnailUrl ?? null,
			published_at: Item.PublishedAt ?? null,
			last_action: Item.LastAction ?? null,
			last_action_by: Item.LastActionBy ?? null,
			last_action_at: Item.LastActionAt ?? null
		}))
	);
	await InsertRows(
		'clip_tasks',
		ClipTasks.map((Task) => ({
			id: Task.Id,
			creator: Task.Creator,
			platform: Task.Platform,
			source: Task.Source,
			source_url: Task.SourceUrl ?? null,
			timestamp: Task.Timestamp,
			hook: Task.Hook,
			score: Task.Score,
			status: Task.Status,
			targets: JSON.stringify(Task.Targets),
			upload_urls: JSON.stringify(Task.UploadUrls),
			last_action: Task.LastAction ?? null,
			last_action_by: Task.LastActionBy ?? null,
			last_action_at: Task.LastActionAt ?? null
		}))
	);
	await InsertRows('saved_searches', [
		{ id: 1, query: 'Whop', created_at: new Date().toISOString() },
		{ id: 2, query: 'challenge', created_at: new Date().toISOString() },
		{ id: 3, query: 'reaction', created_at: new Date().toISOString() }
	]);
	await InsertRows('app_settings', [
		{ id: 1, key: 'NicheKeywords', value: 'gaming, slots, IRL, reaction, funny' },
		{ id: 2, key: 'RefreshSchedule', value: '30' },
		{ id: 3, key: 'MinimumScore', value: '40' },
		{ id: 4, key: 'ScoreRecencyWeight', value: '1' },
		{ id: 5, key: 'ScoreEngagementWeight', value: '1' },
		{ id: 6, key: 'ScorePlatformWeight', value: '1' },
		{ id: 7, key: 'ScoreCampaignWeight', value: '1' },
		{ id: 8, key: 'ScoreTitleWeight', value: '1' },
		{ id: 9, key: 'ScoreStatusWeight', value: '1' }
	]);
}

async function InsertRows(TableName: string, Rows: Record<string, unknown>[]) {
	if (!Rows.length || !PostgresClient) return;
	const Meta = ImportTables.find((Table) => Table.Name === TableName);
	if (!Meta) throw new Error(`Unknown table ${TableName}`);
	const Sql = PostgresClient as any;
	await Sql`insert into ${Sql(TableName)} ${Sql(Rows, Meta.Columns as unknown as string[])}`;
}

if (!IsPostgresRuntime) await LoadSqlite();

function ToPostgresSql(Sql: string) {
	let Index = 0;
	return Sql.replace(/\?/g, () => `$${++Index}`);
}
