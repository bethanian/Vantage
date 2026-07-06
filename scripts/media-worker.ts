import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { EnsureAppDatabaseReady, Get, Run } from '../src/lib/server/db/app-db';
import { ClaimNext, WorkerInstanceId } from './worker-claim';

type MediaJobRow = {
	Id: number;
	SourceUrl: string;
	SourcePlatform: string;
	VideoTitle: string;
	Creator: string;
	MediaStatus: string;
	ManualReviewStatus: string;
	LiveRecordingMode?: string | null;
	LiveChunkSeconds?: number | null;
	LiveAnalyzeWhileRecording?: boolean | number | null;
	LiveGeneratePeriodicClips?: boolean | number | null;
	CancelledAt?: string | null;
};

type YtDlpMetadata = {
	id?: string;
	title?: string;
	uploader?: string;
	channel?: string;
	duration_string?: string;
	duration?: number;
	live_status?: string;
	is_live?: boolean;
	thumbnail?: string;
	filesize_approx?: number;
	filesize?: number;
	ext?: string;
};

type DownloadActivity = {
	Label: string;
	Detail?: string;
	FileName?: string;
	FileSize?: string;
	UpdatedAt: string;
};

type JobMetadata = YtDlpMetadata & {
	DownloadActivity?: DownloadActivity;
	[Key: string]: unknown;
};

const MediaClaimSeconds = Number(process.env.VANTAGE_MEDIA_CLAIM_SECONDS ?? 180);

class WorkerStoppedError extends Error {
	constructor(
		message: string,
		readonly Stage: 'paused' | 'failed'
	) {
		super(message);
	}
}

const RunOnce = process.argv.includes('--once');
const PollMs = Number(process.env.VANTAGE_MEDIA_WORKER_POLL_MS ?? 5000);
const DownloadRoot = resolve(process.env.VANTAGE_DOWNLOAD_DIR ?? process.env.VANTAGE_MEDIA_DIR ?? 'media/downloads');
const LogRoot = resolve(process.env.VANTAGE_MEDIA_LOG_DIR ?? 'media/logs');
const MaxLiveSeconds = Number(process.env.VANTAGE_MAX_LIVE_RECORD_SECONDS ?? 7200);

await EnsureAppDatabaseReady();
mkdirSync(DownloadRoot, { recursive: true });
mkdirSync(LogRoot, { recursive: true });

await RunWorker();

if (!RunOnce) {
	console.log(JSON.stringify({ Status: 'WatchingMediaJobs', PollMs, DownloadRoot }));
	setInterval(RunWorker, PollMs);
}

async function RunWorker() {
	const Job = await NextJob();
	if (!Job) {
		if (RunOnce) console.log(JSON.stringify({ Status: 'Idle' }));
		return;
	}

	try {
		await ProcessJob(Job);
	} catch (Reason) {
		if (Reason instanceof WorkerStoppedError) {
			await UpdateJob(Job.Id, { Stage: Reason.Stage, ErrorMessage: Reason.message });
			return;
		}
		await FailJob(Job.Id, Reason instanceof Error ? Reason.message : 'Unknown media worker error');
	}
}

async function NextJob() {
	return await ClaimNext<MediaJobRow>({
		Table: 'media_jobs',
		Select: `id as "Id", source_url as "SourceUrl", source_platform as "SourcePlatform", video_title as "VideoTitle",
		 creator as "Creator", media_status as "MediaStatus", manual_review_status as "ManualReviewStatus",
		 live_recording_mode as "LiveRecordingMode", live_chunk_seconds as "LiveChunkSeconds",
		 live_analyze_while_recording as "LiveAnalyzeWhileRecording", live_generate_periodic_clips as "LiveGeneratePeriodicClips",
		 cancelled_at as "CancelledAt"`,
		Where: `stage in ('waiting', 'fetching source', 'downloading', 'recording livestream')
		   and cancelled_at is null
		   and manual_review_status != 'Rejected'`,
		OrderBy: 'priority desc, id asc',
		ClaimSeconds: MediaClaimSeconds
	});
}

async function ProcessJob(Job: MediaJobRow) {
	if (Job.ManualReviewStatus === 'Needs source review') {
		await UpdateJob(Job.Id, {
			Stage: 'requires manual review',
			ErrorMessage: 'Manual source review is required before downloading this external source.'
		});
		return;
	}

	await EnsureYtDlp();
	await UpdateJob(Job.Id, { Stage: 'fetching source', Progress: 5, ErrorMessage: null });
	const Metadata = await ReadMetadata(Job);
	const IsLive = Boolean(Metadata.is_live) || ['is_live', 'is_upcoming', 'post_live'].includes(Metadata.live_status ?? '');
	const Stage = IsLive ? 'recording livestream' : 'downloading';
	const OutputTemplate = join(DownloadRoot, `job-${Job.Id}.%(ext)s`);
	const LogPath = join(LogRoot, `job-${Job.Id}.log`);
	const Args = [
		'--newline',
		'--no-playlist',
		'--restrict-filenames',
		'--write-info-json',
		'--write-thumbnail',
		'--paths',
		DownloadRoot,
		'-o',
		OutputTemplate,
		Job.SourceUrl
	];

	const LiveLimit = LiveRecordingSeconds(Job);
	if (IsLive && Number.isFinite(LiveLimit) && LiveLimit > 0) {
		Args.unshift('--download-sections', `*0-${LiveLimit}`);
	}

	await UpdateJob(Job.Id, {
		Stage,
		Progress: 10,
		VideoTitle: Metadata.title || Job.VideoTitle,
		Creator: Metadata.uploader || Metadata.channel || Job.Creator,
		Duration: Metadata.duration_string || SecondsToDuration(Metadata.duration),
		MediaStatus: IsLive ? LiveStatusText(Job, LiveLimit) : 'vod/video',
		ThumbnailUrl: Metadata.thumbnail ?? null,
		EstimatedFileSize: Bytes(Metadata.filesize ?? Metadata.filesize_approx),
		MetadataJson: JSON.stringify(Metadata)
	});
	await UpdateDownloadActivity(Job.Id, Metadata, Stage, 'Preparing download files.');

	let LastActivityWriteAt = 0;
	let LastProgress = 10;
	await RunCommand(
		'yt-dlp',
		Args,
		LogPath,
		async (Line) => {
			const Percent = ProgressPercent(Line);
			const Progress = Percent === null ? null : Math.max(10, Math.min(98, Percent));
			const ShouldWriteActivity =
				Date.now() - LastActivityWriteAt > 5000 ||
				(Progress !== null && Math.floor(Progress) !== Math.floor(LastProgress));
			if (Progress === null && !ShouldWriteActivity) return;
			const Activity = DownloadActivityForJob(Job.Id, Stage, Line);
			const Patch = Progress === null
				? { Stage, MetadataJson: JSON.stringify({ ...Metadata, DownloadActivity: Activity }) }
				: { Progress, Stage, MetadataJson: JSON.stringify({ ...Metadata, DownloadActivity: Activity }) };
			await UpdateJob(Job.Id, Patch);
			LastActivityWriteAt = Date.now();
			if (Progress !== null) LastProgress = Progress;
		},
		() => StopReason(Job.Id)
	);

	const OutputPath = FindDownloadedFile(Job.Id);
	const Size = OutputPath ? Bytes(statSync(OutputPath).size) : 'unknown';
	await UpdateJob(Job.Id, {
		Stage: 'extracting audio',
		Progress: 98,
		OutputPath,
		EstimatedFileSize: Size,
		DownloadedAt: new Date().toISOString(),
		MetadataJson: JSON.stringify({
			...Metadata,
			DownloadActivity: DownloadActivityForJob(Job.Id, 'extracting audio', 'Download finished.')
		})
	});
	await UpdateJob(Job.Id, {
		Stage: 'retrieving transcript',
		Progress: 99,
		ErrorMessage: 'Download complete. Transcript extraction is queued for the transcript worker pass.'
	});
	console.log(JSON.stringify({ Status: 'Downloaded', JobId: Job.Id, OutputPath }));
}

async function ReadMetadata(Job: MediaJobRow) {
	const Output = await RunCommandCapture('yt-dlp', ['--dump-json', '--no-playlist', Job.SourceUrl]);
	return JSON.parse(Output) as YtDlpMetadata;
}

async function EnsureYtDlp() {
	try {
		await RunCommandCapture('yt-dlp', ['--version']);
	} catch {
		throw new Error('yt-dlp is required for media downloads. Install it and ensure yt-dlp is available on PATH.');
	}
}

async function RunCommand(
	Command: string,
	Args: string[],
	LogPath: string,
	OnLine: (Line: string) => Promise<void>,
	ShouldStop?: () => Promise<false | 'cancelled' | 'paused'>
) {
	mkdirSync(dirname(LogPath), { recursive: true });
	const Log = createWriteStream(LogPath, { flags: 'a' });
	const Child = spawn(Command, Args, { windowsHide: true });
	let Buffer = '';
	let ErrorBuffer = '';
	let StopReasonValue: false | 'cancelled' | 'paused' = false;

	Child.stdout.on('data', (Chunk) => {
		const Text = String(Chunk);
		Log.write(Text);
		Buffer += Text;
		const Lines = Buffer.split(/\r?\n/);
		Buffer = Lines.pop() ?? '';
		for (const Line of Lines) void OnLine(Line);
	});
	Child.stderr.on('data', (Chunk) => {
		const Text = String(Chunk);
		Log.write(Text);
		ErrorBuffer += Text;
		const Lines = Text.split(/\r?\n/).filter(Boolean);
		for (const Line of Lines) void OnLine(Line);
	});

	const CancelTimer = ShouldStop
		? setInterval(() => {
				ShouldStop()
					.then((Reason) => {
						if (Reason && !Child.killed) {
							StopReasonValue = Reason;
							Child.kill();
						}
					})
					.catch(() => {});
			}, 2000)
		: null;
	const Code = await new Promise<number | null>((Resolve, Reject) => {
		Child.on('error', Reject);
		Child.on('close', Resolve);
	});
	if (CancelTimer) clearInterval(CancelTimer);
	Log.end();
	StopReasonValue ||= (await ShouldStop?.()) ?? false;
	if (StopReasonValue === 'paused') throw new WorkerStoppedError('Paused by user', 'paused');
	if (StopReasonValue === 'cancelled') throw new WorkerStoppedError('Cancelled by user', 'failed');
	if (Code !== 0) throw new Error(ErrorBuffer.trim() || `${Command} exited with ${Code}`);
}

async function RunCommandCapture(Command: string, Args: string[]) {
	const Child = spawn(Command, Args, { windowsHide: true });
	let Output = '';
	let ErrorOutput = '';
	Child.stdout.on('data', (Chunk) => (Output += String(Chunk)));
	Child.stderr.on('data', (Chunk) => (ErrorOutput += String(Chunk)));
	const Code = await new Promise<number | null>((Resolve, Reject) => {
		Child.on('error', Reject);
		Child.on('close', Resolve);
	});
	if (Code !== 0) throw new Error(ErrorOutput.trim() || `${Command} exited with ${Code}`);
	return Output.trim();
}

async function UpdateJob(
	Id: number,
	Patch: Partial<{
		Stage: string;
		Progress: number;
		ErrorMessage: string | null;
		VideoTitle: string;
		Creator: string;
		Duration: string;
		MediaStatus: string;
		ThumbnailUrl: string | null;
		EstimatedFileSize: string;
		MetadataJson: string;
		OutputPath: string | null;
		DownloadedAt: string;
	}>
) {
	const Entries = Object.entries({
		stage: Patch.Stage,
		progress: Patch.Progress,
		error_message: Patch.ErrorMessage,
		video_title: Patch.VideoTitle,
		creator: Patch.Creator,
		duration: Patch.Duration,
		media_status: Patch.MediaStatus,
		thumbnail_url: Patch.ThumbnailUrl,
		estimated_file_size: Patch.EstimatedFileSize,
		metadata_json: Patch.MetadataJson,
		output_path: Patch.OutputPath,
		downloaded_at: Patch.DownloadedAt,
		updated_at: new Date().toISOString()
	}).filter(([, Value]) => Value !== undefined);
	const SetSql = Entries.map(([Key]) => `${Key} = ?`).join(', ');
	await Run(`update media_jobs set ${SetSql} where id = ?`, [...Entries.map(([, Value]) => Value), Id]);
	if (Patch.Stage && ['completed', 'failed', 'paused', 'requires manual review'].includes(Patch.Stage)) {
		await Run('update media_jobs set claimed_by = null, claimed_at = null, claim_expires_at = null where id = ? and claimed_by = ?', [Id, WorkerInstanceId]);
	} else {
		await Run('update media_jobs set claim_expires_at = ? where id = ? and claimed_by = ?', [
			new Date(Date.now() + MediaClaimSeconds * 1000).toISOString(),
			Id,
			WorkerInstanceId
		]);
	}
}

async function FailJob(Id: number, Message: string) {
	await UpdateJob(Id, { Stage: 'failed', ErrorMessage: Message });
	console.error(JSON.stringify({ Status: 'Failed', JobId: Id, Message }));
}

async function StopReason(Id: number) {
	const Row = await Get<{ CancelledAt?: string | null; Stage?: string | null }>(
		'select cancelled_at as "CancelledAt", stage as "Stage" from media_jobs where id = ?',
		[Id]
	);
	if (Row?.CancelledAt) return 'cancelled';
	if (Row?.Stage === 'paused') return 'paused';
	return false;
}

async function UpdateDownloadActivity(Id: number, Metadata: JobMetadata, Stage: string, Detail?: string) {
	await UpdateJob(Id, {
		Stage,
		MetadataJson: JSON.stringify({
			...Metadata,
			DownloadActivity: DownloadActivityForJob(Id, Stage, Detail)
		})
	});
}

function DownloadActivityForJob(JobId: number, Stage: string, Line?: string): DownloadActivity {
	const Files = DownloadFiles(JobId);
	const Recent = Files[0];
	const Fragment = Files.find((File) => /\.part-Frag\d+\.part$/i.test(File.Name));
	const Partial = Files.find((File) => /\.part$/i.test(File.Name) && !/\.part-Frag\d+\.part$/i.test(File.Name));
	const Final = Files.find((File) => IsFinalMediaFile(File.Name));
	const Info = Files.find((File) => /\.info\.json$/i.test(File.Name));
	const Thumbnail = Files.find((File) => /\.(jpe?g|png|webp)$/i.test(File.Name));
	const Session = Files.find((File) => /\.ytdl$/i.test(File.Name));
	const NormalizedLine = Line?.trim() ?? '';
	const LineLabel = DownloadLineLabel(NormalizedLine);

	if (Final) return Activity('Finalizing downloaded file', LineLabel ?? 'Preparing it for the next step.', Final);
	if (Fragment) return Activity('Downloading fragments', LineLabel ?? 'Saving a new video segment.', Fragment);
	if (Partial) return Activity(Stage === 'recording livestream' ? 'Recording live media' : 'Writing video file', LineLabel ?? 'Saving the main media file.', Partial);
	if (Session) return Activity('Saving download session', LineLabel ?? 'Keeping the download resumable.', Session);
	if (Thumbnail) return Activity('Fetched thumbnail', LineLabel ?? 'Saving preview artwork.', Thumbnail);
	if (Info) return Activity('Fetched source details', LineLabel ?? 'Saving source metadata.', Info);
	return Activity(LineLabel ?? StageLabel(Stage), NormalizedLine && !LineLabel ? CleanDownloadLine(NormalizedLine) : undefined, Recent);
}

function DownloadFiles(JobId: number) {
	if (!existsSync(DownloadRoot)) return [] as Array<{ Name: string; Path: string; Size: number; MtimeMs: number }>;
	const Prefix = `job-${JobId}.`;
	return readdirSync(DownloadRoot)
		.filter((Name) => Name.startsWith(Prefix))
		.map((Name) => {
			const Path = join(DownloadRoot, Name);
			const Stats = statSync(Path);
			return { Name, Path, Size: Stats.size, MtimeMs: Stats.mtimeMs };
		})
		.sort((A, B) => B.MtimeMs - A.MtimeMs);
}

function DownloadLineLabel(Line: string) {
	if (!Line) return null;
	if (/Destination:/i.test(Line)) return 'Opening the destination file.';
	if (/Merging formats/i.test(Line)) return 'Merging media tracks.';
	if (/Deleting original file/i.test(Line)) return 'Cleaning up temporary pieces.';
	if (/Writing video metadata/i.test(Line)) return 'Writing video metadata.';
	if (/Downloading thumbnail/i.test(Line)) return 'Downloading thumbnail.';
	if (/has already been downloaded/i.test(Line)) return 'Using an existing downloaded file.';
	if (/fragment/i.test(Line)) return CleanDownloadLine(Line);
	return null;
}

function StageLabel(Stage: string) {
	const Labels: Record<string, string> = {
		'fetching source': 'Fetching source details',
		downloading: 'Downloading media',
		'recording livestream': 'Recording live media',
		'extracting audio': 'Preparing audio'
	};
	return Labels[Stage] ?? `Working on ${Stage}`;
}

function Activity(Label: string, Detail?: string, File?: { Name: string; Size: number }): DownloadActivity {
	return {
		Label,
		Detail,
		FileName: File?.Name,
		FileSize: File ? Bytes(File.Size) : undefined,
		UpdatedAt: new Date().toISOString()
	};
}

function CleanDownloadLine(Line: string) {
	return Line
		.replace(/^\[[^\]]+\]\s*/, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 120);
}

function IsFinalMediaFile(Name: string) {
	if (!Name.startsWith('job-')) return false;
	if (/\.(info\.json|jpe?g|png|webp|part|ytdl)$/i.test(Name)) return false;
	return /\.(mp4|mkv|webm|mov|m4a|mp3|aac|wav)$/i.test(Name);
}

function FindDownloadedFile(JobId: number) {
	if (!existsSync(DownloadRoot)) return null;
	const Prefix = `job-${JobId}.`;
	const Ignored = new Set(['.json', '.jpg', '.jpeg', '.png', '.webp', '.part', '.ytdl']);
	const Match = readdirSync(DownloadRoot)
		.map((Name) => join(DownloadRoot, Name))
		.find((Path) => {
			const Name = Path.split(/[\\/]/).pop() ?? '';
			return Name.startsWith(Prefix) && !Ignored.has(extname(Name).toLowerCase());
		});
	return Match ?? null;
}

function ProgressPercent(Line: string) {
	const Match = Line.match(/(\d+(?:\.\d+)?)%/);
	return Match ? Number(Match[1]) : null;
}

function LiveRecordingSeconds(Job: MediaJobRow) {
	const Mode = (Job.LiveRecordingMode ?? '').toLowerCase();
	const ChunkSeconds = Number(Job.LiveChunkSeconds ?? 0);
	if (Mode.includes('entire')) return MaxLiveSeconds;
	if (Mode.includes('chunk')) return Number.isFinite(ChunkSeconds) && ChunkSeconds > 0 ? ChunkSeconds : 300;
	if (Mode.includes('current')) return Number.isFinite(ChunkSeconds) && ChunkSeconds > 0 ? ChunkSeconds : MaxLiveSeconds;
	return MaxLiveSeconds;
}

function LiveStatusText(Job: MediaJobRow, Limit: number) {
	const Mode = Job.LiveRecordingMode || 'begin from current moment';
	const Analyze = Job.LiveAnalyzeWhileRecording ? 'analysis on' : 'analysis off';
	const Periodic = Job.LiveGeneratePeriodicClips ? 'periodic clips on' : 'periodic clips off';
	return `livestream recording / ${Mode} / ${Limit}s chunks / ${Analyze} / ${Periodic}`;
}

function SecondsToDuration(Seconds?: number) {
	if (!Seconds || !Number.isFinite(Seconds)) return 'unknown';
	const Hours = Math.floor(Seconds / 3600);
	const Minutes = Math.floor((Seconds % 3600) / 60);
	const Remaining = Math.floor(Seconds % 60);
	return Hours ? `${Hours}:${String(Minutes).padStart(2, '0')}:${String(Remaining).padStart(2, '0')}` : `${Minutes}:${String(Remaining).padStart(2, '0')}`;
}

function Bytes(Size?: number) {
	if (!Size || !Number.isFinite(Size)) return 'unknown';
	if (Size > 1024 ** 3) return `${(Size / 1024 ** 3).toFixed(2)} GB`;
	if (Size > 1024 ** 2) return `${(Size / 1024 ** 2).toFixed(1)} MB`;
	if (Size > 1024) return `${Math.round(Size / 1024)} KB`;
	return `${Size} B`;
}
