import { spawn } from 'node:child_process';
import { EnsureAppDatabaseReady, Get, Run } from '../src/lib/server/db/app-db';

type MediaJobRow = {
	Id: number;
	SourceUrl: string;
	SourcePlatform: string;
	ManualReviewStatus: string;
};

type YtDlpMetadata = {
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
	requested_downloads?: Array<{ filesize?: number; filesize_approx?: number; vcodec?: string; acodec?: string }>;
	formats?: Array<{ vcodec?: string; acodec?: string }>;
	extractor_key?: string;
	webpage_url?: string;
};

const RunOnce = process.argv.includes('--once');
const PollMs = Number(process.env.VANTAGE_SOURCE_WORKER_POLL_MS ?? 5000);

await EnsureAppDatabaseReady();
await RunWorker();

if (!RunOnce) {
	console.log(JSON.stringify({ Status: 'WatchingSourceValidation', PollMs }));
	setInterval(RunWorker, PollMs);
}

async function RunWorker() {
	const Job = await NextJob();
	if (!Job) {
		if (RunOnce) console.log(JSON.stringify({ Status: 'Idle' }));
		return;
	}

	try {
		await ValidateJob(Job);
	} catch (Reason) {
		const Message = Reason instanceof Error ? Reason.message : 'Unknown source validation error';
		await UpdateJob(Job.Id, {
			Stage: 'requires manual review',
			Progress: 20,
			ErrorMessage: Message,
			SourceValidationStatus: ClassifyFailure(Message)
		});
		console.error(JSON.stringify({ Status: 'ValidationFailed', JobId: Job.Id, Message }));
	}
}

async function NextJob() {
	const SpecificId = Number(process.argv.find((Arg) => Arg.startsWith('--id='))?.split('=')[1] ?? 0);
	if (SpecificId) {
		return await Get<MediaJobRow>(
			`select id as "Id", source_url as "SourceUrl", source_platform as "SourcePlatform", manual_review_status as "ManualReviewStatus"
			 from media_jobs where id = ? limit 1`,
			[SpecificId]
		);
	}
	return await Get<MediaJobRow>(
		`select id as "Id", source_url as "SourceUrl", source_platform as "SourcePlatform", manual_review_status as "ManualReviewStatus"
		 from media_jobs
		 where cancelled_at is null
		   and stage = 'fetching source'
		   and (source_validation_status is null or lower(source_validation_status) like 'queued%')
		 order by priority desc, id asc
		 limit 1`
	);
}

async function ValidateJob(Job: MediaJobRow) {
	await UpdateJob(Job.Id, {
		Stage: 'fetching source',
		Progress: 12,
		ErrorMessage: null,
		SourceValidationStatus: 'validating source accessibility'
	});

	const Metadata = await ReadMetadata(Job.SourceUrl);
	const StreamStatus = StreamAvailability(Metadata);
	const IsLive = Boolean(Metadata.is_live) || ['is_live', 'is_upcoming', 'post_live'].includes(Metadata.live_status ?? '');
	const NextStage = Job.ManualReviewStatus === 'Needs source review' ? 'requires manual review' : 'waiting';
	const ReviewHint = Job.ManualReviewStatus === 'Needs source review' ? 'manual approval required before download' : 'ready for download';
	const Status = `publicly accessible / ${StreamStatus} / ${ReviewHint}`;

	await UpdateJob(Job.Id, {
		Stage: NextStage,
		Progress: Job.ManualReviewStatus === 'Needs source review' ? 35 : 25,
		VideoTitle: Metadata.title,
		Creator: Metadata.uploader || Metadata.channel,
		Duration: Metadata.duration_string || SecondsToDuration(Metadata.duration),
		ThumbnailUrl: Metadata.thumbnail,
		MediaStatus: IsLive ? `livestream / ${Metadata.live_status ?? 'live-capable'}` : 'vod/video',
		EstimatedFileSize: Bytes(Metadata.filesize ?? Metadata.filesize_approx ?? LargestRequestedDownload(Metadata)),
		MetadataJson: JSON.stringify(Metadata),
		SourceValidationStatus: Status
	});

	console.log(JSON.stringify({ Status: 'Validated', JobId: Job.Id, SourceValidationStatus: Status }));
}

async function ReadMetadata(SourceUrl: string) {
	const Output = await RunCapture('yt-dlp', ['--dump-json', '--simulate', '--no-playlist', SourceUrl]);
	return JSON.parse(Output) as YtDlpMetadata;
}

async function RunCapture(Command: string, Args: string[]) {
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
		SourceValidationStatus: string;
		VideoTitle: string;
		Creator: string;
		Duration: string;
		ThumbnailUrl: string;
		MediaStatus: string;
		EstimatedFileSize: string;
		MetadataJson: string;
	}>
) {
	const Entries = Object.entries({
		stage: Patch.Stage,
		progress: Patch.Progress,
		error_message: Patch.ErrorMessage,
		source_validation_status: Patch.SourceValidationStatus,
		video_title: Patch.VideoTitle,
		creator: Patch.Creator,
		duration: Patch.Duration,
		thumbnail_url: Patch.ThumbnailUrl,
		media_status: Patch.MediaStatus,
		estimated_file_size: Patch.EstimatedFileSize,
		metadata_json: Patch.MetadataJson,
		updated_at: new Date().toISOString()
	}).filter(([, Value]) => Value !== undefined);
	const SetSql = Entries.map(([Key]) => `${Key} = ?`).join(', ');
	await Run(`update media_jobs set ${SetSql} where id = ?`, [...Entries.map(([, Value]) => Value), Id]);
}

function StreamAvailability(Metadata: YtDlpMetadata) {
	const Formats = Metadata.requested_downloads?.length ? Metadata.requested_downloads : Metadata.formats ?? [];
	const HasVideo = Formats.some((Format) => Format.vcodec && Format.vcodec !== 'none');
	const HasAudio = Formats.some((Format) => Format.acodec && Format.acodec !== 'none');
	if (HasVideo && HasAudio) return 'audio and video streams available';
	if (HasVideo) return 'video stream available, audio uncertain';
	if (HasAudio) return 'audio stream available, video uncertain';
	return 'stream formats not exposed in metadata';
}

function LargestRequestedDownload(Metadata: YtDlpMetadata) {
	return Math.max(0, ...(Metadata.requested_downloads ?? []).map((Download) => Download.filesize ?? Download.filesize_approx ?? 0));
}

function ClassifyFailure(Message: string) {
	const Lower = Message.toLowerCase();
	if (Lower.includes('login') || Lower.includes('sign in') || Lower.includes('cookies')) return 'login or cookies required / manual source upload recommended';
	if (Lower.includes('private') || Lower.includes('unavailable')) return 'restricted or unavailable source / manual review required';
	if (Lower.includes('unsupported url')) return 'unsupported link / manual source upload required';
	if (Lower.includes('drm')) return 'drm protected source / cannot process automatically';
	return 'automatic validation failed / manual review required';
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
