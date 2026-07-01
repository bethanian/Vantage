<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import {
		type ClipCandidate,
		type ClipExport,
		type ClipPreview,
		type ClipTask,
		type ContentItem,
		type ItemStatus,
		type MediaJob,
		type Platform,
		type PlatformAccount,
		type ViewName,
		type WorkerHeartbeat
	} from '$lib/vantage-data';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const Campaigns = $derived(data.Campaigns);
	const ApiCredentials = $derived(data.ApiCredentials);
	const AppSettings = $derived(data.AppSettings);
	const ClipCandidates = $derived(data.ClipCandidates as ClipCandidate[]);
	const ClipExports = $derived(data.ClipExports as ClipExport[]);
	const ClipPreviews = $derived(data.ClipPreviews as ClipPreview[]);
	const ClipTasks = $derived(data.ClipTasks);
	const ContentItems = $derived(data.ContentItems);
	const Creators = $derived(data.Creators);
	const MediaJobs = $derived(data.MediaJobs as MediaJob[]);
	const PlatformAccounts = $derived(data.PlatformAccounts);
	const SavedSearches = $derived(data.SavedSearches);
	const SyncRuns = $derived(data.SyncRuns);
	const ActivityEvents = $derived(data.ActivityEvents);
	const WorkerHeartbeats = $derived(data.WorkerHeartbeats as WorkerHeartbeat[]);

	const Views: ViewName[] = ['Feed', 'Creators', 'Queue', 'Best Clips', 'Campaigns', 'Accounts'];
	const FeedFilters = ['All', 'Live now', 'Whop', 'Clipping.net', 'Not clipped'];
	const ContentStatusActions: { Status: ItemStatus; Icon: string; Label: string }[] = [
		{ Status: 'Watched', Icon: 'ti-eye', Label: 'Mark watched' },
		{ Status: 'Clipped', Icon: 'ti-scissors', Label: 'Mark clipped' },
		{ Status: 'Rejected', Icon: 'ti-circle-x', Label: 'Reject' }
	];
	const QueueFilters = ['All', 'To upload', 'Editing', 'Done'];
	const SortModes = ['Opportunity score', 'Recency', 'Creator', 'Engagement velocity'];
	const SidebarGroups = $derived([
		{
			Label: 'Platforms',
			Items: [
				{ Label: 'All sources', Icon: 'ti-layout-list', Filter: 'All', Count: ContentItems.length },
				{ Label: 'Kick', Icon: 'ti-brand-kick', Filter: 'Kick', Count: PlatformCount('Kick') },
				{ Label: 'Twitch', Icon: 'ti-brand-twitch', Filter: 'Twitch', Count: PlatformCount('Twitch') },
				{ Label: 'YouTube', Icon: 'ti-brand-youtube', Filter: 'YouTube', Count: PlatformCount('YouTube') },
				{ Label: 'TikTok', Icon: 'ti-brand-tiktok', Filter: 'TikTok', Count: PlatformCount('TikTok') }
			]
		},
		{
			Label: 'Campaigns',
			Items: [
				...Campaigns.map((Campaign) => ({
					Label: Campaign.Name,
					Icon: 'ti-tag',
					Filter: Campaign.Name,
					Count: ContentItems.filter((Item) => Item.Campaign === Campaign.Name).length
				}))
			]
		},
		{
			Label: 'Status',
			Items: [
				{ Label: 'Unwatched', Icon: 'ti-circle-dot', Filter: 'New', Count: ContentItems.filter((Item) => Item.Status === 'New').length },
				{ Label: 'In queue', Icon: 'ti-clock', Filter: 'Queue', Count: ClipTasks.length },
				{ Label: 'Uploaded', Icon: 'ti-check', Filter: 'Uploaded', Count: ContentItems.filter((Item) => Item.Status === 'Uploaded').length }
			]
		}
	]);

	let ActiveView = $state<ViewName>('Feed');
	let ActiveFeedFilter = $state('All');
	let FeedSearch = $state('');
	let SourceSearch = $state('');
	let ActiveQueueFilter = $state('All');
	let SortMode = $state(SortModes[0]);
	let SelectedCreatorName = $state(InitialCreatorName());
	let SelectedMediaJobId = $state<number>(InitialMediaJobId());
	let TranscriptSearch = $state('');
	let QueueState = $state<ClipTask[]>(InitialQueueState());
	let EditableNotes = $state<Record<string, string>>(InitialNotes());
	let IsSyncingYoutube = $state(false);
	let IsSyncingTwitch = $state(false);
	let IsSyncingKick = $state(false);
	let IsSyncingAll = $state(false);
	let IsResolvingSources = $state(false);
	let ActorName = $state('');
	let ActorDraft = $state('');
	let NeedsActor = $state(true);
	let PreviewVideo: HTMLVideoElement | null = $state(null);
	let PreviewTime = $state(0);
	let PreviewDuration = $state(0);
	let PreviewVolume = $state(0.85);
	let PreviewSpeed = $state(1);
	let TimelineZoom = $state(1);

	const SelectedCreator = $derived(
		Creators.find((Creator) => Creator.Name === SelectedCreatorName) ?? Creators[0]
	);
	const LiveCount = $derived(ContentItems.filter((Item) => Item.Live).length);
	const Earnings = $derived(Campaigns.reduce((Total, Campaign) => Total + Campaign.Earned, 0));
	const EarningsGoal = $derived(Campaigns.reduce((Total, Campaign) => Total + Campaign.Goal, 0));
	const AverageScore = $derived(ContentItems.length ? Math.round(ContentItems.reduce((Total, Item) => Total + Item.Score, 0) / ContentItems.length) : 0);
	const UploadedCount = $derived(QueueState.filter((Task) => Object.values(Task.UploadUrls).some(Boolean) || Task.Status === 'Done').length);
	const HandledCount = $derived(ContentItems.filter((Item) => ['Watched', 'Clipped', 'Uploaded', 'Rejected'].includes(Item.Status)).length);
	const ClippedCount = $derived(QueueState.length + ContentItems.filter((Item) => ['Clipped', 'Uploaded'].includes(Item.Status)).length);
	const UploadPlatformStats = $derived(
		[
			{ Platform: 'TikTok' as const, Key: 'TikTok' as const },
			{ Platform: 'YouTube' as const, Key: 'Shorts' as const },
			{ Platform: 'Instagram' as const, Key: 'Reels' as const }
		].map(({ Platform, Key }) => ({
			Platform,
			Uploads: QueueState.filter((Task) => Boolean(Task.UploadUrls[Key])).length,
			Queued: QueueState.filter((Task) => Task.Targets[Key]).length
		}))
	);
	const LatestSync = $derived(SyncRuns.at(-1));
	const LocalWorker = $derived(WorkerHeartbeats.find((Heartbeat) => Heartbeat.Role === 'local-primary'));
	const FallbackWorker = $derived(WorkerHeartbeats.find((Heartbeat) => Heartbeat.Role.includes('fallback')));
	const WorkerBadge = $derived(WorkerStatusText(LocalWorker, FallbackWorker));
	const SelectedCampaign = $derived(Campaigns.find((Campaign) => Campaign.Name === SelectedCreator.Campaign));
	const FeedItems = $derived.by(() => {
		const Filtered = ContentItems.filter(
			(Item) =>
				Item.Score >= AppSettings.MinimumScore &&
				MatchesFeedFilter(Item, ActiveFeedFilter) &&
				MatchesSearch(Item, FeedSearch)
		);
		return [...Filtered].sort((A, B) => {
			if (SortMode === 'Creator') return A.Creator.localeCompare(B.Creator);
			if (SortMode === 'Recency') return B.Id - A.Id;
			return B.Score - A.Score;
		});
	});
	const LeadItems = $derived(FeedItems.slice(0, 3));
	const QueueItems = $derived(QueueState.filter((Task) => MatchesQueueFilter(Task, ActiveQueueFilter)));
	const ExternalMediaJobs = $derived(MediaJobs.filter((Job) => !Job.ClipTaskId));
	const SelectedMediaJob = $derived(MediaJobs.find((Job) => Job.Id === SelectedMediaJobId) ?? MediaJobs[0]);
	const SelectedClipCandidates = $derived(ClipCandidates.filter((Candidate) => Candidate.MediaJobId === SelectedMediaJob?.Id));
	const SelectedClipExports = $derived(ClipExports.filter((Export) => Export.MediaJobId === SelectedMediaJob?.Id));
	const SelectedClipPreviews = $derived(ClipPreviews.filter((Preview) => Preview.MediaJobId === SelectedMediaJob?.Id));
	const TranscriptMatchCount = $derived(TranscriptMatches(SelectedMediaJob?.TranscriptText ?? '', TranscriptSearch));
	const SelectedTranscriptSegments = $derived(TranscriptSegments(SelectedMediaJob));
	const SelectedAnalysisReport = $derived(ParseAnalysisReport(SelectedMediaJob?.AnalysisReportJson));
	const SourceAccounts = $derived(PlatformAccounts.filter((Account) => MatchesSourceSearch(Account)));
	const SourceGroups = $derived.by(() => {
		const Groups = new Map<string, PlatformAccount[]>();
		for (const Account of SourceAccounts) Groups.set(Account.Platform, [...(Groups.get(Account.Platform) ?? []), Account]);
		return [...Groups.entries()].map(([Platform, Accounts]) => ({ Platform, Accounts }));
	});
	const CreatorItems = $derived(
		ContentItems.filter((Item) => Item.Creator === SelectedCreator.Name).slice(0, 5)
	);
	const ScoreWeights = $derived([
		{ Key: 'ScoreRecencyWeight', Label: 'Recency', Value: AppSettings.ScoreRecencyWeight },
		{ Key: 'ScoreEngagementWeight', Label: 'Engagement', Value: AppSettings.ScoreEngagementWeight },
		{ Key: 'ScorePlatformWeight', Label: 'Platform fit', Value: AppSettings.ScorePlatformWeight },
		{ Key: 'ScoreCampaignWeight', Label: 'Campaign fit', Value: AppSettings.ScoreCampaignWeight },
		{ Key: 'ScoreTitleWeight', Label: 'Title intent', Value: AppSettings.ScoreTitleWeight },
		{ Key: 'ScoreStatusWeight', Label: 'Status penalty', Value: AppSettings.ScoreStatusWeight }
	]);
	type ToastKind = 'Success' | 'Error' | 'Info';
	type SoundKind = 'Tap' | 'Success' | 'Error' | 'Queue' | 'Delete' | 'Sync';
	type TranscriptSegment = { Start: string; End: string; Text: string; Speaker: string | null; Confidence: number | null };
	let Toasts = $state<{ Id: number; Kind: ToastKind; Message: string }[]>([]);
	let EditingTaskId = $state<number | null>(null);
	let IsSidebarOpen = $state(false);
	let WorkerNow = $state(Date.now());
	let AudioContextInstance: AudioContext | null = null;
	let LastSoundAt = 0;

	onMount(() => {
		const SavedActor = localStorage.getItem('VantageActorName') ?? '';
		ActorName = SavedActor;
		ActorDraft = SavedActor;
		NeedsActor = !SavedActor;
		const OnKeydown = (Event: KeyboardEvent) => HandlePreviewShortcut(Event);
		const WorkerRefreshTimer = setInterval(() => {
			WorkerNow = Date.now();
			void invalidateAll();
		}, 45000);
		window.addEventListener('keydown', OnKeydown);
		return () => {
			clearInterval(WorkerRefreshTimer);
			window.removeEventListener('keydown', OnKeydown);
		};
	});

	function MatchesFeedFilter(Item: ContentItem, Filter: string) {
		if (Filter === 'All') return true;
		if (Filter === 'Live now') return Item.Live;
		if (Filter === 'Not clipped') return !['Clipped', 'Uploaded'].includes(Item.Status);
		if (Filter === 'Queue') return QueueState.some((Task) => Task.Creator === Item.Creator);
		return Item.Platform === Filter || Item.Campaign === Filter || Item.Status === Filter;
	}

	function PlatformCount(Platform: Platform) {
		return ContentItems.filter((Item) => Item.Platform === Platform).length;
	}

	function MatchesSearch(Item: ContentItem, Query: string) {
		const Search = Query.trim().toLowerCase();
		if (!Search) return true;
		return [Item.Creator, Item.Platform, Item.Campaign, Item.Kind, Item.Status, Item.Title, Item.Metric]
			.join(' ')
			.toLowerCase()
			.includes(Search);
	}

	function MatchesQueueFilter(Task: ClipTask, Filter: string) {
		if (Filter === 'All') return true;
		if (Filter === 'To upload') return Task.Status !== 'Done';
		return Task.Status === Filter;
	}

	function MatchesSourceSearch(Account: PlatformAccount) {
		const Search = SourceSearch.trim().toLowerCase();
		if (!Search) return true;
		return [Account.Creator, Account.Platform, Account.Handle, Account.ExternalId, Account.SourceUrl ?? '', Account.LastError ?? '']
			.join(' ')
			.toLowerCase()
			.includes(Search);
	}

	function InitialCreatorName() {
		return data.Creators[0]?.Name ?? '';
	}

	function InitialMediaJobId() {
		return data.MediaJobs[0]?.Id ?? 0;
	}

	function InitialQueueState() {
		return data.ClipTasks.map((Task) => ({
			...Task,
			Targets: { ...Task.Targets },
			UploadUrls: { ...Task.UploadUrls }
		}));
	}

	function InitialNotes() {
		return Object.fromEntries(data.Creators.map((Creator) => [Creator.Name, Creator.Notes]));
	}

	function SetSidebarFilter(Filter: string) {
		PlaySound('Tap');
		ActiveView = 'Feed';
		ActiveFeedFilter = Filter;
		IsSidebarOpen = false;
	}

	function ScoreClass(Score: number) {
		if (Score >= 80) return 'High';
		if (Score >= 65) return 'Medium';
		return 'Low';
	}

	function PlatformIcon(Platform: Platform) {
		return {
			Kick: 'ti-brand-kick',
			Twitch: 'ti-brand-twitch',
			YouTube: 'ti-brand-youtube',
			TikTok: 'ti-brand-tiktok',
			Instagram: 'ti-brand-instagram',
			X: 'ti-brand-x'
		}[Platform];
	}

	function UploadUrl(Task: ClipTask, Target: string) {
		return Task.UploadUrls[Target as keyof ClipTask['UploadUrls']] ?? '';
	}

	function JobsForTask(Task: ClipTask) {
		return MediaJobs.filter((Job) => Job.ClipTaskId === Task.Id || (Job.SourceUrl && Job.SourceUrl === Task.SourceUrl));
	}

	function TranscriptMatches(Text: string, Query: string) {
		const Needle = Query.trim().toLowerCase();
		if (!Needle) return 0;
		return Text.toLowerCase().split(Needle).length - 1;
	}

	function TranscriptSegments(Job?: MediaJob): TranscriptSegment[] {
		if (!Job?.TranscriptText) return [] as TranscriptSegment[];
		const Stored = ParseTranscriptSegments(Job.TranscriptSegmentsJson);
		if (Stored.length) return Stored;
		return Job.TranscriptText.split(/\n+/)
			.map((Line, Index) => TranscriptSegmentFromLine(Line.trim(), Index))
			.filter((Segment): Segment is TranscriptSegment => Boolean(Segment));
	}

	function ParseTranscriptSegments(Raw?: string | null): TranscriptSegment[] {
		if (!Raw) return [] as TranscriptSegment[];
		try {
			const Parsed = JSON.parse(Raw) as TranscriptSegment[];
			return Array.isArray(Parsed)
				? Parsed.filter((Segment) => Boolean(Segment?.Text)).map((Segment) => ({
						Start: Segment.Start,
						End: Segment.End,
						Text: Segment.Text,
						Speaker: Segment.Speaker ?? null,
						Confidence: Segment.Confidence ?? null
					}))
				: [];
		} catch {
			return [];
		}
	}

	function TranscriptSegmentFromLine(Line: string, Index: number): TranscriptSegment | null {
		if (!Line) return null;
		const Match = Line.match(/^\[(?<start>\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)(?:\s*-\s*(?<end>\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?))?\]\s*(?<text>.+)$/);
		const Text = Match?.groups?.text ?? Line;
		const Speaker = Text.match(/^([^:]{2,32}):\s+/)?.[1]?.trim() ?? null;
		return {
			Start: NormalizeClientTimestamp(Match?.groups?.start) || TimestampLabel(Index * 8),
			End: NormalizeClientTimestamp(Match?.groups?.end) || TimestampLabel(Index * 8 + 7),
			Text,
			Speaker,
			Confidence: 0.75
		};
	}

	function NormalizeClientTimestamp(Value?: string) {
		if (!Value) return '';
		const Normalized = Value.replace(',', '.');
		const Parts = Normalized.split(':');
		return Parts.length === 2 ? `${Number(Parts[0])}:${Parts[1]}` : Normalized;
	}

	function SegmentMatchesSearch(Segment: TranscriptSegment) {
		const Search = TranscriptSearch.trim().toLowerCase();
		if (!Search) return true;
		return `${Segment.Speaker ?? ''} ${Segment.Text}`.toLowerCase().includes(Search);
	}

	function SegmentIsActive(Segment: TranscriptSegment) {
		const Start = TimestampSeconds(Segment.Start);
		const End = Math.max(Start + 0.75, TimestampSeconds(Segment.End));
		return PreviewTime >= Start && PreviewTime <= End;
	}

	function ExportsForCandidate(CandidateId: number) {
		return ClipExports.filter((Export) => Export.ClipCandidateId === CandidateId);
	}

	function PreviewForCandidate(CandidateId: number) {
		return SelectedClipPreviews.find((Preview) => Preview.ClipCandidateId === CandidateId);
	}

	function CandidateCuts(Candidate: ClipCandidate) {
		if (!Candidate.CutSegmentsJson) return [] as Array<{ StartTime: string; EndTime: string; Label: string }>;
		try {
			const Parsed = JSON.parse(Candidate.CutSegmentsJson) as Array<{ StartTime?: string; EndTime?: string; Label?: string }>;
			return Array.isArray(Parsed)
				? Parsed.filter((Cut) => Cut.StartTime && Cut.EndTime).map((Cut) => ({ StartTime: Cut.StartTime!, EndTime: Cut.EndTime!, Label: Cut.Label || 'Removed section' }))
				: [];
		} catch {
			return [];
		}
	}

	function IsLiveCapableJob(Job: MediaJob) {
		return /live/i.test(`${Job.MediaStatus} ${Job.SourceUrl} ${Job.Stage}`);
	}

	function LiveMoments(Job: MediaJob) {
		if (!Job.LiveMarkedMomentsJson) return [];
		try {
			const Parsed = JSON.parse(Job.LiveMarkedMomentsJson) as Array<{ At: string; Timestamp: string; Label: string; Actor: string }>;
			return Array.isArray(Parsed) ? Parsed : [];
		} catch {
			return [];
		}
	}

	function LiveChunkAnalysis(Job: MediaJob) {
		if (!Job.MetadataJson) return null;
		try {
			const Parsed = JSON.parse(Job.MetadataJson) as { LiveChunkAnalysis?: { ProcessedMomentKeys?: string[]; LastChunkIndex?: number; UpdatedAt?: string } };
			return Parsed.LiveChunkAnalysis ?? null;
		} catch {
			return null;
		}
	}

	function ParseAnalysisReport(Raw?: string | null) {
		if (!Raw) return null;
		try {
			return JSON.parse(Raw) as {
				GeneratedAt?: string;
				SignalCoverage?: Array<{ Signal: string; Status: string }>;
				Stages?: Array<{ Name: string; Summary: string }>;
				FinalCandidates?: Array<{ Score: number; Category: string; Reason: string }>;
				RejectedWeaknesses?: Array<{ Text: string; Reason: string }>;
			};
		} catch {
			return null;
		}
	}

	function SourceVideoUrl(Job?: MediaJob) {
		return Job?.OutputPath ? `/api/media-jobs/${Job.Id}/source` : '';
	}

	function PlayPreview() {
		void PreviewVideo?.play();
	}

	function PausePreview() {
		PreviewVideo?.pause();
	}

	function StopPreview() {
		if (!PreviewVideo) return;
		PreviewVideo.pause();
		PreviewVideo.currentTime = 0;
	}

	function SeekPreview(Seconds: number) {
		if (!PreviewVideo) return;
		PreviewVideo.currentTime = Math.max(0, Math.min(Seconds, PreviewVideo.duration || Seconds));
		void PreviewVideo.play();
	}

	function StepPreview(Frames: number) {
		if (!PreviewVideo) return;
		PreviewVideo.pause();
		PreviewVideo.currentTime = Math.max(0, PreviewVideo.currentTime + Frames / 30);
	}

	function TogglePreview() {
		if (!PreviewVideo) return;
		if (PreviewVideo.paused) PlayPreview();
		else PausePreview();
	}

	function HandlePreviewShortcut(Event: KeyboardEvent) {
		if (ActiveView !== 'Best Clips' || !PreviewVideo || IsEditableTarget(Event.target)) return;
		if (Event.key === ' ') {
			Event.preventDefault();
			TogglePreview();
		} else if (Event.key === 'ArrowLeft') {
			Event.preventDefault();
			SeekPreview(PreviewVideo.currentTime - (Event.shiftKey ? 5 : 1));
		} else if (Event.key === 'ArrowRight') {
			Event.preventDefault();
			SeekPreview(PreviewVideo.currentTime + (Event.shiftKey ? 5 : 1));
		} else if (Event.key === ',' || Event.key === '.') {
			Event.preventDefault();
			StepPreview(Event.key === ',' ? -1 : 1);
		} else if (Event.key.toLowerCase() === 'f') {
			Event.preventDefault();
			FullscreenPreview();
		}
	}

	function IsEditableTarget(Target: EventTarget | null) {
		if (!(Target instanceof HTMLElement)) return false;
		return ['INPUT', 'TEXTAREA', 'SELECT'].includes(Target.tagName) || Target.isContentEditable;
	}

	function SetPreviewVolume(Value: number) {
		PreviewVolume = Value;
		if (PreviewVideo) PreviewVideo.volume = Value;
	}

	function SetPreviewSpeed(Value: number) {
		PreviewSpeed = Value;
		if (PreviewVideo) PreviewVideo.playbackRate = Value;
	}

	function FullscreenPreview() {
		void PreviewVideo?.requestFullscreen?.();
	}

	function TimestampLabel(Seconds: number) {
		if (!Number.isFinite(Seconds)) return '0:00';
		const Total = Math.max(0, Math.floor(Seconds));
		const Hours = Math.floor(Total / 3600);
		const Minutes = Math.floor((Total % 3600) / 60);
		const Remaining = Total % 60;
		return Hours ? `${Hours}:${String(Minutes).padStart(2, '0')}:${String(Remaining).padStart(2, '0')}` : `${Minutes}:${String(Remaining).padStart(2, '0')}`;
	}

	function CandidateStartSeconds(Candidate: ClipCandidate) {
		return TimestampSeconds(Candidate.StartTime);
	}

	function CandidateLeft(Candidate: ClipCandidate) {
		const Duration = PreviewDuration || 600;
		return Math.min(96, Math.max(0, (CandidateStartSeconds(Candidate) / Duration) * 100 * TimelineZoom));
	}

	function CandidateWidth(Candidate: ClipCandidate) {
		const Duration = PreviewDuration || 600;
		const Width = ((TimestampSeconds(Candidate.EndTime) - TimestampSeconds(Candidate.StartTime)) / Duration) * 100 * TimelineZoom;
		return Math.max(5, Math.min(36, Width));
	}

	function ClipDurationSeconds(Candidate: ClipCandidate) {
		return Math.max(1, TimestampSeconds(Candidate.EndTime) - TimestampSeconds(Candidate.StartTime));
	}

	function CutLeft(Candidate: ClipCandidate, Cut: { StartTime: string }) {
		const Offset = TimestampSeconds(Cut.StartTime) - TimestampSeconds(Candidate.StartTime);
		return Math.max(0, Math.min(98, (Offset / ClipDurationSeconds(Candidate)) * 100));
	}

	function CutWidth(Candidate: ClipCandidate, Cut: { StartTime: string; EndTime: string }) {
		const Width = ((TimestampSeconds(Cut.EndTime) - TimestampSeconds(Cut.StartTime)) / ClipDurationSeconds(Candidate)) * 100;
		return Math.max(2, Math.min(100 - CutLeft(Candidate, Cut), Width));
	}

	function PresetCut(Candidate: ClipCandidate, Preset: 'first beat' | 'middle beat' | 'last beat') {
		const Start = TimestampSeconds(Candidate.StartTime);
		const Duration = ClipDurationSeconds(Candidate);
		const CutLength = Math.max(2, Math.min(8, Math.floor(Duration * 0.16)));
		const Offset = Preset === 'first beat' ? Math.max(1, Math.floor(Duration * 0.08)) : Preset === 'middle beat' ? Math.floor(Duration * 0.5 - CutLength / 2) : Math.max(1, Duration - CutLength - Math.floor(Duration * 0.08));
		return {
			StartTime: TimestampLabel(Start + Math.max(0, Offset)),
			EndTime: TimestampLabel(Start + Math.max(CutLength, Offset + CutLength)),
			Label: `Remove ${Preset}`
		};
	}

	function TimestampSeconds(Value: string) {
		const Parts = Value.split(':').map(Number);
		if (Parts.some((Part) => !Number.isFinite(Part))) return 0;
		if (Parts.length === 3) return Parts[0] * 3600 + Parts[1] * 60 + Parts[2];
		if (Parts.length === 2) return Parts[0] * 60 + Parts[1];
		return Parts[0] ?? 0;
	}

	function StageClass(Stage: string) {
		return Stage.replace(/\s+/g, '-').toLowerCase();
	}

	function WorkerStatusText(Local?: WorkerHeartbeat, Fallback?: WorkerHeartbeat) {
		if (IsWorkerFresh(Local)) return `local ${Local?.Status}`;
		if (IsWorkerFresh(Fallback)) return `fallback ${Fallback?.Status}`;
		return 'workers offline';
	}

	function IsWorkerFresh(Heartbeat?: WorkerHeartbeat) {
		if (!Heartbeat?.LastSeenAt) return false;
		const Fresh = WorkerNow - new Date(Heartbeat.LastSeenAt).getTime() < 1000 * 75;
		return Fresh && ['running', 'running-once'].includes(Heartbeat.Status);
	}

	function WorkerBadgeClass() {
		if (IsWorkerFresh(LocalWorker)) return 'Online';
		if (IsWorkerFresh(FallbackWorker)) return 'Fallback';
		return 'Offline';
	}

	function PushToast(Message: string, Kind: ToastKind = 'Success') {
		PlaySound(SoundForToast(Message, Kind));
		const Id = Date.now() + Math.random();
		Toasts = [...Toasts, { Id, Kind, Message }];
		setTimeout(() => (Toasts = Toasts.filter((Toast) => Toast.Id !== Id)), 3200);
	}

	function SoundForToast(Message: string, Kind: ToastKind): SoundKind {
		if (Kind === 'Error') return 'Error';
		if (/queue item saved|queued/i.test(Message)) return 'Queue';
		if (/removed|deleted|cleared/i.test(Message)) return 'Delete';
		if (/synced|resolved|imported/i.test(Message)) return 'Sync';
		return Kind === 'Info' ? 'Tap' : 'Success';
	}

	function GetAudioContext() {
		if (typeof window === 'undefined') return null;
		if (AudioContextInstance) return AudioContextInstance;
		const AudioConstructor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
		if (!AudioConstructor) return null;
		AudioContextInstance = new AudioConstructor();
		return AudioContextInstance;
	}

	function PlaySound(Kind: SoundKind) {
		const NowMs = Date.now();
		if (NowMs - LastSoundAt < 45) return;
		LastSoundAt = NowMs;

		const Context = GetAudioContext();
		if (!Context) return;
		if (Context.state === 'suspended') void Context.resume();

		const Now = Context.currentTime;
		const Sequences: Record<SoundKind, Array<[number, number, number, OscillatorType, number]>> = {
			Tap: [[520, 0, 0.035, 'triangle', 0.018]],
			Success: [
				[520, 0, 0.055, 'sine', 0.028],
				[780, 0.055, 0.085, 'sine', 0.032]
			],
			Error: [
				[220, 0, 0.09, 'sawtooth', 0.026],
				[164, 0.08, 0.12, 'sawtooth', 0.022]
			],
			Queue: [
				[392, 0, 0.045, 'triangle', 0.025],
				[588, 0.045, 0.075, 'triangle', 0.03]
			],
			Delete: [[180, 0, 0.11, 'triangle', 0.024]],
			Sync: [
				[330, 0, 0.045, 'sine', 0.023],
				[495, 0.04, 0.055, 'sine', 0.026],
				[660, 0.087, 0.07, 'sine', 0.028]
			]
		};

		for (const [Frequency, Offset, Duration, Type, Volume] of Sequences[Kind]) {
			const Oscillator = Context.createOscillator();
			const Gain = Context.createGain();
			const Start = Now + Offset;
			const End = Start + Duration;

			Oscillator.type = Type;
			Oscillator.frequency.setValueAtTime(Frequency, Start);
			Gain.gain.setValueAtTime(0.0001, Start);
			Gain.gain.exponentialRampToValueAtTime(Volume, Start + 0.008);
			Gain.gain.exponentialRampToValueAtTime(0.0001, End);
			Oscillator.connect(Gain);
			Gain.connect(Context.destination);
			Oscillator.start(Start);
			Oscillator.stop(End + 0.01);
		}
	}

	function SaveActor() {
		const CleanActor = ActorDraft.trim().replace(/\s+/g, ' ').slice(0, 40);
		if (!CleanActor) return;
		ActorName = CleanActor;
		ActorDraft = CleanActor;
		NeedsActor = false;
		localStorage.setItem('VantageActorName', CleanActor);
		PushToast(`Using Vantage as ${CleanActor}`, 'Info');
	}

	function LatestAction(Action?: string | null, Actor?: string | null) {
		if (!Action || !Actor) return '';
		return `${Action} - ${Actor}`;
	}

	function FormFeedback(Label: string, SuccessText = 'saved'): SubmitFunction {
		return ({ formData }) => {
			formData.set('Actor', ActorName || ActorDraft || 'Someone');
			return async ({ result, update }) => {
			await update();
			const Failed = result.type === 'failure' || result.type === 'error';
			PushToast(`${Label} ${Failed ? 'failed' : SuccessText}`, Failed ? 'Error' : 'Success');
		};
		};
	}

	async function ToastedFetch(Url: string, Message: string) {
		const Response = await fetch(Url, { method: 'POST', headers: { 'x-vantage-actor': ActorName || ActorDraft || 'Someone' } });
		const Payload = await Response.json().catch(() => ({} as { Message?: string; Status?: string }));
		if (!Response.ok || Payload.Status === 'Failed') PushToast(Payload.Message ?? `${Message} failed`, 'Error');
		else PushToast(Message, 'Success');
	}

	async function UpdateTaskStatus(Task: ClipTask, Status: string) {
		const PreviousStatus = Task.Status;
		Task.Status = Status;
		const Response = await fetch(`/api/clip-tasks/${Task.Id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json', 'x-vantage-actor': ActorName || ActorDraft || 'Someone' },
			body: JSON.stringify({ Status })
		});
		if (!Response.ok) {
			Task.Status = PreviousStatus;
			PushToast('Queue update failed', 'Error');
		} else {
			Task.LastAction = Status;
			Task.LastActionBy = ActorName || ActorDraft || 'Someone';
			Task.LastActionAt = new Date().toISOString();
			PushToast('Queue status saved');
		}
	}

	async function UpdateContentStatus(Item: ContentItem, Status: ItemStatus) {
		const PreviousStatus = Item.Status;
		Item.Status = Status;
		const Response = await fetch(`/api/content-items/${Item.Id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json', 'x-vantage-actor': ActorName || ActorDraft || 'Someone' },
			body: JSON.stringify({ Status })
		});
		if (!Response.ok) {
			Item.Status = PreviousStatus;
			PushToast('Feed status failed', 'Error');
		} else {
			Item.LastAction = Status;
			Item.LastActionBy = ActorName || ActorDraft || 'Someone';
			Item.LastActionAt = new Date().toISOString();
			PushToast('Feed status saved');
		}
	}

	async function SaveCreatorNotes(CreatorName: string) {
		const Response = await fetch(`/api/creators/${encodeURIComponent(CreatorName)}/notes`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json', 'x-vantage-actor': ActorName || ActorDraft || 'Someone' },
			body: JSON.stringify({ Notes: EditableNotes[CreatorName] ?? '' })
		});
		PushToast(Response.ok ? 'Notes saved' : 'Notes failed', Response.ok ? 'Success' : 'Error');
	}

	async function SyncYoutube() {
		IsSyncingYoutube = true;
		try {
			await ToastedFetch('/api/sync/youtube', 'YouTube synced');
			await invalidateAll();
		} finally {
			IsSyncingYoutube = false;
		}
	}

	async function SyncTwitch() {
		IsSyncingTwitch = true;
		try {
			await ToastedFetch('/api/sync/twitch', 'Twitch synced');
			await invalidateAll();
		} finally {
			IsSyncingTwitch = false;
		}
	}

	async function SyncKick() {
		IsSyncingKick = true;
		try {
			await ToastedFetch('/api/sync/kick', 'Kick synced');
			await invalidateAll();
		} finally {
			IsSyncingKick = false;
		}
	}

	async function SyncAll() {
		IsSyncingAll = true;
		try {
			await ToastedFetch('/api/sync/all', 'All sources synced');
			await invalidateAll();
		} finally {
			IsSyncingAll = false;
		}
	}

	async function ResolveSources() {
		IsResolvingSources = true;
		try {
			await ToastedFetch('/api/sources/resolve', 'Source IDs resolved');
			await invalidateAll();
		} finally {
			IsResolvingSources = false;
		}
	}
</script>

<svelte:head>
	<title>Vantage - Creator Intelligence</title>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;1,9..144,300&family=DM+Sans:wght@400;500;600&display=swap"
		rel="stylesheet"
	/>
	<link
		rel="stylesheet"
		href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.31.0/dist/tabler-icons.min.css"
	/>
</svelte:head>

<nav class="Topnav">
	<button class="Wordmark" onclick={() => (ActiveView = 'Feed')}>V<em>antage</em></button>
	{#each Views as View}
		<button class:Active={ActiveView === View} class="NavLink" onclick={() => ((ActiveView = View), (IsSidebarOpen = false))}>
			{View.toLowerCase()}
			{#if View === 'Queue'}<span class="Count">{QueueState.length}</span>{/if}
		</button>
	{/each}
	<div class="NavSpacer"></div>
	<span class="RefreshTag">{LatestSync ? `${LatestSync.Platform} ${LatestSync.Status.toLowerCase()}` : 'not synced yet'}</span>
	<span class={`WorkerTag ${WorkerBadgeClass()}`} title={LocalWorker ? `${LocalWorker.Host ?? 'local'} / ${LocalWorker.Workers}` : 'No local worker heartbeat'}>
		<i class="ti ti-server-2"></i>{WorkerBadge}
	</span>
	<button class="ActorPill" onclick={() => (NeedsActor = true)}>
		<i class="ti ti-user-circle"></i>{ActorName || 'set name'}
	</button>
	<button class="SyncButton" disabled={IsSyncingAll} onclick={SyncAll}>
		<i class="ti ti-refresh"></i>{IsSyncingAll ? 'syncing' : 'sync all'}
	</button>
	<span class="LiveDot">{LiveCount} live</span>
	<span class="Avatar">YO</span>
</nav>

<div class="Shell">
	{#if IsSidebarOpen}<button class="SidebarScrim" aria-label="Close side menu" onclick={() => (IsSidebarOpen = false)}></button>{/if}
	<aside class:Open={IsSidebarOpen} class="Sidebar">
		{#each SidebarGroups as Group}
			<div class="SidebarLabel">{Group.Label}</div>
			{#each Group.Items as Item}
				<button
					class:Active={ActiveFeedFilter === Item.Filter && ActiveView === 'Feed'}
					class="SidebarItem"
					onclick={() => SetSidebarFilter(Item.Filter)}
				>
					<span><i class={`ti ${Item.Icon}`}></i>{Item.Label}</span>
					<span class="SidebarCount">{Item.Count}</span>
				</button>
			{/each}
			<div class="SidebarDivider"></div>
		{/each}
		<div class="SidebarBottom">
			<button class="SidebarItem" onclick={() => ((ActiveView = 'Accounts'), (IsSidebarOpen = false))}>
				<span><i class="ti ti-settings"></i>Settings</span>
			</button>
		</div>
	</aside>

	<main class="Main">
		{#if ActiveView === 'Feed'}
			<section class="View">
				<div class="ConnectBanner">
					<i class="ti ti-plug-connected"></i>
					<span>YouTube, TikTok, and Instagram are connected. Source tracking starts with Kick, Twitch, and YouTube.</span>
					<button onclick={() => (ActiveView = 'Accounts')}>Manage accounts</button>
				</div>

				<div class="Subheader">
					<span class="SubheaderTitle">Today's feed</span>
					{#each FeedFilters as Filter}
						<button
							class:Active={ActiveFeedFilter === Filter}
							class="Chip"
							onclick={() => (ActiveFeedFilter = Filter)}
						>
							{Filter}
						</button>
					{/each}
					<div class="SubheaderSpacer"></div>
					<div class="SearchWrap">
						<i class="ti ti-search"></i>
						<input bind:value={FeedSearch} aria-label="Search feed" placeholder="Search creator, term, campaign" />
						{#if FeedSearch}
							<button aria-label="Clear search" onclick={() => (FeedSearch = '')}>
								<i class="ti ti-x"></i>
							</button>
						{/if}
					</div>
					<button class="SidebarToggle" aria-label="Open side menu" aria-expanded={IsSidebarOpen} onclick={() => (IsSidebarOpen = true)}>
						<i class="ti ti-layout-sidebar-left-expand"></i>
					</button>
					<label class="SortControl" for="SortMode">
						<span>Sort by</span>
						<select id="SortMode" bind:value={SortMode}>
							{#each SortModes as Mode}<option>{Mode}</option>{/each}
						</select>
					</label>
				</div>
				<div class="SavedSearchRow">
					<span>saved searches</span>
					{#each SavedSearches as Search}
						<button class:Active={FeedSearch === Search.Query} onclick={() => (FeedSearch = Search.Query)}>
							{Search.Query}
						</button>
						<form method="POST" action="?/DeleteSavedSearch" use:enhance={FormFeedback('Search')}>
							<input type="hidden" name="Id" value={Search.Id} />
							<button aria-label={`Delete ${Search.Query}`}>
								<i class="ti ti-x"></i>
							</button>
						</form>
					{/each}
				</div>

				<div class="ContentPanes">
					<div class="Feed">
						<div class="LeadGrid">
							{#each LeadItems as Item}
								<div class="LeadCell">
									<button class="LeadMain" onclick={() => (SelectedCreatorName = Item.Creator)}>
										<div class="LeadMedia">
											{#if Item.ThumbnailUrl}
												<img src={Item.ThumbnailUrl} alt="" loading="lazy" />
											{:else}
												<i class={`ti ${PlatformIcon(Item.Platform)}`}></i>
											{/if}
										</div>
										<div class="Eyebrow">
											<i class={`ti ${PlatformIcon(Item.Platform)}`}></i>{Item.Platform} / {Item.Kind}
											{#if Item.Live}<span class="Tag LiveTag">live</span>{/if}
											{#if Item.Campaign !== 'Organic'}<span class="Tag CampaignTag">{Item.Campaign}</span>{/if}
										</div>
										<h2>{Item.Creator}: {Item.Title}</h2>
										<p>{Item.Metric} / {Item.Age}{Item.Velocity ? ` / ${Item.Velocity} velocity` : ''}</p>
										<div class="ScoreBar"><span style={`width:${Item.Score}%`}></span></div>
										<div class="ScoreLabel">opportunity {Item.Score} / 100</div>
									</button>
									<div class="TriageActions">
										{#each ContentStatusActions as Action}
											<button class:Active={Item.Status === Action.Status} aria-label={Action.Label} onclick={() => UpdateContentStatus(Item, Action.Status)}>
												<i class={`ti ${Action.Icon}`}></i>
											</button>
										{/each}
									</div>
								</div>
							{:else}
								<div class="EmptyState">
									<i class="ti ti-filter-off"></i>
									<span>No sources match the current filters.</span>
								</div>
							{/each}
						</div>

						<div class="FeedList">
							<div class="SectionHead">
								<span>full feed / {FeedItems.length} sources</span>
								<span>{ActiveFeedFilter}</span>
							</div>
							{#each FeedItems as Item, Index}
								<div class="FeedRow">
									<button class="FeedMain" onclick={() => (SelectedCreatorName = Item.Creator)}>
										<span class="RowNum">{Index + 1}</span>
										<span class="RowThumb">
											{#if Item.ThumbnailUrl}
												<img src={Item.ThumbnailUrl} alt="" loading="lazy" />
											{:else}
												<i class={`ti ${PlatformIcon(Item.Platform)}`}></i>
											{/if}
										</span>
										<span class="RowBody">
											<span class="RowCreator">{Item.Platform} / {Item.Creator}</span>
											<span class="RowTitle">{Item.Title}</span>
											<span class="RowMeta">
												{Item.Age} / {Item.Kind} / {Item.Metric}
												<span class="Tag">{Item.Status}</span>
												{#if LatestAction(Item.LastAction, Item.LastActionBy)}<span class="ActionTag">{LatestAction(Item.LastAction, Item.LastActionBy)}</span>{/if}
												{#if Item.Campaign !== 'Organic'}<span class="Tag CampaignTag">{Item.Campaign}</span>{/if}
											</span>
										</span>
										<span class={`RowScore ${ScoreClass(Item.Score)}`}>{Item.Score}</span>
									</button>
									{#if Item.SourceUrl}
										<a class="SourceLink" href={Item.SourceUrl} target="_blank" rel="noreferrer" aria-label={`Open ${Item.Title}`}>
											<i class="ti ti-external-link"></i>
										</a>
									{/if}
									<div class="RowTriageActions">
										{#each ContentStatusActions as Action}
											<button class:Active={Item.Status === Action.Status} aria-label={Action.Label} onclick={() => UpdateContentStatus(Item, Action.Status)}>
												<i class={`ti ${Action.Icon}`}></i>
											</button>
										{/each}
									</div>
									<form method="POST" action="?/AddContentToQueue" class="QueueSourceForm" use:enhance={FormFeedback('Queue item')}>
										<input type="hidden" name="ContentId" value={Item.Id} />
										<button aria-label={`Queue ${Item.Title}`}>
											<i class="ti ti-list-plus"></i>
										</button>
									</form>
								</div>
							{:else}
								<div class="EmptyState InlineEmpty">
									<i class="ti ti-filter-off"></i>
									<span>No feed items above score {AppSettings.MinimumScore}. Lower the minimum score or sync more sources.</span>
								</div>
							{/each}
						</div>
					</div>

					<aside class="RightPanel">
						<div class="PanelSection">
							<div class="PanelLabel">Workflow</div>
							<div class="StatGrid">
								<div><span>Clips made</span><strong>{ClippedCount}</strong></div>
								<div><span>Uploads out</span><strong>{UploadedCount}</strong></div>
								<div><span>Avg score</span><strong>{AverageScore}</strong></div>
								<div><span>In queue</span><strong>{QueueState.length}</strong></div>
							</div>
						</div>
						<div class="PanelSection">
							<div class="PanelLabel">Recent activity</div>
							<div class="ActivityList">
								{#each ActivityEvents.slice(0, 6) as Event}
									<div>
										<strong>{Event.Label}</strong>
										<span>{Event.EntityType} / {new Date(Event.CreatedAt).toLocaleString()}</span>
									</div>
								{:else}
									<div><strong>No activity yet</strong><span>Team actions will appear here.</span></div>
								{/each}
							</div>
						</div>
						<div class="PanelSection">
							<div class="PanelLabel">
								Clip queue
								<button onclick={() => (ActiveView = 'Queue')}>view all</button>
							</div>
							{#each QueueState.slice(0, 3) as Task}
								<div class="QueueCard">
									<div class="QueueCreator">{Task.Creator} / {Task.Platform}</div>
									<div class="QueueTitle">{Task.Source}</div>
									<div class="QueueTimestamp">{Task.Timestamp}</div>
									<div class="TaskTargets">
										{#each Object.entries(Task.Targets) as [Target, Done]}
											<span class:Done>{Target}{Done ? ' ok' : ''}</span>
										{/each}
									</div>
								</div>
							{:else}
								<div class="EmptyState MiniEmpty">
									<i class="ti ti-inbox"></i>
									<span>No clips queued.</span>
								</div>
							{/each}
						</div>
						<div class="RevenueBlock">
							<div class="PanelLabel">Campaign earnings</div>
							<div class="Revenue">${Earnings}</div>
							<div class="Muted">{Campaigns.length} active campaigns</div>
							<div class="ScoreBar"><span style={`width:${EarningsGoal ? Math.min(100, (Earnings / EarningsGoal) * 100) : 0}%`}></span></div>
							<div class="GoalLine"><span>${Earnings} earned</span><span>${EarningsGoal} goal</span></div>
						</div>
					</aside>
				</div>
			</section>
		{:else if ActiveView === 'Creators'}
			<section class="View">
				<div class="CreatorHeader">
					<div class="CreatorAvatar">{SelectedCreator.Initial}</div>
					<div class="CreatorMeta">
						<select bind:value={SelectedCreatorName} class="CreatorSelect" aria-label="Creator">
							{#each Creators as Creator}<option>{Creator.Name}</option>{/each}
						</select>
						<div class="CreatorPlatforms">
							{#each SelectedCreator.Platforms as Platform}
								<span><i class={`ti ${PlatformIcon(Platform)}`}></i>{Platform}</span>
							{/each}
							<span>{SelectedCreator.Campaign}</span>
						</div>
					</div>
					<div class="CreatorStats">
						<div><strong>{SelectedCreator.LiveViewers}</strong><span>live viewers</span></div>
						<div><strong>{SelectedCreator.Followers}</strong><span>followers</span></div>
						<div><strong>{SelectedCreator.AverageScore}</strong><span>avg score</span></div>
						<div><strong>{SelectedCreator.ClipsMade}</strong><span>clips made</span></div>
					</div>
					<form method="POST" action="?/DeleteCreator" class="InlineDelete HeaderDelete" use:enhance={FormFeedback('Creator')}>
						<input type="hidden" name="Name" value={SelectedCreator.Name} />
						<button aria-label={`Delete ${SelectedCreator.Name}`}>
							<i class="ti ti-trash"></i>Delete
						</button>
					</form>
				</div>
				<div class="PageScroll">
					<form method="POST" action="?/AddCreator" class="QuickForm" use:enhance={FormFeedback('Creator')}>
						<input name="Name" placeholder="Creator name" required />
						<input name="Platforms" placeholder="Platforms: Kick, Twitch" />
						<input name="Campaign" placeholder="Campaign" />
						<input name="Followers" placeholder="Followers" />
						<button class="PrimaryButton"><i class="ti ti-plus"></i>Add creator</button>
					</form>
					<form method="POST" action="?/UpdateCreator" class="QuickForm CreatorEditForm" use:enhance={FormFeedback('Creator')}>
						<input type="hidden" name="Name" value={SelectedCreator.Name} />
						<input name="Platforms" value={SelectedCreator.Platforms.join(', ')} aria-label="Platforms" />
						<input name="Campaign" value={SelectedCreator.Campaign} aria-label="Campaign" />
						<input name="LiveViewers" value={SelectedCreator.LiveViewers} aria-label="Live viewers" />
						<input name="Followers" value={SelectedCreator.Followers} aria-label="Followers" />
						<input name="AverageScore" type="number" min="0" max="100" value={SelectedCreator.AverageScore} aria-label="Average score" />
						<input name="ClipsMade" type="number" min="0" value={SelectedCreator.ClipsMade} aria-label="Clips made" />
						<button class="PrimaryButton"><i class="ti ti-device-floppy"></i>Save creator</button>
					</form>
					{#if SelectedCampaign}
						<div class="CreatorRuleSummary">
							<div class="SectionHead"><span>{SelectedCampaign.Name} rules</span><span>{SelectedCampaign.Rate}</span></div>
							<div class="CampaignRules">
								<div><span>Allowed</span><p>{SelectedCampaign.Allowed.join(', ')}</p></div>
								<div><span>Rules</span><p>{SelectedCampaign.Rules || 'No campaign rules saved.'}</p></div>
								<div><span>Hook</span><p>{SelectedCampaign.HookRules || 'No hook guidance saved.'}</p></div>
								<div><span>Banned</span><p>{SelectedCampaign.BannedTerms || 'No banned terms saved.'}</p></div>
							</div>
						</div>
					{/if}
					<div class="SectionHead"><span>Recent content</span></div>
					{#each CreatorItems as Item, Index}
						<div class="FeedRow Static">
							<span class="RowNum">{Index + 1}</span>
							<span class="RowBody">
								<span class="RowCreator">{Item.Platform} / {Item.Kind}</span>
								<span class="RowTitle">{Item.Title}</span>
								<span class="RowMeta">{Item.Age} / {Item.Metric}</span>
							</span>
							<span class={`RowScore ${ScoreClass(Item.Score)}`}>{Item.Score}</span>
						</div>
					{/each}
					<label class="NotesCard">
						<span>Notes, hooks, timestamps</span>
						<textarea
							bind:value={EditableNotes[SelectedCreator.Name]}
							onblur={() => SaveCreatorNotes(SelectedCreator.Name)}
						></textarea>
					</label>
				</div>
			</section>
		{:else if ActiveView === 'Queue'}
			<section class="View">
				<div class="Subheader">
					<span class="SubheaderTitle">Clip queue</span>
					{#each QueueFilters as Filter}
						<button
							class:Active={ActiveQueueFilter === Filter}
							class="Chip"
							onclick={() => (ActiveQueueFilter = Filter)}
						>
							{Filter}
						</button>
					{/each}
					<div class="SubheaderSpacer"></div>
				</div>
				<form method="POST" action="?/AddClipTask" class="QuickForm QueueForm" use:enhance={FormFeedback('Clip')}>
					<select name="Creator" required>
						{#each Creators as Creator}<option>{Creator.Name}</option>{/each}
					</select>
					<select name="Platform">
						<option>Kick</option><option>Twitch</option><option>YouTube</option><option>TikTok</option>
					</select>
					<input name="Source" placeholder="Source moment" required />
					<input name="SourceUrl" placeholder="Source URL" />
					<input name="Timestamp" placeholder="1:24:33" />
					<input name="Hook" placeholder="Hook idea" />
					<input name="Score" type="number" min="0" max="100" placeholder="Score" />
					<label><input name="TikTok" type="checkbox" checked />TT</label>
					<label><input name="Shorts" type="checkbox" />YT</label>
					<label><input name="Reels" type="checkbox" />IG</label>
					<input name="TikTokUrl" placeholder="TikTok URL" />
					<input name="ShortsUrl" placeholder="Shorts URL" />
					<input name="ReelsUrl" placeholder="Reels URL" />
					<button class="PrimaryButton"><i class="ti ti-plus"></i>Add clip</button>
				</form>
				<form method="POST" action="?/AddExternalMediaJob" class="QuickForm ExternalDownloadForm" use:enhance={FormFeedback('External download')}>
					<input name="SourceUrl" placeholder="Paste TikTok, Instagram, Kick, Twitch, YouTube, or other video link" required />
					<input name="VideoTitle" placeholder="Optional title" />
					<input name="Creator" placeholder="Optional creator/channel" />
					<button class="PrimaryButton"><i class="ti ti-download"></i>Add external download</button>
				</form>
				<form method="POST" action="?/AddManualMediaJob" enctype="multipart/form-data" class="ManualSourceForm" use:enhance={FormFeedback('Manual source', 'imported')}>
					<input type="hidden" name="Actor" value={ActorName} />
					<div class="SectionHead"><span>manual source fallback</span><span>restricted links, uploads, or local files</span></div>
					<input name="VideoTitle" placeholder="Title" required />
					<input name="Creator" placeholder="Creator/channel" required />
					<input name="SourceUrl" placeholder="Original source URL or manual note" />
					<select name="Platform" aria-label="Manual source platform">
						<option>Manual</option><option>TikTok</option><option>Instagram</option><option>Kick</option><option>Twitch</option><option>YouTube</option><option>Other</option>
					</select>
					<input name="Duration" placeholder="Duration, e.g. 12:34" />
					<label><span>Video file</span><input name="VideoFile" type="file" accept="video/*" /></label>
					<label><span>Audio file</span><input name="AudioFile" type="file" accept="audio/*" /></label>
					<input name="VideoPath" placeholder="Or local video path for desktop worker" />
					<input name="AudioPath" placeholder="Or local audio path" />
					<input name="TranscriptLanguage" placeholder="Transcript language, e.g. en" />
					<textarea name="TranscriptText" placeholder="Optional transcript. Timestamped lines are supported."></textarea>
					<textarea name="ManualContext" placeholder="Context, login/restriction notes, campaign rules, source details, or anything the analysis should know."></textarea>
					<button class="PrimaryButton"><i class="ti ti-upload"></i>Import manual source</button>
				</form>
				{#if ExternalMediaJobs.length}
					<div class="ExternalJobPanel">
						<div class="SectionHead"><span>external-link downloader</span><span>{ExternalMediaJobs.length} source review items</span></div>
						<div class="MediaJobList">
							{#each ExternalMediaJobs as Job}
								<article class={`MediaJobCard ${StageClass(Job.Stage)}`}>
									<div class="MediaJobMedia">
										{#if Job.ThumbnailUrl}
											<img src={Job.ThumbnailUrl} alt="" loading="lazy" />
										{:else}
											<i class={`ti ${PlatformIcon(Job.SourcePlatform as Platform) ?? 'ti-video'}`}></i>
										{/if}
									</div>
									<div class="MediaJobBody">
										<div class="MediaJobTop">
											<span>{Job.SourcePlatform}</span>
											<strong>{Job.VideoTitle}</strong>
										</div>
										<div class="MediaJobMeta">
											<span>{Job.Creator}</span>
											<span>{Job.Duration}</span>
											<span>{Job.MediaStatus}</span>
											<span>{Job.EstimatedFileSize}</span>
											<span>Priority {Job.Priority}</span>
										</div>
										<div class="JobProgress">
											<span style={`width:${Math.max(0, Math.min(100, Job.Progress))}%`}></span>
										</div>
										<div class="MediaJobStage">
											<span>{Job.Stage}</span>
											<span>{Job.Progress}%</span>
											<span>{Job.ManualReviewStatus}</span>
										</div>
										{#if Job.OutputPath}<div class="OutputPath"><i class="ti ti-folder"></i>{Job.OutputPath}</div>{/if}
										{#if Job.AudioPath}<div class="OutputPath"><i class="ti ti-volume"></i>{Job.AudioPath}</div>{/if}
										{#if Job.SourceValidationStatus}<div class="SourceValidation"><i class="ti ti-shield-check"></i>{Job.SourceValidationStatus}</div>{/if}
										{#if Job.ManualContext}<div class="ManualContext">{Job.ManualContext}</div>{/if}
										{#if IsLiveCapableJob(Job)}
											<form method="POST" action="?/ConfigureLivestreamJob" class="LiveControlForm" use:enhance={FormFeedback('Livestream')}>
												<input type="hidden" name="Id" value={Job.Id} />
												<label>
													<span>Record</span>
													<select name="LiveRecordingMode">
														<option selected={Job.LiveRecordingMode === 'record entire livestream'}>record entire livestream</option>
														<option selected={Job.LiveRecordingMode === 'begin from current moment'}>begin from current moment</option>
														<option selected={Job.LiveRecordingMode === 'chunk analysis'}>chunk analysis</option>
													</select>
												</label>
												<label><span>Chunk seconds</span><input name="LiveChunkSeconds" type="number" min="30" max="7200" value={Job.LiveChunkSeconds ?? 300} /></label>
												<label class="CheckField"><input name="LiveAnalyzeWhileRecording" type="checkbox" checked={Boolean(Job.LiveAnalyzeWhileRecording)} /> Analyze while recording</label>
												<label class="CheckField"><input name="LiveGeneratePeriodicClips" type="checkbox" checked={Boolean(Job.LiveGeneratePeriodicClips)} /> Generate clips periodically</label>
												<button><i class="ti ti-broadcast"></i>Save live plan</button>
											</form>
											<form method="POST" action="?/MarkLivestreamMoment" class="LiveMarkForm" use:enhance={FormFeedback('Live moment', 'marked')}>
												<input type="hidden" name="Id" value={Job.Id} />
												<input name="MomentTimestamp" placeholder="Timestamp or live" value="live" />
												<input name="MomentLabel" placeholder="Moment note, e.g. insane reaction" />
												<button><i class="ti ti-bookmark-plus"></i>Mark moment</button>
											</form>
											{#if LiveMoments(Job).length}
												<div class="LiveMomentList">
													{#each LiveMoments(Job) as Moment}
														<span>{Moment.Timestamp} / {Moment.Label} / {Moment.Actor}</span>
													{/each}
												</div>
											{/if}
										{/if}
										{#if Job.TranscriptText}
											<div class="TranscriptInfo">
												<span>{Job.TranscriptSource ?? 'transcript'}</span>
												<span>{Job.TranscriptModel ?? 'auto model'}</span>
												<span>{Job.TranscriptLanguage ?? 'unknown language'}</span>
												{#if Job.TranscriptConfidence}<span>{Math.round(Job.TranscriptConfidence * 100)}% confidence</span>{/if}
											</div>
											{#if Job.TranscriptTranslationText}
												<div class="TranscriptInfo">
													<span>{Job.TranscriptTranslationLanguage ?? 'translated'}</span>
													<span>{Job.TranscriptTranslationSource ?? 'translation'}</span>
												</div>
											{/if}
											<div class="TranscriptExports">
												<a href={`/api/media-jobs/${Job.Id}/transcript/txt`}><i class="ti ti-file-text"></i>TXT</a>
												<a href={`/api/media-jobs/${Job.Id}/transcript/srt`}><i class="ti ti-captions"></i>SRT</a>
												<a href={`/api/media-jobs/${Job.Id}/transcript/vtt`}><i class="ti ti-captions-filled"></i>VTT</a>
												<a href={`/api/media-jobs/${Job.Id}/transcript/json`}><i class="ti ti-braces"></i>JSON</a>
											</div>
											<pre class="TranscriptPreview">{Job.TranscriptText}</pre>
										{/if}
										{#if Job.ErrorMessage}<div class="JobError">{Job.ErrorMessage}</div>{/if}
									</div>
									<div class="MediaJobActions">
										{#if Job.ManualReviewStatus === 'Needs source review'}
											<form method="POST" action="?/ApproveMediaJobSource" use:enhance={FormFeedback('Source review')}>
												<input type="hidden" name="Id" value={Job.Id} />
												<button>Approve</button>
											</form>
										{/if}
										<form method="POST" action="?/ValidateMediaJobSource" use:enhance={FormFeedback('Source validation', 'queued')}>
											<input type="hidden" name="Id" value={Job.Id} />
											<button><i class="ti ti-shield-search"></i>Validate</button>
										</form>
										<form method="POST" action="?/UpdateMediaJobPriority" use:enhance={FormFeedback('Priority')}>
											<input type="hidden" name="Id" value={Job.Id} />
											<input type="hidden" name="Delta" value="1" />
											<button><i class="ti ti-arrow-up"></i>Priority</button>
										</form>
										<form method="POST" action="?/UpdateMediaJobPriority" use:enhance={FormFeedback('Priority')}>
											<input type="hidden" name="Id" value={Job.Id} />
											<input type="hidden" name="Delta" value="-1" />
											<button><i class="ti ti-arrow-down"></i>Priority</button>
										</form>
										<form method="POST" action="?/PauseMediaJob" use:enhance={FormFeedback('Media job')}>
											<input type="hidden" name="Id" value={Job.Id} />
											<button><i class="ti ti-player-pause"></i>Pause</button>
										</form>
										<form method="POST" action="?/ResumeMediaJob" use:enhance={FormFeedback('Media job')}>
											<input type="hidden" name="Id" value={Job.Id} />
											<button><i class="ti ti-player-play"></i>Resume</button>
										</form>
										<form method="POST" action="?/RetryMediaJob" use:enhance={FormFeedback('Media job')}>
											<input type="hidden" name="Id" value={Job.Id} />
											<button><i class="ti ti-refresh"></i>Retry</button>
										</form>
										<form method="POST" action="?/RetryTranscript" use:enhance={FormFeedback('Transcript')}>
											<input type="hidden" name="Id" value={Job.Id} />
											<input type="hidden" name="TranscriptModel" value="auto" />
											<button><i class="ti ti-captions"></i>Transcript</button>
										</form>
										<form method="POST" action="?/CancelMediaJob" use:enhance={FormFeedback('Media job')}>
											<input type="hidden" name="Id" value={Job.Id} />
											<button><i class="ti ti-x"></i>Cancel</button>
										</form>
									</div>
								</article>
							{/each}
						</div>
					</div>
				{/if}
				<div class="TableWrap">
					<table>
						<thead>
							<tr>
								<th>#</th>
								<th>Source</th>
								<th>Timestamp</th>
								<th>Hook idea</th>
								<th>Platforms</th>
								<th>Score</th>
								<th>Status</th>
								<th></th>
							</tr>
						</thead>
						<tbody>
							{#each QueueItems as Task}
								<tr>
									<td>{Task.Id}</td>
									<td>
										<div class="QueueCreator">{Task.Creator} / {Task.Platform}</div>
										<div>{Task.Source}</div>
										{#if Task.SourceUrl}
											<a class="QueueSourceLink" href={Task.SourceUrl} target="_blank" rel="noreferrer">open source</a>
										{/if}
										{#if LatestAction(Task.LastAction, Task.LastActionBy)}
											<div class="ActionLine">{LatestAction(Task.LastAction, Task.LastActionBy)}</div>
										{/if}
									</td>
									<td class="QueueTimestamp">{Task.Timestamp}</td>
									<td class="Hook">"{Task.Hook}"</td>
									<td>
										<div class="TaskTargets">
											{#each Object.entries(Task.Targets) as [Target, Done]}
												{#if UploadUrl(Task, Target)}
													<a href={UploadUrl(Task, Target)} target="_blank" rel="noreferrer">{Target}</a>
												{:else}
													<span class:Done>{Target}</span>
												{/if}
											{/each}
										</div>
									</td>
									<td><span class={`RowScore ${ScoreClass(Task.Score)}`}>{Task.Score}</span></td>
									<td>
										<select value={Task.Status} onchange={(Event) => UpdateTaskStatus(Task, Event.currentTarget.value)}>
											{#each QueueFilters.filter((Filter) => Filter !== 'All') as Status}
												<option>{Status}</option>
											{/each}
											<option>Uploading</option>
											<option>Watched</option>
											<option>To clip</option>
										</select>
									</td>
									<td>
										<div class="RowActions">
											<form method="POST" action="?/PrepareClipDownload" use:enhance={FormFeedback('Download job')}>
												<input type="hidden" name="ClipTaskId" value={Task.Id} />
												<button disabled={!Task.SourceUrl} aria-label={`Prepare download for ${Task.Source}`}>
													<i class="ti ti-download"></i>
												</button>
											</form>
											<button aria-label={`Edit clip task ${Task.Id}`} onclick={() => (EditingTaskId = EditingTaskId === Task.Id ? null : Task.Id)}>
												<i class="ti ti-edit"></i>
											</button>
											<form method="POST" action="?/DeleteClipTask" class="InlineDelete TableDelete" use:enhance={FormFeedback('Clip')}>
												<input type="hidden" name="Id" value={Task.Id} />
												<button aria-label={`Delete clip task ${Task.Id}`}><i class="ti ti-trash"></i></button>
											</form>
										</div>
									</td>
								</tr>
								{#if JobsForTask(Task).length}
									<tr class="MediaJobRow">
										<td></td>
										<td colspan="7">
											<div class="MediaJobList">
												{#each JobsForTask(Task) as Job}
													<article class={`MediaJobCard ${StageClass(Job.Stage)}`}>
														<div class="MediaJobMedia">
															{#if Job.ThumbnailUrl}
																<img src={Job.ThumbnailUrl} alt="" loading="lazy" />
															{:else}
																<i class={`ti ${PlatformIcon(Job.SourcePlatform as Platform) ?? 'ti-video'}`}></i>
															{/if}
														</div>
														<div class="MediaJobBody">
															<div class="MediaJobTop">
																<span>{Job.SourcePlatform}</span>
																<strong>{Job.VideoTitle}</strong>
															</div>
															<div class="MediaJobMeta">
																<span>{Job.Creator}</span>
																<span>{Job.Duration}</span>
																<span>{Job.MediaStatus}</span>
																<span>{Job.EstimatedFileSize}</span>
																<span>Priority {Job.Priority}</span>
															</div>
															<div class="JobProgress">
																<span style={`width:${Math.max(0, Math.min(100, Job.Progress))}%`}></span>
															</div>
															<div class="MediaJobStage">
																<span>{Job.Stage}</span>
																<span>{Job.Progress}%</span>
																<span>{Job.ManualReviewStatus}</span>
															</div>
															{#if Job.OutputPath}<div class="OutputPath"><i class="ti ti-folder"></i>{Job.OutputPath}</div>{/if}
															{#if Job.AudioPath}<div class="OutputPath"><i class="ti ti-volume"></i>{Job.AudioPath}</div>{/if}
															{#if Job.SourceValidationStatus}<div class="SourceValidation"><i class="ti ti-shield-check"></i>{Job.SourceValidationStatus}</div>{/if}
															{#if Job.ManualContext}<div class="ManualContext">{Job.ManualContext}</div>{/if}
															{#if IsLiveCapableJob(Job)}
																<form method="POST" action="?/ConfigureLivestreamJob" class="LiveControlForm" use:enhance={FormFeedback('Livestream')}>
																	<input type="hidden" name="Id" value={Job.Id} />
																	<label>
																		<span>Record</span>
																		<select name="LiveRecordingMode">
																			<option selected={Job.LiveRecordingMode === 'record entire livestream'}>record entire livestream</option>
																			<option selected={Job.LiveRecordingMode === 'begin from current moment'}>begin from current moment</option>
																			<option selected={Job.LiveRecordingMode === 'chunk analysis'}>chunk analysis</option>
																		</select>
																	</label>
																	<label><span>Chunk seconds</span><input name="LiveChunkSeconds" type="number" min="30" max="7200" value={Job.LiveChunkSeconds ?? 300} /></label>
																	<label class="CheckField"><input name="LiveAnalyzeWhileRecording" type="checkbox" checked={Boolean(Job.LiveAnalyzeWhileRecording)} /> Analyze while recording</label>
																	<label class="CheckField"><input name="LiveGeneratePeriodicClips" type="checkbox" checked={Boolean(Job.LiveGeneratePeriodicClips)} /> Generate clips periodically</label>
																	<button><i class="ti ti-broadcast"></i>Save live plan</button>
																</form>
																<form method="POST" action="?/MarkLivestreamMoment" class="LiveMarkForm" use:enhance={FormFeedback('Live moment', 'marked')}>
																	<input type="hidden" name="Id" value={Job.Id} />
																	<input name="MomentTimestamp" placeholder="Timestamp or live" value="live" />
																	<input name="MomentLabel" placeholder="Moment note, e.g. insane reaction" />
																	<button><i class="ti ti-bookmark-plus"></i>Mark moment</button>
																</form>
																{#if LiveMoments(Job).length}
																	<div class="LiveMomentList">
																		{#each LiveMoments(Job) as Moment}
																			<span>{Moment.Timestamp} / {Moment.Label} / {Moment.Actor}</span>
																		{/each}
																	</div>
																{/if}
															{/if}
															{#if Job.ErrorMessage}<div class="JobError">{Job.ErrorMessage}</div>{/if}
															{#if Job.TranscriptText}
																<div class="TranscriptInfo">
																	<span>{Job.TranscriptSource ?? 'transcript'}</span>
																	<span>{Job.TranscriptModel ?? 'auto model'}</span>
																	<span>{Job.TranscriptLanguage ?? 'unknown language'}</span>
																	{#if Job.TranscriptConfidence}<span>{Math.round(Job.TranscriptConfidence * 100)}% confidence</span>{/if}
																</div>
																{#if Job.TranscriptTranslationText}
																	<div class="TranscriptInfo">
																		<span>{Job.TranscriptTranslationLanguage ?? 'translated'}</span>
																		<span>{Job.TranscriptTranslationSource ?? 'translation'}</span>
																	</div>
																{/if}
																<div class="TranscriptExports">
																	<a href={`/api/media-jobs/${Job.Id}/transcript/txt`}><i class="ti ti-file-text"></i>TXT</a>
																	<a href={`/api/media-jobs/${Job.Id}/transcript/srt`}><i class="ti ti-captions"></i>SRT</a>
																	<a href={`/api/media-jobs/${Job.Id}/transcript/vtt`}><i class="ti ti-captions-filled"></i>VTT</a>
																	<a href={`/api/media-jobs/${Job.Id}/transcript/json`}><i class="ti ti-braces"></i>JSON</a>
																</div>
																<pre class="TranscriptPreview">{Job.TranscriptText}</pre>
															{/if}
														</div>
														<div class="MediaJobActions">
															{#if Job.ManualReviewStatus === 'Needs source review'}
																<form method="POST" action="?/ApproveMediaJobSource" use:enhance={FormFeedback('Source review')}>
																	<input type="hidden" name="Id" value={Job.Id} />
																	<button>Approve</button>
																</form>
															{/if}
															<form method="POST" action="?/ValidateMediaJobSource" use:enhance={FormFeedback('Source validation', 'queued')}>
																<input type="hidden" name="Id" value={Job.Id} />
																<button><i class="ti ti-shield-search"></i>Validate</button>
															</form>
															<form method="POST" action="?/UpdateMediaJobPriority" use:enhance={FormFeedback('Priority')}>
																<input type="hidden" name="Id" value={Job.Id} />
																<input type="hidden" name="Delta" value="1" />
																<button><i class="ti ti-arrow-up"></i>Priority</button>
															</form>
															<form method="POST" action="?/UpdateMediaJobPriority" use:enhance={FormFeedback('Priority')}>
																<input type="hidden" name="Id" value={Job.Id} />
																<input type="hidden" name="Delta" value="-1" />
																<button><i class="ti ti-arrow-down"></i>Priority</button>
															</form>
															<form method="POST" action="?/PauseMediaJob" use:enhance={FormFeedback('Media job')}>
																<input type="hidden" name="Id" value={Job.Id} />
																<button><i class="ti ti-player-pause"></i>Pause</button>
															</form>
															<form method="POST" action="?/ResumeMediaJob" use:enhance={FormFeedback('Media job')}>
																<input type="hidden" name="Id" value={Job.Id} />
																<button><i class="ti ti-player-play"></i>Resume</button>
															</form>
															<form method="POST" action="?/RetryMediaJob" use:enhance={FormFeedback('Media job')}>
																<input type="hidden" name="Id" value={Job.Id} />
																<button><i class="ti ti-refresh"></i>Retry</button>
															</form>
															<form method="POST" action="?/RetryTranscript" use:enhance={FormFeedback('Transcript')}>
																<input type="hidden" name="Id" value={Job.Id} />
																<input type="hidden" name="TranscriptModel" value="auto" />
																<button><i class="ti ti-captions"></i>Transcript</button>
															</form>
															<form method="POST" action="?/CancelMediaJob" use:enhance={FormFeedback('Media job')}>
																<input type="hidden" name="Id" value={Job.Id} />
																<button><i class="ti ti-x"></i>Cancel</button>
															</form>
														</div>
													</article>
												{/each}
											</div>
										</td>
									</tr>
								{/if}
								{#if EditingTaskId === Task.Id}
									<tr class="EditRow">
										<td></td>
										<td colspan="7">
											<form method="POST" action="?/UpdateClipTask" class="InlineEditForm" use:enhance={FormFeedback('Clip')}>
											<input type="hidden" name="Id" value={Task.Id} />
											<input name="Source" value={Task.Source} aria-label="Source" />
											<input name="SourceUrl" value={Task.SourceUrl ?? ''} aria-label="Source URL" />
											<input name="Timestamp" value={Task.Timestamp} aria-label="Timestamp" />
											<input name="Hook" value={Task.Hook} aria-label="Hook" />
											<input name="Score" type="number" min="0" max="100" value={Task.Score} aria-label="Score" />
											<select name="Status" value={Task.Status} aria-label="Status">
												<option>To upload</option><option>Editing</option><option>Done</option><option>Uploading</option><option>Watched</option><option>To clip</option>
											</select>
											<label><input name="TikTok" type="checkbox" checked={Task.Targets.TikTok} />TT</label>
											<label><input name="Shorts" type="checkbox" checked={Task.Targets.Shorts} />YT</label>
											<label><input name="Reels" type="checkbox" checked={Task.Targets.Reels} />IG</label>
											<input name="TikTokUrl" value={Task.UploadUrls.TikTok} aria-label="TikTok upload URL" />
											<input name="ShortsUrl" value={Task.UploadUrls.Shorts} aria-label="Shorts upload URL" />
											<input name="ReelsUrl" value={Task.UploadUrls.Reels} aria-label="Reels upload URL" />
											<button class="PrimaryButton"><i class="ti ti-device-floppy"></i>Save</button>
											</form>
										</td>
									</tr>
								{/if}
							{:else}
								<tr>
									<td colspan="8">
										<div class="EmptyState InlineEmpty">
											<i class="ti ti-inbox"></i>
											<span>No queue items match this filter.</span>
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>
		{:else if ActiveView === 'Best Clips'}
			<section class="View PageScroll">
				<div class="PageTitleRow">
					<div>
						<h1>Best clips cutter</h1>
						<p>Transcript-first clip discovery for queued downloads and manually reviewed sources.</p>
					</div>
				</div>
				{#if MediaJobs.length}
					<div class="ClipCutterLayout">
						<section class="ClipCutterPanel">
							<div class="SectionHead"><span>source</span><span>{MediaJobs.length} media jobs</span></div>
							<label class="StackedField">
								<span>Media job</span>
								<select bind:value={SelectedMediaJobId}>
									{#each MediaJobs as Job}
										<option value={Job.Id}>{Job.SourcePlatform} / {Job.VideoTitle}</option>
									{/each}
								</select>
							</label>
							{#if SelectedMediaJob}
								<div class="SelectedMediaJob">
									<div class="MediaJobMedia">
										{#if SelectedMediaJob.ThumbnailUrl}
											<img src={SelectedMediaJob.ThumbnailUrl} alt="" loading="lazy" />
										{:else}
											<i class={`ti ${PlatformIcon(SelectedMediaJob.SourcePlatform as Platform) ?? 'ti-video'}`}></i>
										{/if}
									</div>
									<div>
										<strong>{SelectedMediaJob.VideoTitle}</strong>
										<span>{SelectedMediaJob.Creator} / {SelectedMediaJob.MediaStatus} / {SelectedMediaJob.Stage}</span>
										{#if IsLiveCapableJob(SelectedMediaJob)}
											<div class="TranscriptInfo">
												<span>{SelectedMediaJob.LiveRecordingMode ?? 'begin from current moment'}</span>
												<span>{SelectedMediaJob.LiveChunkSeconds ?? 300}s chunks</span>
												<span>{SelectedMediaJob.LiveAnalyzeWhileRecording ? 'live analysis on' : 'live analysis off'}</span>
												<span>{LiveMoments(SelectedMediaJob).length} marked moments</span>
												{#if LiveChunkAnalysis(SelectedMediaJob)}
													<span>processed {LiveChunkAnalysis(SelectedMediaJob)?.ProcessedMomentKeys?.length ?? 0} marks</span>
													<span>chunk #{(LiveChunkAnalysis(SelectedMediaJob)?.LastChunkIndex ?? -1) + 1}</span>
												{/if}
											</div>
										{/if}
										{#if SelectedMediaJob.TranscriptText}
											<div class="TranscriptInfo">
												<span>{SelectedMediaJob.TranscriptSource ?? 'transcript'}</span>
												<span>{SelectedMediaJob.TranscriptModel ?? 'auto model'}</span>
												<span>{SelectedMediaJob.TranscriptLanguage ?? 'unknown language'}</span>
												{#if SelectedMediaJob.TranscriptConfidence}<span>{Math.round(SelectedMediaJob.TranscriptConfidence * 100)}% confidence</span>{/if}
											</div>
											<div class="TranscriptExports">
												<a href={`/api/media-jobs/${SelectedMediaJob.Id}/transcript/txt`}><i class="ti ti-file-text"></i>TXT</a>
												<a href={`/api/media-jobs/${SelectedMediaJob.Id}/transcript/srt`}><i class="ti ti-captions"></i>SRT</a>
												<a href={`/api/media-jobs/${SelectedMediaJob.Id}/transcript/vtt`}><i class="ti ti-captions-filled"></i>VTT</a>
												<a href={`/api/media-jobs/${SelectedMediaJob.Id}/transcript/json`}><i class="ti ti-braces"></i>JSON</a>
											</div>
										{/if}
									</div>
								</div>
								<form method="POST" action="?/SaveTranscript" class="TranscriptForm" use:enhance={FormFeedback('Transcript')}>
									<input type="hidden" name="MediaJobId" value={SelectedMediaJob.Id} />
									<input type="hidden" name="TranscriptFormat" value="manual" />
									<label>
										<span>Language</span>
										<input name="TranscriptLanguage" placeholder="en, es, unknown" value={SelectedMediaJob.TranscriptLanguage ?? 'unknown'} />
									</label>
									<label>
										<span>Model</span>
										<select name="TranscriptModel">
											<option selected={(SelectedMediaJob.TranscriptModel ?? 'manual') === 'manual'}>manual</option>
											<option selected={SelectedMediaJob.TranscriptModel === 'auto'}>auto</option>
											<option selected={SelectedMediaJob.TranscriptModel === 'whisper'}>whisper</option>
											<option selected={SelectedMediaJob.TranscriptModel === 'large-v3'}>large-v3</option>
											<option selected={SelectedMediaJob.TranscriptModel === 'fast'}>fast</option>
										</select>
									</label>
									<label>
										<span>Search</span>
										<input bind:value={TranscriptSearch} placeholder="Find words or phrases" />
										<small>{TranscriptMatchCount} matches</small>
									</label>
									<label class="StackedField">
										<span>Transcript</span>
										<textarea name="TranscriptText" placeholder="Paste a timestamped transcript, captions, or rough notes before analysis.">{SelectedMediaJob.TranscriptText ?? ''}</textarea>
									</label>
									<button class="PrimaryButton"><i class="ti ti-file-text"></i>Save transcript</button>
								</form>
								<form method="POST" action="?/RetryTranscript" class="TranscriptRegenerateForm" use:enhance={FormFeedback('Transcript', 'queued')}>
									<input type="hidden" name="Id" value={SelectedMediaJob.Id} />
									<label>
										<span>Regenerate with</span>
										<select name="TranscriptModel">
											<option>auto</option>
											<option>whisper</option>
											<option>large-v3</option>
											<option>fast</option>
										</select>
									</label>
									<button><i class="ti ti-refresh"></i>Regenerate transcript</button>
								</form>
								<form method="POST" action="?/SaveTranscriptTranslation" class="TranscriptForm" use:enhance={FormFeedback('Translation')}>
									<input type="hidden" name="MediaJobId" value={SelectedMediaJob.Id} />
									<label>
										<span>Translation language</span>
										<input name="TranslationLanguage" placeholder="en, es, fr" value={SelectedMediaJob.TranscriptTranslationLanguage ?? 'en'} />
									</label>
									<label class="StackedField">
										<span>Translation</span>
										<textarea name="TranslationText" placeholder="Optional translated transcript for analysis or editing handoff.">{SelectedMediaJob.TranscriptTranslationText ?? ''}</textarea>
									</label>
									<input type="hidden" name="TranslationSource" value="manual" />
									<button><i class="ti ti-language"></i>Save translation</button>
								</form>
								<form method="POST" action="?/QueueTranscriptTranslation" class="TranscriptTranslateForm" use:enhance={FormFeedback('Translation', 'queued')}>
									<input type="hidden" name="MediaJobId" value={SelectedMediaJob.Id} />
									<label>
										<span>AI translate to</span>
										<input name="TranslationLanguage" placeholder="en, es, fr" value={SelectedMediaJob.TranscriptTranslationLanguage ?? 'en'} />
									</label>
									<button><i class="ti ti-wand"></i>Queue AI translation</button>
									{#if SelectedMediaJob.TranscriptTranslationSource}
										<small>{SelectedMediaJob.TranscriptTranslationSource}{SelectedMediaJob.TranscriptTranslationUpdatedAt ? ` / ${SelectedMediaJob.TranscriptTranslationUpdatedAt}` : ''}</small>
									{/if}
								</form>
								<form method="POST" action="?/GenerateClipCandidates" class="ClipAnalysisForm" use:enhance={FormFeedback('Clip analysis', 'queued')}>
									<input type="hidden" name="MediaJobId" value={SelectedMediaJob.Id} />
									<label>
										<span>Output</span>
										<select name="ClipCountMode">
											<option>best 3 clips</option>
											<option selected>best 5 clips</option>
											<option>best 10 clips</option>
											<option value="automatic">automatically determine</option>
											<option value="custom">custom</option>
										</select>
									</label>
									<label><span>Custom</span><input name="CustomClipCount" type="number" min="1" max="30" value="5" /></label>
									<label><span>Min duration</span><input name="MinimumDuration" value="20s" /></label>
									<label><span>Max duration</span><input name="MaximumDuration" value="75s" /></label>
									<label>
										<span>Target</span>
										<select name="TargetPlatform">
											<option>TikTok</option><option>YouTube Shorts</option><option>Instagram Reels</option><option>X</option>
										</select>
									</label>
									<input name="PreferredTopics" placeholder="Preferred topics" />
									<input name="MomentsToAvoid" placeholder="Moments to avoid" />
									<input name="PreferredClipStyle" placeholder="Clip style, e.g. fast reaction, drama, payoff" value="viral clipping" />
									<label class="InlineToggle"><input type="checkbox" name="IncludeContext" checked /> Include setup</label>
									<label class="InlineToggle"><input type="checkbox" name="LoopEnding" /> Loop ending</label>
									<label class="InlineToggle"><input type="checkbox" name="PrioritizeControversy" /> Prioritize controversy</label>
									<label class="InlineToggle"><input type="checkbox" name="ProfanityAllowed" /> Profanity allowed</label>
									<label class="InlineToggle"><input type="checkbox" name="AllowOverlap" /> Allow overlap</label>
									<button class="PrimaryButton"><i class="ti ti-sparkles"></i>Queue AI analysis</button>
								</form>
								{#if SelectedAnalysisReport}
									<div class="AnalysisReportPanel">
										<div class="SectionHead">
											<span>analysis report</span>
											<a href={`/api/media-jobs/${SelectedMediaJob.Id}/analysis-report`} target="_blank" rel="noreferrer">export json</a>
										</div>
										<div class="SignalGrid">
											{#each SelectedAnalysisReport.SignalCoverage ?? [] as Signal}
												<div><strong>{Signal.Signal}</strong><span>{Signal.Status}</span></div>
											{/each}
										</div>
										<div class="StageList">
											{#each SelectedAnalysisReport.Stages ?? [] as Stage}
												<div><strong>{Stage.Name}</strong><span>{Stage.Summary}</span></div>
											{/each}
										</div>
										{#if SelectedAnalysisReport.RejectedWeaknesses?.length}
											<div class="WeaknessList">
												<strong>Why weaker moments were skipped</strong>
												{#each SelectedAnalysisReport.RejectedWeaknesses.slice(0, 4) as Weakness}
													<span>{Weakness.Reason}</span>
												{/each}
											</div>
										{/if}
									</div>
								{/if}
							{/if}
						</section>
						<section class="ClipTimelinePanel">
							<div class="SectionHead"><span>timeline selections</span><span>{SelectedClipCandidates.length} clips</span></div>
							<form method="POST" action="?/QueueClipExportBatch" class="ExportBar" use:enhance={FormFeedback('Clip exports', 'queued')}>
								<input type="hidden" name="MediaJobId" value={SelectedMediaJob.Id} />
								<label>
									<span>Preset</span>
									<select name="Preset">
										<option>TikTok</option>
										<option>Instagram Reels</option>
										<option>YouTube Shorts</option>
										<option>X</option>
										<option>standard vertical video</option>
										<option>square video</option>
										<option>horizontal video</option>
										<option selected>original aspect ratio</option>
									</select>
								</label>
								<label>
									<span>Batch</span>
									<select name="ExportMode">
										<option value="approved">approved clips only</option>
										<option value="all">all generated clips</option>
									</select>
								</label>
								<button class="PrimaryButton"><i class="ti ti-package-export"></i>Queue batch export</button>
							</form>
							<div class="ReportLinks">
								<a href={`/api/media-jobs/${SelectedMediaJob.Id}/clip-timestamps/json`}><i class="ti ti-braces"></i>Clip timestamps JSON</a>
								<a href={`/api/media-jobs/${SelectedMediaJob.Id}/clip-timestamps/csv`}><i class="ti ti-table"></i>Clip timestamps CSV</a>
							</div>
							{#if SelectedClipExports.length}
								<div class="ExportQueueStrip">
									{#each SelectedClipExports as Export}
										<a class:Disabled={Export.Status !== 'completed'} href={Export.Status === 'completed' ? `/api/clip-exports/${Export.Id}/download` : undefined}>
											<span>{Export.Preset}</span>
											<strong>{Export.Status} {Export.Progress}%</strong>
											{#if Export.FileSize}<small>{Export.FileSize}</small>{/if}
										</a>
									{/each}
								</div>
							{/if}
							<div class="VideoPreviewShell">
								{#if SourceVideoUrl(SelectedMediaJob)}
									<video
										bind:this={PreviewVideo}
										class="PreviewVideo"
										src={SourceVideoUrl(SelectedMediaJob)}
										playsinline
										onloadedmetadata={() => {
											PreviewDuration = PreviewVideo?.duration ?? 0;
											SetPreviewVolume(PreviewVolume);
											SetPreviewSpeed(PreviewSpeed);
										}}
										ontimeupdate={() => (PreviewTime = PreviewVideo?.currentTime ?? 0)}
									>
										<track kind="captions" src={SelectedMediaJob.TranscriptText ? `/api/media-jobs/${SelectedMediaJob.Id}/transcript/vtt` : 'data:text/vtt,WEBVTT'} default />
									</video>
								{:else}
									<div class="PreviewScreen">
										<i class="ti ti-video-off"></i>
										<span>Download or attach a source video to enable preview.</span>
									</div>
								{/if}
								<div class="PlayerControls">
									<button aria-label="Play preview" onclick={PlayPreview}><i class="ti ti-player-play"></i></button>
									<button aria-label="Pause preview" onclick={PausePreview}><i class="ti ti-player-pause"></i></button>
									<button aria-label="Stop preview" onclick={StopPreview}><i class="ti ti-player-stop"></i></button>
									<button aria-label="Previous frame" onclick={() => StepPreview(-1)}><i class="ti ti-player-skip-back"></i></button>
									<button aria-label="Next frame" onclick={() => StepPreview(1)}><i class="ti ti-player-skip-forward"></i></button>
									<label><i class="ti ti-volume"></i><input type="range" min="0" max="1" step="0.05" value={PreviewVolume} oninput={(Event) => SetPreviewVolume(Number(Event.currentTarget.value))} /></label>
									<label><i class="ti ti-gauge"></i><select value={PreviewSpeed} onchange={(Event) => SetPreviewSpeed(Number(Event.currentTarget.value))}>
										<option value="0.5">0.5x</option><option value="0.75">0.75x</option><option value="1">1x</option><option value="1.25">1.25x</option><option value="1.5">1.5x</option><option value="2">2x</option>
									</select></label>
									<label><i class="ti ti-zoom-in"></i><input type="range" min="1" max="4" step="0.25" bind:value={TimelineZoom} /></label>
									<span>{TimestampLabel(PreviewTime)} / {TimestampLabel(PreviewDuration)}</span>
									{#if SourceVideoUrl(SelectedMediaJob)}<a aria-label="Download original source video" href={`/api/media-jobs/${SelectedMediaJob.Id}/source?download=1`}><i class="ti ti-download"></i></a>{/if}
									<button aria-label="Fullscreen preview" onclick={FullscreenPreview}><i class="ti ti-maximize"></i></button>
								</div>
								<input class="PreviewScrubber" type="range" min="0" max={Math.max(1, PreviewDuration)} step="0.1" value={PreviewTime} oninput={(Event) => SeekPreview(Number(Event.currentTarget.value))} />
								<div class="ClipTimeline">
									{#each SelectedClipCandidates as Candidate}
										{@const Cuts = CandidateCuts(Candidate)}
										<button class="ClipRegion" onclick={() => SeekPreview(CandidateStartSeconds(Candidate))} style={`left:${CandidateLeft(Candidate)}%; width:${CandidateWidth(Candidate)}%`}>
											<span>#{Candidate.ClipNumber}</span>
											<strong>{Candidate.ViralScore}</strong>
											{#each Cuts as Cut}
												<i class="ClipCutOverlay" title={`${Cut.StartTime} - ${Cut.EndTime} / ${Cut.Label}`} style={`left:${CutLeft(Candidate, Cut)}%; width:${CutWidth(Candidate, Cut)}%`}></i>
											{/each}
										</button>
									{/each}
								</div>
								{#if SelectedClipCandidates.length}
									<div class="TimelineQuickEdit">
										{#each SelectedClipCandidates as Candidate}
											<div>
												<button class="TimelineClipJump" onclick={() => SeekPreview(CandidateStartSeconds(Candidate))}>
													<strong>#{Candidate.ClipNumber}</strong>
													<span>{Candidate.StartTime} - {Candidate.EndTime}</span>
												</button>
												<form method="POST" action="?/AdjustClipCandidateWindow" use:enhance={FormFeedback('Clip window')}>
													<input type="hidden" name="Id" value={Candidate.Id} />
													<input type="hidden" name="Operation" value="move-earlier" />
													<input type="hidden" name="Step" value="1" />
													<button aria-label={`Move clip ${Candidate.ClipNumber} earlier`}><i class="ti ti-arrow-left"></i></button>
												</form>
												<form method="POST" action="?/AdjustClipCandidateWindow" use:enhance={FormFeedback('Clip window')}>
													<input type="hidden" name="Id" value={Candidate.Id} />
													<input type="hidden" name="Operation" value="move-later" />
													<input type="hidden" name="Step" value="1" />
													<button aria-label={`Move clip ${Candidate.ClipNumber} later`}><i class="ti ti-arrow-right"></i></button>
												</form>
												<form method="POST" action="?/AdjustClipCandidateWindow" use:enhance={FormFeedback('Clip window')}>
													<input type="hidden" name="Id" value={Candidate.Id} />
													<input type="hidden" name="Operation" value="start-earlier" />
													<input type="hidden" name="Step" value="1" />
													<button aria-label={`Expand clip ${Candidate.ClipNumber} start`}><i class="ti ti-bracket"></i></button>
												</form>
												<form method="POST" action="?/AdjustClipCandidateWindow" use:enhance={FormFeedback('Clip window')}>
													<input type="hidden" name="Id" value={Candidate.Id} />
													<input type="hidden" name="Operation" value="start-later" />
													<input type="hidden" name="Step" value="1" />
													<button aria-label={`Trim clip ${Candidate.ClipNumber} start`}><i class="ti ti-bracket-off"></i></button>
												</form>
												<form method="POST" action="?/AdjustClipCandidateWindow" use:enhance={FormFeedback('Clip window')}>
													<input type="hidden" name="Id" value={Candidate.Id} />
													<input type="hidden" name="Operation" value="end-earlier" />
													<input type="hidden" name="Step" value="1" />
													<button aria-label={`Trim clip ${Candidate.ClipNumber} end`}><i class="ti ti-bracket-off"></i></button>
												</form>
												<form method="POST" action="?/AdjustClipCandidateWindow" use:enhance={FormFeedback('Clip window')}>
													<input type="hidden" name="Id" value={Candidate.Id} />
													<input type="hidden" name="Operation" value="end-later" />
													<input type="hidden" name="Step" value="1" />
													<button aria-label={`Expand clip ${Candidate.ClipNumber} end`}><i class="ti ti-bracket"></i></button>
												</form>
											</div>
										{/each}
									</div>
								{/if}
								{#if SelectedTranscriptSegments.length}
									<div class="TranscriptSyncPanel">
										<div class="TranscriptSyncHead">
											<span>synced transcript</span>
											<strong>{SelectedTranscriptSegments.filter(SegmentMatchesSearch).length} lines</strong>
										</div>
										<div class="TranscriptSyncList">
											{#each SelectedTranscriptSegments.filter(SegmentMatchesSearch).slice(0, 80) as Segment}
												<button class:Active={SegmentIsActive(Segment)} onclick={() => SeekPreview(TimestampSeconds(Segment.Start))}>
													<span>{Segment.Start}</span>
													<p>{Segment.Speaker ? `${Segment.Speaker}: ${Segment.Text.replace(`${Segment.Speaker}:`, '').trim()}` : Segment.Text}</p>
												</button>
											{/each}
										</div>
									</div>
								{/if}
							</div>
							<div class="ClipCandidateGrid">
								{#each SelectedClipCandidates as Candidate}
									{@const Preview = PreviewForCandidate(Candidate.Id)}
									{@const Cuts = CandidateCuts(Candidate)}
									<article class="ClipCandidateCard">
										<div class="CandidateTop">
											<span>Clip {Candidate.ClipNumber}</span>
											<strong>{Candidate.ViralScore}</strong>
										</div>
										<h2>{Candidate.Title || Candidate.Category}</h2>
										<div class="CandidateMiniTimeline">
											<span class="CandidateHandle StartHandle">{Candidate.StartTime}</span>
											<span class="CandidateKeepRange"></span>
											{#each Cuts as Cut}
												<span class="CandidateCutRange" title={`${Cut.StartTime} - ${Cut.EndTime} / ${Cut.Label}`} style={`left:${CutLeft(Candidate, Cut)}%; width:${CutWidth(Candidate, Cut)}%`}>
													<i class="ti ti-cut"></i>
												</span>
											{/each}
											<span class="CandidateHandle EndHandle">{Candidate.EndTime}</span>
										</div>
										<div class="CandidatePreviewAsset">
											{#if Preview?.Status === 'completed'}
												<video
													src={`/api/clip-previews/${Preview.Id}/file`}
													poster={`/api/clip-previews/${Preview.Id}/file?type=thumbnail`}
													controls
													playsinline
													preload="metadata"
												>
													<track kind="captions" src="data:text/vtt,WEBVTT" default />
												</video>
												<a href={`/api/clip-previews/${Preview.Id}/file?download=1`}><i class="ti ti-download"></i>{Preview.FileSize ?? 'Preview'}</a>
											{:else if Preview}
												<div class="PreviewPending">
													<i class={Preview.Status === 'failed' ? 'ti ti-alert-circle' : 'ti ti-loader'}></i>
													<span>{Preview.Status} {Preview.Progress}%</span>
													{#if Preview.ErrorMessage}<small>{Preview.ErrorMessage}</small>{/if}
												</div>
											{:else}
												<form method="POST" action="?/QueueClipPreview" use:enhance={FormFeedback('Clip preview', 'queued')}>
													<input type="hidden" name="ClipCandidateId" value={Candidate.Id} />
													<button><i class="ti ti-player-play"></i>Generate preview</button>
												</form>
											{/if}
										</div>
										<p>{Candidate.StartTime} - {Candidate.EndTime} / {Candidate.Duration} / {Candidate.Variant}</p>
										<div class="CaptionPanel">
											<div>
												<strong>Caption</strong>
												<span>{Candidate.CaptionStatus ?? 'not generated'}</span>
											</div>
											<form method="POST" action="?/QueueClipCaption" use:enhance={FormFeedback('Caption', 'queued')}>
												<input type="hidden" name="Id" value={Candidate.Id} />
												<select name="CaptionPlatform" aria-label={`Caption platform for clip ${Candidate.ClipNumber}`}>
													<option>TikTok</option>
													<option>YouTube Shorts</option>
													<option>Instagram Reels</option>
													<option>X</option>
												</select>
												<input name="CaptionStyle" value="short-form punchy" aria-label={`Caption style for clip ${Candidate.ClipNumber}`} />
												<button><i class="ti ti-writing"></i>Queue caption</button>
											</form>
											<form method="POST" action="?/SaveClipCaption" use:enhance={FormFeedback('Caption')}>
												<input type="hidden" name="Id" value={Candidate.Id} />
												<textarea name="CaptionText" placeholder="Generated or manual caption">{Candidate.CaptionText ?? ''}</textarea>
												<button><i class="ti ti-device-floppy"></i>Save caption</button>
											</form>
										</div>
										<div class="InternalCutsPanel">
											<div>
												<strong>Internal cuts</strong>
												<span>{Cuts.length ? `${Cuts.length} removed` : 'none'}</span>
											</div>
											{#if Cuts.length}
												<ul>
													{#each Cuts as Cut}
														<li>{Cut.StartTime} - {Cut.EndTime} / {Cut.Label}</li>
													{/each}
												</ul>
											{/if}
											<form method="POST" action="?/AddClipCandidateCut" use:enhance={FormFeedback('Internal cut')}>
												<input type="hidden" name="Id" value={Candidate.Id} />
												<input name="CutStart" placeholder="Cut start" />
												<input name="CutEnd" placeholder="Cut end" />
												<input name="CutLabel" placeholder="Reason" />
												<button><i class="ti ti-cut"></i>Add cut</button>
											</form>
											<div class="CutPresetRow">
												{#each ['first beat', 'middle beat', 'last beat'] as Preset}
													{@const Cut = PresetCut(Candidate, Preset as 'first beat' | 'middle beat' | 'last beat')}
													<form method="POST" action="?/AddClipCandidateCut" use:enhance={FormFeedback('Internal cut')}>
														<input type="hidden" name="Id" value={Candidate.Id} />
														<input type="hidden" name="CutStart" value={Cut.StartTime} />
														<input type="hidden" name="CutEnd" value={Cut.EndTime} />
														<input type="hidden" name="CutLabel" value={Cut.Label} />
														<button>{Preset}</button>
													</form>
												{/each}
											</div>
											{#if Cuts.length}
												<form method="POST" action="?/ClearClipCandidateCuts" use:enhance={FormFeedback('Internal cuts')}>
													<input type="hidden" name="Id" value={Candidate.Id} />
													<button><i class="ti ti-eraser"></i>Clear cuts</button>
												</form>
											{/if}
										</div>
										<p>{Candidate.Explanation}</p>
										<button class="PreviewCandidateButton" onclick={() => SeekPreview(CandidateStartSeconds(Candidate))}><i class="ti ti-player-play"></i>Preview this clip</button>
										<div class="CandidateScores">
											<span>Hook {Candidate.HookScore}</span>
											<span>Context {Candidate.ContextScore}</span>
											<span>Emotion {Candidate.EmotionScore}</span>
											<span>Humor {Candidate.HumorScore}</span>
											<span>Controversy {Candidate.ControversyScore}</span>
											<span>Retention {Candidate.RetentionScore}</span>
										</div>
										{#if ExportsForCandidate(Candidate.Id).length}
											<div class="CandidateExports">
												{#each ExportsForCandidate(Candidate.Id) as Export}
													<a class:Disabled={Export.Status !== 'completed'} href={Export.Status === 'completed' ? `/api/clip-exports/${Export.Id}/download` : undefined}>
														<i class="ti ti-download"></i>
														<span>{Export.Preset}</span>
														<strong>{Export.Status} {Export.Progress}%</strong>
													</a>
												{/each}
											</div>
										{/if}
										<form method="POST" action="?/UpdateClipCandidate" class="CandidateEditForm" use:enhance={FormFeedback('Clip candidate')}>
											<input type="hidden" name="Id" value={Candidate.Id} />
											<label><span>Name</span><input name="Title" value={Candidate.Title ?? `Clip ${Candidate.ClipNumber}`} /></label>
											<label><span>Start</span><input name="StartTime" value={Candidate.StartTime} /></label>
											<label><span>End</span><input name="EndTime" value={Candidate.EndTime} /></label>
											<label><span>Category</span><input name="Category" value={Candidate.Category} /></label>
											<label>
												<span>Variant</span>
												<select name="Variant">
													<option selected={Candidate.Variant === 'strongest hook'}>strongest hook</option>
													<option selected={Candidate.Variant === 'full-context version'}>full-context version</option>
													<option selected={Candidate.Variant === 'shortest version'}>shortest version</option>
													<option selected={Candidate.Variant === 'highest-retention version'}>highest-retention version</option>
													<option selected={Candidate.Variant === 'clean version'}>clean version</option>
													<option selected={Candidate.Variant === 'uncensored version'}>uncensored version</option>
													<option selected={Candidate.Variant === 'manual edit'}>manual edit</option>
												</select>
											</label>
											<label>
												<span>Status</span>
												<select name="Status">
													<option selected={Candidate.Status === 'Suggested'}>Suggested</option>
													<option selected={Candidate.Status === 'Approved'}>Approved</option>
													<option selected={Candidate.Status === 'Rejected'}>Rejected</option>
												</select>
											</label>
											<label class="CandidateWide"><span>Reason</span><textarea name="Explanation">{Candidate.Explanation}</textarea></label>
											<label class="CandidateWide"><span>Review notes</span><textarea name="ReviewNotes">{Candidate.ReviewNotes ?? ''}</textarea></label>
											<button><i class="ti ti-device-floppy"></i>Save edit</button>
										</form>
										<div class="VariantActions">
											{#each ['strongest hook', 'full-context version', 'shortest version', 'highest-retention version', 'clean version', 'uncensored version'] as Variant}
												<form method="POST" action="?/CreateClipVariant" use:enhance={FormFeedback('Clip variant', 'created')}>
													<input type="hidden" name="Id" value={Candidate.Id} />
													<input type="hidden" name="Variant" value={Variant} />
													<button>{Variant}</button>
												</form>
											{/each}
											<form method="POST" action="?/SplitClipCandidate" use:enhance={FormFeedback('Clip candidate')}>
												<input type="hidden" name="Id" value={Candidate.Id} />
												<button><i class="ti ti-columns-2"></i>Split</button>
											</form>
											<form method="POST" action="?/MergeWithPreviousClipCandidate" use:enhance={FormFeedback('Clip candidate')}>
												<input type="hidden" name="Id" value={Candidate.Id} />
												<button><i class="ti ti-arrows-join"></i>Merge previous</button>
											</form>
										</div>
										<div class="CandidateActions">
											<form method="POST" action="?/UpdateClipCandidateStatus" use:enhance={FormFeedback('Clip candidate')}>
												<input type="hidden" name="Id" value={Candidate.Id} />
												<input type="hidden" name="Status" value="Approved" />
												<button>Approve</button>
											</form>
											<form method="POST" action="?/QueueClipExport" use:enhance={FormFeedback('Clip export', 'queued')}>
												<input type="hidden" name="ClipCandidateId" value={Candidate.Id} />
												<select name="Preset" aria-label={`Export preset for clip ${Candidate.ClipNumber}`}>
													<option>TikTok</option>
													<option>Instagram Reels</option>
													<option>YouTube Shorts</option>
													<option>X</option>
													<option>standard vertical video</option>
													<option>square video</option>
													<option>horizontal video</option>
													<option selected>original aspect ratio</option>
												</select>
												<button><i class="ti ti-package-export"></i>Export</button>
											</form>
											<form method="POST" action="?/UpdateClipCandidateStatus" use:enhance={FormFeedback('Clip candidate')}>
												<input type="hidden" name="Id" value={Candidate.Id} />
												<input type="hidden" name="Status" value="Rejected" />
												<button>Reject</button>
											</form>
										</div>
									</article>
								{:else}
									<div class="EmptyState InlineEmpty">
										<i class="ti ti-sparkles"></i>
										<span>Add a transcript, then generate clip suggestions.</span>
									</div>
								{/each}
							</div>
						</section>
					</div>
				{:else}
					<div class="EmptyState">
						<i class="ti ti-download-off"></i>
						<span>Create a download/media job from Queue before using the best clips cutter.</span>
					</div>
				{/if}
			</section>
		{:else if ActiveView === 'Campaigns'}
			<section class="View PageScroll">
				<div class="PageTitleRow">
					<div>
						<h1>Campaigns</h1>
						<p>Active clipping agreements and payout tracking.</p>
					</div>
				</div>
				<form method="POST" action="?/AddCampaign" class="QuickForm" use:enhance={FormFeedback('Campaign')}>
					<input name="Name" placeholder="Campaign name" required />
					<input name="Rate" placeholder="$4 / 1k views" />
					<input name="Niche" placeholder="Niche" />
					<input name="Goal" type="number" min="1" placeholder="Goal" />
					<input name="Allowed" placeholder="TikTok, YouTube Shorts, Instagram Reels" />
					<input name="Rules" placeholder="Campaign rules" />
					<input name="HookRules" placeholder="Hook rules" />
					<input name="BannedTerms" placeholder="Banned terms" />
					<button class="PrimaryButton"><i class="ti ti-plus"></i>Add campaign</button>
				</form>
				<div class="CampaignGrid">
					{#each Campaigns as Campaign}
						<div class="CampaignCard">
							<div class="CampaignTop">
								<div>
									<h2>{Campaign.Name}</h2>
									<p>{Campaign.State}</p>
								</div>
								<strong>${Campaign.Earned}<span> earned</span></strong>
							</div>
							<div class="CampaignDetails">
								<div><span>Rate</span><b>{Campaign.Rate}</b></div>
								<div><span>Submitted</span><b>{Campaign.Submitted}</b></div>
								<div><span>Niche</span><b>{Campaign.Niche}</b></div>
							</div>
							<div class="ScoreBar"><span style={`width:${(Campaign.Earned / Campaign.Goal) * 100}%`}></span></div>
							<div class="GoalLine"><span>${Campaign.Earned} / ${Campaign.Goal}</span><span>{Math.round((Campaign.Earned / Campaign.Goal) * 100)}%</span></div>
							<div class="Allowed">
								{#each Campaign.Allowed as Platform}<span>{Platform}</span>{/each}
							</div>
							<div class="CampaignRules">
								<div><span>Rules</span><p>{Campaign.Rules || 'No campaign rules saved.'}</p></div>
								<div><span>Hook</span><p>{Campaign.HookRules || 'No hook guidance saved.'}</p></div>
								<div><span>Banned</span><p>{Campaign.BannedTerms || 'No banned terms saved.'}</p></div>
							</div>
							<form method="POST" action="?/UpdateCampaign" class="CampaignEditForm" use:enhance={FormFeedback('Campaign')}>
								<input type="hidden" name="Name" value={Campaign.Name} />
								<input name="State" value={Campaign.State} aria-label="State" />
								<input name="Rate" value={Campaign.Rate} aria-label="Rate" />
								<input name="Niche" value={Campaign.Niche} aria-label="Niche" />
								<input name="Earned" type="number" min="0" value={Campaign.Earned} aria-label="Earned" />
								<input name="Goal" type="number" min="1" value={Campaign.Goal} aria-label="Goal" />
								<input name="Submitted" type="number" min="0" value={Campaign.Submitted} aria-label="Submitted" />
								<input name="Allowed" value={Campaign.Allowed.join(', ')} aria-label="Allowed platforms" />
								<input name="Rules" value={Campaign.Rules} aria-label="Rules" />
								<input name="HookRules" value={Campaign.HookRules} aria-label="Hook rules" />
								<input name="BannedTerms" value={Campaign.BannedTerms} aria-label="Banned terms" />
								<button class="PrimaryButton"><i class="ti ti-device-floppy"></i>Save</button>
							</form>
							<form method="POST" action="?/DeleteCampaign" class="InlineDelete" use:enhance={FormFeedback('Campaign')}>
								<input type="hidden" name="Name" value={Campaign.Name} />
								<button aria-label={`Delete ${Campaign.Name}`}>
									<i class="ti ti-trash"></i>Delete
								</button>
							</form>
						</div>
					{/each}
				</div>
				<div class="MetricBand">
					<div><span>Earned</span><strong>${Earnings}</strong></div>
					<div><span>This month</span><strong>${Earnings}</strong></div>
					<div><span>Total clips</span><strong>{ClippedCount}</strong></div>
					<div><span>Total uploads</span><strong>{UploadedCount}</strong></div>
				</div>
			</section>
		{:else}
			<section class="View PageScroll">
				<div class="PageTitleRow">
					<div>
						<h1>Connected accounts</h1>
						<p>Link clipping accounts for upload tracking, and source accounts for fresh content.</p>
					</div>
				</div>
				<div class="SectionHead"><span>Your clipping platforms</span></div>
				<div class="AccountGrid">
					{#each UploadPlatformStats as Stat}
						<div class="AccountCard">
							<div class="AccountTop">
								<div class="AccountIcon"><i class={`ti ${PlatformIcon(Stat.Platform)}`}></i></div>
								<div><h2>{Stat.Platform}</h2><p>{Stat.Queued} queued targets</p></div>
							</div>
							<div class="AccountStats">
								<div><strong>{Stat.Uploads}</strong><span>uploads</span></div>
								<div><strong>{Stat.Queued}</strong><span>planned</span></div>
								<div><strong>{QueueState.length ? Math.round((Stat.Uploads / QueueState.length) * 100) : 0}%</strong><span>coverage</span></div>
							</div>
							<span class={Stat.Uploads ? 'ConnectedText' : 'Chip'}>{Stat.Uploads ? 'Tracking' : 'No uploads yet'}</span>
						</div>
					{/each}
				</div>
				<div class="SectionHead"><span>Source platforms</span></div>
				<div class="SourceActionRow">
					<span>{SourceAccounts.length} / {PlatformAccounts.length} saved source accounts</span>
					<div>
						<label class="SourceSearch">
							<i class="ti ti-search"></i>
							<input bind:value={SourceSearch} placeholder="Find source account" aria-label="Find source account" />
						</label>
						<a class="PrimaryButton" href="/api/backup/db" download><i class="ti ti-download"></i>Backup DB</a>
						<form method="POST" action="?/ImportDatabaseBackup" enctype="multipart/form-data" class="ImportBackupForm" use:enhance={FormFeedback('Database import')}>
							<label class="PrimaryButton">
								<i class="ti ti-upload"></i>Import DB
								<input name="Backup" type="file" accept=".db,.sqlite,.sqlite3,application/vnd.sqlite3" onchange={(Event) => Event.currentTarget.form?.requestSubmit()} />
							</label>
						</form>
						<button class="PrimaryButton" disabled={IsResolvingSources} onclick={ResolveSources}>
							<i class="ti ti-id"></i>{IsResolvingSources ? 'Resolving IDs' : 'Resolve source IDs'}
						</button>
					</div>
				</div>
				<div class="ApiKeyPanel">
					<div>
						<h2>API keys</h2>
						<p>Keys are stored locally in SQLite. Environment variables still override saved values.</p>
					</div>
					<form method="POST" action="?/SaveApiCredentials" class="ApiKeyForm" use:enhance={FormFeedback('API keys')}>
						{#each ApiCredentials as Credential}
							<label>
								<span>{Credential.Label}</span>
								<input name={Credential.Key} type="password" placeholder={Credential.Configured ? `Saved / ${Credential.Source} / ...${Credential.LastFour}` : 'Not set'} autocomplete="off" />
							</label>
						{/each}
						<button class="PrimaryButton"><i class="ti ti-device-floppy"></i>Save keys</button>
					</form>
					<div class="CredentialList">
						{#each ApiCredentials as Credential}
							<div>
								<span>{Credential.Label}</span>
								<strong class:Configured={Credential.Configured}>{Credential.Configured ? `${Credential.Source} / ...${Credential.LastFour}` : 'Missing'}</strong>
								<form method="POST" action="?/ClearApiCredential" use:enhance={FormFeedback('API key')}>
									<input type="hidden" name="Key" value={Credential.Key} />
									<button disabled={Credential.Source === 'Environment' || !Credential.Configured} aria-label={`Clear ${Credential.Label}`}>
										<i class="ti ti-trash"></i>
									</button>
								</form>
							</div>
						{/each}
					</div>
				</div>
				<form method="POST" action="?/AddSourceAccount" class="QuickForm SourceAccountForm" use:enhance={FormFeedback('Source account')}>
					<input name="Creator" placeholder="Creator name" required />
					<select name="Platform" required>
						<option>YouTube</option>
						<option>Twitch</option>
						<option>Kick</option>
						<option>TikTok</option>
						<option>Instagram</option>
						<option>X</option>
					</select>
					<input name="Handle" placeholder="@handle" required />
					<input name="ExternalId" placeholder="Channel/user id or manual key" required />
					<input name="SourceUrl" placeholder="Source URL optional" />
					<button class="PrimaryButton"><i class="ti ti-plus"></i>Add source</button>
				</form>
				<div class="SourceGroupList">
					{#each SourceGroups as Group}
						<section class="SourceGroup">
							<div class="SectionHead"><span>{Group.Platform}</span><span>{Group.Accounts.length} accounts</span></div>
							<div class="AccountGrid">
								{#each Group.Accounts as Account}
									<div class="AccountCard">
										<div class="AccountTop">
											<div class="AccountIcon"><i class={`ti ${PlatformIcon(Account.Platform)}`}></i></div>
											<div><h2>{Account.Creator}</h2><p>{Account.Platform} / {Account.Handle}</p></div>
										</div>
										<p class="Muted">
											{Account.LastError ?? (Account.LastSyncedAt ? `Last synced ${Account.LastSyncedAt}` : 'Ready for manual sync')}
										</p>
										<div class="SourceIdLine">
											<span>ID</span>
											<code>{Account.ExternalId}</code>
										</div>
										<form method="POST" action="?/UpdateSourceAccount" class="SourceAccountEditForm" use:enhance={FormFeedback('Source account')}>
											<input type="hidden" name="Id" value={Account.Id} />
											<input name="Creator" value={Account.Creator} aria-label="Creator" />
											<select name="Platform" value={Account.Platform} aria-label="Platform">
												<option>YouTube</option>
												<option>Twitch</option>
												<option>Kick</option>
												<option>TikTok</option>
												<option>Instagram</option>
												<option>X</option>
											</select>
											<input name="Handle" value={Account.Handle} aria-label="Handle" />
											<input name="ExternalId" value={Account.ExternalId} aria-label="External ID" />
											<input name="SourceUrl" value={Account.SourceUrl ?? ''} aria-label="Source URL" />
											<button class="PrimaryButton"><i class="ti ti-device-floppy"></i>Save</button>
										</form>
										{#if Account.Platform === 'YouTube'}
											<button class="PrimaryButton" disabled={IsSyncingYoutube} onclick={SyncYoutube}>
												<i class="ti ti-refresh"></i>{IsSyncingYoutube ? 'Syncing' : 'Sync YouTube'}
											</button>
										{:else if Account.Platform === 'Twitch'}
											<button class="PrimaryButton" disabled={IsSyncingTwitch} onclick={SyncTwitch}>
												<i class="ti ti-refresh"></i>{IsSyncingTwitch ? 'Syncing' : 'Sync Twitch'}
											</button>
										{:else if Account.Platform === 'Kick'}
											<button class="PrimaryButton" disabled={IsSyncingKick} onclick={SyncKick}>
												<i class="ti ti-refresh"></i>{IsSyncingKick ? 'Syncing' : 'Sync Kick'}
											</button>
										{:else}
											<span class={Account.Connected ? 'ConnectedText' : 'Chip'}>{Account.Connected ? 'Connected' : 'Manual'}</span>
										{/if}
										<form method="POST" action="?/DeleteSourceAccount" class="InlineDelete" use:enhance={FormFeedback('Source account')}>
											<input type="hidden" name="Id" value={Account.Id} />
											<button aria-label={`Remove ${Account.Creator} ${Account.Platform}`}>
												<i class="ti ti-trash"></i>Remove
											</button>
										</form>
									</div>
								{/each}
							</div>
						</section>
					{:else}
						<div class="EmptyState">
							<i class="ti ti-search-off"></i>
							<span>No source accounts match this search.</span>
						</div>
					{/each}
				</div>
				<div class="SectionHead"><span>Sync history</span></div>
				<div class="SyncList">
					{#each SyncRuns.slice(-5).reverse() as Run}
						<div>
							<strong>{Run.Platform} / {Run.Status}</strong>
							<span>{Run.ItemsFound} items / {Run.Message ?? 'No message'}</span>
						</div>
					{:else}
						<div><strong>No sync runs yet</strong><span>Add keys in API settings, then run sync all.</span></div>
					{/each}
				</div>
				<form method="POST" action="?/SaveAppSettings" class="PreferenceGrid" use:enhance={FormFeedback('Preferences')}>
					<label>
						<span>Niche keywords</span>
						<input name="NicheKeywords" value={AppSettings.NicheKeywords} />
					</label>
					<label>
						<span>Refresh schedule</span>
						<select name="RefreshSchedule" value={AppSettings.RefreshSchedule}>
							<option value="15">Every 15 minutes</option>
							<option value="30">Every 30 minutes</option>
							<option value="60">Every hour</option>
							<option value="180">Every 3 hours</option>
						</select>
					</label>
					<label>
						<span>Minimum opportunity score</span>
						<input name="MinimumScore" type="number" min="0" max="100" value={AppSettings.MinimumScore} />
					</label>
					{#each ScoreWeights as Weight}
						<label>
							<span>{Weight.Label} weight</span>
							<input name={Weight.Key} type="number" min="0" max="3" step="0.1" value={Weight.Value} />
						</label>
					{/each}
					<button class="PrimaryButton"><i class="ti ti-device-floppy"></i>Save preferences</button>
				</form>
			</section>
		{/if}
	</main>
</div>

{#if NeedsActor}
	<div class="ActorOverlay">
		<form class="ActorPrompt" onsubmit={(Event) => { Event.preventDefault(); SaveActor(); }}>
			<div>
				<span class="PanelLabel">Team identity</span>
				<h2>Who is using Vantage?</h2>
				<p>This name stays in this browser and labels your team actions.</p>
			</div>
			<input bind:value={ActorDraft} placeholder="Your name" maxlength="40" />
			<div class="ActorPromptActions">
				{#if ActorName}<button type="button" class="Chip" onclick={() => (NeedsActor = false)}>Cancel</button>{/if}
				<button class="PrimaryButton" disabled={!ActorDraft.trim()}><i class="ti ti-check"></i>Continue</button>
			</div>
		</form>
	</div>
{/if}

<div class="ToastStack" aria-live="polite">
	{#each Toasts as Toast}
		<div class={`Toast ${Toast.Kind}`}>{Toast.Message}</div>
	{/each}
</div>

<style>
	:global(*) {
		box-sizing: border-box;
	}

	:global(html),
	:global(body) {
		margin: 0;
		height: 100%;
	}

	:global(body) {
		--Page: #f7f5f0;
		--Surface: #eceae4;
		--Ink: #1a1916;
		--Ink2: #6a6862;
		--Ink3: #a8a59e;
		--Rule: #d8d5ce;
		--RuleSoft: #e8e5de;
		--Green: #2b5c3a;
		--GreenSoft: #eaf1ec;
		--Amber: #92520a;
		--AmberSoft: #faf2e8;
		--Blue: #1a3e6e;
		--BlueSoft: #eaf0fa;
		background: var(--Page);
		color: var(--Ink);
		font-family: 'DM Sans', sans-serif;
		font-size: 13px;
		overflow: hidden;
	}

	button,
	input,
	select,
	textarea {
		font: inherit;
	}

	button {
		color: inherit;
		cursor: pointer;
	}

	.Topnav {
		align-items: center;
		background: var(--Ink);
		display: flex;
		gap: 2px;
		height: 48px;
		padding: 0 20px;
	}

	.Wordmark {
		background: transparent;
		border: 0;
		color: var(--Page);
		font-family: 'Fraunces', serif;
		font-size: 19px;
		margin-right: 22px;
	}

	.Wordmark em {
		color: #8dbf9e;
	}

	.NavLink {
		align-items: center;
		background: transparent;
		border: 0;
		border-bottom: 2px solid transparent;
		color: #7a7870;
		display: flex;
		gap: 7px;
		height: 48px;
		padding: 0 13px;
	}

	.NavLink.Active {
		border-bottom-color: #8dbf9e;
		color: var(--Page);
	}

	.Count,
	.SidebarCount {
		background: #373530;
		border-radius: 10px;
		color: #b8b5ad;
		font-size: 10px;
		padding: 1px 6px;
	}

	.NavSpacer,
	.SubheaderSpacer {
		flex: 1;
	}

	.RefreshTag {
		color: #7a7870;
		font-size: 11px;
	}

	.WorkerTag {
		align-items: center;
		border: 1px solid #3f3c36;
		border-radius: 14px;
		color: #b8b5ad;
		display: inline-flex;
		font-size: 11px;
		gap: 5px;
		max-width: 150px;
		overflow: hidden;
		padding: 4px 9px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.WorkerTag.Online {
		background: rgba(141, 191, 158, 0.14);
		border-color: rgba(141, 191, 158, 0.38);
		color: #8dbf9e;
	}

	.WorkerTag.Fallback {
		background: rgba(213, 164, 92, 0.16);
		border-color: rgba(213, 164, 92, 0.38);
		color: #d5a45c;
	}

	.WorkerTag.Offline {
		background: #2b2925;
		color: #8b877d;
	}

	.SyncButton {
		align-items: center;
		background: #2b2925;
		border: 1px solid #3f3c36;
		border-radius: 14px;
		color: #b8b5ad;
		display: inline-flex;
		font-size: 11px;
		gap: 5px;
		padding: 4px 9px;
	}

	.SyncButton:disabled {
		cursor: wait;
		opacity: 0.65;
	}

	.ActorPill {
		align-items: center;
		background: #332f28;
		border: 1px solid #4a453b;
		border-radius: 14px;
		color: #d9d3c8;
		display: inline-flex;
		font-size: 11px;
		gap: 5px;
		padding: 4px 9px;
	}

	.LiveDot {
		background: rgba(141, 191, 158, 0.14);
		border-radius: 14px;
		color: #8dbf9e;
		font-size: 11px;
		padding: 4px 9px;
	}

	.Avatar {
		align-items: center;
		background: #3a3832;
		border-radius: 50%;
		color: var(--Page);
		display: grid;
		font-size: 10px;
		height: 28px;
		place-items: center;
		width: 28px;
	}

	.Shell {
		display: flex;
		height: calc(100vh - 48px);
	}

	.Sidebar {
		background: var(--Surface);
		border-right: 1px solid var(--Rule);
		display: flex;
		flex-direction: column;
		overflow-y: auto;
		padding: 18px 12px;
		width: 220px;
	}

	.SidebarLabel,
	.SectionHead,
	.PanelLabel {
		color: var(--Ink3);
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.SidebarItem {
		align-items: center;
		background: transparent;
		border: 0;
		border-radius: 6px;
		display: flex;
		justify-content: space-between;
		margin-top: 3px;
		padding: 8px 9px;
		text-align: left;
		width: 100%;
	}

	.SidebarItem span:first-child {
		align-items: center;
		display: flex;
		gap: 9px;
	}

	.SidebarItem.Active,
	.SidebarItem:hover {
		background: var(--Page);
	}

	.SidebarCount.Live {
		background: var(--Green);
		color: white;
	}

	.SidebarDivider {
		border-top: 1px solid var(--Rule);
		margin: 14px 0;
	}

	.SidebarBottom {
		margin-top: auto;
	}

	.Main,
	.View {
		display: flex;
		flex: 1;
		min-width: 0;
	}

	.View {
		flex-direction: column;
	}

	.ConnectBanner,
	.Subheader {
		align-items: center;
		border-bottom: 1px solid var(--Rule);
		display: flex;
		gap: 10px;
	}

	.ConnectBanner {
		background: var(--GreenSoft);
		color: var(--Green);
		font-size: 12px;
		padding: 9px 22px;
	}

	.ConnectBanner button,
	.PanelLabel button {
		background: transparent;
		border: 0;
		color: var(--Green);
		font-size: 12px;
		margin-left: auto;
	}

	.Subheader {
		background: var(--Surface);
		padding: 12px 22px;
	}

	.SubheaderTitle {
		font-family: 'Fraunces', serif;
		font-size: 18px;
		margin-right: 8px;
	}

	.Chip,
	.Subheader select,
	table select,
	.PrimaryButton,
	.ConnectedText {
		border: 1px solid var(--Rule);
		border-radius: 6px;
		padding: 5px 10px;
	}

	.Chip {
		background: var(--Page);
		color: var(--Ink2);
	}

	.Chip.Active {
		background: var(--Ink);
		border-color: var(--Ink);
		color: var(--Page);
	}

	select,
	input,
	textarea {
		background: var(--Page);
		border: 1px solid var(--Rule);
		border-radius: 6px;
		color: var(--Ink);
		padding: 6px 9px;
	}

	.SearchWrap {
		align-items: center;
		background: var(--Page);
		border: 1px solid var(--Rule);
		border-radius: 6px;
		display: flex;
		gap: 6px;
		min-width: 260px;
		padding: 0 8px;
	}

	.SearchWrap input {
		background: transparent;
		border: 0;
		flex: 1;
		min-width: 0;
		padding: 6px 0;
	}

	.SearchWrap button {
		background: transparent;
		border: 0;
		color: var(--Ink3);
		display: grid;
		padding: 0;
		place-items: center;
	}

	.SidebarToggle {
		align-items: center;
		background: var(--Page);
		border: 1px solid var(--Rule);
		border-radius: 6px;
		color: var(--Ink2);
		display: inline-flex;
		font-size: 16px;
		height: 31px;
		justify-content: center;
		width: 36px;
	}

	.SidebarToggle:hover {
		border-color: var(--Ink3);
		color: var(--Green);
	}

	.SortControl {
		align-items: center;
		display: inline-flex;
		gap: 9px;
		line-height: 1;
		white-space: nowrap;
	}

	.SortControl span {
		align-items: center;
		display: inline-flex;
		height: 31px;
	}

	.SidebarScrim {
		display: none;
	}

	.SavedSearchRow {
		align-items: center;
		background: var(--Surface);
		border-bottom: 1px solid var(--Rule);
		display: flex;
		flex-wrap: wrap;
		gap: 7px;
		padding: 8px 22px;
	}

	.SavedSearchRow span {
		color: var(--Ink3);
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.12em;
		margin-right: 4px;
		text-transform: uppercase;
	}

	.SavedSearchRow form {
		display: contents;
	}

	.SavedSearchRow button {
		background: var(--Page);
		border: 1px solid var(--Rule);
		border-radius: 6px;
		color: var(--Ink2);
		font-size: 11px;
		padding: 4px 8px;
	}

	.SavedSearchRow button.Active {
		background: var(--Ink);
		border-color: var(--Ink);
		color: var(--Page);
	}

	.ContentPanes {
		display: grid;
		flex: 1;
		grid-template-columns: minmax(0, 1fr) 320px;
		min-height: 0;
	}

	.Feed,
	.PageScroll,
	.TableWrap {
		overflow-y: auto;
		padding: 22px;
	}

	.LeadGrid {
		display: grid;
		gap: 12px;
		grid-template-columns: 1.15fr 1fr 1fr;
		margin-bottom: 18px;
	}

	.LeadCell,
	.CampaignCard,
	.AccountCard,
	.NotesCard,
	.QueueCard,
	.MetricBand > div,
	.PreferenceGrid label {
		background: var(--Page);
		border: 1px solid var(--Rule);
		border-radius: 8px;
	}

	.LeadCell {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		text-align: left;
	}

	.LeadMain {
		background: transparent;
		border: 0;
		display: block;
		flex: 1;
		padding: 18px;
		text-align: left;
		width: 100%;
	}

	.LeadMedia {
		align-items: center;
		aspect-ratio: 16 / 9;
		background: var(--RuleSoft);
		border-radius: 7px;
		color: var(--Ink3);
		display: flex;
		font-size: 34px;
		justify-content: center;
		margin: -6px -6px 14px;
		overflow: hidden;
	}

	.LeadMedia img,
	.RowThumb img {
		height: 100%;
		object-fit: cover;
		width: 100%;
	}

	.LeadCell:hover,
	.FeedRow:hover,
	.QueueCard:hover {
		border-color: var(--Ink3);
	}

	.Eyebrow,
	.RowCreator,
	.QueueCreator {
		color: var(--Ink3);
		font-size: 10px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	.Eyebrow {
		align-items: center;
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 8px;
	}

	h1,
	h2,
	p {
		margin: 0;
	}

	.LeadCell h2 {
		font-family: 'Fraunces', serif;
		font-size: 23px;
		font-weight: 400;
		line-height: 1.1;
		margin-bottom: 10px;
	}

	.LeadCell p,
	.RowMeta,
	.Muted,
	.PageTitleRow p {
		color: var(--Ink2);
		font-size: 12px;
	}

	.ScoreBar {
		background: var(--RuleSoft);
		border-radius: 3px;
		height: 5px;
		margin-top: 13px;
		overflow: hidden;
	}

	.ScoreBar span {
		background: var(--Green);
		display: block;
		height: 100%;
	}

	.ScoreLabel,
	.GoalLine {
		color: var(--Ink3);
		display: flex;
		font-size: 10px;
		justify-content: space-between;
		margin-top: 6px;
		text-transform: uppercase;
	}

	.FeedList,
	.PanelSection,
	.RevenueBlock {
		background: var(--Surface);
		border: 1px solid var(--Rule);
		border-radius: 8px;
	}

	.SectionHead {
		align-items: center;
		display: flex;
		justify-content: space-between;
		margin-bottom: 12px;
	}

	.FeedList .SectionHead {
		border-bottom: 1px solid var(--Rule);
		margin: 0;
		padding: 13px 18px;
	}

	.FeedRow {
		align-items: flex-start;
		background: transparent;
		border: 0;
		border-bottom: 1px solid var(--RuleSoft);
		display: flex;
		width: 100%;
	}

	.FeedMain {
		align-items: flex-start;
		background: transparent;
		border: 0;
		display: flex;
		flex: 1;
		gap: 12px;
		min-width: 0;
		padding: 12px 18px;
		text-align: left;
	}

	.RowThumb {
		align-items: center;
		aspect-ratio: 16 / 9;
		background: var(--RuleSoft);
		border-radius: 6px;
		color: var(--Ink3);
		display: flex;
		flex: 0 0 96px;
		font-size: 22px;
		justify-content: center;
		overflow: hidden;
	}

	.SourceLink {
		align-items: center;
		align-self: stretch;
		border-left: 1px solid var(--RuleSoft);
		color: var(--Ink3);
		display: flex;
		justify-content: center;
		min-width: 42px;
		text-decoration: none;
	}

	.RowTriageActions {
		align-self: stretch;
		border-left: 1px solid var(--RuleSoft);
		display: flex;
	}

	.TriageActions {
		border-top: 1px solid var(--RuleSoft);
		display: grid;
		grid-template-columns: repeat(3, 1fr);
	}

	.TriageActions button,
	.RowTriageActions button {
		background: transparent;
		border: 0;
		color: var(--Ink3);
		display: grid;
		place-items: center;
	}

	.TriageActions button {
		min-height: 38px;
	}

	.RowTriageActions button {
		min-width: 34px;
	}

	.TriageActions button + button,
	.RowTriageActions button + button {
		border-left: 1px solid var(--RuleSoft);
	}

	.TriageActions button:hover,
	.RowTriageActions button:hover,
	.TriageActions button.Active,
	.RowTriageActions button.Active {
		background: var(--Page);
		color: var(--Green);
	}

	.QueueSourceForm {
		align-self: stretch;
		display: flex;
	}

	.QueueSourceForm button {
		background: transparent;
		border: 0;
		border-left: 1px solid var(--RuleSoft);
		color: var(--Ink3);
		min-width: 42px;
	}

	.SourceLink:hover,
	.QueueSourceForm button:hover {
		background: var(--Page);
		color: var(--Ink);
	}

	.QueueSourceLink {
		color: var(--Green);
		display: inline-block;
		font-size: 11px;
		margin-top: 4px;
		text-decoration: none;
	}

	.SourceIdLine {
		align-items: center;
		background: var(--RuleSoft);
		border-radius: 6px;
		display: flex;
		gap: 8px;
		margin: 10px 0;
		padding: 7px 9px;
	}

	.SourceIdLine span {
		color: var(--Ink3);
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	.SourceIdLine code {
		color: var(--Ink2);
		font-family: 'DM Sans', sans-serif;
		font-size: 11px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.SourceAccountEditForm {
		display: grid;
		gap: 7px;
		margin: 10px 0 12px;
	}

	.SourceAccountEditForm input,
	.SourceAccountEditForm select {
		min-width: 0;
		width: 100%;
	}

	.SourceAccountEditForm button {
		justify-content: center;
	}

	.ActorOverlay {
		align-items: center;
		background: rgba(26, 25, 22, 0.42);
		display: grid;
		inset: 0;
		place-items: center;
		position: fixed;
		z-index: 30;
	}

	.ActorPrompt {
		background: var(--Page);
		border: 1px solid var(--Rule);
		border-radius: 8px;
		box-shadow: 0 24px 70px rgba(26, 25, 22, 0.28);
		display: grid;
		gap: 14px;
		padding: 18px;
		width: min(380px, calc(100vw - 32px));
	}

	.ActorPrompt h2 {
		font-family: 'Fraunces', serif;
		font-size: 24px;
		font-weight: 400;
		margin-top: 5px;
	}

	.ActorPrompt p {
		color: var(--Ink2);
		font-size: 12px;
		margin-top: 5px;
	}

	.ActorPromptActions {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
	}

	.ToastStack {
		display: grid;
		gap: 8px;
		position: fixed;
		right: 18px;
		top: 62px;
		width: min(320px, calc(100vw - 36px));
		z-index: 20;
	}

	.Toast {
		background: var(--Ink);
		border: 1px solid #3f3c36;
		border-radius: 8px;
		box-shadow: 0 12px 30px rgba(26, 25, 22, 0.18);
		color: var(--Page);
		font-weight: 600;
		padding: 10px 12px;
	}

	.Toast.Success {
		border-color: #8dbf9e;
	}

	.Toast.Error {
		border-color: #d88989;
	}

	.Toast.Info {
		border-color: #8aa5cf;
	}

	.FeedRow.Static {
		background: var(--Page);
		border: 1px solid var(--RuleSoft);
		border-radius: 8px;
		gap: 12px;
		margin-bottom: 8px;
		padding: 12px 18px;
	}

	.RowNum,
	.QueueTimestamp {
		color: var(--Ink3);
		font-family: 'Fraunces', serif;
		font-style: italic;
	}

	.RowNum {
		font-size: 21px;
		width: 24px;
	}

	.RowBody {
		display: grid;
		flex: 1;
		gap: 4px;
		min-width: 0;
	}

	.RowTitle {
		font-size: 14px;
	}

	.RowScore {
		align-items: center;
		background: var(--RuleSoft);
		border-radius: 50%;
		display: grid;
		font-family: 'Fraunces', serif;
		height: 34px;
		place-items: center;
		width: 34px;
	}

	.RowScore.High {
		background: var(--Green);
		color: white;
	}

	.RowScore.Medium {
		background: var(--AmberSoft);
		color: var(--Amber);
	}

	.Tag,
	.ActionTag,
	.Allowed span,
	.TaskTargets span,
	.CreatorPlatforms span {
		background: var(--RuleSoft);
		border-radius: 4px;
		color: var(--Ink2);
		display: inline-flex;
		font-size: 10px;
		margin-left: 5px;
		padding: 2px 6px;
		text-transform: uppercase;
	}

	.LiveTag {
		background: var(--Green);
		color: white;
	}

	.CampaignTag {
		background: var(--BlueSoft);
		color: var(--Blue);
	}

	.ActionTag {
		background: var(--GreenSoft);
		color: var(--Green);
	}

	.RightPanel {
		background: var(--Surface);
		border-left: 1px solid var(--Rule);
		overflow-y: auto;
		padding: 18px;
	}

	.PanelSection,
	.RevenueBlock {
		margin-bottom: 14px;
		padding: 15px;
	}

	.ActivityList {
		display: grid;
		gap: 9px;
		margin-top: 12px;
	}

	.ActivityList div {
		border-top: 1px solid var(--RuleSoft);
		display: grid;
		gap: 3px;
		padding-top: 9px;
	}

	.ActivityList strong {
		font-size: 12px;
	}

	.ActivityList span,
	.ActionLine {
		color: var(--Ink3);
		font-size: 10px;
		text-transform: uppercase;
	}

	.ActionLine {
		margin-top: 5px;
	}

	.StatGrid,
	.CampaignDetails,
	.AccountStats,
	.MetricBand {
		display: grid;
		gap: 10px;
	}

	.StatGrid {
		grid-template-columns: 1fr 1fr;
		margin-top: 12px;
	}

	.StatGrid div,
	.CampaignDetails div {
		border-top: 1px solid var(--RuleSoft);
		padding-top: 9px;
	}

	.StatGrid span,
	.CampaignDetails span,
	.AccountStats span,
	.MetricBand span,
	.PreferenceGrid span {
		color: var(--Ink3);
		display: block;
		font-size: 10px;
		text-transform: uppercase;
	}

	.StatGrid strong,
	.Revenue,
	.MetricBand strong {
		font-family: 'Fraunces', serif;
		font-size: 24px;
		font-weight: 400;
	}

	.QueueCard {
		margin-top: 10px;
		padding: 12px;
	}

	.QueueTitle {
		margin: 4px 0;
	}

	.TaskTargets {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 8px;
	}

	.TaskTargets span {
		margin: 0;
	}

	.TaskTargets span.Done {
		background: var(--GreenSoft);
		color: var(--Green);
	}

	.TaskTargets a {
		background: var(--BlueSoft);
		border-radius: 4px;
		color: var(--Blue);
		display: inline-flex;
		font-size: 10px;
		margin: 0;
		padding: 2px 6px;
		text-decoration: none;
		text-transform: uppercase;
	}

	.CreatorHeader {
		align-items: center;
		background: var(--Surface);
		border-bottom: 1px solid var(--Rule);
		display: flex;
		gap: 16px;
		padding: 24px 40px;
	}

	.CreatorAvatar {
		background: var(--Ink);
		border-radius: 12px;
		color: var(--Page);
		display: grid;
		font-family: 'Fraunces', serif;
		font-size: 24px;
		height: 54px;
		place-items: center;
		width: 54px;
	}

	.CreatorMeta {
		flex: 1;
	}

	.CreatorSelect {
		border: 0;
		font-family: 'Fraunces', serif;
		font-size: 24px;
		padding-left: 0;
	}

	.CreatorPlatforms {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 8px;
	}

	.CreatorStats {
		display: flex;
		gap: 22px;
	}

	.CreatorStats strong {
		display: block;
		font-family: 'Fraunces', serif;
		font-size: 20px;
	}

	.CreatorStats span {
		color: var(--Ink3);
		font-size: 10px;
		text-transform: uppercase;
	}

	.NotesCard {
		display: grid;
		gap: 10px;
		margin-top: 18px;
		padding: 16px;
	}

	.CreatorRuleSummary,
	.SourceGroup {
		background: var(--Surface);
		border: 1px solid var(--Rule);
		border-radius: 8px;
		margin-bottom: 18px;
		padding: 14px;
	}

	.SourceGroupList {
		display: grid;
		gap: 18px;
	}

	.QuickForm {
		background: var(--Surface);
		border: 1px solid var(--Rule);
		border-radius: 8px;
		display: grid;
		gap: 8px;
		grid-template-columns: repeat(4, minmax(0, 1fr)) auto;
		margin-bottom: 18px;
		padding: 12px;
	}

	.QuickForm.QueueForm {
		border-bottom: 1px solid var(--Rule);
		border-left: 0;
		border-radius: 0;
		border-right: 0;
		grid-template-columns: 140px 110px minmax(180px, 1.2fr) minmax(160px, 1fr) 90px minmax(160px, 1fr) 76px repeat(3, auto) repeat(3, minmax(130px, 1fr)) auto;
		margin: 0;
	}

	.ExternalDownloadForm {
		border-left: 0;
		border-radius: 0;
		border-right: 0;
		grid-template-columns: minmax(220px, 1.8fr) minmax(160px, 1fr) minmax(140px, 0.9fr) auto;
		margin: 0;
	}

	.ManualSourceForm {
		background: var(--Surface);
		border-bottom: 1px solid var(--Rule);
		display: grid;
		gap: 10px;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		padding: 12px 14px;
	}

	.ManualSourceForm .SectionHead,
	.ManualSourceForm textarea,
	.ManualSourceForm .PrimaryButton {
		grid-column: 1 / -1;
	}

	.ManualSourceForm label {
		display: grid;
		gap: 5px;
	}

	.ManualSourceForm label span {
		color: var(--Ink3);
		font-size: 10px;
		text-transform: uppercase;
	}

	.ManualSourceForm textarea {
		min-height: 86px;
		resize: vertical;
	}

	.ExternalJobPanel {
		background: color-mix(in srgb, var(--Surface) 72%, var(--Page));
		border-bottom: 1px solid var(--Rule);
		padding: 12px 14px;
	}

	.QuickForm.SourceAccountForm {
		grid-template-columns: 1fr 120px 150px minmax(180px, 1fr) minmax(180px, 1fr) auto;
	}

	.QuickForm.CreatorEditForm {
		grid-template-columns: repeat(6, minmax(0, 1fr)) auto;
	}

	.QuickForm label {
		align-items: center;
		color: var(--Ink2);
		display: inline-flex;
		font-size: 11px;
		gap: 4px;
		white-space: nowrap;
	}

	.NotesCard span {
		color: var(--Ink3);
		font-size: 10px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.NotesCard textarea {
		min-height: 120px;
		resize: vertical;
	}

	.TableWrap {
		padding: 0;
	}

	table {
		border-collapse: collapse;
		width: 100%;
	}

	th,
	td {
		border-bottom: 1px solid var(--RuleSoft);
		padding: 12px 16px;
		text-align: left;
		vertical-align: top;
	}

	th {
		background: var(--Surface);
		color: var(--Ink3);
		font-size: 10px;
		letter-spacing: 0.12em;
		position: sticky;
		text-transform: uppercase;
		top: 0;
	}

	.EditRow td {
		background: var(--Surface);
		padding-bottom: 16px;
		padding-top: 0;
	}

	.RowActions {
		align-items: center;
		display: flex;
		gap: 6px;
	}

	.RowActions form {
		display: contents;
	}

	.RowActions button {
		background: var(--Page);
		border: 1px solid var(--Rule);
		border-radius: 6px;
		color: var(--Ink2);
		display: grid;
		height: 30px;
		place-items: center;
		width: 30px;
	}

	.MediaJobRow td {
		background: color-mix(in srgb, var(--Surface) 72%, var(--Page));
	}

	.MediaJobList {
		display: grid;
		gap: 10px;
	}

	.MediaJobCard {
		align-items: stretch;
		background: var(--Page);
		border: 1px solid var(--Rule);
		border-left: 4px solid var(--Ink3);
		border-radius: 8px;
		display: grid;
		gap: 12px;
		grid-template-columns: 116px minmax(0, 1fr) auto;
		padding: 10px;
	}

	.MediaJobCard.requires-manual-review {
		border-left-color: var(--Amber);
	}

	.MediaJobCard.failed {
		border-left-color: #9b3328;
	}

	.MediaJobCard.completed,
	.MediaJobCard.ready-for-review {
		border-left-color: var(--Green);
	}

	.MediaJobMedia {
		align-items: center;
		aspect-ratio: 16 / 9;
		background: var(--RuleSoft);
		border-radius: 6px;
		color: var(--Ink3);
		display: grid;
		font-size: 24px;
		overflow: hidden;
		place-items: center;
	}

	.MediaJobMedia img {
		height: 100%;
		object-fit: cover;
		width: 100%;
	}

	.MediaJobBody {
		display: grid;
		gap: 7px;
		min-width: 0;
	}

	.MediaJobTop {
		display: grid;
		gap: 2px;
	}

	.MediaJobTop span,
	.MediaJobMeta,
	.MediaJobStage {
		color: var(--Ink3);
		font-size: 10px;
		text-transform: uppercase;
	}

	.MediaJobTop strong {
		font-size: 13px;
		overflow-wrap: anywhere;
	}

	.MediaJobMeta,
	.MediaJobStage {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.JobProgress {
		background: var(--RuleSoft);
		border-radius: 999px;
		height: 6px;
		overflow: hidden;
	}

	.JobProgress span {
		background: var(--Green);
		display: block;
		height: 100%;
	}

	.JobError {
		background: #fff1ee;
		border: 1px solid #e6b7ae;
		border-radius: 6px;
		color: #8c2a1e;
		font-size: 12px;
		padding: 7px 9px;
	}

	.OutputPath {
		align-items: center;
		background: var(--GreenSoft);
		border: 1px solid #b0d0bc;
		border-radius: 6px;
		color: var(--Green);
		display: flex;
		font-size: 11px;
		gap: 6px;
		overflow-wrap: anywhere;
		padding: 7px 9px;
	}

	.SourceValidation,
	.ManualContext {
		align-items: center;
		background: var(--Surface);
		border: 1px solid var(--RuleSoft);
		border-radius: 6px;
		color: var(--Ink2);
		display: flex;
		font-size: 11px;
		gap: 6px;
		overflow-wrap: anywhere;
		padding: 7px 9px;
	}

	.ManualContext {
		align-items: flex-start;
		white-space: pre-wrap;
	}

	.LiveControlForm,
	.LiveMarkForm {
		background: color-mix(in srgb, var(--GreenSoft) 52%, var(--Surface));
		border: 1px solid #b0d0bc;
		border-radius: 6px;
		display: grid;
		gap: 8px;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		padding: 8px;
	}

	.LiveControlForm label,
	.LiveMarkForm label {
		display: grid;
		gap: 4px;
	}

	.LiveControlForm span {
		color: var(--Ink3);
		font-size: 10px;
		text-transform: uppercase;
	}

	.LiveControlForm button,
	.LiveMarkForm button {
		grid-column: 1 / -1;
	}

	.CheckField {
		align-items: center !important;
		display: flex !important;
		font-size: 12px;
		gap: 6px !important;
	}

	.LiveMomentList {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.LiveMomentList span {
		background: var(--Ink);
		border-radius: 999px;
		color: var(--Page);
		font-size: 11px;
		padding: 5px 8px;
	}

	.TranscriptInfo,
	.TranscriptExports {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.TranscriptInfo span,
	.TranscriptExports a {
		align-items: center;
		background: var(--Surface);
		border: 1px solid var(--RuleSoft);
		border-radius: 999px;
		color: var(--Ink2);
		display: inline-flex;
		font-size: 11px;
		gap: 4px;
		padding: 4px 7px;
		text-decoration: none;
	}

	.TranscriptExports a:hover {
		border-color: var(--Green);
		color: var(--Green);
	}

	.TranscriptPreview {
		background: var(--Surface);
		border: 1px solid var(--RuleSoft);
		border-radius: 6px;
		color: var(--Ink2);
		font: inherit;
		font-size: 12px;
		margin: 0;
		max-height: 110px;
		overflow: auto;
		padding: 8px;
		white-space: pre-wrap;
	}

	.MediaJobActions {
		align-content: start;
		display: grid;
		gap: 6px;
		min-width: 92px;
	}

	.MediaJobActions button {
		background: var(--Surface);
		border: 1px solid var(--Rule);
		border-radius: 6px;
		color: var(--Ink2);
		font-size: 12px;
		padding: 6px 8px;
		width: 100%;
	}

	.MediaJobActions button:hover {
		border-color: var(--Ink3);
		color: var(--Green);
	}

	.ClipCutterLayout {
		display: grid;
		gap: 14px;
		grid-template-columns: minmax(280px, 0.8fr) minmax(0, 1.2fr);
	}

	.ClipCutterPanel,
	.ClipTimelinePanel {
		background: var(--Surface);
		border: 1px solid var(--Rule);
		border-radius: 8px;
		display: grid;
		gap: 12px;
		padding: 14px;
	}

	.StackedField,
	.TranscriptForm,
	.TranscriptTranslateForm,
	.ClipAnalysisForm {
		display: grid;
		gap: 8px;
	}

	.StackedField span,
	.ClipAnalysisForm span {
		color: var(--Ink3);
		font-size: 10px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.SelectedMediaJob {
		align-items: center;
		background: var(--Page);
		border: 1px solid var(--RuleSoft);
		border-radius: 8px;
		display: grid;
		gap: 12px;
		grid-template-columns: 120px minmax(0, 1fr);
		padding: 10px;
	}

	.SelectedMediaJob div:last-child {
		display: grid;
		gap: 4px;
		min-width: 0;
	}

	.SelectedMediaJob span {
		color: var(--Ink3);
		font-size: 11px;
		text-transform: uppercase;
	}

	.TranscriptForm textarea {
		min-height: 220px;
		resize: vertical;
	}

	.TranscriptRegenerateForm,
	.TranscriptTranslateForm {
		align-items: end;
		background: var(--GreenSoft);
		border: 1px solid #b0d0bc;
		border-radius: 8px;
		display: grid;
		gap: 8px;
		grid-template-columns: minmax(160px, 1fr) auto;
		padding: 10px;
	}

	.TranscriptRegenerateForm label,
	.TranscriptTranslateForm label {
		display: grid;
		gap: 5px;
	}

	.TranscriptRegenerateForm span,
	.TranscriptTranslateForm span {
		color: var(--Green);
		font-size: 10px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	.TranscriptTranslateForm small {
		color: var(--Ink3);
		grid-column: 1 / -1;
	}

	.ClipAnalysisForm {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.ClipAnalysisForm .PrimaryButton,
	.ClipAnalysisForm input[name='PreferredTopics'],
	.ClipAnalysisForm input[name='MomentsToAvoid'],
	.ClipAnalysisForm input[name='PreferredClipStyle'] {
		grid-column: 1 / -1;
	}

	.InlineToggle {
		align-items: center;
		color: var(--Ink2);
		display: flex;
		font-size: 12px;
		gap: 7px;
	}

	.InlineToggle input {
		accent-color: var(--Green);
	}

	.AnalysisReportPanel {
		background: var(--Page);
		border: 1px solid var(--RuleSoft);
		border-radius: 8px;
		display: grid;
		gap: 10px;
		padding: 10px;
	}

	.AnalysisReportPanel .SectionHead a {
		color: var(--Green);
		text-decoration: none;
	}

	.SignalGrid {
		display: grid;
		gap: 6px;
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.SignalGrid div,
	.StageList div,
	.WeaknessList {
		background: var(--Surface);
		border: 1px solid var(--RuleSoft);
		border-radius: 6px;
		display: grid;
		gap: 3px;
		padding: 8px;
	}

	.SignalGrid strong,
	.StageList strong,
	.WeaknessList strong {
		font-size: 12px;
	}

	.SignalGrid span,
	.StageList span,
	.WeaknessList span {
		color: var(--Ink3);
		font-size: 11px;
	}

	.StageList,
	.WeaknessList {
		display: grid;
		gap: 6px;
	}

	.VideoPreviewShell {
		background: var(--Ink);
		border-radius: 8px;
		color: var(--Page);
		overflow: hidden;
	}

	.PreviewVideo {
		aspect-ratio: 16 / 9;
		background: #050505;
		display: block;
		width: 100%;
	}

	.PreviewScrubber {
		accent-color: var(--Green);
		display: block;
		width: 100%;
	}

	.ExportBar {
		align-items: end;
		display: grid;
		gap: 10px;
		grid-template-columns: minmax(150px, 1fr) minmax(150px, 1fr) auto;
	}

	.ExportQueueStrip,
	.CandidateExports,
	.ReportLinks {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.ExportQueueStrip a,
	.CandidateExports a,
	.ReportLinks a {
		align-items: center;
		background: var(--GreenSoft);
		border: 1px solid #b0d0bc;
		border-radius: 999px;
		color: var(--Green);
		display: inline-flex;
		font-size: 11px;
		gap: 5px;
		padding: 5px 8px;
		text-decoration: none;
	}

	.ExportQueueStrip a.Disabled,
	.CandidateExports a.Disabled {
		background: var(--Surface);
		border-color: var(--RuleSoft);
		color: var(--Ink3);
		pointer-events: none;
	}

	.PreviewScreen {
		align-items: center;
		aspect-ratio: 16 / 9;
		display: grid;
		gap: 8px;
		place-items: center;
	}

	.PreviewScreen i {
		font-size: 42px;
	}

	.PlayerControls {
		align-items: center;
		background: #25231f;
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		padding: 8px 10px;
	}

	.PlayerControls button,
	.PlayerControls a {
		background: #34312b;
		border: 1px solid #48443b;
		border-radius: 6px;
		color: var(--Page);
		display: grid;
		height: 30px;
		place-items: center;
		text-decoration: none;
		width: 32px;
	}

	.PlayerControls label {
		align-items: center;
		color: #b8b5ad;
		display: flex;
		font-size: 12px;
		gap: 5px;
	}

	.PlayerControls input[type='range'] {
		accent-color: var(--Green);
		max-width: 110px;
	}

	.PlayerControls select {
		background: #34312b;
		border-color: #48443b;
		color: var(--Page);
		height: 30px;
		padding: 0 6px;
	}

	.PlayerControls span {
		color: #b8b5ad;
		font-size: 12px;
		margin-left: auto;
	}

	.ClipTimeline {
		background: #181713;
		height: 72px;
		position: relative;
	}

	.ClipRegion {
		background: var(--Green);
		border: 1px solid #8dbf9e;
		border-radius: 5px;
		color: white;
		display: grid;
		height: 42px;
		overflow: hidden;
		padding: 4px;
		position: absolute;
		top: 15px;
	}

	.ClipRegion span {
		font-size: 10px;
	}

	.ClipCutOverlay {
		background: repeating-linear-gradient(135deg, rgba(0, 0, 0, 0.5) 0 4px, rgba(255, 255, 255, 0.22) 4px 7px);
		bottom: 0;
		pointer-events: none;
		position: absolute;
		top: 0;
	}

	.TimelineQuickEdit {
		background: #201e1a;
		border-top: 1px solid #37342d;
		display: grid;
		gap: 1px;
		max-height: 210px;
		overflow: auto;
	}

	.TimelineQuickEdit > div {
		align-items: center;
		border-bottom: 1px solid #2f2c26;
		display: grid;
		gap: 6px;
		grid-template-columns: minmax(120px, 1fr) repeat(6, 32px);
		padding: 7px 10px;
	}

	.TimelineQuickEdit button {
		background: #34312b;
		border: 1px solid #48443b;
		border-radius: 6px;
		color: var(--Page);
		display: grid;
		height: 30px;
		place-items: center;
		width: 32px;
	}

	.TimelineQuickEdit button:hover {
		background: #2e3a2f;
		border-color: #6c9b79;
	}

	.TimelineQuickEdit .TimelineClipJump {
		align-items: center;
		display: flex;
		gap: 8px;
		justify-content: flex-start;
		padding: 0 8px;
		width: 100%;
	}

	.TimelineClipJump strong {
		color: #93b79e;
		font-size: 12px;
	}

	.TimelineClipJump span {
		color: #e6e1d8;
		font-size: 12px;
	}

	.TranscriptSyncPanel {
		background: #201e1a;
		border-top: 1px solid #37342d;
		display: grid;
		gap: 1px;
		max-height: 240px;
		overflow: hidden;
	}

	.TranscriptSyncHead {
		align-items: center;
		background: #25231f;
		display: flex;
		justify-content: space-between;
		padding: 8px 10px;
	}

	.TranscriptSyncHead span,
	.TranscriptSyncHead strong {
		color: #b8b5ad;
		font-size: 10px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	.TranscriptSyncList {
		display: grid;
		max-height: 196px;
		overflow: auto;
	}

	.TranscriptSyncList button {
		background: transparent;
		border: 0;
		border-bottom: 1px solid #2f2c26;
		color: var(--Page);
		display: grid;
		gap: 6px;
		grid-template-columns: 54px minmax(0, 1fr);
		padding: 8px 10px;
		text-align: left;
	}

	.TranscriptSyncList button:hover,
	.TranscriptSyncList button.Active {
		background: #2e3a2f;
	}

	.TranscriptSyncList span {
		color: #93b79e;
		font-size: 11px;
	}

	.TranscriptSyncList p {
		color: #e6e1d8;
		font-size: 12px;
		line-height: 1.35;
		margin: 0;
	}

	.PreviewCandidateButton {
		align-items: center;
		background: var(--GreenSoft);
		border: 1px solid #b0d0bc;
		border-radius: 6px;
		color: var(--Green);
		display: inline-flex;
		gap: 6px;
		justify-content: center;
		padding: 7px 9px;
		width: fit-content;
	}

	.ClipCandidateGrid {
		display: grid;
		gap: 10px;
	}

	.ClipCandidateCard {
		background: var(--Page);
		border: 1px solid var(--Rule);
		border-radius: 8px;
		display: grid;
		gap: 8px;
		padding: 12px;
	}

	.CandidateTop {
		align-items: center;
		display: flex;
		justify-content: space-between;
	}

	.CandidateTop span,
	.CandidateScores span {
		color: var(--Ink3);
		font-size: 10px;
		text-transform: uppercase;
	}

	.CandidateTop strong {
		background: var(--Green);
		border-radius: 50%;
		color: white;
		display: grid;
		height: 34px;
		place-items: center;
		width: 34px;
	}

	.ClipCandidateCard h2 {
		font-family: 'Fraunces', serif;
		font-size: 20px;
		font-weight: 400;
		margin: 0;
		text-transform: capitalize;
	}

	.CandidateMiniTimeline {
		background: #1f1d19;
		border: 1px solid #39362f;
		border-radius: 8px;
		height: 34px;
		position: relative;
	}

	.CandidateKeepRange {
		background: linear-gradient(90deg, #2d6a3f, #589267);
		border-radius: 999px;
		bottom: 11px;
		left: 42px;
		position: absolute;
		right: 42px;
		top: 11px;
	}

	.CandidateCutRange {
		align-items: center;
		background: #b94848;
		border: 1px solid #e3a09a;
		border-radius: 999px;
		color: white;
		display: flex;
		height: 18px;
		justify-content: center;
		min-width: 18px;
		position: absolute;
		top: 7px;
		z-index: 2;
	}

	.CandidateCutRange i {
		font-size: 11px;
	}

	.CandidateHandle {
		background: #f6f2e9;
		border: 1px solid var(--Rule);
		border-radius: 6px;
		color: var(--Ink2);
		font-size: 10px;
		padding: 3px 5px;
		position: absolute;
		top: 6px;
		z-index: 3;
	}

	.StartHandle {
		left: 6px;
	}

	.EndHandle {
		right: 6px;
	}

	.ClipCandidateCard p {
		color: var(--Ink2);
		margin: 0;
	}

	.CandidatePreviewAsset {
		background: var(--Surface);
		border: 1px solid var(--RuleSoft);
		border-radius: 8px;
		display: grid;
		gap: 8px;
		overflow: hidden;
		padding: 8px;
	}

	.CandidatePreviewAsset video {
		aspect-ratio: 16 / 9;
		background: #111;
		border-radius: 6px;
		width: 100%;
	}

	.CandidatePreviewAsset a,
	.CandidatePreviewAsset button {
		align-items: center;
		background: var(--Green);
		border: 0;
		border-radius: 6px;
		color: white;
		display: inline-flex;
		font-size: 12px;
		gap: 6px;
		justify-content: center;
		padding: 8px 10px;
		text-decoration: none;
	}

	.PreviewPending {
		align-items: center;
		color: var(--Ink2);
		display: grid;
		gap: 6px;
		min-height: 92px;
		place-items: center;
		text-align: center;
	}

	.PreviewPending small {
		color: var(--Danger);
	}

	.CandidateScores {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.CandidateScores span {
		background: var(--RuleSoft);
		border-radius: 4px;
		padding: 3px 6px;
	}

	.CaptionPanel,
	.InternalCutsPanel {
		background: color-mix(in srgb, var(--Surface) 72%, var(--Page));
		border: 1px solid var(--RuleSoft);
		border-radius: 8px;
		display: grid;
		gap: 8px;
		padding: 9px;
	}

	.CaptionPanel > div,
	.InternalCutsPanel > div {
		align-items: center;
		display: flex;
		justify-content: space-between;
	}

	.CaptionPanel strong,
	.CaptionPanel span,
	.InternalCutsPanel strong,
	.InternalCutsPanel span,
	.InternalCutsPanel li {
		color: var(--Ink3);
		font-size: 11px;
	}

	.InternalCutsPanel ul {
		display: grid;
		gap: 3px;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.CaptionPanel form,
	.InternalCutsPanel form {
		display: grid;
		gap: 6px;
		grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
	}

	.CaptionPanel form:last-child {
		grid-template-columns: minmax(0, 1fr) auto;
	}

	.CaptionPanel textarea {
		min-height: 76px;
		resize: vertical;
	}

	.InternalCutsPanel form:last-child {
		grid-template-columns: 1fr;
	}

	.CutPresetRow {
		display: grid;
		gap: 6px;
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}

	.InternalCutsPanel .CutPresetRow form {
		display: block;
	}

	.InternalCutsPanel .CutPresetRow button {
		width: 100%;
	}

	.CaptionPanel button,
	.InternalCutsPanel button {
		background: var(--Surface);
		border: 1px solid var(--Rule);
		border-radius: 6px;
		color: var(--Ink2);
		padding: 6px 8px;
	}

	.CandidateEditForm {
		display: grid;
		gap: 8px;
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}

	.CandidateEditForm label {
		display: grid;
		gap: 4px;
	}

	.CandidateEditForm span {
		color: var(--Ink3);
		font-size: 10px;
		text-transform: uppercase;
	}

	.CandidateEditForm textarea {
		min-height: 74px;
		resize: vertical;
	}

	.CandidateEditForm button,
	.CandidateWide {
		grid-column: 1 / -1;
	}

	.VariantActions {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.VariantActions button {
		background: var(--Surface);
		border: 1px solid var(--RuleSoft);
		border-radius: 999px;
		color: var(--Ink2);
		font-size: 11px;
		padding: 5px 8px;
	}

	.CandidateActions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.CandidateActions form {
		align-items: center;
		display: flex;
		gap: 6px;
	}

	.CandidateActions select {
		max-width: 150px;
	}

	.CandidateActions button {
		background: var(--Surface);
		border: 1px solid var(--Rule);
		border-radius: 6px;
		color: var(--Ink2);
		padding: 6px 9px;
	}

	.InlineEditForm,
	.CampaignEditForm {
		display: grid;
		gap: 8px;
	}

	.InlineEditForm {
		align-items: center;
		grid-template-columns: minmax(160px, 1fr) 86px minmax(160px, 1fr) 70px 110px repeat(3, auto) auto;
	}

	.InlineEditForm label {
		align-items: center;
		color: var(--Ink2);
		display: inline-flex;
		font-size: 11px;
		gap: 4px;
	}

	.Hook {
		color: var(--Ink2);
		font-family: 'Fraunces', serif;
		font-style: italic;
	}

	.PrimaryButton {
		align-items: center;
		background: var(--Green);
		border-color: var(--Green);
		color: white;
		display: inline-flex;
		gap: 7px;
		text-decoration: none;
	}

	.PrimaryButton:disabled {
		cursor: wait;
		opacity: 0.62;
	}

	.PageTitleRow {
		align-items: center;
		display: flex;
		justify-content: space-between;
		margin-bottom: 24px;
	}

	.PageTitleRow h1 {
		font-family: 'Fraunces', serif;
		font-size: 30px;
		font-weight: 400;
	}

	.CampaignGrid,
	.AccountGrid,
	.PreferenceGrid {
		display: grid;
		gap: 14px;
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.CampaignCard,
	.AccountCard,
	.PreferenceGrid label {
		padding: 18px;
	}

	.CampaignTop,
	.AccountTop {
		align-items: flex-start;
		display: flex;
		justify-content: space-between;
		margin-bottom: 16px;
	}

	.CampaignTop h2,
	.AccountTop h2 {
		font-family: 'Fraunces', serif;
		font-size: 20px;
		font-weight: 400;
	}

	.CampaignTop p,
	.AccountTop p {
		color: var(--Ink3);
		font-size: 12px;
	}

	.CampaignTop strong {
		color: var(--Green);
		font-family: 'Fraunces', serif;
		font-size: 24px;
		font-weight: 400;
	}

	.CampaignTop strong span {
		color: var(--Ink3);
		font-family: 'DM Sans', sans-serif;
		font-size: 11px;
	}

	.CampaignDetails {
		grid-template-columns: repeat(3, 1fr);
	}

	.Allowed {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 14px;
	}

	.Allowed span {
		background: var(--GreenSoft);
		color: var(--Green);
		margin: 0;
	}

	.CampaignEditForm {
		grid-template-columns: repeat(4, minmax(0, 1fr));
		margin-top: 14px;
	}

	.CampaignEditForm button {
		width: max-content;
	}

	.CampaignRules {
		display: grid;
		gap: 8px;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		margin-top: 14px;
	}

	.CampaignRules div {
		background: var(--RuleSoft);
		border-radius: 6px;
		padding: 9px;
	}

	.CampaignRules span {
		color: var(--Ink3);
		display: block;
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.1em;
		margin-bottom: 4px;
		text-transform: uppercase;
	}

	.CampaignRules p {
		color: var(--Ink2);
		font-size: 12px;
		line-height: 1.35;
	}

	.AddCard {
		background: transparent;
		border: 1px dashed var(--Rule);
		border-radius: 8px;
		color: var(--Ink3);
		min-height: 190px;
	}

	.MetricBand {
		grid-template-columns: repeat(4, 1fr);
		margin-top: 26px;
	}

	.MetricBand > div {
		padding: 16px;
	}

	.AccountGrid {
		grid-template-columns: repeat(3, minmax(0, 1fr));
		margin-bottom: 28px;
	}

	.ApiKeyPanel {
		background: var(--Surface);
		border: 1px solid var(--Rule);
		border-radius: 8px;
		display: grid;
		gap: 16px;
		margin: 12px 0 28px;
		padding: 18px;
	}

	.SourceActionRow {
		align-items: center;
		display: flex;
		gap: 12px;
		justify-content: space-between;
		margin: 10px 0 12px;
	}

	.SourceActionRow div {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		justify-content: flex-end;
	}

	.SourceSearch {
		align-items: center;
		background: var(--Page);
		border: 1px solid var(--Rule);
		border-radius: 6px;
		display: flex;
		gap: 7px;
		min-width: 230px;
		padding: 0 9px;
	}

	.SourceSearch input {
		background: transparent;
		border: 0;
		min-width: 0;
		padding: 6px 0;
	}

	.ImportBackupForm {
		display: flex;
	}

	.ImportBackupForm input {
		height: 1px;
		opacity: 0;
		pointer-events: none;
		position: absolute;
		width: 1px;
	}

	.SourceActionRow span {
		color: var(--Ink2);
		font-size: 12px;
	}

	.ApiKeyPanel h2 {
		font-family: 'Fraunces', serif;
		font-size: 22px;
		font-weight: 400;
		margin: 0 0 4px;
	}

	.ApiKeyPanel p {
		color: var(--Ink2);
		font-size: 12px;
	}

	.ApiKeyForm {
		display: grid;
		gap: 10px;
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}

	.ApiKeyForm label {
		display: grid;
		gap: 6px;
	}

	.ApiKeyForm span,
	.CredentialList span {
		color: var(--Ink3);
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	.CredentialList {
		border-top: 1px solid var(--Rule);
		display: grid;
		gap: 1px;
		padding-top: 10px;
	}

	.CredentialList div {
		align-items: center;
		display: flex;
		gap: 10px;
		min-height: 32px;
	}

	.CredentialList strong {
		color: var(--Ink3);
		font-size: 12px;
		font-weight: 500;
		margin-left: auto;
	}

	.CredentialList strong.Configured {
		color: var(--Green);
	}

	.CredentialList form {
		display: flex;
	}

	.CredentialList button {
		background: transparent;
		border: 0;
		color: var(--Ink3);
		padding: 0;
	}

	.CredentialList button:disabled {
		cursor: not-allowed;
		opacity: 0.35;
	}

	.AccountCard.Connected {
		border-color: #b0d0bc;
	}

	.EmptyState {
		align-items: center;
		background: var(--Surface);
		border: 1px dashed var(--Rule);
		border-radius: 8px;
		color: var(--Ink3);
		display: flex;
		gap: 8px;
		min-height: 120px;
		padding: 18px;
	}

	.LeadGrid > .EmptyState {
		grid-column: 1 / -1;
	}

	.EmptyState.InlineEmpty {
		border-left: 0;
		border-radius: 0;
		border-right: 0;
		min-height: 92px;
	}

	.EmptyState.MiniEmpty {
		background: var(--Page);
		min-height: 70px;
	}

	.InlineDelete {
		margin-top: 12px;
	}

	.InlineDelete.HeaderDelete {
		margin-left: auto;
		margin-top: 0;
	}

	.InlineDelete.TableDelete {
		margin-top: 0;
	}

	.InlineDelete button {
		background: transparent;
		border: 0;
		color: var(--Ink3);
		font-size: 11px;
		padding: 0;
	}

	.InlineDelete button:hover {
		color: #8c2a1e;
	}

	.AccountIcon {
		align-items: center;
		background: var(--GreenSoft);
		border-radius: 10px;
		color: var(--Green);
		display: grid;
		font-size: 20px;
		height: 40px;
		place-items: center;
		width: 40px;
	}

	.AccountTop {
		justify-content: flex-start;
		gap: 12px;
	}

	.AccountStats {
		grid-template-columns: repeat(3, 1fr);
		margin-bottom: 12px;
	}

	.ConnectedText {
		background: var(--GreenSoft);
		border-color: #b0d0bc;
		color: var(--Green);
		display: inline-block;
	}

	.PreferenceGrid {
		grid-template-columns: repeat(3, 1fr);
	}

	.SyncList {
		background: var(--Surface);
		border: 1px solid var(--Rule);
		border-radius: 8px;
		display: grid;
		gap: 1px;
		margin-bottom: 26px;
		overflow: hidden;
	}

	.SyncList div {
		background: var(--Page);
		display: flex;
		justify-content: space-between;
		padding: 11px 14px;
	}

	.SyncList span {
		color: var(--Ink2);
		font-size: 12px;
	}

	.PreferenceGrid label {
		display: grid;
		gap: 10px;
	}

	.PreferenceGrid button {
		align-self: end;
		justify-content: center;
		min-height: 42px;
	}

	@media (max-width: 1100px) {
		.ContentPanes,
		.AccountGrid,
		.CampaignGrid,
		.ApiKeyForm,
		.PreferenceGrid {
			grid-template-columns: 1fr;
		}

		.RightPanel {
			display: none;
		}

		.LeadGrid {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 760px) {
		.Sidebar {
			box-shadow: 18px 0 38px rgba(26, 25, 22, 0.22);
			display: flex;
			height: 100dvh;
			left: 0;
			max-width: min(82vw, 300px);
			position: fixed;
			top: 0;
			transform: translateX(-105%);
			transition: transform 180ms ease;
			width: min(82vw, 300px);
			z-index: 40;
		}

		.Sidebar.Open {
			transform: translateX(0);
		}

		.SidebarScrim {
			background: rgba(26, 25, 22, 0.34);
			border: 0;
			display: block;
			inset: 0;
			padding: 0;
			position: fixed;
			z-index: 35;
		}

		.Topnav {
			overflow-x: auto;
		}

		.CreatorHeader,
		.Subheader {
			align-items: flex-start;
			flex-wrap: wrap;
		}

		.SearchWrap {
			min-width: 0;
			width: 100%;
		}

		.SidebarToggle {
			height: 42px;
			width: 46px;
		}

		.SortControl {
			flex: 1;
			justify-content: flex-start;
			min-width: min(100%, 240px);
		}

		.SortControl span {
			height: 42px;
		}

		.SortControl select {
			flex: 1;
			min-width: 0;
		}

		.RowThumb {
			flex-basis: 72px;
		}

		.RowTriageActions {
			border-left: 0;
			border-top: 1px solid var(--RuleSoft);
			flex: 0 0 100%;
			order: 4;
		}

		.RowTriageActions button {
			flex: 1;
			min-height: 34px;
		}

		.CreatorStats,
		.MetricBand {
			display: grid;
			grid-template-columns: repeat(2, 1fr);
			width: 100%;
		}

		.QuickForm,
		.QuickForm.QueueForm,
		.ExternalDownloadForm,
		.ManualSourceForm,
		.QuickForm.CreatorEditForm,
		.InlineEditForm,
		.CampaignEditForm {
			grid-template-columns: 1fr;
		}

		.MediaJobCard {
			grid-template-columns: 1fr;
		}

		.MediaJobActions {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.ClipCutterLayout,
		.ClipAnalysisForm,
		.CandidateEditForm,
		.ExportBar,
		.LiveControlForm,
		.LiveMarkForm,
		.SignalGrid,
		.SelectedMediaJob {
			grid-template-columns: 1fr;
		}

		.PlayerControls {
			flex-wrap: wrap;
		}

		.PlayerControls span {
			flex: 1 0 100%;
			margin-left: 0;
		}
	}
</style>
