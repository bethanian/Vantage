import { All, EnsureAppDatabaseReady, Get, IsPostgresRuntime, NextId, Run } from '$lib/server/db/app-db';
import { ImportTables, ScoreWeightKeys } from '$lib/server/db/metadata';
import { CalculateOpportunityScore } from '$lib/opportunity-score';
import { GetOpportunityWeights } from '$lib/server/opportunity-settings';
import { ActorFromForm, MarkClipTaskAction, MarkContentAction, WriteActivity } from '$lib/server/activity';
import { ApiCredentialFields, GetApiCredentialStatuses } from '$lib/server/api-credentials';
import { NormalizeThumbnailUrl } from '$lib/server/thumbnails';
import { fail, type Actions } from '@sveltejs/kit';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type {
	ActivityEvent,
	ApiCredentialStatus,
	AppSettings,
	ClipTask,
	ContentItem,
	Platform,
	PlatformAccount,
	SavedSearch,
	SyncRun
} from '$lib/vantage-data';

export async function load() {
	await EnsureAppDatabaseReady();

	const ContentItems = (await All<ContentItemRow>(
		`select id as "Id", creator as "Creator", external_id as "ExternalId", platform as "Platform", kind as "Kind",
		 title as "Title", age as "Age", metric as "Metric", campaign as "Campaign", status as "Status",
		 score as "Score", live as "Live", velocity as "Velocity", source_url as "SourceUrl",
		 thumbnail_url as "ThumbnailUrl", published_at as "PublishedAt", last_action as "LastAction",
		 last_action_by as "LastActionBy", last_action_at as "LastActionAt" from content_items`
	))
		.map(
			(Item): ContentItem => ({
				...Item,
				Platform: Item.Platform as ContentItem['Platform'],
				Status: Item.Status as ContentItem['Status'],
				Live: Boolean(Item.Live),
				Velocity: Item.Velocity ?? undefined,
				ThumbnailUrl: NormalizeThumbnailUrl(Item.ThumbnailUrl)
			})
		);

	const ClipTasks = (await All<ClipTaskRow>(
		`select id as "Id", creator as "Creator", platform as "Platform", source as "Source", source_url as "SourceUrl",
		 timestamp as "Timestamp", hook as "Hook", score as "Score", status as "Status", targets as "Targets",
		 upload_urls as "UploadUrls", last_action as "LastAction", last_action_by as "LastActionBy",
		 last_action_at as "LastActionAt" from clip_tasks`
	))
		.map(
			(Task): ClipTask => ({
				...Task,
				Platform: Task.Platform as ClipTask['Platform'],
				Targets: JSON.parse(Task.Targets) as ClipTask['Targets'],
				UploadUrls: JSON.parse(Task.UploadUrls) as ClipTask['UploadUrls']
			})
		);

	const PlatformAccounts = (await All<PlatformAccountRow>(
		`select id as "Id", creator as "Creator", platform as "Platform", handle as "Handle",
		 external_id as "ExternalId", source_url as "SourceUrl", connected as "Connected",
		 last_synced_at as "LastSyncedAt", last_error as "LastError" from platform_accounts`
	)).map((Account): PlatformAccount => ({ ...Account, Connected: Boolean(Account.Connected), Platform: Account.Platform as Platform }));

	const SyncRuns = (await All<SyncRunRow>(
		`select id as "Id", platform as "Platform", started_at as "StartedAt", finished_at as "FinishedAt",
		 status as "Status", items_found as "ItemsFound", message as "Message" from sync_runs`
	))
		.map((Run): SyncRun => ({ ...Run, Platform: Run.Platform as Platform }));

	const SavedSearches = await All<SavedSearch>('select id as "Id", query as "Query", created_at as "CreatedAt" from saved_searches');
	const ActivityEvents = await All<ActivityEvent>(
		`select id as "Id", actor as "Actor", action as "Action", entity_type as "EntityType",
		 entity_id as "EntityId", label as "Label", created_at as "CreatedAt"
		 from activity_events order by id desc limit 30`
	);
	const ApiCredentials = (await GetApiCredentialStatuses()) as ApiCredentialStatus[];
	const AppSettings = await LoadAppSettings();

	return { ActivityEvents, ApiCredentials, AppSettings, ClipTasks, ContentItems, PlatformAccounts, SavedSearches, SyncRuns };
}

export const actions: Actions = {
	AddCreator: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Name = RequiredText(Form, 'Name');
		if (!Name) return fail(400, { Message: 'Creator name is required' });

		const Platforms = TextList(Form, 'Platforms', ['Kick']);
		const Id = await NextId('creators');
		await Run(
			`insert into creators
			 (id, name, initial, platforms, campaign, live_viewers, followers, average_score, clips_made, notes)
			 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				Id,
				Name,
				Name[0]?.toUpperCase() ?? 'C',
				JSON.stringify(Platforms),
				OptionalText(Form, 'Campaign', 'Organic'),
				OptionalText(Form, 'LiveViewers', 'offline'),
				OptionalText(Form, 'Followers', '0'),
				NumberField(Form, 'AverageScore', 50),
				0,
				OptionalText(Form, 'Notes', '')
			]
		);

		await WriteActivity(Actor, { EntityType: 'Creator', EntityId: Id, Action: 'Added creator', Label: `Added ${Name} - ${Actor}` });
		return { Created: 'Creator' };
	},

	AddCampaign: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Name = RequiredText(Form, 'Name');
		if (!Name) return fail(400, { Message: 'Campaign name is required' });

		await Run(
			`insert into campaigns
			 (id, name, state, rate, niche, earned, goal, submitted, allowed, rules, hook_rules, banned_terms)
			 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				await NextId('campaigns'),
				Name,
				OptionalText(Form, 'State', 'Active'),
				OptionalText(Form, 'Rate', '$0 / 1k views'),
				OptionalText(Form, 'Niche', 'General'),
				NumberField(Form, 'Earned', 0),
				NumberField(Form, 'Goal', 100),
				0,
				JSON.stringify(TextList(Form, 'Allowed', ['TikTok', 'YouTube Shorts', 'Instagram Reels'])),
				OptionalText(Form, 'Rules', ''),
				OptionalText(Form, 'HookRules', ''),
				OptionalText(Form, 'BannedTerms', '')
			]
		);

		await WriteActivity(Actor, { EntityType: 'Campaign', EntityId: null, Action: 'Added campaign', Label: `Added ${Name} - ${Actor}` });
		return { Created: 'Campaign' };
	},

	AddClipTask: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Creator = RequiredText(Form, 'Creator');
		const Source = RequiredText(Form, 'Source');
		if (!Creator || !Source) return fail(400, { Message: 'Creator and source are required' });
		const Platform = OptionalText(Form, 'Platform', 'Kick');
		const Status = NormalizeQueueStatus(OptionalText(Form, 'Status', 'To Clip'));
		const ScoreWeights = await GetOpportunityWeights();

		const Id = await NextId('clip_tasks');
		await Run(
			`insert into clip_tasks
			 (id, creator, platform, source, source_url, timestamp, hook, score, status, targets, upload_urls)
			 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				Id,
				Creator,
				Platform,
				Source,
				OptionalText(Form, 'SourceUrl', ''),
				OptionalText(Form, 'Timestamp', '0:00'),
				OptionalText(Form, 'Hook', 'clip this moment'),
				OptionalNumberField(
					Form,
					'Score',
					CalculateOpportunityScore({ Platform, Kind: 'Clip idea', Title: Source, Status }, ScoreWeights)
				),
				Status,
				JSON.stringify({
					TikTok: Form.has('TikTok'),
					Shorts: Form.has('Shorts'),
					Reels: Form.has('Reels')
				}),
				UploadUrls(Form)
			]
		);

		await MarkClipTaskAction(Id, Actor, 'Queued');
		return { Created: 'ClipTask' };
	},

	AddContentToQueue: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const ContentId = NumberField(Form, 'ContentId', 0);
		if (!ContentId) return fail(400, { Message: 'Content item id is required' });
		const Item = await Get<ContentRow>('select * from content_items where id = ?', [ContentId]);
		if (!Item) return fail(404, { Message: 'Content item was not found' });
		const Exists = await FindQueuedTask(Item);
		if (Exists) return { Created: 'ClipTask' };

		const Id = await NextId('clip_tasks');
		await Run(
			`insert into clip_tasks
			 (id, creator, platform, source, source_url, timestamp, hook, score, status, targets, upload_urls, last_action, last_action_by, last_action_at)
			 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				Id,
				Item.creator,
				Item.platform,
				Item.title,
				Item.source_url,
				'0:00',
				SuggestedHook(Item.title),
				Item.score,
				'To Clip',
				JSON.stringify({ TikTok: true, Shorts: true, Reels: true }),
				EmptyUploadUrls(),
				'Queued',
				Actor,
				new Date().toISOString()
			]
		);

		await Run("update content_items set status = 'Watched' where id = ? and status = 'New'", [ContentId]);
		await MarkClipTaskAction(Id, Actor, 'Queued');
		await MarkContentAction(ContentId, Actor, 'Queued');
		return { Created: 'ClipTask' };
	},

	DeleteContentQueueItem: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const ContentId = NumberField(Form, 'ContentId', 0);
		if (!ContentId) return fail(400, { Message: 'Content item id is required' });
		const Item = await Get<ContentRow>('select * from content_items where id = ?', [ContentId]);
		if (!Item) return fail(404, { Message: 'Content item was not found' });
		const Task = await FindQueuedTask(Item);
		if (!Task) return { Deleted: 'ClipTask' };
		await Run('delete from clip_tasks where id = ?', [Task.id]);
		await Run("update content_items set status = 'New' where id = ? and status = 'Watched'", [ContentId]);
		try {
			await MarkContentAction(ContentId, Actor, 'Removed from queue');
			await WriteActivity(Actor, { EntityType: 'ClipTask', EntityId: Task.id, Action: 'Removed queued clip', Label: `Removed queue item - ${Actor}` });
		} catch {
			return { Deleted: 'ClipTask' };
		}
		return { Deleted: 'ClipTask' };
	},

	AddSourceAccount: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Creator = RequiredText(Form, 'Creator');
		const Platform = RequiredText(Form, 'Platform');
		const Handle = RequiredText(Form, 'Handle');
		const ExternalId = OptionalText(Form, 'ExternalId', Handle);
		if (!Creator || !Platform || !Handle) {
			return fail(400, { Message: 'Source name, platform, and handle are required' });
		}
		if (!['YouTube', 'Twitch', 'Kick', 'TikTok', 'Instagram', 'X'].includes(Platform)) {
			return fail(400, { Message: 'Unsupported platform' });
		}

		const Id = await NextId('platform_accounts');
		await Run(
			`insert into platform_accounts
			 (id, creator, platform, handle, external_id, source_url, connected)
			 values (?, ?, ?, ?, ?, ?, ?)`,
			[Id, Creator, Platform, Handle, ExternalId, OptionalText(Form, 'SourceUrl', DefaultSourceUrl(Platform, Handle)), false]
		);

		await WriteActivity(Actor, { EntityType: 'SourceAccount', EntityId: Id, Action: 'Added source', Label: `Added ${Platform} source - ${Actor}` });
		return { Created: 'SourceAccount' };
	},

	SaveApiCredentials: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		for (const Field of ApiCredentialFields) {
			const Value = RequiredText(Form, Field.Key);
			if (!Value) continue;
			await Run('delete from api_credentials where key = ?', [Field.Key]);
			await Run('insert into api_credentials (id, key, value, updated_at) values (?, ?, ?, ?)', [
				await NextId('api_credentials'),
				Field.Key,
				Value,
				new Date().toISOString()
			]);
		}
		await WriteActivity(Actor, { EntityType: 'Settings', EntityId: null, Action: 'Saved API keys' });
		return { Updated: 'ApiCredentials' };
	},

	ClearApiCredential: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Key = RequiredText(Form, 'Key');
		if (!ApiCredentialFields.some((Field) => Field.Key === Key)) return fail(400, { Message: 'Unsupported API key' });
		await Run('delete from api_credentials where key = ?', [Key]);
		await WriteActivity(Actor, { EntityType: 'Settings', EntityId: null, Action: 'Cleared API key' });
		return { Deleted: 'ApiCredential' };
	},

	SaveAppSettings: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		await UpsertSetting('NicheKeywords', OptionalText(Form, 'NicheKeywords', ''));
		await UpsertSetting('RefreshSchedule', OptionalText(Form, 'RefreshSchedule', '30'));
		await UpsertSetting('MinimumScore', String(Math.max(0, Math.min(100, NumberField(Form, 'MinimumScore', 40)))));
		for (const Key of ScoreWeightKeys) await UpsertSetting(Key, String(Math.max(0, Math.min(3, NumberField(Form, Key, 1)))));
		await WriteActivity(Actor, { EntityType: 'Settings', EntityId: null, Action: 'Saved preferences' });
		return { Updated: 'AppSettings' };
	},

	ImportDatabaseBackup: async ({ request }) => {
		await EnsureAppDatabaseReady();
		if (IsPostgresRuntime) return fail(400, { Message: 'SQLite backup import is only available in local mode' });
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Backup = Form.get('Backup');
		if (!(Backup instanceof File) || Backup.size === 0) return fail(400, { Message: 'Backup file is required' });
		if (Backup.size > 25 * 1024 * 1024) return fail(400, { Message: 'Backup file is too large' });

		const ImportDir = join(tmpdir(), 'vantage-imports');
		const ImportPath = join(ImportDir, `vantage-import-${Date.now()}.db`);
		mkdirSync(ImportDir, { recursive: true });
		writeFileSync(ImportPath, Buffer.from(await Backup.arrayBuffer()));

		try {
			const Result = await ImportBackup(ImportPath);
			await WriteActivity(Actor, { EntityType: 'Backup', EntityId: null, Action: 'Imported database', Label: `Imported database - ${Actor}` });
			return { Imported: 'DatabaseBackup', ...Result };
		} catch (Reason) {
			const Message = Reason instanceof Error ? Reason.message : 'Backup import failed';
			return fail(400, { Message });
		} finally {
			rmSync(ImportPath, { force: true });
		}
	},

	DeleteSourceAccount: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Id = NumberField(Form, 'Id', 0);
		if (!Id) return fail(400, { Message: 'Source account id is required' });
		const Account = await Get<{ creator: string; platform: string }>('select creator, platform from platform_accounts where id = ? limit 1', [Id]);
		if (!Account) return { Deleted: 'SourceAccount' };
		await Run('delete from platform_accounts where id = ?', [Id]);
		await Run('delete from content_items where creator = ? and platform = ?', [Account.creator, Account.platform]);
		await Run('delete from clip_tasks where creator = ? and platform = ?', [Account.creator, Account.platform]);
		await WriteActivity(Actor, {
			EntityType: 'SourceAccount',
			EntityId: Id,
			Action: 'Removed source',
			Label: `Removed ${Account.platform} source - ${Actor}`
		});
		return { Deleted: 'SourceAccount' };
	},

	UpdateSourceAccount: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Id = NumberField(Form, 'Id', 0);
		const Creator = RequiredText(Form, 'Creator');
		const Platform = RequiredText(Form, 'Platform');
		const Handle = RequiredText(Form, 'Handle');
		const ExternalId = OptionalText(Form, 'ExternalId', Handle);
		if (!Id || !Creator || !Platform || !Handle) {
			return fail(400, { Message: 'Source account id, source name, platform, and handle are required' });
		}
		if (!['YouTube', 'Twitch', 'Kick', 'TikTok', 'Instagram', 'X'].includes(Platform)) {
			return fail(400, { Message: 'Unsupported platform' });
		}

		await Run(
			`update platform_accounts
			 set creator = ?, platform = ?, handle = ?, external_id = ?, source_url = ?, connected = ?, last_error = null
			 where id = ?`,
			[Creator, Platform, Handle, ExternalId, OptionalText(Form, 'SourceUrl', DefaultSourceUrl(Platform, Handle)), false, Id]
		);
		await WriteActivity(Actor, { EntityType: 'SourceAccount', EntityId: Id, Action: 'Updated source' });
		return { Updated: 'SourceAccount' };
	},

	AddSavedSearch: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Query = RequiredText(Form, 'Query');
		if (!Query) return fail(400, { Message: 'Search query is required' });
		const Exists = await Get('select 1 from saved_searches where lower(query) = lower(?) limit 1', [Query]);
		if (Exists) return { Created: 'SavedSearch' };
		await Run('insert into saved_searches (id, query, created_at) values (?, ?, ?)', [await NextId('saved_searches'), Query, new Date().toISOString()]);
		await WriteActivity(Actor, { EntityType: 'SavedSearch', EntityId: null, Action: 'Saved search', Label: `Saved search - ${Actor}` });
		return { Created: 'SavedSearch' };
	},

	DeleteSavedSearch: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Id = NumberField(Form, 'Id', 0);
		if (!Id) return fail(400, { Message: 'Saved search id is required' });
		await Run('delete from saved_searches where id = ?', [Id]);
		await WriteActivity(Actor, { EntityType: 'SavedSearch', EntityId: Id, Action: 'Deleted search' });
		return { Deleted: 'SavedSearch' };
	},

	DeleteClipTask: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Id = NumberField(Form, 'Id', 0);
		if (!Id) return fail(400, { Message: 'Clip task id is required' });
		const Task = await Get<{ id: number; source_url?: string | null }>('select id, source_url from clip_tasks where id = ? limit 1', [Id]);
		if (!Task) return { Deleted: 'ClipTask' };
		await Run('delete from clip_tasks where id = ?', [Id]);
		try {
			await WriteActivity(Actor, { EntityType: 'ClipTask', EntityId: Id, Action: 'Deleted clip' });
			if (Task.source_url) await Run("update content_items set status = 'New' where source_url = ? and status = 'Watched'", [Task.source_url]);
		} catch {
			return { Deleted: 'ClipTask' };
		}
		return { Deleted: 'ClipTask' };
	},

	DeleteCampaign: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Name = RequiredText(Form, 'Name');
		if (!Name) return fail(400, { Message: 'Campaign name is required' });
		await Run('delete from campaigns where name = ?', [Name]);
		await Run("update content_items set campaign = 'Organic' where campaign = ?", [Name]);
		await Run("update creators set campaign = 'Organic' where campaign = ?", [Name]);
		await WriteActivity(Actor, { EntityType: 'Campaign', EntityId: null, Action: 'Deleted campaign', Label: `Deleted ${Name} - ${Actor}` });
		return { Deleted: 'Campaign' };
	},

	DeleteCreator: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Name = RequiredText(Form, 'Name');
		if (!Name) return fail(400, { Message: 'Creator name is required' });
		await Run('delete from creators where name = ?', [Name]);
		await Run('delete from platform_accounts where creator = ?', [Name]);
		await Run('delete from content_items where creator = ?', [Name]);
		await Run('delete from clip_tasks where creator = ?', [Name]);
		await WriteActivity(Actor, { EntityType: 'Creator', EntityId: null, Action: 'Deleted creator', Label: `Deleted ${Name} - ${Actor}` });
		return { Deleted: 'Creator' };
	},

	UpdateCreator: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Name = RequiredText(Form, 'Name');
		if (!Name) return fail(400, { Message: 'Creator name is required' });
		await Run(
			`update creators
			 set platforms = ?, campaign = ?, live_viewers = ?, followers = ?, average_score = ?, clips_made = ?
			 where name = ?`,
			[
				JSON.stringify(TextList(Form, 'Platforms', ['Kick'])),
				OptionalText(Form, 'Campaign', 'Organic'),
				OptionalText(Form, 'LiveViewers', 'offline'),
				OptionalText(Form, 'Followers', '0'),
				NumberField(Form, 'AverageScore', 50),
				NumberField(Form, 'ClipsMade', 0),
				Name
			]
		);
		await WriteActivity(Actor, { EntityType: 'Creator', EntityId: null, Action: 'Updated creator', Label: `Updated ${Name} - ${Actor}` });
		return { Updated: 'Creator' };
	},

	UpdateCampaign: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Name = RequiredText(Form, 'Name');
		if (!Name) return fail(400, { Message: 'Campaign name is required' });
		await Run(
			`update campaigns
			 set state = ?, rate = ?, niche = ?, earned = ?, goal = ?, submitted = ?, allowed = ?, rules = ?, hook_rules = ?, banned_terms = ?
			 where name = ?`,
			[
				OptionalText(Form, 'State', 'Active'),
				OptionalText(Form, 'Rate', '$0 / 1k views'),
				OptionalText(Form, 'Niche', 'General'),
				NumberField(Form, 'Earned', 0),
				NumberField(Form, 'Goal', 100),
				NumberField(Form, 'Submitted', 0),
				JSON.stringify(TextList(Form, 'Allowed', ['TikTok', 'YouTube Shorts', 'Instagram Reels'])),
				OptionalText(Form, 'Rules', ''),
				OptionalText(Form, 'HookRules', ''),
				OptionalText(Form, 'BannedTerms', ''),
				Name
			]
		);
		await WriteActivity(Actor, { EntityType: 'Campaign', EntityId: null, Action: 'Updated campaign', Label: `Updated ${Name} - ${Actor}` });
		return { Updated: 'Campaign' };
	},

	UpdateClipTask: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Id = NumberField(Form, 'Id', 0);
		if (!Id) return fail(400, { Message: 'Clip task id is required' });
		await Run(
			`update clip_tasks
			 set source = ?, source_url = ?, timestamp = ?, hook = ?, score = ?, status = ?, targets = ?, upload_urls = ?
			 where id = ?`,
			[
				OptionalText(Form, 'Source', 'Source moment'),
				OptionalText(Form, 'SourceUrl', ''),
				OptionalText(Form, 'Timestamp', '0:00'),
				OptionalText(Form, 'Hook', 'clip this moment'),
				NumberField(Form, 'Score', 50),
				NormalizeQueueStatus(OptionalText(Form, 'Status', 'To Clip')),
				JSON.stringify({
					TikTok: Form.has('TikTok'),
					Shorts: Form.has('Shorts'),
					Reels: Form.has('Reels')
				}),
				UploadUrls(Form),
				Id
			]
		);
		await MarkClipTaskAction(Id, Actor, 'Updated');
		return { Updated: 'ClipTask' };
	}
};

function RequiredText(Form: FormData, Key: string) {
	const Value = Form.get(Key);
	return typeof Value === 'string' ? Value.trim() : '';
}

function OptionalText(Form: FormData, Key: string, Fallback: string) {
	return RequiredText(Form, Key) || Fallback;
}

function NumberField(Form: FormData, Key: string, Fallback: number) {
	const Value = Number(Form.get(Key));
	return Number.isFinite(Value) ? Value : Fallback;
}

function OptionalNumberField(Form: FormData, Key: string, Fallback: number) {
	const Raw = Form.get(Key);
	if (typeof Raw !== 'string' || !Raw.trim()) return Fallback;
	const Value = Number(Raw);
	return Number.isFinite(Value) ? Value : Fallback;
}

function TextList(Form: FormData, Key: string, Fallback: string[]) {
	const Value = RequiredText(Form, Key);
	return Value ? Value.split(',').map((Item) => Item.trim()).filter(Boolean) : Fallback;
}

function UploadUrls(Form: FormData) {
	return JSON.stringify({
		TikTok: RequiredText(Form, 'TikTokUrl'),
		Shorts: RequiredText(Form, 'ShortsUrl'),
		Reels: RequiredText(Form, 'ReelsUrl')
	});
}

function EmptyUploadUrls() {
	return JSON.stringify({ TikTok: '', Shorts: '', Reels: '' });
}

async function FindQueuedTask(Item: ContentRow) {
	if (Item.source_url) {
		const ByUrl = await Get<{ id: number }>(
			'select id from clip_tasks where creator = ? and source = ? and source_url = ? limit 1',
			[Item.creator, Item.title, Item.source_url]
		);
		if (ByUrl) return ByUrl;
	}
	return Get<{ id: number }>(
		"select id from clip_tasks where creator = ? and source = ? and (source_url is null or source_url = '') limit 1",
		[Item.creator, Item.title]
	);
}

function NormalizeQueueStatus(Status: string) {
	if (Status === 'Done') return 'Finished';
	if (Status === 'To upload' || Status === 'Editing' || Status === 'Uploading' || Status === 'Watched' || Status === 'To clip') return 'To Clip';
	return ['To Clip', 'Finished', 'Uploaded'].includes(Status) ? Status : 'To Clip';
}

async function LoadAppSettings(): Promise<AppSettings> {
	const Rows = await All<{ Key: string; Value: string }>('select key as "Key", value as "Value" from app_settings');
	const Settings = Object.fromEntries(Rows.map((Row) => [Row.Key, Row.Value]));
	return {
		NicheKeywords: Settings.NicheKeywords ?? 'gaming, slots, IRL, reaction, funny',
		RefreshSchedule: Settings.RefreshSchedule ?? '30',
		MinimumScore: Number(Settings.MinimumScore ?? 40),
		ScoreRecencyWeight: Number(Settings.ScoreRecencyWeight ?? 1),
		ScoreEngagementWeight: Number(Settings.ScoreEngagementWeight ?? 1),
		ScorePlatformWeight: Number(Settings.ScorePlatformWeight ?? 1),
		ScoreCampaignWeight: Number(Settings.ScoreCampaignWeight ?? 1),
		ScoreTitleWeight: Number(Settings.ScoreTitleWeight ?? 1),
		ScoreStatusWeight: Number(Settings.ScoreStatusWeight ?? 1)
	};
}

async function UpsertSetting(Key: string, Value: string) {
	const Existing = await Get<{ id: number }>('select id from app_settings where key = ? limit 1', [Key]);
	if (Existing) {
		await Run('update app_settings set value = ? where id = ?', [Value, Existing.id]);
		return;
	}
	await Run('insert into app_settings (id, key, value) values (?, ?, ?)', [await NextId('app_settings'), Key, Value]);
}

async function ImportBackup(ImportPath: string) {
	const { Sqlite } = await import('$lib/server/db');
	const Alias = `backup_${Date.now()}`;
	let ImportedRows = 0;
	Sqlite.exec(`attach database ${SqlLiteral(ImportPath)} as ${Alias}`);
	try {
		ValidateBackup(Sqlite, Alias);
		const Import = Sqlite.transaction(() => {
			for (const Table of ImportTables) {
				const Columns = Table.Columns.join(', ');
				const Row = Sqlite.prepare(
					`insert or replace into ${Table.Name} (${Columns}) select ${Columns} from ${Alias}.${Table.Name}`
				).run();
				ImportedRows += Number(Row.changes);
			}
		});
		Import();
		return { ImportedRows };
	} finally {
		Sqlite.exec(`detach database ${Alias}`);
	}
}

function ValidateBackup(Sqlite: SqliteDatabase, Alias: string) {
	for (const Table of ImportTables) {
		const Exists = Sqlite.prepare(`select 1 from ${Alias}.sqlite_master where type = 'table' and name = ? limit 1`).get(Table.Name);
		if (!Exists) throw new Error(`Backup is missing ${Table.Name}`);
	}
}

function SqlLiteral(Value: string) {
	return `'${Value.replace(/'/g, "''")}'`;
}

function DefaultSourceUrl(Platform: string, Handle: string) {
	const CleanHandle = Handle.replace(/^@/, '');
	if (Platform === 'YouTube') return `https://www.youtube.com/@${CleanHandle}`;
	if (Platform === 'Twitch') return `https://www.twitch.tv/${CleanHandle}`;
	if (Platform === 'Kick') return `https://kick.com/${CleanHandle}`;
	if (Platform === 'TikTok') return `https://www.tiktok.com/@${CleanHandle}`;
	if (Platform === 'Instagram') return `https://www.instagram.com/${CleanHandle}`;
	if (Platform === 'X') return `https://x.com/${CleanHandle}`;
	return '';
}

function SuggestedHook(Title: string) {
	const CleanTitle = Title.trim();
	if (!CleanTitle) return 'clip this moment';
	return CleanTitle.length > 72 ? `${CleanTitle.slice(0, 69)}...` : CleanTitle;
}

type ContentRow = {
	id: number;
	creator: string;
	platform: Platform;
	title: string;
	source_url?: string | null;
	score: number;
};

type SqliteDatabase = typeof import('$lib/server/db').Sqlite;

type ContentItemRow = Omit<ContentItem, 'Live' | 'Platform' | 'Status'> & {
	Platform: string;
	Status: string;
	Live?: boolean | number | null;
};

type ClipTaskRow = Omit<ClipTask, 'Platform' | 'Targets' | 'UploadUrls'> & {
	Platform: string;
	Targets: string;
	UploadUrls: string;
};

type PlatformAccountRow = Omit<PlatformAccount, 'Platform' | 'Connected'> & {
	Platform: string;
	Connected: boolean | number;
};

type SyncRunRow = Omit<SyncRun, 'Platform'> & {
	Platform: string;
};
