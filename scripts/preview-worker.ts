import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { EnsureAppDatabaseReady, Get, Run } from '../src/lib/server/db/app-db';
import { ClaimNext } from './worker-claim';

type PreviewRow = {
	Id: number;
	MediaJobId: number;
	ClipCandidateId: number;
};

type SourceRow = {
	OutputPath?: string | null;
};

type CandidateRow = {
	ClipNumber: number;
	StartTime: string;
	EndTime: string;
	CutSegmentsJson?: string | null;
};

const RunOnce = process.argv.includes('--once');
const PollMs = Number(process.env.VANTAGE_PREVIEW_WORKER_POLL_MS ?? 5000);
const PreviewRoot = resolve(process.env.VANTAGE_PREVIEW_DIR ?? 'media/previews');

await EnsureAppDatabaseReady();
mkdirSync(PreviewRoot, { recursive: true });
await RunWorker();

if (!RunOnce) {
	console.log(JSON.stringify({ Status: 'WatchingClipPreviews', PollMs, PreviewRoot }));
	setInterval(RunWorker, PollMs);
}

async function RunWorker() {
	const Job = await NextPreview();
	if (!Job) {
		if (RunOnce) console.log(JSON.stringify({ Status: 'Idle' }));
		return;
	}

	try {
		await ProcessPreview(Job);
	} catch (Reason) {
		const Message = Reason instanceof Error ? Reason.message : 'Unknown preview worker error';
		await UpdatePreview(Job.Id, { Status: 'failed', ErrorMessage: Message });
		await Run('update media_jobs set error_message = ?, updated_at = ? where id = ?', [Message, new Date().toISOString(), Job.MediaJobId]);
		console.error(JSON.stringify({ Status: 'Failed', PreviewId: Job.Id, Message }));
	}
}

async function NextPreview() {
	return await ClaimNext<PreviewRow>({
		Table: 'clip_previews',
		Select: `id as "Id", media_job_id as "MediaJobId", clip_candidate_id as "ClipCandidateId"`,
		Where: `status in ('waiting', 'generating')`,
		OrderBy: 'id asc',
		ClaimSeconds: 20 * 60
	});
}

async function ProcessPreview(Job: PreviewRow) {
	await EnsureFfmpeg();
	const Source = await Get<SourceRow>('select output_path as "OutputPath" from media_jobs where id = ?', [Job.MediaJobId]);
	if (!Source?.OutputPath || !existsSync(Source.OutputPath)) throw new Error('Original source video is not downloaded yet');
	const Candidate = await Get<CandidateRow>(
		'select clip_number as "ClipNumber", start_time as "StartTime", end_time as "EndTime", cut_segments_json as "CutSegmentsJson" from clip_candidates where id = ?',
		[Job.ClipCandidateId]
	);
	if (!Candidate) throw new Error('Clip candidate was not found');

	await UpdatePreview(Job.Id, { Status: 'generating', Progress: 20, ErrorMessage: null });
	await Run('update media_jobs set stage = ?, progress = ?, updated_at = ? where id = ?', ['generating previews', 88, new Date().toISOString(), Job.MediaJobId]);

	const BaseName = `job-${Job.MediaJobId}-clip-${Candidate.ClipNumber}`;
	const PreviewPath = join(PreviewRoot, `${BaseName}-preview.mp4`);
	const ThumbnailPath = join(PreviewRoot, `${BaseName}-thumb.jpg`);
	const Start = TimestampSeconds(Candidate.StartTime);
	const End = TimestampSeconds(Candidate.EndTime);
	const Duration = Math.max(1, End - Start);

	await RunCommand('ffmpeg', PreviewArgs(Source.OutputPath, Candidate, PreviewPath));
	await UpdatePreview(Job.Id, { Status: 'generating', Progress: 78 });
	await RunCommand('ffmpeg', ['-y', '-ss', String(Start + Math.min(2, Math.floor(Duration / 2))), '-i', Source.OutputPath, '-frames:v', '1', '-vf', 'scale=720:-2', ThumbnailPath]);

	const Now = new Date().toISOString();
	await UpdatePreview(Job.Id, { Status: 'completed', Progress: 100, PreviewPath, ThumbnailPath, FileSize: Bytes(statSync(PreviewPath).size), CompletedAt: Now });
	await Run('update media_jobs set progress = ?, error_message = null, updated_at = ? where id = ?', [90, Now, Job.MediaJobId]);
	console.log(JSON.stringify({ Status: 'PreviewGenerated', PreviewId: Job.Id, PreviewPath, ThumbnailPath }));
}

async function EnsureFfmpeg() {
	try {
		await RunCommand('ffmpeg', ['-version']);
	} catch {
		throw new Error('ffmpeg is required for preview generation. Install ffmpeg and ensure it is available on PATH.');
	}
}

async function RunCommand(Command: string, Args: string[]) {
	const Child = spawn(Command, Args, { windowsHide: true });
	let ErrorOutput = '';
	Child.stderr.on('data', (Chunk) => (ErrorOutput += String(Chunk)));
	const Code = await new Promise<number | null>((Resolve, Reject) => {
		Child.on('error', Reject);
		Child.on('close', Resolve);
	});
	if (Code !== 0) throw new Error(ErrorOutput.trim() || `${Command} exited with ${Code}`);
}

async function UpdatePreview(
	Id: number,
	Patch: Partial<{
		Status: string;
		Progress: number;
		PreviewPath: string;
		ThumbnailPath: string;
		FileSize: string;
		ErrorMessage: string | null;
		CompletedAt: string;
	}>
) {
	const Entries = Object.entries({
		status: Patch.Status,
		progress: Patch.Progress,
		preview_path: Patch.PreviewPath,
		thumbnail_path: Patch.ThumbnailPath,
		file_size: Patch.FileSize,
		error_message: Patch.ErrorMessage,
		completed_at: Patch.CompletedAt,
		updated_at: new Date().toISOString()
	}).filter(([, Value]) => Value !== undefined);
	await Run(`update clip_previews set ${Entries.map(([Key]) => `${Key} = ?`).join(', ')} where id = ?`, [
		...Entries.map(([, Value]) => Value),
		Id
	]);
}

function TimestampSeconds(Value: string) {
	const Parts = Value.split(':').map(Number);
	if (Parts.some((Part) => !Number.isFinite(Part))) return 0;
	if (Parts.length === 3) return Parts[0] * 3600 + Parts[1] * 60 + Parts[2];
	if (Parts.length === 2) return Parts[0] * 60 + Parts[1];
	return Parts[0] ?? 0;
}

function PreviewArgs(SourcePath: string, Candidate: CandidateRow, OutputPath: string) {
	const Ranges = KeepRanges(Candidate);
	if (Ranges.length <= 1) {
		return ['-y', '-ss', String(Ranges[0].Start), '-t', String(Ranges[0].End - Ranges[0].Start), '-i', SourcePath, '-vf', 'scale=720:-2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', OutputPath];
	}
	const Chains = Ranges.flatMap((Range, Index) => [
		`[0:v]trim=start=${Range.Start}:end=${Range.End},setpts=PTS-STARTPTS,scale=720:-2[v${Index}]`,
		`[0:a]atrim=start=${Range.Start}:end=${Range.End},asetpts=PTS-STARTPTS[a${Index}]`
	]);
	const Inputs = Ranges.map((_, Index) => `[v${Index}][a${Index}]`).join('');
	return ['-y', '-i', SourcePath, '-filter_complex', `${Chains.join(';')};${Inputs}concat=n=${Ranges.length}:v=1:a=1[v][a]`, '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', OutputPath];
}

function KeepRanges(Candidate: CandidateRow) {
	const Start = TimestampSeconds(Candidate.StartTime);
	const End = Math.max(Start + 1, TimestampSeconds(Candidate.EndTime));
	const Cuts = ParseCuts(Candidate.CutSegmentsJson).map((Cut) => ({ Start: Math.max(Start, TimestampSeconds(Cut.StartTime)), End: Math.min(End, TimestampSeconds(Cut.EndTime)) })).filter((Cut) => Cut.End - Cut.Start >= 1).sort((A, B) => A.Start - B.Start);
	const Ranges = [];
	let Cursor = Start;
	for (const Cut of Cuts) {
		if (Cut.Start > Cursor) Ranges.push({ Start: Cursor, End: Cut.Start });
		Cursor = Math.max(Cursor, Cut.End);
	}
	if (Cursor < End) Ranges.push({ Start: Cursor, End });
	return Ranges.length ? Ranges : [{ Start, End }];
}

function ParseCuts(Raw?: string | null) {
	if (!Raw) return [] as Array<{ StartTime: string; EndTime: string }>;
	try {
		const Parsed = JSON.parse(Raw) as Array<{ StartTime?: string; EndTime?: string }>;
		return Array.isArray(Parsed) ? Parsed.filter((Cut) => Cut.StartTime && Cut.EndTime).map((Cut) => ({ StartTime: Cut.StartTime!, EndTime: Cut.EndTime! })) : [];
	} catch {
		return [];
	}
}

function Bytes(Size: number) {
	if (Size > 1024 ** 3) return `${(Size / 1024 ** 3).toFixed(2)} GB`;
	if (Size > 1024 ** 2) return `${(Size / 1024 ** 2).toFixed(1)} MB`;
	if (Size > 1024) return `${Math.round(Size / 1024)} KB`;
	return `${Size} B`;
}
