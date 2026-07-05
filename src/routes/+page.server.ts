import { All, EnsureAppDatabaseReady, Get, IsPostgresRuntime, NextId, Run } from '$lib/server/db/app-db';
import { ImportTables, ScoreWeightKeys } from '$lib/server/db/metadata';
import { CalculateOpportunityScore } from '$lib/opportunity-score';
import { GetOpportunityWeights } from '$lib/server/opportunity-settings';
import { ActorFromForm, MarkClipTaskAction, MarkContentAction, WriteActivity } from '$lib/server/activity';
import { ApiCredentialFields, GetApiCredentialStatuses } from '$lib/server/api-credentials';
import { fail, type Actions } from '@sveltejs/kit';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type {
	Campaign,
	ActivityEvent,
	ApiCredentialStatus,
	AppSettings,
	ClipCandidate,
	ClipExport,
	ClipPreview,
	ClipTask,
	ContentItem,
	Creator,
	MediaJob,
	Platform,
	PlatformAccount,
	SavedSearch,
	SyncRun,
	WorkerHeartbeat
} from '$lib/vantage-data';

export async function load() {
	await EnsureAppDatabaseReady();

	const Creators = (await All<CreatorRow>(
		`select id as "Id", name as "Name", initial as "Initial", platforms as "Platforms", campaign as "Campaign",
		 live_viewers as "LiveViewers", followers as "Followers", average_score as "AverageScore",
		 clips_made as "ClipsMade", notes as "Notes" from creators`
	))
		.map((Creator): Creator => ({ ...Creator, Platforms: JSON.parse(Creator.Platforms) as Platform[] }));

	const Campaigns = (await All<CampaignRow>(
		`select id as "Id", name as "Name", state as "State", rate as "Rate", niche as "Niche", earned as "Earned",
		 goal as "Goal", submitted as "Submitted", allowed as "Allowed", rules as "Rules",
		 hook_rules as "HookRules", banned_terms as "BannedTerms" from campaigns`
	))
		.map((Campaign): Campaign => ({ ...Campaign, Allowed: JSON.parse(Campaign.Allowed) as string[] }));

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
				Velocity: Item.Velocity ?? undefined
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
	const MediaJobs = (await All<MediaJobRow>(
		`select id as "Id", clip_task_id as "ClipTaskId", source_url as "SourceUrl", source_platform as "SourcePlatform",
		 video_title as "VideoTitle", thumbnail_url as "ThumbnailUrl", creator as "Creator", duration as "Duration",
		 media_status as "MediaStatus", progress as "Progress", priority as "Priority", stage as "Stage", estimated_file_size as "EstimatedFileSize",
		 error_message as "ErrorMessage", manual_review_status as "ManualReviewStatus", transcript_text as "TranscriptText",
		 transcript_format as "TranscriptFormat", transcript_language as "TranscriptLanguage",
		 transcript_confidence as "TranscriptConfidence", transcript_model as "TranscriptModel", transcript_source as "TranscriptSource",
		 transcript_segments_json as "TranscriptSegmentsJson", transcript_words_json as "TranscriptWordsJson",
		 transcript_translation_text as "TranscriptTranslationText", transcript_translation_language as "TranscriptTranslationLanguage",
		 transcript_translation_source as "TranscriptTranslationSource", transcript_translation_updated_at as "TranscriptTranslationUpdatedAt",
		 transcript_updated_at as "TranscriptUpdatedAt", output_path as "OutputPath", audio_path as "AudioPath",
		 manual_context as "ManualContext", source_validation_status as "SourceValidationStatus",
		 live_recording_mode as "LiveRecordingMode", live_chunk_seconds as "LiveChunkSeconds",
		 live_analyze_while_recording as "LiveAnalyzeWhileRecording", live_generate_periodic_clips as "LiveGeneratePeriodicClips",
		 live_marked_moments_json as "LiveMarkedMomentsJson", analysis_report_json as "AnalysisReportJson",
		 analysis_request_json as "AnalysisRequestJson",
		 analysis_updated_at as "AnalysisUpdatedAt", metadata_json as "MetadataJson",
		 downloaded_at as "DownloadedAt", cancelled_at as "CancelledAt", created_at as "CreatedAt", updated_at as "UpdatedAt"
		 from media_jobs order by id desc`
	)).map((Job): MediaJob => ({
		...Job,
		Stage: Job.Stage as MediaJob['Stage'],
		ManualReviewStatus: Job.ManualReviewStatus as MediaJob['ManualReviewStatus'],
		LiveAnalyzeWhileRecording: Boolean(Job.LiveAnalyzeWhileRecording),
		LiveGeneratePeriodicClips: Boolean(Job.LiveGeneratePeriodicClips)
	}));
	const ClipCandidates = await All<ClipCandidate>(
		`select id as "Id", media_job_id as "MediaJobId", clip_number as "ClipNumber", title as "Title", start_time as "StartTime",
		 end_time as "EndTime", duration as "Duration", viral_score as "ViralScore", category as "Category",
		 explanation as "Explanation", hook_score as "HookScore", context_score as "ContextScore",
		 emotion_score as "EmotionScore", humor_score as "HumorScore", controversy_score as "ControversyScore",
		 payoff_score as "PayoffScore", retention_score as "RetentionScore", shareability_score as "ShareabilityScore",
		 originality_score as "OriginalityScore", status as "Status", variant as "Variant", cut_segments_json as "CutSegmentsJson",
		 caption_text as "CaptionText", caption_json as "CaptionJson", caption_status as "CaptionStatus", review_notes as "ReviewNotes",
		 created_at as "CreatedAt"
		 from clip_candidates order by media_job_id, clip_number`
	);
	const ClipExports = await All<ClipExport>(
		`select id as "Id", media_job_id as "MediaJobId", clip_candidate_id as "ClipCandidateId", preset as "Preset",
		 status as "Status", progress as "Progress", output_path as "OutputPath", file_size as "FileSize",
		 error_message as "ErrorMessage", created_at as "CreatedAt", updated_at as "UpdatedAt",
		 completed_at as "CompletedAt" from clip_exports order by id desc`
	);
	const ClipPreviews = await All<ClipPreview>(
		`select id as "Id", media_job_id as "MediaJobId", clip_candidate_id as "ClipCandidateId",
		 status as "Status", progress as "Progress", preview_path as "PreviewPath", thumbnail_path as "ThumbnailPath",
		 file_size as "FileSize", error_message as "ErrorMessage", created_at as "CreatedAt",
		 updated_at as "UpdatedAt", completed_at as "CompletedAt" from clip_previews order by id desc`
	);
	const ApiCredentials = (await GetApiCredentialStatuses()) as ApiCredentialStatus[];
	const AppSettings = await LoadAppSettings();
	const WorkerHeartbeats = await All<WorkerHeartbeat>(
		`select id as "Id", instance_id as "InstanceId", role as "Role", workers as "Workers", status as "Status",
		 pid as "Pid", host as "Host", started_at as "StartedAt", last_seen_at as "LastSeenAt", message as "Message"
		 from worker_heartbeats order by last_seen_at desc limit 12`
	);

	return { ActivityEvents, ApiCredentials, AppSettings, Campaigns, ClipCandidates, ClipExports, ClipPreviews, ClipTasks, ContentItems, Creators, DatabaseMode: IsPostgresRuntime ? 'Postgres' : 'SQLite', MediaJobs, PlatformAccounts, SavedSearches, SyncRuns, WorkerHeartbeats };
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
		const Status = OptionalText(Form, 'Status', 'To clip');
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
		const Exists = await Get(
			"select 1 from clip_tasks where creator = ? and source = ? and coalesce(source_url, '') = coalesce(?, '') limit 1",
			[Item.creator, Item.title, Item.source_url ?? '']
		);
		if (Exists) return { Created: 'ClipTask' };

		const Id = await NextId('clip_tasks');
		await Run(
			`insert into clip_tasks
			 (id, creator, platform, source, source_url, timestamp, hook, score, status, targets, upload_urls)
			 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				Id,
				Item.creator,
				Item.platform,
				Item.title,
				Item.source_url,
				'0:00',
				SuggestedHook(Item.title),
				Item.score,
				'To clip',
				JSON.stringify({ TikTok: true, Shorts: true, Reels: true }),
				EmptyUploadUrls()
			]
		);

		await Run("update content_items set status = 'Watched' where id = ? and status = 'New'", [ContentId]);
		await MarkClipTaskAction(Id, Actor, 'Queued');
		await MarkContentAction(ContentId, Actor, 'Queued');
		return { Created: 'ClipTask' };
	},

	AddExternalMediaJob: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const SourceUrl = RequiredText(Form, 'SourceUrl');
		if (!SourceUrl) return fail(400, { Message: 'Source URL is required' });
		const Metadata = await BuildMediaJobMetadata({
			SourceUrl,
			Title: OptionalText(Form, 'VideoTitle', ''),
			Creator: OptionalText(Form, 'Creator', ''),
			ClipTaskId: 0
		});
		const Id = await CreateMediaJob({
			...Metadata,
			ClipTaskId: null,
			ManualReviewStatus: 'Needs source review',
			Stage: 'fetching source',
			ErrorMessage: 'External source validation is queued before manual approval.'
		});
		await Run('update media_jobs set source_validation_status = ?, updated_at = ? where id = ?', [
			'queued for validation',
			new Date().toISOString(),
			Id
		]);
		await WriteActivity(Actor, { EntityType: 'MediaJob', EntityId: Id, Action: 'Added external download', Label: `Added external download - ${Actor}` });
		return { Created: 'MediaJob' };
	},

	AddManualMediaJob: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Title = RequiredText(Form, 'VideoTitle') || 'Manual source';
		const Creator = RequiredText(Form, 'Creator') || 'Manual creator';
		const SourceUrl = RequiredText(Form, 'SourceUrl') || `manual://${Date.now()}`;
		const VideoPath = OptionalText(Form, 'VideoPath', '');
		const AudioPath = OptionalText(Form, 'AudioPath', '');
		const SavedVideoPath = await SaveUploadFile(Form.get('VideoFile'), 'video');
		const SavedAudioPath = await SaveUploadFile(Form.get('AudioFile'), 'audio');
		const TranscriptText = RequiredText(Form, 'TranscriptText');
		const TranscriptSegments = TranscriptText ? TranscriptSegmentsFromText(TranscriptText) : null;
		const Now = new Date().toISOString();
		const Id = await CreateMediaJob({
			SourceUrl,
			SourcePlatform: OptionalText(Form, 'Platform', 'Manual'),
			VideoTitle: Title,
			ThumbnailUrl: null,
			Creator,
			Duration: OptionalText(Form, 'Duration', 'unknown'),
			MediaStatus: 'manual source package',
			EstimatedFileSize: 'manual',
			ManualReviewStatus: 'Approved',
			Stage: TranscriptText ? 'ready for review' : 'retrieving transcript',
			ErrorMessage: TranscriptText ? null : 'Manual source saved. Add a transcript or run the transcript worker before clip analysis.'
		});
		await Run(
			`update media_jobs
			 set output_path = ?, audio_path = ?, manual_context = ?, source_validation_status = ?,
			 transcript_text = ?, transcript_format = ?, transcript_language = ?, transcript_confidence = ?, transcript_model = ?,
			 transcript_source = ?, transcript_segments_json = ?, transcript_updated_at = ?, progress = ?, updated_at = ?
			 where id = ?`,
			[
				SavedVideoPath || VideoPath || null,
				SavedAudioPath || AudioPath || null,
				OptionalText(Form, 'ManualContext', ''),
				'manual source provided by user',
				TranscriptText || null,
				TranscriptText ? 'manual' : null,
				TranscriptText ? OptionalText(Form, 'TranscriptLanguage', 'unknown') : null,
				TranscriptText ? 0.75 : null,
				TranscriptText ? 'manual' : null,
				TranscriptText ? 'manual upload' : null,
				TranscriptSegments ? JSON.stringify(TranscriptSegments) : null,
				TranscriptText ? Now : null,
				TranscriptText ? 70 : 35,
				Now,
				Id
			]
		);
		await WriteActivity(Actor, { EntityType: 'MediaJob', EntityId: Id, Action: 'Added manual source', Label: `Added manual source - ${Actor}` });
		return { Created: 'MediaJob' };
	},

	PrepareClipDownload: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const ClipTaskId = NumberField(Form, 'ClipTaskId', 0);
		const Task = await Get<ClipTaskDbRow>('select * from clip_tasks where id = ?', [ClipTaskId]);
		if (!Task) return fail(404, { Message: 'Clip task was not found' });
		if (!Task.source_url) return fail(400, { Message: 'Queued item has no source URL' });
		const Metadata = await BuildMediaJobMetadata({
			SourceUrl: Task.source_url,
			Title: Task.source,
			Creator: Task.creator,
			ClipTaskId: Task.id,
			Platform: Task.platform
		});
		const NeedsReview = RequiresManualSourceReview(Metadata.SourcePlatform, Task.source_url);
		const Id = await CreateMediaJob({
			...Metadata,
			ClipTaskId: Task.id,
			ManualReviewStatus: NeedsReview ? 'Needs source review' : 'Not required',
			Stage: NeedsReview ? 'fetching source' : 'waiting',
			ErrorMessage: NeedsReview ? 'Source validation is queued before manual approval.' : null
		});
		if (NeedsReview) {
			await Run('update media_jobs set source_validation_status = ?, updated_at = ? where id = ?', [
				'queued for validation',
				new Date().toISOString(),
				Id
			]);
		}
		await MarkClipTaskAction(Task.id, Actor, 'Download queued');
		await WriteActivity(Actor, { EntityType: 'MediaJob', EntityId: Id, Action: 'Queued download', Label: `Queued download - ${Actor}` });
		return { Created: 'MediaJob' };
	},

	RetryMediaJob: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Id = NumberField(Form, 'Id', 0);
		if (!Id) return fail(400, { Message: 'Media job id is required' });
		await Run(
			`update media_jobs
			 set stage = ?, progress = ?, error_message = null, cancelled_at = null, updated_at = ?
			 where id = ?`,
			['waiting', 0, new Date().toISOString(), Id]
		);
		await WriteActivity(Actor, { EntityType: 'MediaJob', EntityId: Id, Action: 'Retried media job', Label: `Retried media job - ${Actor}` });
		return { Updated: 'MediaJob' };
	},

	CancelMediaJob: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Id = NumberField(Form, 'Id', 0);
		if (!Id) return fail(400, { Message: 'Media job id is required' });
		await Run(
			`update media_jobs
			 set stage = ?, error_message = ?, cancelled_at = ?, updated_at = ?
			 where id = ?`,
			['failed', 'Cancelled by user', new Date().toISOString(), new Date().toISOString(), Id]
		);
		await WriteActivity(Actor, { EntityType: 'MediaJob', EntityId: Id, Action: 'Cancelled media job', Label: `Cancelled media job - ${Actor}` });
		return { Updated: 'MediaJob' };
	},

	PauseMediaJob: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Id = NumberField(Form, 'Id', 0);
		if (!Id) return fail(400, { Message: 'Media job id is required' });
		await Run(
			`update media_jobs
			 set stage = ?, error_message = ?, updated_at = ?
			 where id = ? and stage not in ('completed', 'failed')`,
			['paused', 'Paused by user', new Date().toISOString(), Id]
		);
		await WriteActivity(Actor, { EntityType: 'MediaJob', EntityId: Id, Action: 'Paused media job', Label: `Paused media job - ${Actor}` });
		return { Updated: 'MediaJob' };
	},

	ResumeMediaJob: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Id = NumberField(Form, 'Id', 0);
		if (!Id) return fail(400, { Message: 'Media job id is required' });
		await Run(
			`update media_jobs
			 set stage = ?, error_message = null, cancelled_at = null, updated_at = ?
			 where id = ? and stage not in ('completed')`,
			['waiting', new Date().toISOString(), Id]
		);
		await WriteActivity(Actor, { EntityType: 'MediaJob', EntityId: Id, Action: 'Resumed media job', Label: `Resumed media job - ${Actor}` });
		return { Updated: 'MediaJob' };
	},

	RetryTranscript: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Id = NumberField(Form, 'Id', 0);
		const Model = OptionalText(Form, 'TranscriptModel', 'auto');
		if (!Id) return fail(400, { Message: 'Media job id is required' });
		await Run(
			`update media_jobs
			 set stage = ?, progress = ?, error_message = null, transcript_text = null, transcript_format = null,
			 transcript_language = null, transcript_confidence = null, transcript_model = ?, transcript_source = null,
			 transcript_segments_json = null, transcript_words_json = null, transcript_updated_at = null,
			 updated_at = ?
			 where id = ?`,
			['retrieving transcript', 55, Model, new Date().toISOString(), Id]
		);
		await WriteActivity(Actor, { EntityType: 'Transcript', EntityId: Id, Action: 'Retried transcript', Label: `Retried transcript - ${Actor}` });
		return { Updated: 'Transcript' };
	},

	ApproveMediaJobSource: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Id = NumberField(Form, 'Id', 0);
		if (!Id) return fail(400, { Message: 'Media job id is required' });
		await Run(
			`update media_jobs
			 set manual_review_status = ?, stage = ?, error_message = null, updated_at = ?
			 where id = ?`,
			['Approved', 'waiting', new Date().toISOString(), Id]
		);
		await WriteActivity(Actor, { EntityType: 'MediaJob', EntityId: Id, Action: 'Approved source', Label: `Approved source - ${Actor}` });
		return { Updated: 'MediaJob' };
	},

	ValidateMediaJobSource: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Id = NumberField(Form, 'Id', 0);
		if (!Id) return fail(400, { Message: 'Media job id is required' });
		await Run(
			`update media_jobs
			 set stage = ?, progress = ?, source_validation_status = ?, error_message = null, cancelled_at = null, updated_at = ?
			 where id = ? and stage not in ('completed')`,
			['fetching source', 8, 'queued for validation', new Date().toISOString(), Id]
		);
		await WriteActivity(Actor, { EntityType: 'MediaJob', EntityId: Id, Action: 'Queued source validation', Label: `Queued validation - ${Actor}` });
		return { Updated: 'MediaJob' };
	},

	UpdateMediaJobPriority: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Id = NumberField(Form, 'Id', 0);
		const Delta = Math.max(-5, Math.min(5, NumberField(Form, 'Delta', 0)));
		if (!Id) return fail(400, { Message: 'Media job id is required' });
		if (!Delta) return fail(400, { Message: 'Priority change is required' });
		const Job = await Get<{ Priority?: number | null; Stage?: string | null }>(
			'select priority as "Priority", stage as "Stage" from media_jobs where id = ?',
			[Id]
		);
		if (!Job) return fail(404, { Message: 'Media job was not found' });
		if (Job.Stage === 'completed' || Job.Stage === 'failed') return fail(400, { Message: 'Finished jobs cannot be reprioritized' });
		const Priority = Math.max(-10, Math.min(10, Number(Job.Priority ?? 0) + Delta));
		await Run(
			`update media_jobs
			 set priority = ?, updated_at = ?
			 where id = ?`,
			[Priority, new Date().toISOString(), Id]
		);
		await WriteActivity(Actor, { EntityType: 'MediaJob', EntityId: Id, Action: 'Updated media job priority', Label: `Priority ${Delta > 0 ? '+' : ''}${Delta} - ${Actor}` });
		return { Updated: 'MediaJob' };
	},

	ConfigureLivestreamJob: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Id = NumberField(Form, 'Id', 0);
		if (!Id) return fail(400, { Message: 'Media job id is required' });
		const Mode = OptionalText(Form, 'LiveRecordingMode', 'begin from current moment');
		const ChunkSeconds = Math.max(30, Math.min(7200, NumberField(Form, 'LiveChunkSeconds', 300)));
		const Analyze = Form.get('LiveAnalyzeWhileRecording') === 'on';
		const Periodic = Form.get('LiveGeneratePeriodicClips') === 'on';
		const RestrictionNote = 'Live source availability may fail because of platform restrictions, authentication, DRM, expired playback URLs, or unsupported stream formats.';
		await Run(
			`update media_jobs
			 set live_recording_mode = ?, live_chunk_seconds = ?, live_analyze_while_recording = ?,
			 live_generate_periodic_clips = ?, source_validation_status = ?, media_status = ?,
			 stage = ?, updated_at = ?
			 where id = ?`,
			[
				Mode,
				ChunkSeconds,
				Analyze,
				Periodic,
				RestrictionNote,
				`livestream / ${Mode}`,
				'waiting',
				new Date().toISOString(),
				Id
			]
		);
		await WriteActivity(Actor, { EntityType: 'MediaJob', EntityId: Id, Action: 'Configured livestream', Label: `Configured livestream - ${Actor}` });
		return { Updated: 'MediaJob' };
	},

	MarkLivestreamMoment: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Id = NumberField(Form, 'Id', 0);
		if (!Id) return fail(400, { Message: 'Media job id is required' });
		const Job = await Get<{ live_marked_moments_json?: string | null }>('select live_marked_moments_json from media_jobs where id = ?', [Id]);
		const Moments = ParseLiveMoments(Job?.live_marked_moments_json);
		Moments.push({
			At: new Date().toISOString(),
			Timestamp: OptionalText(Form, 'MomentTimestamp', 'live'),
			Label: OptionalText(Form, 'MomentLabel', 'Marked moment'),
			Actor
		});
		await Run('update media_jobs set live_marked_moments_json = ?, updated_at = ? where id = ?', [
			JSON.stringify(Moments),
			new Date().toISOString(),
			Id
		]);
		await WriteActivity(Actor, { EntityType: 'MediaJob', EntityId: Id, Action: 'Marked livestream moment', Label: `Marked moment - ${Actor}` });
		return { Updated: 'MediaJob' };
	},

	SaveTranscript: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Id = NumberField(Form, 'MediaJobId', 0);
		const TranscriptText = RequiredText(Form, 'TranscriptText');
		if (!Id || !TranscriptText) return fail(400, { Message: 'Media job and transcript text are required' });
		const Segments = TranscriptSegmentsFromText(TranscriptText);
		await Run(
			`update media_jobs
			 set transcript_text = ?, transcript_format = ?, transcript_language = ?, transcript_confidence = ?, transcript_model = ?,
			 transcript_source = ?, transcript_segments_json = ?, transcript_updated_at = ?, stage = ?, progress = ?, updated_at = ?
			 where id = ?`,
			[
				TranscriptText,
				OptionalText(Form, 'TranscriptFormat', 'manual'),
				OptionalText(Form, 'TranscriptLanguage', 'unknown'),
				0.75,
				OptionalText(Form, 'TranscriptModel', 'manual'),
				'manual',
				JSON.stringify(Segments),
				new Date().toISOString(),
				'ready for review',
				65,
				new Date().toISOString(),
				Id
			]
		);
		await WriteActivity(Actor, { EntityType: 'Transcript', EntityId: Id, Action: 'Saved transcript', Label: `Saved transcript - ${Actor}` });
		return { Updated: 'Transcript' };
	},

	SaveTranscriptTranslation: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Id = NumberField(Form, 'MediaJobId', 0);
		const TranslationText = RequiredText(Form, 'TranslationText');
		if (!Id) return fail(400, { Message: 'Media job id is required' });
		if (!TranslationText) return fail(400, { Message: 'Translation text is required' });
		await Run(
			`update media_jobs
			 set transcript_translation_text = ?, transcript_translation_language = ?, transcript_translation_source = ?,
			 transcript_translation_updated_at = ?, updated_at = ?
			 where id = ?`,
			[
				TranslationText,
				OptionalText(Form, 'TranslationLanguage', 'en'),
				OptionalText(Form, 'TranslationSource', 'manual'),
				new Date().toISOString(),
				new Date().toISOString(),
				Id
			]
		);
		await WriteActivity(Actor, { EntityType: 'Transcript', EntityId: Id, Action: 'Saved transcript translation', Label: `Saved translation - ${Actor}` });
		return { Updated: 'TranscriptTranslation' };
	},

	QueueTranscriptTranslation: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Id = NumberField(Form, 'MediaJobId', 0);
		if (!Id) return fail(400, { Message: 'Media job id is required' });
		const Job = await Get<{ transcript_text?: string | null }>('select transcript_text from media_jobs where id = ?', [Id]);
		if (!Job?.transcript_text) return fail(400, { Message: 'Add or generate a transcript before translation' });
		await Run(
			`update media_jobs
			 set transcript_translation_language = ?, transcript_translation_source = ?, error_message = null, updated_at = ?
			 where id = ?`,
			[OptionalText(Form, 'TranslationLanguage', 'en'), 'queued', new Date().toISOString(), Id]
		);
		await WriteActivity(Actor, { EntityType: 'Transcript', EntityId: Id, Action: 'Queued transcript translation', Label: `Queued translation - ${Actor}` });
		return { Updated: 'TranscriptTranslation' };
	},

	GenerateClipCandidates: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const MediaJobId = NumberField(Form, 'MediaJobId', 0);
		const Job = await Get<MediaJobDbRow>('select * from media_jobs where id = ?', [MediaJobId]);
		if (!Job) return fail(404, { Message: 'Media job was not found' });
		if (!Job.transcript_text) return fail(400, { Message: 'Add or generate a transcript before clip analysis' });

		const DesiredCount = ClipCount(Form);
		const AnalysisRequest = {
			DesiredCount,
			ClipCountMode: OptionalText(Form, 'ClipCountMode', 'best 5 clips'),
			CustomClipCount: NumberField(Form, 'CustomClipCount', DesiredCount),
			MinimumDuration: OptionalText(Form, 'MinimumDuration', '20s'),
			MaximumDuration: OptionalText(Form, 'MaximumDuration', '75s'),
			TargetPlatform: OptionalText(Form, 'TargetPlatform', 'TikTok'),
			PreferredTopics: OptionalText(Form, 'PreferredTopics', ''),
			MomentsToAvoid: OptionalText(Form, 'MomentsToAvoid', ''),
			PreferredClipStyle: OptionalText(Form, 'PreferredClipStyle', 'viral clipping'),
			AllowOverlap: Form.get('AllowOverlap') === 'on',
			IncludeContext: Form.get('IncludeContext') === 'on',
			LoopEnding: Form.get('LoopEnding') === 'on',
			ProfanityAllowed: Form.get('ProfanityAllowed') === 'on',
			PrioritizeControversy: Form.get('PrioritizeControversy') === 'on',
			RequestedBy: Actor,
			RequestedAt: new Date().toISOString()
		};
		await Run(
			`update media_jobs
			 set stage = ?, progress = ?, analysis_request_json = ?, analysis_report_json = null,
			 analysis_updated_at = null, error_message = null, updated_at = ?
			 where id = ?`,
			['analyzing topics', 72, JSON.stringify(AnalysisRequest), new Date().toISOString(), MediaJobId]
		);
		await WriteActivity(Actor, { EntityType: 'ClipCandidate', EntityId: MediaJobId, Action: 'Queued clip analysis', Label: `Queued analysis - ${Actor}` });
		return { Updated: 'ClipAnalysis' };
	},

	UpdateClipCandidateStatus: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Id = NumberField(Form, 'Id', 0);
		const Status = OptionalText(Form, 'Status', 'Approved');
		if (!Id || !['Approved', 'Rejected', 'Suggested'].includes(Status)) return fail(400, { Message: 'Invalid clip candidate status' });
		await Run('update clip_candidates set status = ? where id = ?', [Status, Id]);
		await WriteActivity(Actor, { EntityType: 'ClipCandidate', EntityId: Id, Action: Status, Label: `${Status} clip - ${Actor}` });
		return { Updated: 'ClipCandidate' };
	},

	UpdateClipCandidate: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Id = NumberField(Form, 'Id', 0);
		if (!Id) return fail(400, { Message: 'Clip candidate id is required' });
		const StartTime = OptionalText(Form, 'StartTime', '0:00');
		const EndTime = OptionalText(Form, 'EndTime', '0:30');
		const Duration = DurationLabel(StartTime, EndTime);
		await Run(
			`update clip_candidates
			 set title = ?, start_time = ?, end_time = ?, duration = ?, category = ?, variant = ?, explanation = ?, review_notes = ?, status = ?
			 where id = ?`,
			[
				OptionalText(Form, 'Title', 'Untitled clip'),
				StartTime,
				EndTime,
				Duration,
				OptionalText(Form, 'Category', 'conversation'),
				OptionalText(Form, 'Variant', 'manual edit'),
				OptionalText(Form, 'Explanation', ''),
				OptionalText(Form, 'ReviewNotes', ''),
				OptionalText(Form, 'Status', 'Suggested'),
				Id
			]
		);
		await WriteActivity(Actor, { EntityType: 'ClipCandidate', EntityId: Id, Action: 'Edited clip candidate', Label: `Edited clip - ${Actor}` });
		return { Updated: 'ClipCandidate' };
	},

	AddClipCandidateCut: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Id = NumberField(Form, 'Id', 0);
		const CutStart = OptionalText(Form, 'CutStart', '');
		const CutEnd = OptionalText(Form, 'CutEnd', '');
		const Label = OptionalText(Form, 'CutLabel', 'Removed section');
		if (!Id || !CutStart || !CutEnd) return fail(400, { Message: 'Clip candidate, cut start, and cut end are required' });
		const Candidate = await Get<ClipCandidateFullRow>('select * from clip_candidates where id = ?', [Id]);
		if (!Candidate) return fail(404, { Message: 'Clip candidate was not found' });
		const Cut = NormalizedCut(Candidate, CutStart, CutEnd, Label);
		if (!Cut) return fail(400, { Message: 'Cut must sit inside the clip and have a real duration' });
		const Cuts = [...ParseCuts(Candidate.cut_segments_json), Cut].sort((A, B) => TimestampSeconds(A.StartTime) - TimestampSeconds(B.StartTime));
		await Run('update clip_candidates set cut_segments_json = ?, variant = ? where id = ?', [JSON.stringify(Cuts), 'manual internal cuts', Id]);
		await WriteActivity(Actor, { EntityType: 'ClipCandidate', EntityId: Id, Action: 'Added internal cut', Label: `Added cut - ${Actor}` });
		return { Updated: 'ClipCandidate' };
	},

	ClearClipCandidateCuts: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Id = NumberField(Form, 'Id', 0);
		if (!Id) return fail(400, { Message: 'Clip candidate id is required' });
		await Run('update clip_candidates set cut_segments_json = null where id = ?', [Id]);
		await WriteActivity(Actor, { EntityType: 'ClipCandidate', EntityId: Id, Action: 'Cleared internal cuts', Label: `Cleared cuts - ${Actor}` });
		return { Updated: 'ClipCandidate' };
	},

	QueueClipCaption: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Id = NumberField(Form, 'Id', 0);
		if (!Id) return fail(400, { Message: 'Clip candidate id is required' });
		const Candidate = await Get<ClipCandidateDbRow>('select id, media_job_id from clip_candidates where id = ?', [Id]);
		if (!Candidate) return fail(404, { Message: 'Clip candidate was not found' });
		const Request = {
			Style: OptionalText(Form, 'CaptionStyle', 'short-form punchy'),
			Platform: OptionalText(Form, 'CaptionPlatform', 'TikTok'),
			RequestedBy: Actor,
			RequestedAt: new Date().toISOString()
		};
		await Run('update clip_candidates set caption_status = ?, caption_json = ?, caption_text = null where id = ?', ['queued', JSON.stringify(Request), Id]);
		await WriteActivity(Actor, { EntityType: 'ClipCandidate', EntityId: Id, Action: 'Queued clip caption', Label: `Queued caption - ${Actor}` });
		return { Updated: 'ClipCandidate' };
	},

	SaveClipCaption: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Id = NumberField(Form, 'Id', 0);
		const CaptionText = RequiredText(Form, 'CaptionText');
		if (!Id || !CaptionText) return fail(400, { Message: 'Clip candidate and caption text are required' });
		await Run('update clip_candidates set caption_text = ?, caption_status = ?, caption_json = ? where id = ?', [
			CaptionText,
			'manual',
			JSON.stringify({ Source: 'manual', SavedBy: Actor, SavedAt: new Date().toISOString() }),
			Id
		]);
		await WriteActivity(Actor, { EntityType: 'ClipCandidate', EntityId: Id, Action: 'Saved clip caption', Label: `Saved caption - ${Actor}` });
		return { Updated: 'ClipCandidate' };
	},

	AdjustClipCandidateWindow: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Id = NumberField(Form, 'Id', 0);
		const Operation = OptionalText(Form, 'Operation', '');
		const Step = Math.max(1, Math.min(30, NumberField(Form, 'Step', 1)));
		if (!Id) return fail(400, { Message: 'Clip candidate id is required' });
		if (!['move-earlier', 'move-later', 'start-earlier', 'start-later', 'end-earlier', 'end-later'].includes(Operation)) {
			return fail(400, { Message: 'Invalid timeline adjustment' });
		}
		const Candidate = await Get<ClipCandidateFullRow>('select * from clip_candidates where id = ?', [Id]);
		if (!Candidate) return fail(404, { Message: 'Clip candidate was not found' });
		const Window = AdjustWindow(Candidate.start_time, Candidate.end_time, Operation, Step);
		await Run(
			`update clip_candidates
			 set start_time = ?, end_time = ?, duration = ?, variant = ?, status = ?
			 where id = ?`,
			[Window.Start, Window.End, DurationLabel(Window.Start, Window.End), 'manual timeline edit', 'Suggested', Id]
		);
		await WriteActivity(Actor, { EntityType: 'ClipCandidate', EntityId: Id, Action: 'Adjusted clip window', Label: `Adjusted clip - ${Actor}` });
		return { Updated: 'ClipCandidate' };
	},

	CreateClipVariant: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Id = NumberField(Form, 'Id', 0);
		const Variant = OptionalText(Form, 'Variant', 'full-context version');
		const Candidate = await Get<ClipCandidateFullRow>('select * from clip_candidates where id = ?', [Id]);
		if (!Candidate) return fail(404, { Message: 'Clip candidate was not found' });
		const Window = VariantWindow(Candidate.start_time, Candidate.end_time, Variant);
		const NextNumber = await NextClipNumber(Candidate.media_job_id);
		const NewId = await InsertClipCandidateVariant(Candidate, NextNumber, Variant, Window.Start, Window.End);
		await WriteActivity(Actor, { EntityType: 'ClipCandidate', EntityId: NewId, Action: 'Created clip variant', Label: `Created ${Variant} - ${Actor}` });
		return { Created: 'ClipCandidate' };
	},

	SplitClipCandidate: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Id = NumberField(Form, 'Id', 0);
		const Candidate = await Get<ClipCandidateFullRow>('select * from clip_candidates where id = ?', [Id]);
		if (!Candidate) return fail(404, { Message: 'Clip candidate was not found' });
		const Start = TimestampSeconds(Candidate.start_time);
		const End = TimestampSeconds(Candidate.end_time);
		const Mid = Math.max(Start + 1, Math.floor((Start + End) / 2));
		await Run('update clip_candidates set end_time = ?, duration = ?, variant = ?, cut_segments_json = null where id = ?', [
			FormatTimestamp(Mid),
			DurationLabel(Candidate.start_time, FormatTimestamp(Mid)),
			`${Candidate.variant} / split A`,
			Id
		]);
		const NewId = await InsertClipCandidateVariant(Candidate, await NextClipNumber(Candidate.media_job_id), `${Candidate.variant} / split B`, FormatTimestamp(Mid), Candidate.end_time, false);
		await WriteActivity(Actor, { EntityType: 'ClipCandidate', EntityId: NewId, Action: 'Split clip candidate', Label: `Split clip - ${Actor}` });
		return { Created: 'ClipCandidate' };
	},

	MergeWithPreviousClipCandidate: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Id = NumberField(Form, 'Id', 0);
		const Candidate = await Get<ClipCandidateFullRow>('select * from clip_candidates where id = ?', [Id]);
		if (!Candidate) return fail(404, { Message: 'Clip candidate was not found' });
		const Previous = await Get<ClipCandidateFullRow>(
			'select * from clip_candidates where media_job_id = ? and clip_number < ? order by clip_number desc limit 1',
			[Candidate.media_job_id, Candidate.clip_number]
		);
		if (!Previous) return fail(400, { Message: 'No previous clip to merge with' });
		const Start = TimestampSeconds(Previous.start_time) <= TimestampSeconds(Candidate.start_time) ? Previous.start_time : Candidate.start_time;
		const End = TimestampSeconds(Previous.end_time) >= TimestampSeconds(Candidate.end_time) ? Previous.end_time : Candidate.end_time;
		const Cuts = [...ParseCuts(Previous.cut_segments_json), ...ParseCuts(Candidate.cut_segments_json)].sort((A, B) => TimestampSeconds(A.StartTime) - TimestampSeconds(B.StartTime));
		await Run(
			`update clip_candidates
			 set end_time = ?, start_time = ?, duration = ?, title = ?, explanation = ?, variant = ?, status = ?, cut_segments_json = ?
			 where id = ?`,
			[
				End,
				Start,
				DurationLabel(Start, End),
				`${Previous.title || `Clip ${Previous.clip_number}`} + ${Candidate.title || `Clip ${Candidate.clip_number}`}`,
				`${Previous.explanation} Merged with nearby candidate: ${Candidate.explanation}`,
				'merged nearby moments',
				'Suggested',
				Cuts.length ? JSON.stringify(Cuts) : null,
				Previous.id
			]
		);
		await Run('delete from clip_candidates where id = ?', [Candidate.id]);
		await WriteActivity(Actor, { EntityType: 'ClipCandidate', EntityId: Previous.id, Action: 'Merged clip candidates', Label: `Merged clips - ${Actor}` });
		return { Updated: 'ClipCandidate' };
	},

	QueueClipExport: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const CandidateId = NumberField(Form, 'ClipCandidateId', 0);
		const Candidate = await Get<ClipCandidateDbRow>('select id, media_job_id from clip_candidates where id = ?', [CandidateId]);
		if (!Candidate) return fail(404, { Message: 'Clip candidate was not found' });
		const Id = await CreateClipExport(Candidate.media_job_id, Candidate.id, OptionalText(Form, 'Preset', 'original aspect ratio'));
		await WriteActivity(Actor, { EntityType: 'ClipExport', EntityId: Id, Action: 'Queued clip export', Label: `Queued export - ${Actor}` });
		return { Created: 'ClipExport' };
	},

	QueueClipExportBatch: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const MediaJobId = NumberField(Form, 'MediaJobId', 0);
		const Mode = OptionalText(Form, 'ExportMode', 'approved');
		if (!MediaJobId) return fail(400, { Message: 'Media job id is required' });
		const Candidates = await All<ClipCandidateDbRow>(
			`select id, media_job_id from clip_candidates
			 where media_job_id = ? and (? = 'all' or status = 'Approved')
			 order by clip_number`,
			[MediaJobId, Mode]
		);
		if (!Candidates.length) return fail(400, { Message: 'No matching clip candidates to export' });
		let Count = 0;
		for (const Candidate of Candidates) {
			await CreateClipExport(Candidate.media_job_id, Candidate.id, OptionalText(Form, 'Preset', 'original aspect ratio'));
			Count += 1;
		}
		await WriteActivity(Actor, { EntityType: 'ClipExport', EntityId: MediaJobId, Action: 'Queued batch export', Label: `Queued ${Count} exports - ${Actor}` });
		return { Created: 'ClipExports' };
	},

	QueueClipPreview: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const CandidateId = NumberField(Form, 'ClipCandidateId', 0);
		const Candidate = await Get<ClipCandidateDbRow>('select id, media_job_id from clip_candidates where id = ?', [CandidateId]);
		if (!Candidate) return fail(404, { Message: 'Clip candidate was not found' });
		const Existing = await Get<{ id: number }>(
			`select id from clip_previews
			 where clip_candidate_id = ? and status in ('waiting', 'generating', 'completed')
			 order by id desc limit 1`,
			[Candidate.id]
		);
		if (Existing) return { Updated: 'ClipPreview' };
		const Id = await CreateClipPreview(Candidate.media_job_id, Candidate.id);
		await WriteActivity(Actor, { EntityType: 'ClipPreview', EntityId: Id, Action: 'Queued clip preview', Label: `Queued preview - ${Actor}` });
		return { Created: 'ClipPreview' };
	},

	AddSourceAccount: async ({ request }) => {
		await EnsureAppDatabaseReady();
		const Form = await request.formData();
		const Actor = ActorFromForm(Form);
		const Creator = RequiredText(Form, 'Creator');
		const Platform = RequiredText(Form, 'Platform');
		const Handle = RequiredText(Form, 'Handle');
		const ExternalId = RequiredText(Form, 'ExternalId');
		if (!Creator || !Platform || !Handle || !ExternalId) {
			return fail(400, { Message: 'Creator, platform, handle, and external id are required' });
		}
		if (!['YouTube', 'Twitch', 'Kick', 'TikTok', 'Instagram', 'X'].includes(Platform)) {
			return fail(400, { Message: 'Unsupported platform' });
		}

		const Id = await NextId('platform_accounts');
		await Run(
			`insert into platform_accounts
			 (id, creator, platform, handle, external_id, source_url, connected)
			 values (?, ?, ?, ?, ?, ?, ?)`,
			[Id, Creator, Platform, Handle, ExternalId, OptionalText(Form, 'SourceUrl', DefaultSourceUrl(Platform, Handle)), 0]
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
		await Run('delete from platform_accounts where id = ?', [Id]);
		await WriteActivity(Actor, { EntityType: 'SourceAccount', EntityId: Id, Action: 'Removed source' });
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
		const ExternalId = RequiredText(Form, 'ExternalId');
		if (!Id || !Creator || !Platform || !Handle || !ExternalId) {
			return fail(400, { Message: 'Source account id, creator, platform, handle, and external id are required' });
		}
		if (!['YouTube', 'Twitch', 'Kick', 'TikTok', 'Instagram', 'X'].includes(Platform)) {
			return fail(400, { Message: 'Unsupported platform' });
		}

		await Run(
			`update platform_accounts
			 set creator = ?, platform = ?, handle = ?, external_id = ?, source_url = ?, connected = 0, last_error = null
			 where id = ?`,
			[Creator, Platform, Handle, ExternalId, OptionalText(Form, 'SourceUrl', DefaultSourceUrl(Platform, Handle)), Id]
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
		await Run('delete from clip_tasks where id = ?', [Id]);
		await WriteActivity(Actor, { EntityType: 'ClipTask', EntityId: Id, Action: 'Deleted clip' });
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
				OptionalText(Form, 'Status', 'To clip'),
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

async function SaveUploadFile(Value: FormDataEntryValue | null, Kind: 'video' | 'audio') {
	if (!(Value instanceof File) || !Value.size) return '';
	const UploadRoot = resolve('media/manual', Kind);
	mkdirSync(UploadRoot, { recursive: true });
	const Extension = extname(Value.name) || (Kind === 'video' ? '.mp4' : '.mp3');
	const Name = `${Date.now()}-${SafeFileName(Value.name.replace(Extension, ''))}${Extension}`;
	const Path = join(UploadRoot, Name);
	writeFileSync(Path, Buffer.from(await Value.arrayBuffer()));
	return Path;
}

function SafeFileName(Value: string) {
	return Value.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'source';
}

function ParseLiveMoments(Raw?: string | null) {
	if (!Raw) return [] as Array<{ At: string; Timestamp: string; Label: string; Actor: string }>;
	try {
		const Parsed = JSON.parse(Raw) as Array<{ At: string; Timestamp: string; Label: string; Actor: string }>;
		return Array.isArray(Parsed) ? Parsed : [];
	} catch {
		return [];
	}
}

async function CreateMediaJob(Input: MediaJobInput) {
	const Id = await NextId('media_jobs');
	const Now = new Date().toISOString();
	await Run(
		`insert into media_jobs
		 (id, clip_task_id, source_url, source_platform, video_title, thumbnail_url, creator, duration, media_status,
		  progress, stage, estimated_file_size, error_message, manual_review_status, transcript_text, transcript_format, created_at, updated_at)
		 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			Id,
			Input.ClipTaskId,
			Input.SourceUrl,
			Input.SourcePlatform,
			Input.VideoTitle,
			Input.ThumbnailUrl,
			Input.Creator,
			Input.Duration,
			Input.MediaStatus,
			0,
			Input.Stage,
			Input.EstimatedFileSize,
			Input.ErrorMessage,
			Input.ManualReviewStatus,
			null,
			null,
			Now,
			Now
		]
	);
	return Id;
}

async function CreateClipExport(MediaJobId: number, ClipCandidateId: number | null, Preset: string) {
	const Id = await NextId('clip_exports');
	const Now = new Date().toISOString();
	await Run(
		`insert into clip_exports
		 (id, media_job_id, clip_candidate_id, preset, status, progress, output_path, file_size, error_message, created_at, updated_at, completed_at)
		 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[Id, MediaJobId, ClipCandidateId, Preset, 'waiting', 0, null, null, null, Now, Now, null]
	);
	await Run('update media_jobs set stage = ?, progress = ?, updated_at = ? where id = ?', ['exporting', 90, Now, MediaJobId]);
	return Id;
}

async function CreateClipPreview(MediaJobId: number, ClipCandidateId: number) {
	const Id = await NextId('clip_previews');
	const Now = new Date().toISOString();
	await Run(
		`insert into clip_previews
		 (id, media_job_id, clip_candidate_id, status, progress, preview_path, thumbnail_path, file_size, error_message, created_at, updated_at, completed_at)
		 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[Id, MediaJobId, ClipCandidateId, 'waiting', 0, null, null, null, null, Now, Now, null]
	);
	await Run('update media_jobs set stage = ?, progress = ?, updated_at = ? where id = ?', ['generating previews', 88, Now, MediaJobId]);
	return Id;
}

async function BuildMediaJobMetadata(Input: {
	SourceUrl: string;
	Title?: string;
	Creator?: string;
	Platform?: string;
	ClipTaskId?: number;
}): Promise<Omit<MediaJobInput, 'ClipTaskId' | 'Stage' | 'ErrorMessage' | 'ManualReviewStatus'>> {
	const Platform = Input.Platform || DetectSourcePlatform(Input.SourceUrl);
	const Og = await FetchOpenGraph(Input.SourceUrl);
	return {
		SourceUrl: Input.SourceUrl,
		SourcePlatform: Platform,
		VideoTitle: Input.Title || Og.Title || 'Untitled source',
		ThumbnailUrl: Og.Image,
		Creator: Input.Creator || Og.SiteName || Platform,
		Duration: 'unknown',
		MediaStatus: IsLikelyLivestream(Input.SourceUrl, Platform) ? 'livestream or live-capable source' : 'vod or external video',
		EstimatedFileSize: 'unknown'
	};
}

async function FetchOpenGraph(SourceUrl: string) {
	try {
		const Response = await fetch(SourceUrl, {
			headers: {
				accept: 'text/html,application/xhtml+xml',
				'user-agent': 'Mozilla/5.0 VantageClippingBot/1.0'
			},
			signal: AbortSignal.timeout(8000)
		});
		if (!Response.ok) return {};
		const Html = await Response.text();
		return {
			Title: MetaContent(Html, 'og:title') || TitleContent(Html),
			Image: MetaContent(Html, 'og:image'),
			SiteName: MetaContent(Html, 'og:site_name')
		};
	} catch {
		return {};
	}
}

function MetaContent(Html: string, Property: string) {
	const Match = Html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${EscapeRegex(Property)}["'][^>]+content=["']([^"']+)["']`, 'i'));
	return Match?.[1]?.trim() ?? '';
}

function TitleContent(Html: string) {
	return Html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? '';
}

function EscapeRegex(Value: string) {
	return Value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function DetectSourcePlatform(SourceUrl: string) {
	try {
		const Host = new URL(SourceUrl).hostname.replace(/^www\./, '').toLowerCase();
		if (Host.includes('twitch.tv')) return 'Twitch';
		if (Host.includes('youtube.com') || Host.includes('youtu.be')) return 'YouTube';
		if (Host.includes('kick.com')) return 'Kick';
		if (Host.includes('tiktok.com')) return 'TikTok';
		if (Host.includes('instagram.com')) return 'Instagram';
		if (Host.includes('x.com') || Host.includes('twitter.com')) return 'X';
		return 'Other';
	} catch {
		return 'Other';
	}
}

function RequiresManualSourceReview(Platform: string, SourceUrl: string) {
	if (['TikTok', 'Instagram', 'Other'].includes(Platform)) return true;
	return /\/clip\/|\/reel\/|\/shorts\//i.test(SourceUrl);
}

function IsLikelyLivestream(SourceUrl: string, Platform: string) {
	if (Platform === 'Kick') return /^https?:\/\/(?:www\.)?kick\.com\/[^/]+\/?$/i.test(SourceUrl);
	if (Platform === 'Twitch') return /^https?:\/\/(?:www\.)?twitch\.tv\/[^/]+\/?$/i.test(SourceUrl);
	if (Platform === 'YouTube') return /\/live\b|[?&]live=1/i.test(SourceUrl);
	return false;
}

function ClipCount(Form: FormData) {
	const Mode = OptionalText(Form, 'ClipCountMode', 'best 5 clips');
	if (Mode === 'custom') return Math.max(1, Math.min(30, NumberField(Form, 'CustomClipCount', 5)));
	if (Mode === 'best 3 clips') return 3;
	if (Mode === 'best 10 clips') return 10;
	if (Mode === 'automatic') return 6;
	return 5;
}

function BuildAnalysisReport(Job: MediaJobDbRow, DesiredCount: number, Form: FormData) {
	const Transcript = Job.transcript_text ?? '';
	const Topics = TopicSections(Transcript);
	const RawCandidates = CandidateMoments(Transcript, Math.max(DesiredCount * 3, DesiredCount + 4));
	const Enriched = RawCandidates.map((Candidate, Index) => {
		const Signals = SignalVector(Candidate.Text, Job, Form);
		const Score = ClampScore(Math.round((Candidate.Score + Signals.Overall) / 2));
		return {
			...Candidate,
			Score,
			Hook: Signals.Hook,
			Context: Signals.Context,
			Emotion: Signals.Emotion,
			Humor: Signals.Humor,
			Controversy: Signals.Controversy,
			Payoff: Signals.Payoff,
			Retention: Signals.Retention,
			Shareability: Signals.Shareability,
			Originality: Signals.Originality,
			Explanation: SignalExplanation(Candidate.Text, Signals),
			Signals,
			Rank: Index + 1
		};
	});
	const FinalCandidates = VariedFinalSet(Enriched, DesiredCount);
	const Report = {
		Version: 1,
		GeneratedAt: new Date().toISOString(),
		RequestedClips: DesiredCount,
		Source: {
			Title: Job.video_title ?? 'Untitled source',
			Platform: Job.source_platform ?? 'Unknown',
			MediaStatus: Job.media_status ?? 'unknown',
			TranscriptSource: Job.transcript_source ?? 'unknown',
			TranscriptConfidence: Job.transcript_confidence ?? null,
			ManualContext: Job.manual_context ?? '',
			LiveMarkedMoments: ParseLiveMoments(Job.live_marked_moments_json)
		},
		Stages: [
			{ Name: 'Topic segmentation', Summary: `${Topics.length} transcript sections identified`, Items: Topics },
			{ Name: 'Candidate discovery', Summary: `${RawCandidates.length} possible moments found from transcript/context`, Items: RawCandidates.map((Candidate) => Candidate.Text.slice(0, 180)) },
			{ Name: 'Signal scoring', Summary: 'Candidates scored across transcript meaning, emotion, humor, controversy, payoff, clarity, retention, shareability, and originality.' },
			{ Name: 'Variety filter', Summary: 'Final set avoids repeating the same category when lower-ranked alternatives are close enough.' },
			{ Name: 'Manual review', Summary: 'Selections are editable before export; AI output is treated as a starting point.' }
		],
		SignalCoverage: SignalCoverage(Job),
		RejectedWeaknesses: Enriched.slice(DesiredCount).map((Candidate) => ({
			Text: Candidate.Text.slice(0, 180),
			Reason: WeaknessReason(Candidate)
		})),
		FinalCandidates: FinalCandidates.map((Candidate) => ({
			StartTime: Candidate.StartTime,
			EndTime: Candidate.EndTime,
			Score: Candidate.Score,
			Category: Candidate.Category,
			Reason: Candidate.Explanation,
			Signals: Candidate.Signals
		}))
	};
	return { FinalCandidates, Report };
}

function CandidateMoments(Transcript: string, Count: number) {
	const Sentences = Transcript.split(/(?<=[.!?])\s+|\n+/)
		.map((Sentence) => Sentence.trim())
		.filter(Boolean);
	const Source = Sentences.length ? Sentences : [Transcript.trim()].filter(Boolean);
	return Source
		.map((Text, Index) => {
			const Score = HeuristicScore(Text, Index);
			const StartSeconds = Index * 42;
			const DurationSeconds = Math.max(25, Math.min(75, 20 + Math.ceil(Text.length / 14)));
			return {
				Text,
				StartTime: FormatTimestamp(StartSeconds),
				EndTime: FormatTimestamp(StartSeconds + DurationSeconds),
				Duration: `${DurationSeconds}s`,
				Score,
				Category: ClipCategory(Text),
				Explanation: `Selected because it has ${ReasonText(Text)} and can stand alone with a clear setup/payoff window.`,
				Hook: ClampScore(Score + (/^["“']?[A-Z0-9]/.test(Text) ? 4 : 0)),
				Context: ClampScore(Score - (Text.length < 60 ? 8 : 0)),
				Emotion: ClampScore(Score + (/!|insane|crazy|wild|no way|angry|shocked/i.test(Text) ? 7 : 0)),
				Humor: ClampScore(Score + (/funny|laugh|lol|bro|chat/i.test(Text) ? 6 : -4)),
				Controversy: ClampScore(Score + (/accus|expose|drama|ban|scam|fight|wrong/i.test(Text) ? 9 : -3)),
				Payoff: ClampScore(Score + (/because|then|but|finally|actually/i.test(Text) ? 5 : 0)),
				Retention: ClampScore(Score + (Text.length > 90 ? 4 : 0)),
				Shareability: ClampScore(Score + (/you|everyone|nobody|best|worst/i.test(Text) ? 5 : 0)),
				Originality: ClampScore(Score + (/first|never|only|unexpected/i.test(Text) ? 8 : 0))
			};
		})
		.sort((A, B) => B.Score - A.Score)
		.slice(0, Count)
		.sort((A, B) => TimestampSeconds(A.StartTime) - TimestampSeconds(B.StartTime));
}

function TranscriptSegmentsFromText(Transcript: string) {
	const Lines = Transcript.split(/\n+/).map((Line) => Line.trim()).filter(Boolean);
	return Lines.map((Line, Index) => {
		const Match = Line.match(/^\[(?<start>\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)(?:\s*-\s*(?<end>\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?))?\]\s*(?<text>.+)$/);
		const Start = Match?.groups?.start ? NormalizeTranscriptTimestamp(Match.groups.start) : FormatTimestamp(Index * 8);
		const End = Match?.groups?.end ? NormalizeTranscriptTimestamp(Match.groups.end) : FormatTimestamp(Index * 8 + 7);
		const Text = Match?.groups?.text ?? Line;
		const Speaker = Text.match(/^([^:]{2,32}):\s+/)?.[1]?.trim();
		return { Start, End, Text, Speaker, Confidence: 0.75 };
	});
}

function NormalizeTranscriptTimestamp(Value: string) {
	const Normalized = Value.replace(',', '.');
	const Parts = Normalized.split(':');
	return Parts.length === 2 ? `00:${Parts[0].padStart(2, '0')}:${Parts[1].padStart(6, '0')}` : Normalized;
}

async function NextClipNumber(MediaJobId: number) {
	const Row = await Get<{ MaxClip?: number | null }>('select max(clip_number) as "MaxClip" from clip_candidates where media_job_id = ?', [MediaJobId]);
	return Number(Row?.MaxClip ?? 0) + 1;
}

async function InsertClipCandidateVariant(Candidate: ClipCandidateFullRow, ClipNumber: number, Variant: string, StartTime: string, EndTime: string, PreserveCuts = true) {
	const Id = await NextId('clip_candidates');
	await Run(
		`insert into clip_candidates
		 (id, media_job_id, clip_number, title, start_time, end_time, duration, viral_score, category, explanation,
		  hook_score, context_score, emotion_score, humor_score, controversy_score, payoff_score, retention_score,
		  shareability_score, originality_score, status, variant, cut_segments_json, caption_text, caption_json, caption_status, review_notes, created_at)
		 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			Id,
			Candidate.media_job_id,
			ClipNumber,
			`${Candidate.title || `Clip ${Candidate.clip_number}`} - ${Variant}`,
			StartTime,
			EndTime,
			DurationLabel(StartTime, EndTime),
			Candidate.viral_score,
			Candidate.category,
			`${Candidate.explanation} Variant: ${Variant}.`,
			Candidate.hook_score,
			Candidate.context_score,
			Candidate.emotion_score,
			Candidate.humor_score,
			Candidate.controversy_score,
			Candidate.payoff_score,
			Candidate.retention_score,
			Candidate.shareability_score,
			Candidate.originality_score,
			'Suggested',
			Variant,
			PreserveCuts ? Candidate.cut_segments_json ?? null : null,
			null,
			null,
			null,
			Candidate.review_notes ?? '',
			new Date().toISOString()
		]
	);
	return Id;
}

function VariantWindow(StartTime: string, EndTime: string, Variant: string) {
	const Start = TimestampSeconds(StartTime);
	const End = Math.max(Start + 1, TimestampSeconds(EndTime));
	const Duration = End - Start;
	const Name = Variant.toLowerCase();
	if (Name.includes('full-context')) return { Start: FormatTimestamp(Math.max(0, Start - 12)), End: FormatTimestamp(End + 8) };
	if (Name.includes('shortest')) return { Start: FormatTimestamp(Start), End: FormatTimestamp(Math.max(Start + 12, Start + Math.min(Duration, 24))) };
	if (Name.includes('highest-retention')) return { Start: FormatTimestamp(Math.max(0, Start + Math.min(4, Math.floor(Duration / 4)))), End: FormatTimestamp(End) };
	if (Name.includes('clean')) return { Start: FormatTimestamp(Start), End: FormatTimestamp(End) };
	if (Name.includes('uncensored')) return { Start: FormatTimestamp(Start), End: FormatTimestamp(End) };
	return { Start: FormatTimestamp(Math.max(0, Start - 3)), End: FormatTimestamp(End) };
}

function ParseCuts(Raw?: string | null) {
	if (!Raw) return [] as Array<{ StartTime: string; EndTime: string; Label: string }>;
	try {
		const Parsed = JSON.parse(Raw) as Array<{ StartTime?: string; EndTime?: string; Label?: string }>;
		return Array.isArray(Parsed)
			? Parsed.filter((Cut) => Cut.StartTime && Cut.EndTime).map((Cut) => ({ StartTime: Cut.StartTime!, EndTime: Cut.EndTime!, Label: Cut.Label || 'Removed section' }))
			: [];
	} catch {
		return [];
	}
}

function NormalizedCut(Candidate: ClipCandidateFullRow, StartTime: string, EndTime: string, Label: string) {
	const ClipStart = TimestampSeconds(Candidate.start_time);
	const ClipEnd = TimestampSeconds(Candidate.end_time);
	const Start = Math.max(ClipStart, TimestampSeconds(StartTime));
	const End = Math.min(ClipEnd, TimestampSeconds(EndTime));
	if (End - Start < 1) return null;
	return { StartTime: FormatTimestamp(Start), EndTime: FormatTimestamp(End), Label };
}

function AdjustWindow(StartTime: string, EndTime: string, Operation: string, Step: number) {
	let Start = TimestampSeconds(StartTime);
	let End = Math.max(Start + 1, TimestampSeconds(EndTime));
	if (Operation === 'move-earlier') {
		const Shift = Math.min(Step, Start);
		Start -= Shift;
		End -= Shift;
	} else if (Operation === 'move-later') {
		Start += Step;
		End += Step;
	} else if (Operation === 'start-earlier') {
		Start = Math.max(0, Start - Step);
	} else if (Operation === 'start-later') {
		Start = Math.min(Start + Step, End - 1);
	} else if (Operation === 'end-earlier') {
		End = Math.max(Start + 1, End - Step);
	} else if (Operation === 'end-later') {
		End += Step;
	}
	return { Start: FormatTimestamp(Start), End: FormatTimestamp(End) };
}

function DurationLabel(StartTime: string, EndTime: string) {
	const Duration = Math.max(1, TimestampSeconds(EndTime) - TimestampSeconds(StartTime));
	return `${Duration}s`;
}

function TopicSections(Transcript: string) {
	const Sentences = Transcript.split(/(?<=[.!?])\s+|\n+/).map((Line) => Line.trim()).filter(Boolean);
	const Size = Math.max(3, Math.ceil(Sentences.length / 6));
	const Sections = [];
	for (let Index = 0; Index < Sentences.length; Index += Size) {
		const Chunk = Sentences.slice(Index, Index + Size);
		const Text = Chunk.join(' ');
		Sections.push({
			Topic: ClipCategory(Text),
			Start: FormatTimestamp(Index * 42),
			End: FormatTimestamp(Math.max(Index * 42 + 30, (Index + Chunk.length) * 42)),
			Summary: Text.slice(0, 220)
		});
	}
	return Sections.length ? Sections : [{ Topic: 'conversation', Start: '0:00', End: '0:30', Summary: 'No transcript sections were available.' }];
}

function SignalVector(Text: string, Job: MediaJobDbRow, Form: FormData) {
	const Preferred = OptionalText(Form, 'PreferredTopics', '').toLowerCase();
	const Avoid = OptionalText(Form, 'MomentsToAvoid', '').toLowerCase();
	const Context = `${Job.manual_context ?? ''} ${Job.live_marked_moments_json ?? ''}`.toLowerCase();
	const Lower = Text.toLowerCase();
	const PreferredHit = Preferred && Preferred.split(',').some((Term) => Term.trim() && Lower.includes(Term.trim()));
	const AvoidHit = Avoid && Avoid.split(',').some((Term) => Term.trim() && Lower.includes(Term.trim()));
	const LiveMarked = Context && Lower.split(/\W+/).some((Word) => Word.length > 4 && Context.includes(Word));
	const Hook = ClampScore(55 + MatchCount(Text, [/^["'A-Z0-9]/, /\?/, /!/, /\b(wait|look|listen|no way|what)\b/i]) * 9);
	const ContextScore = ClampScore(62 + (Text.length > 80 ? 10 : -8) + (/\b(because|after|before|then|but)\b/i.test(Text) ? 7 : 0));
	const Emotion = ClampScore(50 + MatchCount(Text, [/\b(insane|crazy|wild|shocked|angry|cry|scream)\b/i, /!/, /\b(no way)\b/i]) * 11);
	const Humor = ClampScore(45 + MatchCount(Text, [/\b(lol|funny|laugh|bro|chat)\b/i, /\b(troll|joke)\b/i]) * 12);
	const Controversy = ClampScore(42 + MatchCount(Text, [/\b(drama|accuse|expose|ban|scam|fight|wrong|leak)\b/i]) * 16);
	const Payoff = ClampScore(50 + MatchCount(Text, [/\b(finally|actually|because|turns out|then)\b/i]) * 10);
	const Retention = ClampScore(54 + (Hook > 70 ? 8 : 0) + (Emotion > 70 ? 8 : 0) + (Text.length > 150 ? -8 : 4));
	const Shareability = ClampScore(50 + MatchCount(Text, [/\b(everyone|nobody|best|worst|you|they)\b/i]) * 9 + (PreferredHit ? 8 : 0));
	const Originality = ClampScore(48 + MatchCount(Text, [/\b(first|never|only|unexpected|new)\b/i]) * 13 + (LiveMarked ? 7 : 0));
	const Penalty = AvoidHit ? 18 : 0;
	const Overall = ClampScore((Hook + ContextScore + Emotion + Humor + Controversy + Payoff + Retention + Shareability + Originality) / 9 - Penalty);
	return { Hook, Context: ContextScore, Emotion, Humor, Controversy, Payoff, Retention, Shareability, Originality, Overall, PreferredHit: Boolean(PreferredHit), AvoidHit: Boolean(AvoidHit), LiveMarked: Boolean(LiveMarked) };
}

function VariedFinalSet<T extends { Category: string; Score: number; StartTime: string }>(Candidates: T[], Count: number) {
	const Sorted = [...Candidates].sort((A, B) => B.Score - A.Score);
	const Picked: T[] = [];
	for (const Candidate of Sorted) {
		const SameCategoryCount = Picked.filter((Item) => Item.Category === Candidate.Category).length;
		if (SameCategoryCount < 2 || Picked.length < Math.ceil(Count / 2)) Picked.push(Candidate);
		if (Picked.length >= Count) break;
	}
	for (const Candidate of Sorted) {
		if (Picked.length >= Count) break;
		if (!Picked.includes(Candidate)) Picked.push(Candidate);
	}
	return Picked.sort((A, B) => TimestampSeconds(A.StartTime) - TimestampSeconds(B.StartTime));
}

function SignalCoverage(Job: MediaJobDbRow) {
	return [
		{ Signal: 'Transcript meaning', Status: Job.transcript_text ? 'available' : 'missing' },
		{ Signal: 'Speaker/timestamps', Status: Job.transcript_segments_json ? 'partial' : 'manual or unavailable' },
		{ Signal: 'Chat activity', Status: Job.live_marked_moments_json ? 'manual marks available' : 'not connected yet' },
		{ Signal: 'Audio changes', Status: Job.audio_path || Job.output_path ? 'source available for worker integration' : 'not available' },
		{ Signal: 'Scene/facial reactions', Status: Job.output_path ? 'source available for future vision worker' : 'not available' },
		{ Signal: 'Campaign/context rules', Status: Job.manual_context ? 'manual context available' : 'not provided' }
	];
}

function SignalExplanation(Text: string, Signals: ReturnType<typeof SignalVector>) {
	const Reasons = [];
	if (Signals.Hook >= 70) Reasons.push('opens with a strong hook');
	if (Signals.Emotion >= 70) Reasons.push('contains emotional intensity');
	if (Signals.Humor >= 65) Reasons.push('has a comedic or chat-friendly beat');
	if (Signals.Controversy >= 65) Reasons.push('has conflict or controversy');
	if (Signals.Payoff >= 65) Reasons.push('moves toward a payoff');
	if (Signals.LiveMarked) Reasons.push('matches a manually marked live moment');
	if (Signals.PreferredHit) Reasons.push('matches preferred topics');
	const Ending = Signals.AvoidHit ? ' It is penalized because it overlaps an avoided topic.' : '';
	return `Selected because it ${Reasons.length ? Reasons.join(', ') : 'has the clearest standalone transcript window'} and scored ${Signals.Overall}/100 across hook, context, emotion, humor, controversy, payoff, retention, shareability, and originality.${Ending}`;
}

function WeaknessReason(Candidate: { Signals: ReturnType<typeof SignalVector>; Category: string }) {
	if (Candidate.Signals.AvoidHit) return 'overlaps a moment marked to avoid';
	if (Candidate.Signals.Context < 55) return 'needs too much outside context';
	if (Candidate.Signals.Hook < 55) return 'weak opening hook';
	if (Candidate.Signals.Retention < 55) return 'lower retention potential than selected clips';
	return `lower ranked after variety comparison for ${Candidate.Category}`;
}

function MatchCount(Text: string, Patterns: RegExp[]) {
	return Patterns.filter((Pattern) => Pattern.test(Text)).length;
}

function HeuristicScore(Text: string, Index: number) {
	const Signals = [
		/!|\?/,
		/\b(no way|wait|what|bro|chat|look|listen)\b/i,
		/\b(insane|crazy|wild|unexpected|exposed|accused|banned|drama|fight|won|lost)\b/i,
		/\b(because|but|then|actually|finally)\b/i
	].filter((Pattern) => Pattern.test(Text)).length;
	return ClampScore(58 + Signals * 8 - Math.min(Index, 6));
}

function ClipCategory(Text: string) {
	if (/drama|accus|fight|expose|ban|scam/i.test(Text)) return 'conflict';
	if (/funny|laugh|lol|bro|chat/i.test(Text)) return 'humor';
	if (/won|lost|game|play|round|kill/i.test(Text)) return 'gameplay';
	if (/shocked|angry|cry|wild|insane/i.test(Text)) return 'reaction';
	return 'conversation';
}

function ReasonText(Text: string) {
	if (/accus|drama|fight|expose/i.test(Text)) return 'conflict and immediate stakes';
	if (/funny|laugh|lol/i.test(Text)) return 'a comedic beat';
	if (/!|\?|no way|what/i.test(Text)) return 'a strong hook';
	return 'a compact standalone idea';
}

function ClampScore(Score: number) {
	return Math.max(1, Math.min(100, Math.round(Score)));
}

function FormatTimestamp(TotalSeconds: number) {
	const Minutes = Math.floor(TotalSeconds / 60);
	const Seconds = TotalSeconds % 60;
	return `${Minutes}:${String(Seconds).padStart(2, '0')}`;
}

function TimestampSeconds(Timestamp: string) {
	const Parts = Timestamp.split(':').map(Number);
	return Parts.reduce((Total, Part) => Total * 60 + (Number.isFinite(Part) ? Part : 0), 0);
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
				const Exists = Sqlite.prepare(`select 1 from ${Alias}.sqlite_master where type = 'table' and name = ? limit 1`).get(Table.Name);
				if (!Exists && IsOptionalImportTable(Table)) continue;
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
		if (!Exists && IsOptionalImportTable(Table)) continue;
		if (!Exists) throw new Error(`Backup is missing ${Table.Name}`);
	}
}

function IsOptionalImportTable(Table: (typeof ImportTables)[number]) {
	return 'Optional' in Table && Table.Optional === true;
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

type CreatorRow = Omit<Creator, 'Platforms'> & {
	Id: number;
	Platforms: string;
};

type CampaignRow = Omit<Campaign, 'Allowed'> & {
	Id: number;
	Allowed: string;
};

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

type ClipTaskDbRow = {
	id: number;
	creator: string;
	platform: Platform;
	source: string;
	source_url?: string | null;
};

type MediaJobInput = {
	ClipTaskId?: number | null;
	SourceUrl: string;
	SourcePlatform: string;
	VideoTitle: string;
	ThumbnailUrl?: string | null;
	Creator: string;
	Duration: string;
	MediaStatus: string;
	Stage: MediaJob['Stage'];
	EstimatedFileSize: string;
	ErrorMessage?: string | null;
	ManualReviewStatus: MediaJob['ManualReviewStatus'];
};

type MediaJobRow = Omit<MediaJob, 'Stage' | 'ManualReviewStatus'> & {
	Stage: string;
	ManualReviewStatus: string;
};

type MediaJobDbRow = {
	id: number;
	video_title?: string | null;
	source_platform?: string | null;
	media_status?: string | null;
	transcript_text?: string | null;
	transcript_source?: string | null;
	transcript_confidence?: number | null;
	transcript_segments_json?: string | null;
	manual_context?: string | null;
	audio_path?: string | null;
	output_path?: string | null;
	live_marked_moments_json?: string | null;
};

type ClipCandidateDbRow = {
	id: number;
	media_job_id: number;
};

type ClipCandidateFullRow = {
	id: number;
	media_job_id: number;
	clip_number: number;
	title?: string | null;
	start_time: string;
	end_time: string;
	duration: string;
	viral_score: number;
	category: string;
	explanation: string;
	hook_score: number;
	context_score: number;
	emotion_score: number;
	humor_score: number;
	controversy_score: number;
	payoff_score: number;
	retention_score: number;
	shareability_score: number;
	originality_score: number;
	status: string;
	variant: string;
	cut_segments_json?: string | null;
	caption_text?: string | null;
	caption_json?: string | null;
	caption_status?: string | null;
	review_notes?: string | null;
	created_at: string;
};

type PlatformAccountRow = Omit<PlatformAccount, 'Platform' | 'Connected'> & {
	Platform: string;
	Connected: boolean | number;
};

type SyncRunRow = Omit<SyncRun, 'Platform'> & {
	Platform: string;
};
