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
		);

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
		);

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
		);

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
		);

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
	EnsureMediaJobColumns();
	EnsureClipCandidateColumns();
	EnsureClipExportColumns();
	EnsureClipPreviewColumns();
	SeedCreatorWatchlist();
	SeedPlatformAccounts();
	SeedSavedSearches();
	SeedAppSettings();
}

function EnsureMediaJobColumns() {
	EnsureColumn('media_jobs', 'clip_task_id', 'integer');
	EnsureColumn('media_jobs', 'source_url', "text not null default ''");
	EnsureColumn('media_jobs', 'source_platform', "text not null default 'Other'");
	EnsureColumn('media_jobs', 'video_title', "text not null default 'Untitled source'");
	EnsureColumn('media_jobs', 'thumbnail_url', 'text');
	EnsureColumn('media_jobs', 'creator', "text not null default 'Unknown'");
	EnsureColumn('media_jobs', 'duration', "text not null default 'unknown'");
	EnsureColumn('media_jobs', 'media_status', "text not null default 'unknown'");
	EnsureColumn('media_jobs', 'progress', 'integer not null default 0');
	EnsureColumn('media_jobs', 'priority', 'integer not null default 0');
	EnsureColumn('media_jobs', 'stage', "text not null default 'waiting'");
	EnsureColumn('media_jobs', 'estimated_file_size', "text not null default 'unknown'");
	EnsureColumn('media_jobs', 'error_message', 'text');
	EnsureColumn('media_jobs', 'manual_review_status', "text not null default 'Not required'");
	EnsureColumn('media_jobs', 'transcript_text', 'text');
	EnsureColumn('media_jobs', 'transcript_format', 'text');
	EnsureColumn('media_jobs', 'transcript_language', 'text');
	EnsureColumn('media_jobs', 'transcript_confidence', 'real');
	EnsureColumn('media_jobs', 'transcript_model', 'text');
	EnsureColumn('media_jobs', 'transcript_source', 'text');
	EnsureColumn('media_jobs', 'transcript_segments_json', 'text');
	EnsureColumn('media_jobs', 'transcript_words_json', 'text');
	EnsureColumn('media_jobs', 'transcript_translation_text', 'text');
	EnsureColumn('media_jobs', 'transcript_translation_language', 'text');
	EnsureColumn('media_jobs', 'transcript_translation_source', 'text');
	EnsureColumn('media_jobs', 'transcript_translation_updated_at', 'text');
	EnsureColumn('media_jobs', 'transcript_updated_at', 'text');
	EnsureColumn('media_jobs', 'output_path', 'text');
	EnsureColumn('media_jobs', 'audio_path', 'text');
	EnsureColumn('media_jobs', 'manual_context', 'text');
	EnsureColumn('media_jobs', 'source_validation_status', 'text');
	EnsureColumn('media_jobs', 'live_recording_mode', 'text');
	EnsureColumn('media_jobs', 'live_chunk_seconds', 'integer');
	EnsureColumn('media_jobs', 'live_analyze_while_recording', 'integer not null default 0');
	EnsureColumn('media_jobs', 'live_generate_periodic_clips', 'integer not null default 0');
	EnsureColumn('media_jobs', 'live_marked_moments_json', 'text');
	EnsureColumn('media_jobs', 'analysis_report_json', 'text');
	EnsureColumn('media_jobs', 'analysis_request_json', 'text');
	EnsureColumn('media_jobs', 'analysis_updated_at', 'text');
	EnsureColumn('media_jobs', 'metadata_json', 'text');
	EnsureColumn('media_jobs', 'downloaded_at', 'text');
	EnsureColumn('media_jobs', 'cancelled_at', 'text');
	EnsureColumn('media_jobs', 'claimed_by', 'text');
	EnsureColumn('media_jobs', 'claimed_at', 'text');
	EnsureColumn('media_jobs', 'claim_expires_at', 'text');
	EnsureColumn('media_jobs', 'created_at', "text not null default ''");
	EnsureColumn('media_jobs', 'updated_at', 'text');
}

function EnsureClipCandidateColumns() {
	EnsureColumn('clip_candidates', 'media_job_id', 'integer not null default 0');
	EnsureColumn('clip_candidates', 'clip_number', 'integer not null default 1');
	EnsureColumn('clip_candidates', 'title', 'text');
	EnsureColumn('clip_candidates', 'start_time', "text not null default '0:00'");
	EnsureColumn('clip_candidates', 'end_time', "text not null default '0:30'");
	EnsureColumn('clip_candidates', 'duration', "text not null default '30s'");
	EnsureColumn('clip_candidates', 'viral_score', 'integer not null default 50');
	EnsureColumn('clip_candidates', 'category', "text not null default 'reaction'");
	EnsureColumn('clip_candidates', 'explanation', "text not null default ''");
	EnsureColumn('clip_candidates', 'hook_score', 'integer not null default 50');
	EnsureColumn('clip_candidates', 'context_score', 'integer not null default 50');
	EnsureColumn('clip_candidates', 'emotion_score', 'integer not null default 50');
	EnsureColumn('clip_candidates', 'humor_score', 'integer not null default 50');
	EnsureColumn('clip_candidates', 'controversy_score', 'integer not null default 50');
	EnsureColumn('clip_candidates', 'payoff_score', 'integer not null default 50');
	EnsureColumn('clip_candidates', 'retention_score', 'integer not null default 50');
	EnsureColumn('clip_candidates', 'shareability_score', 'integer not null default 50');
	EnsureColumn('clip_candidates', 'originality_score', 'integer not null default 50');
	EnsureColumn('clip_candidates', 'status', "text not null default 'Suggested'");
	EnsureColumn('clip_candidates', 'variant', "text not null default 'strongest hook'");
	EnsureColumn('clip_candidates', 'cut_segments_json', 'text');
	EnsureColumn('clip_candidates', 'caption_text', 'text');
	EnsureColumn('clip_candidates', 'caption_json', 'text');
	EnsureColumn('clip_candidates', 'caption_status', 'text');
	EnsureColumn('clip_candidates', 'review_notes', 'text');
	EnsureColumn('clip_candidates', 'created_at', "text not null default ''");
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

function EnsureClipExportColumns() {
	EnsureColumn('clip_exports', 'media_job_id', 'integer not null default 0');
	EnsureColumn('clip_exports', 'clip_candidate_id', 'integer');
	EnsureColumn('clip_exports', 'preset', "text not null default 'original aspect ratio'");
	EnsureColumn('clip_exports', 'status', "text not null default 'waiting'");
	EnsureColumn('clip_exports', 'progress', 'integer not null default 0');
	EnsureColumn('clip_exports', 'output_path', 'text');
	EnsureColumn('clip_exports', 'file_size', 'text');
	EnsureColumn('clip_exports', 'error_message', 'text');
	EnsureColumn('clip_exports', 'claimed_by', 'text');
	EnsureColumn('clip_exports', 'claimed_at', 'text');
	EnsureColumn('clip_exports', 'claim_expires_at', 'text');
	EnsureColumn('clip_exports', 'created_at', "text not null default ''");
	EnsureColumn('clip_exports', 'updated_at', 'text');
	EnsureColumn('clip_exports', 'completed_at', 'text');
}

function EnsureClipPreviewColumns() {
	EnsureColumn('clip_previews', 'media_job_id', 'integer not null default 0');
	EnsureColumn('clip_previews', 'clip_candidate_id', 'integer not null default 0');
	EnsureColumn('clip_previews', 'status', "text not null default 'waiting'");
	EnsureColumn('clip_previews', 'progress', 'integer not null default 0');
	EnsureColumn('clip_previews', 'preview_path', 'text');
	EnsureColumn('clip_previews', 'thumbnail_path', 'text');
	EnsureColumn('clip_previews', 'file_size', 'text');
	EnsureColumn('clip_previews', 'error_message', 'text');
	EnsureColumn('clip_previews', 'claimed_by', 'text');
	EnsureColumn('clip_previews', 'claimed_at', 'text');
	EnsureColumn('clip_previews', 'claim_expires_at', 'text');
	EnsureColumn('clip_previews', 'created_at', "text not null default ''");
	EnsureColumn('clip_previews', 'updated_at', 'text');
	EnsureColumn('clip_previews', 'completed_at', 'text');
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
	for (const Query of ['Whop', 'challenge', 'reaction']) {
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
