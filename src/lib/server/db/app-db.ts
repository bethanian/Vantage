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
		await EnsurePostgresSeeded();
	} else {
		const { EnsureDatabaseReady } = await import('$lib/server/db/seed');
		EnsureDatabaseReady();
	}
	Ready = true;
}

export async function All<T>(Sql: string, Params: unknown[] = []) {
	if (IsPostgresRuntime) return PgRows<T>(Sql, Params);
	return GetSqlite().prepare(Sql).all(...Params) as T[];
}

export async function Get<T>(Sql: string, Params: unknown[] = []) {
	if (IsPostgresRuntime) return (await PgRows<T>(Sql, Params))[0];
	return GetSqlite().prepare(Sql).get(...Params) as T | undefined;
}

export async function Run(Sql: string, Params: unknown[] = []) {
	if (IsPostgresRuntime) {
		await PgRows(Sql, Params);
		return;
	}
	GetSqlite().prepare(Sql).run(...Params);
}

export async function NextId(Table: string) {
	const Row = await Get<{ Id: number }>(`select coalesce(max(id), 0) + 1 as "Id" from ${Table}`);
	return Row?.Id ?? 1;
}

async function PgRows<T>(Sql: string, Params: unknown[] = []) {
	if (!PostgresClient) throw new Error('POSTGRES_URL is required for Postgres runtime');
	return (await PostgresClient.unsafe(ToPostgresSql(Sql), Params as never[])) as T[];
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
		{ id: 1, query: 'challenge', created_at: new Date().toISOString() },
		{ id: 2, query: 'reaction', created_at: new Date().toISOString() },
		{ id: 3, query: 'live stream', created_at: new Date().toISOString() }
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
