import { Campaigns, ClipTasks, ContentItems, Creators } from '$lib/vantage-data';
import { Db, Sqlite } from './index';
import {
	AppSettingsTable,
	CampaignsTable,
	ClipTasksTable,
	ContentItemsTable,
	CreatorsTable,
	PlatformAccountsTable,
	SavedSearchesTable
} from './schema';

let SeedChecked = false;

export function EnsureDatabaseReady() {
	CreateTables();
	if (SeedChecked) return;
	SeedChecked = true;
	const Row = Sqlite.prepare('select count(*) as Count from creators').get() as { Count: number };
	if (Row.Count > 0) return;
	SeedDatabase();
}

function CreateTables() {
	Sqlite.exec(`
		create table if not exists creators (
			id integer primary key,
			name text not null,
			initial text not null,
			platforms text not null,
			campaign text not null,
			live_viewers text not null,
			followers text not null,
			average_score integer not null,
			clips_made integer not null,
			notes text not null
		);

		create table if not exists campaigns (
			id integer primary key,
			name text not null,
			state text not null,
			rate text not null,
			niche text not null,
			earned integer not null,
			goal integer not null,
			submitted integer not null,
			allowed text not null,
			rules text not null default '',
			hook_rules text not null default '',
			banned_terms text not null default ''
		);

		create table if not exists content_items (
			id integer primary key,
			creator text not null,
			external_id text,
			platform text not null,
			kind text not null,
			title text not null,
			age text not null,
			metric text not null,
			campaign text not null,
			status text not null,
			score integer not null,
			live integer not null default 0,
			velocity text,
			source_url text,
			thumbnail_url text,
			published_at text,
			last_action text,
			last_action_by text,
			last_action_at text
		);

		create table if not exists clip_tasks (
			id integer primary key,
			creator text not null,
			platform text not null,
			source text not null,
			source_url text,
			timestamp text not null,
			hook text not null,
			score integer not null,
			status text not null,
			targets text not null,
			upload_urls text not null default '{"TikTok":"","Shorts":"","Reels":""}',
			last_action text,
			last_action_by text,
			last_action_at text
		);

		create table if not exists platform_accounts (
			id integer primary key,
			creator text not null,
			platform text not null,
			handle text not null,
			external_id text not null,
			source_url text,
			connected integer not null default 0,
			last_synced_at text,
			last_error text
		);

		create table if not exists sync_runs (
			id integer primary key,
			platform text not null,
			started_at text not null,
			finished_at text,
			status text not null,
			items_found integer not null default 0,
			message text
		);

		create table if not exists saved_searches (
			id integer primary key,
			query text not null,
			created_at text not null
		);

		create table if not exists api_credentials (
			id integer primary key,
			key text not null,
			value text not null,
			updated_at text not null
		);

		create table if not exists app_settings (
			id integer primary key,
			key text not null,
			value text not null
		);

		create table if not exists activity_events (
			id integer primary key,
			actor text not null,
			action text not null,
			entity_type text not null,
			entity_id integer,
			label text not null,
			created_at text not null
		);
	`);
	EnsureColumn('campaigns', 'rules', "text not null default ''");
	EnsureColumn('campaigns', 'hook_rules', "text not null default ''");
	EnsureColumn('campaigns', 'banned_terms', "text not null default ''");
	EnsureColumn('content_items', 'external_id', 'text');
	EnsureColumn('content_items', 'source_url', 'text');
	EnsureColumn('content_items', 'thumbnail_url', 'text');
	EnsureColumn('content_items', 'published_at', 'text');
	EnsureColumn('content_items', 'last_action', 'text');
	EnsureColumn('content_items', 'last_action_by', 'text');
	EnsureColumn('content_items', 'last_action_at', 'text');
	EnsureColumn('clip_tasks', 'source_url', 'text');
	EnsureColumn('clip_tasks', 'upload_urls', `text not null default '{"TikTok":"","Shorts":"","Reels":""}'`);
	EnsureColumn('clip_tasks', 'last_action', 'text');
	EnsureColumn('clip_tasks', 'last_action_by', 'text');
	EnsureColumn('clip_tasks', 'last_action_at', 'text');
	SeedCreatorWatchlist();
	SeedPlatformAccounts();
	SeedSavedSearches();
	SeedAppSettings();
}

function SeedDatabase() {
	const Seed = Sqlite.transaction(() => {
		Db.insert(CreatorsTable)
			.values(
				Creators.map((Creator, Index) => ({
					Id: Index + 1,
					...Creator,
					Platforms: JSON.stringify(Creator.Platforms)
				}))
			)
			.run();

		Db.insert(CampaignsTable)
			.values(
				Campaigns.map((Campaign, Index) => ({
					Id: Index + 1,
					...Campaign,
					Allowed: JSON.stringify(Campaign.Allowed)
				}))
			)
			.run();

		Db.insert(ContentItemsTable).values(ContentItems).run();

		Db.insert(ClipTasksTable)
			.values(ClipTasks.map((Task) => ({ ...Task, Targets: JSON.stringify(Task.Targets), UploadUrls: JSON.stringify(Task.UploadUrls) })))
			.run();
	});

	Seed();
}

function EnsureColumn(Table: string, Column: string, Type: string) {
	const Columns = Sqlite.prepare(`pragma table_info(${Table})`).all() as { name: string }[];
	if (!Columns.some((Info) => Info.name === Column)) {
		Sqlite.exec(`alter table ${Table} add column ${Column} ${Type}`);
	}
}

function SeedPlatformAccounts() {
	const Accounts = [
		{
			Creator: 'Kai Cenat',
			Platform: 'YouTube',
			Handle: '@KaiCenatLive',
			ExternalId: 'UCvCfpQXRXdK8G7_D9wY3v7g',
			SourceUrl: 'https://www.youtube.com/@KaiCenatLive'
		},
		{
			Creator: 'IShowSpeed',
			Platform: 'YouTube',
			Handle: '@IShowSpeed',
			ExternalId: 'UCWsDFcIhY2DBi3GB5uykGXA',
			SourceUrl: 'https://www.youtube.com/@IShowSpeed'
		},
		{
			Creator: 'Shroud',
			Platform: 'Twitch',
			Handle: 'shroud',
			ExternalId: '37402112',
			SourceUrl: 'https://www.twitch.tv/shroud'
		},
		{
			Creator: 'Hasan Abi',
			Platform: 'Twitch',
			Handle: 'hasanabi',
			ExternalId: '207813352',
			SourceUrl: 'https://www.twitch.tv/hasanabi'
		}
	];

	for (const Account of Accounts) {
		const Exists = Sqlite.prepare('select 1 from platform_accounts where platform = ? and external_id = ? limit 1').get(
			Account.Platform,
			Account.ExternalId
		);
		if (Exists) continue;
		Db.insert(PlatformAccountsTable)
			.values({
				Id: NextId('platform_accounts'),
				...Account,
				Connected: false
			})
			.run();
	}
}

function SeedCreatorWatchlist() {
	const Watchlist = [
		Watch('Kai Cenat', [
			['Instagram', 'kaicenat', 'https://www.instagram.com/kaicenat/'],
			['TikTok', 'kaicenat', 'https://www.tiktok.com/@kaicenat'],
			['YouTube', '@KaiCenat', 'https://www.youtube.com/@KaiCenat'],
			['Twitch', 'kaicenat', 'https://www.twitch.tv/kaicenat']
		]),
		Watch('IShowSpeed', [
			['Instagram', 'ishowspeed', 'https://www.instagram.com/ishowspeed/'],
			['TikTok', 'ishowspeed', 'https://www.tiktok.com/@ishowspeed'],
			['YouTube', '@IShowSpeed', 'https://www.youtube.com/@IShowSpeed'],
			['Twitch', 'ishowspeed', 'https://www.twitch.tv/ishowspeed']
		]),
		Watch('Andrew Tate', [
			['Instagram', 'cobratate', 'https://www.instagram.com/cobratate/'],
			['TikTok', 'cobratate', 'https://www.tiktok.com/@cobratate'],
			['YouTube', '@TateSpeech', 'https://www.youtube.com/@TateSpeech']
		]),
		Watch('Adin Ross', [
			['Instagram', 'adinross', 'https://www.instagram.com/adinross/'],
			['TikTok', 'adinross', 'https://www.tiktok.com/@adinross'],
			['YouTube', '@AdinRoss', 'https://www.youtube.com/@AdinRoss'],
			['Kick', 'adinross', 'https://kick.com/adinross'],
			['Twitch', 'adinross', 'https://www.twitch.tv/adinross']
		]),
		Watch('Jynxzi', [
			['Instagram', 'jynxzi', 'https://www.instagram.com/jynxzi/'],
			['TikTok', 'jynxzi', 'https://www.tiktok.com/@jynxzi'],
			['YouTube', '@Jynxzi', 'https://www.youtube.com/@Jynxzi'],
			['Twitch', 'jynxzi', 'https://www.twitch.tv/jynxzi']
		]),
		Watch('Clavicular', [
			['Instagram', 'clavicular0', 'https://www.instagram.com/clavicular0/'],
			['TikTok', 'clavicular', 'https://www.tiktok.com/@clavicular'],
			['Kick', 'clavicular', 'https://kick.com/clavicular']
		]),
		Watch('Plaqueboymax', [
			['Instagram', 'plaqueboymax', 'https://www.instagram.com/plaqueboymax/'],
			['TikTok', 'plaqueboymax', 'https://www.tiktok.com/@plaqueboymax'],
			['YouTube', '@Plaqueboymax', 'https://www.youtube.com/@Plaqueboymax'],
			['Twitch', 'plaqueboymax', 'https://www.twitch.tv/plaqueboymax']
		]),
		Watch('N3on', [
			['Instagram', 'n3on', 'https://www.instagram.com/n3on/'],
			['TikTok', 'n3on', 'https://www.tiktok.com/@n3on'],
			['YouTube', '@N3ON', 'https://www.youtube.com/@N3ON'],
			['Kick', 'n3on', 'https://kick.com/n3on']
		]),
		Watch('Joe Rogan', [
			['Instagram', 'joerogan', 'https://www.instagram.com/joerogan/'],
			['YouTube', '@joerogan', 'https://www.youtube.com/@joerogan']
		]),
		Watch('Theo Von', [
			['Instagram', 'theovon', 'https://www.instagram.com/theovon/'],
			['TikTok', 'theovon', 'https://www.tiktok.com/@theovon'],
			['YouTube', '@TheoVon', 'https://www.youtube.com/@TheoVon']
		]),
		Watch('MrBeast', [
			['Instagram', 'mrbeast', 'https://www.instagram.com/mrbeast/'],
			['TikTok', 'mrbeast', 'https://www.tiktok.com/@mrbeast'],
			['YouTube', '@MrBeast', 'https://www.youtube.com/@MrBeast']
		]),
		Watch('Asmongold', [
			['Instagram', 'asmongold', 'https://www.instagram.com/asmongold/'],
			['YouTube', '@AsmongoldTV', 'https://www.youtube.com/@AsmongoldTV'],
			['Twitch', 'zackrawrr', 'https://www.twitch.tv/zackrawrr']
		]),
		Watch('xQc', [
			['Instagram', 'xqcow1', 'https://www.instagram.com/xqcow1/'],
			['TikTok', 'xqcow1', 'https://www.tiktok.com/@xqcow1'],
			['YouTube', '@xQcOW', 'https://www.youtube.com/@xQcOW'],
			['Twitch', 'xqc', 'https://www.twitch.tv/xqc']
		]),
		Watch('Hasan Piker', [
			['Instagram', 'hasandpiker', 'https://www.instagram.com/hasandpiker/'],
			['TikTok', 'hasanabi', 'https://www.tiktok.com/@hasanabi'],
			['YouTube', '@HasanAbi', 'https://www.youtube.com/@HasanAbi'],
			['Twitch', 'hasanabi', 'https://www.twitch.tv/hasanabi']
		]),
		Watch('Ibai Llanos', [
			['Instagram', 'ibaillanos', 'https://www.instagram.com/ibaillanos/'],
			['TikTok', 'ibai', 'https://www.tiktok.com/@ibai'],
			['YouTube', '@IbaiLlanos', 'https://www.youtube.com/@IbaiLlanos'],
			['Twitch', 'ibai', 'https://www.twitch.tv/ibai']
		]),
		Watch('Westcol', [
			['Instagram', 'westcol', 'https://www.instagram.com/westcol/'],
			['TikTok', 'westcol', 'https://www.tiktok.com/@westcol'],
			['YouTube', '@WestCOL', 'https://www.youtube.com/@WestCOL'],
			['Kick', 'westcol', 'https://kick.com/westcol']
		]),
		Watch('JasonTheWeen', [
			['Instagram', 'jasontheween', 'https://www.instagram.com/jasontheween/'],
			['TikTok', 'jasontheween', 'https://www.tiktok.com/@jasontheween'],
			['YouTube', '@JasonTheWeen', 'https://www.youtube.com/@JasonTheWeen'],
			['Twitch', 'jasontheween', 'https://www.twitch.tv/jasontheween']
		]),
		Watch('Duke Dennis', [
			['Instagram', 'dukedennis', 'https://www.instagram.com/dukedennis/'],
			['TikTok', 'dukedennis', 'https://www.tiktok.com/@dukedennis'],
			['YouTube', '@DukeDennis864', 'https://www.youtube.com/@DukeDennis864'],
			['Twitch', 'dukedennis', 'https://www.twitch.tv/dukedennis']
		]),
		Watch('Caedrel', [
			['Instagram', 'caedrel', 'https://www.instagram.com/caedrel/'],
			['TikTok', 'caedrel', 'https://www.tiktok.com/@caedrel'],
			['YouTube', '@Caedrel', 'https://www.youtube.com/@Caedrel'],
			['Twitch', 'caedrel', 'https://www.twitch.tv/caedrel']
		]),
		Watch('Rubius', [
			['Instagram', 'rubius', 'https://www.instagram.com/rubius/'],
			['TikTok', 'rubius', 'https://www.tiktok.com/@rubius'],
			['YouTube', '@elrubiusOMG', 'https://www.youtube.com/@elrubiusOMG'],
			['Twitch', 'rubius', 'https://www.twitch.tv/rubius']
		])
	];

	for (const Creator of Watchlist) {
		UpsertCreator(Creator.Name, Creator.Accounts.map((Account) => Account.Platform));
		for (const Account of Creator.Accounts) UpsertAccount(Creator.Name, Account);
	}
}

function SeedSavedSearches() {
	for (const Query of ['challenge', 'reaction', 'live stream']) {
		const Exists = Sqlite.prepare('select 1 from saved_searches where lower(query) = lower(?) limit 1').get(Query);
		if (Exists) continue;
		Db.insert(SavedSearchesTable)
			.values({ Id: NextId('saved_searches'), Query, CreatedAt: new Date().toISOString() })
			.run();
	}
}

function SeedAppSettings() {
	const Settings = {
		NicheKeywords: 'gaming, slots, IRL, reaction, funny',
		RefreshSchedule: '30',
		MinimumScore: '40',
		ScoreRecencyWeight: '1',
		ScoreEngagementWeight: '1',
		ScorePlatformWeight: '1',
		ScoreCampaignWeight: '1',
		ScoreTitleWeight: '1',
		ScoreStatusWeight: '1'
	};
	for (const [Key, Value] of Object.entries(Settings)) {
		const Exists = Sqlite.prepare('select 1 from app_settings where key = ? limit 1').get(Key);
		if (Exists) continue;
		Db.insert(AppSettingsTable).values({ Id: NextId('app_settings'), Key, Value }).run();
	}
}

function Watch(Name: string, Accounts: WatchAccountInput[]) {
	return {
		Name,
		Accounts: Accounts.map(([Platform, Handle, SourceUrl]) => ({ Platform, Handle, SourceUrl }))
	};
}

function UpsertCreator(Name: string, Platforms: string[]) {
	const Existing = Sqlite.prepare('select platforms from creators where name = ? limit 1').get(Name) as { platforms: string } | undefined;
	const MergedPlatforms = JSON.stringify([...new Set([...(Existing ? JSON.parse(Existing.platforms) : []), ...Platforms])]);
	if (Existing) {
		Sqlite.prepare('update creators set platforms = ? where name = ?').run(MergedPlatforms, Name);
		return;
	}
	Db.insert(CreatorsTable)
		.values({
			Id: NextId('creators'),
			Name,
			Initial: Name[0]?.toUpperCase() ?? 'C',
			Platforms: MergedPlatforms,
			Campaign: 'Organic',
			LiveViewers: 'offline',
			Followers: '0',
			AverageScore: 50,
			ClipsMade: 0,
			Notes: 'Manual watchlist source. Add campaign notes, clip angles, and platform rules here.'
		})
		.run();
}

function UpsertAccount(Creator: string, Account: WatchAccount) {
	const Exists = Sqlite.prepare('select id, external_id as ExternalId from platform_accounts where creator = ? and platform = ? limit 1').get(
		Creator,
		Account.Platform
	) as { id: number; ExternalId: string } | undefined;
	if (Exists) {
		Sqlite.prepare('update platform_accounts set handle = ?, external_id = ?, source_url = ? where id = ?').run(
			Account.Handle,
			IsResolvedExternalId(Account.Platform, Exists.ExternalId) ? Exists.ExternalId : Account.Handle,
			Account.SourceUrl,
			Exists.id
		);
		return;
	}
	Db.insert(PlatformAccountsTable)
		.values({
			Id: NextId('platform_accounts'),
			Creator,
			Platform: Account.Platform,
			Handle: Account.Handle,
			ExternalId: Account.Handle,
			SourceUrl: Account.SourceUrl,
			Connected: false,
			LastError: SyncHint(Account.Platform)
		})
		.run();
}

function SyncHint(Platform: string) {
	if (Platform === 'YouTube') return 'Manual handle saved; add channel ID before API sync.';
	if (Platform === 'Twitch') return 'Manual handle saved; add Twitch user ID before API sync.';
	if (Platform === 'Kick') return 'Manual handle saved; add numeric broadcaster_user_id before API sync.';
	return 'Manual tracking source.';
}

function IsResolvedExternalId(Platform: string, ExternalId: string) {
	if (Platform === 'YouTube') return /^UC[\w-]{20,}$/.test(ExternalId);
	if (Platform === 'Twitch' || Platform === 'Kick') return /^\d+$/.test(ExternalId);
	return false;
}

function NextId(Table: string) {
	const Row = Sqlite.prepare(`select coalesce(max(id), 0) + 1 as Id from ${Table}`).get() as { Id: number };
	return Row.Id;
}

type WatchAccount = {
	Platform: string;
	Handle: string;
	SourceUrl: string;
};

type WatchAccountInput = [Platform: string, Handle: string, SourceUrl: string];
