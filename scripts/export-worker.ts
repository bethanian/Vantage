import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { EnsureAppDatabaseReady, Get, Run } from '../src/lib/server/db/app-db';
import { ClaimNext } from './worker-claim';

type ExportRow = {
	Id: number;
	MediaJobId: number;
	ClipCandidateId?: number | null;
	Preset: string;
};

type SourceRow = {
	OutputPath?: string | null;
	VideoTitle: string;
};

type CandidateRow = {
	ClipNumber: number;
	StartTime: string;
	EndTime: string;
	Category: string;
	CutSegmentsJson?: string | null;
};

const RunOnce = process.argv.includes('--once');
const PollMs = Number(process.env.VANTAGE_EXPORT_WORKER_POLL_MS ?? 5000);
const ExportRoot = resolve(process.env.VANTAGE_EXPORT_DIR ?? 'media/exports');

await EnsureAppDatabaseReady();
mkdirSync(ExportRoot, { recursive: true });

await RunWorker();

if (!RunOnce) {
	console.log(JSON.stringify({ Status: 'WatchingClipExports', PollMs, ExportRoot }));
	setInterval(RunWorker, PollMs);
}

async function RunWorker() {
	const Job = await NextExport();
	if (!Job) {
		if (RunOnce) console.log(JSON.stringify({ Status: 'Idle' }));
		return;
	}

	try {
		await ProcessExport(Job);
	} catch (Reason) {
		const Message = Reason instanceof Error ? Reason.message : 'Unknown export worker error';
		await UpdateExport(Job.Id, { Status: 'failed', ErrorMessage: Message });
		await Run('update media_jobs set stage = ?, error_message = ?, updated_at = ? where id = ?', [
			'failed',
			Message,
			new Date().toISOString(),
			Job.MediaJobId
		]);
		console.error(JSON.stringify({ Status: 'Failed', ExportId: Job.Id, Message }));
	}
}

async function NextExport() {
	return await ClaimNext<ExportRow>({
		Table: 'clip_exports',
		Select: `id as "Id", media_job_id as "MediaJobId", clip_candidate_id as "ClipCandidateId", preset as "Preset"`,
		Where: `status in ('waiting', 'exporting')`,
		OrderBy: 'id asc',
		ClaimSeconds: 30 * 60
	});
}

async function ProcessExport(Job: ExportRow) {
	await EnsureFfmpeg();
	const Source = await Get<SourceRow>('select output_path as "OutputPath", video_title as "VideoTitle" from media_jobs where id = ?', [Job.MediaJobId]);
	if (!Source?.OutputPath || !existsSync(Source.OutputPath)) throw new Error('Original source video is not downloaded yet');
	if (!Job.ClipCandidateId) throw new Error('Export job is missing a clip candidate');
	const Candidate = await Get<CandidateRow>(
		'select clip_number as "ClipNumber", start_time as "StartTime", end_time as "EndTime", category as "Category", cut_segments_json as "CutSegmentsJson" from clip_candidates where id = ?',
		[Job.ClipCandidateId]
	);
	if (!Candidate) throw new Error('Clip candidate was not found');

	await UpdateExport(Job.Id, { Status: 'exporting', Progress: 10, ErrorMessage: null });
	await Run('update media_jobs set stage = ?, progress = ?, updated_at = ? where id = ?', ['exporting', 92, new Date().toISOString(), Job.MediaJobId]);

	const OutputPath = join(ExportRoot, `job-${Job.MediaJobId}-clip-${Candidate.ClipNumber}-${PresetSlug(Job.Preset)}.mp4`);
	await RunCommand('ffmpeg', ExportArgs(Source.OutputPath, Candidate, Job.Preset, OutputPath));

	const FileSize = Bytes(statSync(OutputPath).size);
	const Now = new Date().toISOString();
	await UpdateExport(Job.Id, { Status: 'completed', Progress: 100, OutputPath, FileSize, CompletedAt: Now });
	await Run('update media_jobs set stage = ?, progress = ?, updated_at = ? where id = ?', ['completed', 100, Now, Job.MediaJobId]);
	console.log(JSON.stringify({ Status: 'Exported', ExportId: Job.Id, OutputPath }));
}

async function EnsureFfmpeg() {
	try {
		await RunCommand('ffmpeg', ['-version']);
	} catch {
		throw new Error('ffmpeg is required for clip exports. Install ffmpeg and ensure it is available on PATH.');
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

async function UpdateExport(
	Id: number,
	Patch: Partial<{
		Status: string;
		Progress: number;
		OutputPath: string;
		FileSize: string;
		ErrorMessage: string | null;
		CompletedAt: string;
	}>
) {
	const Entries = Object.entries({
		status: Patch.Status,
		progress: Patch.Progress,
		output_path: Patch.OutputPath,
		file_size: Patch.FileSize,
		error_message: Patch.ErrorMessage,
		completed_at: Patch.CompletedAt,
		updated_at: new Date().toISOString()
	}).filter(([, Value]) => Value !== undefined);
	await Run(`update clip_exports set ${Entries.map(([Key]) => `${Key} = ?`).join(', ')} where id = ?`, [
		...Entries.map(([, Value]) => Value),
		Id
	]);
}

function PresetArgs(Preset: string) {
	const Name = Preset.toLowerCase();
	if (Name.includes('tiktok') || Name.includes('reels') || Name.includes('shorts') || Name.includes('vertical')) {
		return ['-vf', 'scale=1080:-2,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black', '-c:v', 'libx264', '-c:a', 'aac'];
	}
	if (Name.includes('square')) return ['-vf', 'scale=1080:-2,pad=1080:1080:(ow-iw)/2:(oh-ih)/2:black', '-c:v', 'libx264', '-c:a', 'aac'];
	if (Name.includes('horizontal')) return ['-vf', 'scale=1920:-2,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black', '-c:v', 'libx264', '-c:a', 'aac'];
	return ['-c:v', 'libx264', '-c:a', 'aac'];
}

function ExportArgs(SourcePath: string, Candidate: CandidateRow, Preset: string, OutputPath: string) {
	const Ranges = KeepRanges(Candidate);
	if (Ranges.length <= 1) {
		return ['-y', '-ss', String(Ranges[0].Start), '-to', String(Ranges[0].End), '-i', SourcePath, ...PresetArgs(Preset), '-movflags', '+faststart', OutputPath];
	}
	const Chains = Ranges.flatMap((Range, Index) => [
		`[0:v]trim=start=${Range.Start}:end=${Range.End},setpts=PTS-STARTPTS[v${Index}]`,
		`[0:a]atrim=start=${Range.Start}:end=${Range.End},asetpts=PTS-STARTPTS[a${Index}]`
	]);
	const Inputs = Ranges.map((_, Index) => `[v${Index}][a${Index}]`).join('');
	const VideoFilter = PresetFilter(Preset);
	const Filter = `${Chains.join(';')};${Inputs}concat=n=${Ranges.length}:v=1:a=1[vraw][a];[vraw]${VideoFilter}[v]`;
	return ['-y', '-i', SourcePath, '-filter_complex', Filter, '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart', OutputPath];
}

function PresetFilter(Preset: string) {
	const Name = Preset.toLowerCase();
	if (Name.includes('tiktok') || Name.includes('reels') || Name.includes('shorts') || Name.includes('vertical')) return 'scale=1080:-2,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black';
	if (Name.includes('square')) return 'scale=1080:-2,pad=1080:1080:(ow-iw)/2:(oh-ih)/2:black';
	if (Name.includes('horizontal')) return 'scale=1920:-2,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black';
	return 'null';
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

function TimestampSeconds(Value: string) {
	const Parts = Value.split(':').map(Number);
	if (Parts.some((Part) => !Number.isFinite(Part))) return 0;
	if (Parts.length === 3) return Parts[0] * 3600 + Parts[1] * 60 + Parts[2];
	if (Parts.length === 2) return Parts[0] * 60 + Parts[1];
	return Parts[0] ?? 0;
}

function PresetSlug(Preset: string) {
	return Preset.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'original';
}

function Bytes(Size: number) {
	if (Size > 1024 ** 3) return `${(Size / 1024 ** 3).toFixed(2)} GB`;
	if (Size > 1024 ** 2) return `${(Size / 1024 ** 2).toFixed(1)} MB`;
	if (Size > 1024) return `${Math.round(Size / 1024)} KB`;
	return `${Size} B`;
}
