export type Platform = 'Kick' | 'Twitch' | 'YouTube' | 'TikTok' | 'Instagram' | 'X';
export type ItemStatus = 'New' | 'Watched' | 'Clipped' | 'Uploaded' | 'Rejected';
export type ViewName = 'Feed' | 'Queue' | 'Editor' | 'Creators' | 'Best Clips' | 'Campaigns' | 'Accounts';
export type MediaJobStage =
	| 'waiting'
	| 'fetching source'
	| 'downloading'
	| 'recording livestream'
	| 'extracting audio'
	| 'analyzing media'
	| 'retrieving transcript'
	| 'generating transcript'
	| 'analyzing topics'
	| 'detecting candidate clips'
	| 'scoring clips'
	| 'generating previews'
	| 'ready for review'
	| 'exporting'
	| 'paused'
	| 'completed'
	| 'failed'
	| 'requires manual review';

export type ReviewStatus = 'Not required' | 'Needs source review' | 'Approved' | 'Rejected';

export type ContentItem = {
	Id: number;
	Creator: string;
	ExternalId?: string | null;
	Platform: Platform;
	Kind: string;
	Title: string;
	Age: string;
	Metric: string;
	Campaign: string;
	Status: ItemStatus;
	Score: number;
	Live?: boolean;
	Velocity?: string;
	SourceUrl?: string | null;
	ThumbnailUrl?: string | null;
	PublishedAt?: string | null;
	LastAction?: string | null;
	LastActionBy?: string | null;
	LastActionAt?: string | null;
};

export type ClipTask = {
	Id: number;
	Creator: string;
	Platform: Platform;
	Source: string;
	SourceUrl?: string | null;
	Timestamp: string;
	Hook: string;
	Score: number;
	Status: string;
	Targets: Record<'TikTok' | 'Shorts' | 'Reels', boolean>;
	UploadUrls: Record<'TikTok' | 'Shorts' | 'Reels', string>;
	LastAction?: string | null;
	LastActionBy?: string | null;
	LastActionAt?: string | null;
};

export type MediaJob = {
	Id: number;
	ClipTaskId?: number | null;
	SourceUrl: string;
	SourcePlatform: string;
	VideoTitle: string;
	ThumbnailUrl?: string | null;
	Creator: string;
	Duration: string;
	MediaStatus: string;
	Progress: number;
	Priority: number;
	Stage: MediaJobStage;
	EstimatedFileSize: string;
	ErrorMessage?: string | null;
	ManualReviewStatus: ReviewStatus;
	TranscriptText?: string | null;
	TranscriptFormat?: string | null;
	TranscriptLanguage?: string | null;
	TranscriptConfidence?: number | null;
	TranscriptModel?: string | null;
	TranscriptSource?: string | null;
	TranscriptSegmentsJson?: string | null;
	TranscriptWordsJson?: string | null;
	TranscriptTranslationText?: string | null;
	TranscriptTranslationLanguage?: string | null;
	TranscriptTranslationSource?: string | null;
	TranscriptTranslationUpdatedAt?: string | null;
	TranscriptUpdatedAt?: string | null;
	OutputPath?: string | null;
	AudioPath?: string | null;
	ManualContext?: string | null;
	SourceValidationStatus?: string | null;
	LiveRecordingMode?: string | null;
	LiveChunkSeconds?: number | null;
	LiveAnalyzeWhileRecording?: boolean | null;
	LiveGeneratePeriodicClips?: boolean | null;
	LiveMarkedMomentsJson?: string | null;
	AnalysisReportJson?: string | null;
	AnalysisRequestJson?: string | null;
	AnalysisUpdatedAt?: string | null;
	MetadataJson?: string | null;
	DownloadedAt?: string | null;
	CancelledAt?: string | null;
	ClaimedBy?: string | null;
	ClaimedAt?: string | null;
	ClaimExpiresAt?: string | null;
	CreatedAt: string;
	UpdatedAt?: string | null;
};

export type ClipCandidate = {
	Id: number;
	MediaJobId: number;
	ClipNumber: number;
	Title?: string | null;
	StartTime: string;
	EndTime: string;
	Duration: string;
	ViralScore: number;
	Category: string;
	Explanation: string;
	HookScore: number;
	ContextScore: number;
	EmotionScore: number;
	HumorScore: number;
	ControversyScore: number;
	PayoffScore: number;
	RetentionScore: number;
	ShareabilityScore: number;
	OriginalityScore: number;
	Status: string;
	Variant: string;
	CutSegmentsJson?: string | null;
	CaptionText?: string | null;
	CaptionJson?: string | null;
	CaptionStatus?: string | null;
	ReviewNotes?: string | null;
	CreatedAt: string;
};

export type ClipExport = {
	Id: number;
	MediaJobId: number;
	ClipCandidateId?: number | null;
	Preset: string;
	Status: string;
	Progress: number;
	OutputPath?: string | null;
	FileSize?: string | null;
	ErrorMessage?: string | null;
	ClaimedBy?: string | null;
	ClaimedAt?: string | null;
	ClaimExpiresAt?: string | null;
	CreatedAt: string;
	UpdatedAt?: string | null;
	CompletedAt?: string | null;
};

export type ClipPreview = {
	Id: number;
	MediaJobId: number;
	ClipCandidateId: number;
	Status: string;
	Progress: number;
	PreviewPath?: string | null;
	ThumbnailPath?: string | null;
	FileSize?: string | null;
	ErrorMessage?: string | null;
	ClaimedBy?: string | null;
	ClaimedAt?: string | null;
	ClaimExpiresAt?: string | null;
	CreatedAt: string;
	UpdatedAt?: string | null;
	CompletedAt?: string | null;
};

export type Creator = {
	Name: string;
	Initial: string;
	Platforms: Platform[];
	Campaign: string;
	LiveViewers: string;
	Followers: string;
	AverageScore: number;
	ClipsMade: number;
	Notes: string;
};

export type Campaign = {
	Name: string;
	State: string;
	Rate: string;
	Niche: string;
	Earned: number;
	Goal: number;
	Submitted: number;
	Allowed: string[];
	Rules: string;
	HookRules: string;
	BannedTerms: string;
};

export type PlatformAccount = {
	Id: number;
	Creator: string;
	Platform: Platform;
	Handle: string;
	ExternalId: string;
	SourceUrl?: string | null;
	Connected: boolean;
	LastSyncedAt?: string | null;
	LastError?: string | null;
};

export type SyncRun = {
	Id: number;
	Platform: Platform;
	StartedAt: string;
	FinishedAt?: string | null;
	Status: string;
	ItemsFound: number;
	Message?: string | null;
};

export type SavedSearch = {
	Id: number;
	Query: string;
	CreatedAt: string;
};

export type ApiCredentialStatus = {
	Key: string;
	Label: string;
	Configured: boolean;
	LastFour?: string | null;
	UpdatedAt?: string | null;
	Source: 'Database' | 'Environment' | 'Missing';
};

export type AppSettings = {
	NicheKeywords: string;
	RefreshSchedule: string;
	MinimumScore: number;
	ScoreRecencyWeight: number;
	ScoreEngagementWeight: number;
	ScorePlatformWeight: number;
	ScoreCampaignWeight: number;
	ScoreTitleWeight: number;
	ScoreStatusWeight: number;
};

export type ActivityEvent = {
	Id: number;
	Actor: string;
	Action: string;
	EntityType: string;
	EntityId?: number | null;
	Label: string;
	CreatedAt: string;
};

export type WorkerHeartbeat = {
	Id: number;
	InstanceId: string;
	Role: string;
	Workers: string;
	Status: string;
	Pid?: number | null;
	Host?: string | null;
	StartedAt: string;
	LastSeenAt: string;
	Message?: string | null;
};

export const ContentItems: ContentItem[] = [
	{
		Id: 1,
		Creator: 'Kai Cenat',
		Platform: 'Kick',
		Kind: 'Live stream',
		Title: "72-hour subathon crosses 150k concurrent viewers",
		Age: '2h in',
		Metric: '142k watching',
		Campaign: 'Whop',
		Status: 'New',
		Score: 94,
		Live: true,
		Velocity: '+38%'
	},
	{
		Id: 2,
		Creator: 'Trainwreckstv',
		Platform: 'Kick',
		Kind: 'Live stream',
		Title: '$50k viewer pot challenge spikes during slots marathon',
		Age: '45m in',
		Metric: '89k watching',
		Campaign: 'Clipping.net',
		Status: 'New',
		Score: 91,
		Live: true,
		Velocity: '+26%'
	},
	{
		Id: 3,
		Creator: 'Shroud',
		Platform: 'Twitch',
		Kind: 'VOD',
		Title: 'FPS session turns into a no-scope flick highlight reel',
		Age: '6h ago',
		Metric: '2.1M channel avg',
		Campaign: 'Organic',
		Status: 'Watched',
		Score: 76
	},
	{
		Id: 4,
		Creator: 'Adin Ross',
		Platform: 'Kick',
		Kind: 'VOD',
		Title: 'Celebrity guest confrontation goes fully unfiltered',
		Age: '3h ago',
		Metric: 'chat velocity high',
		Campaign: 'Whop',
		Status: 'New',
		Score: 71
	},
	{
		Id: 5,
		Creator: 'Hasan Abi',
		Platform: 'Twitch',
		Kind: 'Clip',
		Title: 'Reacts to leaked documents live as chat explodes',
		Age: '8h ago',
		Metric: '580k avg',
		Campaign: 'Organic',
		Status: 'Clipped',
		Score: 58
	},
	{
		Id: 6,
		Creator: 'IShowSpeed',
		Platform: 'YouTube',
		Kind: 'Upload',
		Title: 'Training with world cup pros goes completely wrong',
		Age: '11h ago',
		Metric: '14M channel',
		Campaign: 'Clipping.net',
		Status: 'New',
		Score: 52
	},
	{
		Id: 7,
		Creator: 'xQc',
		Platform: 'Kick',
		Kind: 'Stream',
		Title: 'Reacts to his own banned clips and says something unexpected',
		Age: '14h ago',
		Metric: '220k avg',
		Campaign: 'Organic',
		Status: 'New',
		Score: 49
	},
	{
		Id: 8,
		Creator: 'Pokimane',
		Platform: 'Twitch',
		Kind: 'Stream',
		Title: 'First stream back after break hits an emotional moment',
		Age: '16h ago',
		Metric: '80k viewers',
		Campaign: 'Organic',
		Status: 'Watched',
		Score: 44
	}
];

export const ClipTasks: ClipTask[] = [
	{
		Id: 1,
		Creator: 'Kai Cenat',
		Platform: 'Kick',
		Source: 'Subathon milestone, chat reacts to 150k',
		Timestamp: '1:24:33',
		Hook: 'nobody expected this to happen live on stream',
		Score: 94,
		Status: 'Uploading',
		Targets: { TikTok: true, Shorts: false, Reels: false },
		UploadUrls: { TikTok: '', Shorts: '', Reels: '' }
	},
	{
		Id: 2,
		Creator: 'Trainwreckstv',
		Platform: 'Kick',
		Source: '$50k pot won live, full reaction',
		Timestamp: '0:47:12',
		Hook: 'he won $50,000 on stream and this happened',
		Score: 91,
		Status: 'Editing',
		Targets: { TikTok: true, Shorts: true, Reels: false },
		UploadUrls: { TikTok: '', Shorts: '', Reels: '' }
	},
	{
		Id: 3,
		Creator: 'Shroud',
		Platform: 'Twitch',
		Source: 'No-scope across the entire map',
		Timestamp: '2:11:08',
		Hook: 'bro actually hit this shot',
		Score: 76,
		Status: 'Done',
		Targets: { TikTok: true, Shorts: true, Reels: true },
		UploadUrls: { TikTok: '', Shorts: '', Reels: '' }
	},
	{
		Id: 4,
		Creator: 'Adin Ross',
		Platform: 'Kick',
		Source: 'Celebrity guest says something unhinged',
		Timestamp: '3:02:44',
		Hook: "I can't believe he said this on stream",
		Score: 71,
		Status: 'To clip',
		Targets: { TikTok: false, Shorts: false, Reels: false },
		UploadUrls: { TikTok: '', Shorts: '', Reels: '' }
	},
	{
		Id: 5,
		Creator: 'Hasan Abi',
		Platform: 'Twitch',
		Source: 'Reacts to leaked documents',
		Timestamp: '1:08:17',
		Hook: 'he had no idea this was coming',
		Score: 58,
		Status: 'Watched',
		Targets: { TikTok: false, Shorts: false, Reels: false },
		UploadUrls: { TikTok: '', Shorts: '', Reels: '' }
	}
];

export const Creators: Creator[] = [
	{
		Name: 'Kai Cenat',
		Initial: 'K',
		Platforms: ['Kick', 'Twitch', 'YouTube'],
		Campaign: 'Whop',
		LiveViewers: '142k',
		Followers: '8.4M',
		AverageScore: 94,
		ClipsMade: 14,
		Notes:
			'Subathon moments tend to peak around hour 2-3. Best hooks: milestone reactions, chat moments, unexpected guests. Whop allows TikTok, Shorts, and Reels.'
	},
	{
		Name: 'Trainwreckstv',
		Initial: 'T',
		Platforms: ['Kick', 'YouTube'],
		Campaign: 'Clipping.net',
		LiveViewers: '89k',
		Followers: '2.2M',
		AverageScore: 91,
		ClipsMade: 8,
		Notes: 'Slots challenge clips perform best when the payout number appears in the first frame.'
	},
	{
		Name: 'Shroud',
		Initial: 'S',
		Platforms: ['Twitch', 'YouTube'],
		Campaign: 'Organic',
		LiveViewers: 'offline',
		Followers: '10.1M',
		AverageScore: 76,
		ClipsMade: 5,
		Notes: 'FPS highlights need minimal context. Lead with the shot, then add replay angle if available.'
	}
];

export const Campaigns: Campaign[] = [
	{
		Name: 'Whop',
		State: 'Active, renews monthly',
		Rate: '$4 / 1k views',
		Niche: 'Business / SaaS',
		Earned: 180,
		Goal: 300,
		Submitted: 23,
		Allowed: ['TikTok', 'YouTube Shorts', 'Instagram Reels', 'X'],
		Rules: 'Keep edits native to each platform. Avoid misleading income claims and preserve creator context.',
		HookRules: 'Lead with the surprising moment or payout reveal in the first two seconds.',
		BannedTerms: 'guaranteed, risk-free, official partnership'
	},
	{
		Name: 'Clipping.net',
		State: 'Active, open-ended',
		Rate: '$3.50 / 1k views',
		Niche: 'Gaming / IRL',
		Earned: 104,
		Goal: 250,
		Submitted: 11,
		Allowed: ['TikTok', 'YouTube Shorts', 'Instagram Reels'],
		Rules: 'Gaming and IRL clips only. No recycled watermarked reposts.',
		HookRules: 'Start with the reaction, win, fail, or chat spike before adding setup.',
		BannedTerms: 'giveaway, free money, sponsor confirmed'
	}
];
