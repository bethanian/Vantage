import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { EnsureAppDatabaseReady, Run } from '../src/lib/server/db/app-db';
import { ClaimNext } from './worker-claim';

type MediaJobRow = {
	Id: number;
	OutputPath?: string | null;
	MetadataJson?: string | null;
	Stage?: string | null;
};

type MediaSignals = {
	Version: number;
	GeneratedAt: string;
	SourcePath: string;
	Probe: Record<string, unknown>;
	Scenes: Array<{ Index: number; Timestamp: string; FramePath: string }>;
	Audio: {
		MeanVolume?: string | null;
		MaxVolume?: string | null;
		Silences: Array<{ Start: number; End?: number; Duration?: number }>;
		Events: Array<{ Timestamp: string; Label: string; Strength: number }>;
	};
	Visual: {
		SampledFrames: string[];
		SceneCount: number;
		FaceDetection: DetectorResult;
		GameplayDetection: DetectorResult;
	};
};

type DetectorResult = {
	Status: 'not configured' | 'completed' | 'failed';
	Summary?: string;
	Events?: Array<{ Timestamp?: string; Label: string; Strength?: number; FramePath?: string }>;
	Raw?: unknown;
	Error?: string;
};

const RunOnce = process.argv.includes('--once');
const PollMs = Number(process.env.VANTAGE_MEDIA_SIGNAL_WORKER_POLL_MS ?? 5000);
const SignalRoot = resolve(process.env.VANTAGE_MEDIA_SIGNAL_DIR ?? 'media/signals');
const MaxScenes = Number(process.env.VANTAGE_MEDIA_SIGNAL_MAX_SCENES ?? 24);
const SceneThreshold = Number(process.env.VANTAGE_MEDIA_SIGNAL_SCENE_THRESHOLD ?? 0.32);

await EnsureAppDatabaseReady();
mkdirSync(SignalRoot, { recursive: true });
await RunWorker();

if (!RunOnce) {
	console.log(JSON.stringify({ Status: 'WatchingMediaSignals', PollMs, SignalRoot }));
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
		const Message = Reason instanceof Error ? Reason.message : 'Unknown media signal worker error';
		await Run('update media_jobs set error_message = ?, updated_at = ? where id = ?', [Message, new Date().toISOString(), Job.Id]);
		console.error(JSON.stringify({ Status: 'Failed', JobId: Job.Id, Message }));
	}
}

async function NextJob() {
	const Job = await ClaimNext<MediaJobRow>({
		Table: 'media_jobs',
		Select: `id as "Id", output_path as "OutputPath", metadata_json as "MetadataJson", stage as "Stage"`,
		Where: `output_path is not null
		   and cancelled_at is null
		   and (metadata_json is null or metadata_json not like '%"MediaSignals"%')
		   and stage not in ('waiting', 'fetching source', 'downloading', 'recording livestream', 'failed', 'paused', 'requires manual review')
		`,
		OrderBy: 'priority desc, id asc',
		ClaimSeconds: 20 * 60
	});
	return Job && Job.OutputPath && existsSync(Job.OutputPath) && !ParseMetadata(Job.MetadataJson).MediaSignals ? Job : undefined;
}

async function ProcessJob(Job: MediaJobRow) {
	if (!Job.OutputPath) throw new Error('Media job has no source file');
	await EnsureFfmpeg();
	const PreviousStage = Job.Stage || 'ready for review';
	await Run('update media_jobs set stage = ?, progress = ?, error_message = null, updated_at = ? where id = ?', [
		'analyzing media',
		73,
		new Date().toISOString(),
		Job.Id
	]);
	const JobDir = join(SignalRoot, `job-${Job.Id}`);
	mkdirSync(JobDir, { recursive: true });
	const Signals = await BuildSignals(Job.OutputPath, JobDir);
	const Metadata = ParseMetadata(Job.MetadataJson);
	const Now = new Date().toISOString();
	await Run('update media_jobs set stage = ?, metadata_json = ?, updated_at = ? where id = ?', [
		PreviousStage === 'analyzing media' ? 'ready for review' : PreviousStage,
		JSON.stringify({ ...Metadata, MediaSignals: Signals }),
		Now,
		Job.Id
	]);
	console.log(JSON.stringify({ Status: 'MediaSignalsSaved', JobId: Job.Id, Scenes: Signals.Scenes.length, AudioEvents: Signals.Audio.Events.length }));
}

async function BuildSignals(SourcePath: string, JobDir: string): Promise<MediaSignals> {
	const Probe = await ProbeMedia(SourcePath);
	const Scenes = await ExtractScenes(SourcePath, join(JobDir, 'scenes'));
	const SampledFrames = await ExtractSampleFrames(SourcePath, join(JobDir, 'samples'));
	const Audio = await AnalyzeAudio(SourcePath);
	const DetectorContext = {
		SourcePath,
		JobDir,
		SceneFrames: Scenes.map((Scene) => Scene.FramePath),
		SampledFrames
	};
	const FaceDetection = await RunDetector(process.env.VANTAGE_FACE_DETECT_COMMAND, DetectorContext);
	const GameplayDetection = await RunDetector(process.env.VANTAGE_GAMEPLAY_DETECT_COMMAND, DetectorContext);
	return {
		Version: 1,
		GeneratedAt: new Date().toISOString(),
		SourcePath,
		Probe,
		Scenes,
		Audio,
		Visual: {
			SampledFrames,
			SceneCount: Scenes.length,
			FaceDetection,
			GameplayDetection
		}
	};
}

async function ProbeMedia(SourcePath: string) {
	const Output = await RunCommandCapture('ffprobe', [
		'-v',
		'error',
		'-show_entries',
		'format=duration,bit_rate:stream=index,codec_type,codec_name,width,height,avg_frame_rate',
		'-of',
		'json',
		SourcePath
	]);
	return JSON.parse(Output) as Record<string, unknown>;
}

async function ExtractScenes(SourcePath: string, Dir: string) {
	mkdirSync(Dir, { recursive: true });
	const Pattern = join(Dir, 'scene-%03d.jpg');
	const ErrorOutput = await RunCommandCapture('ffmpeg', [
		'-y',
		'-i',
		SourcePath,
		'-vf',
		`select='gt(scene,${SceneThreshold})',showinfo,scale=640:-2`,
		'-fps_mode',
		'vfr',
		'-frames:v',
		String(MaxScenes),
		Pattern
	]).catch((Reason) => String(Reason instanceof Error ? Reason.message : Reason));
	const Times = [...ErrorOutput.matchAll(/pts_time:([0-9.]+)/g)].map((Match) => Number(Match[1])).filter(Number.isFinite);
	return readdirSync(Dir)
		.filter((Name) => Name.endsWith('.jpg'))
		.sort()
		.map((Name, Index) => ({ Index: Index + 1, Timestamp: FormatTimestamp(Times[Index] ?? Index * 30), FramePath: join(Dir, Name) }));
}

async function ExtractSampleFrames(SourcePath: string, Dir: string) {
	mkdirSync(Dir, { recursive: true });
	const Pattern = join(Dir, 'sample-%03d.jpg');
	await RunCommandCapture('ffmpeg', ['-y', '-i', SourcePath, '-vf', 'fps=1/45,scale=640:-2', '-frames:v', '12', Pattern]).catch(() => '');
	return readdirSync(Dir).filter((Name) => Name.endsWith('.jpg')).sort().map((Name) => join(Dir, Name));
}

async function AnalyzeAudio(SourcePath: string) {
	const SilenceOutput = await RunCommandCapture('ffmpeg', ['-i', SourcePath, '-af', 'silencedetect=n=-35dB:d=0.4', '-f', 'null', '-']).catch((Reason) =>
		String(Reason instanceof Error ? Reason.message : Reason)
	);
	const VolumeOutput = await RunCommandCapture('ffmpeg', ['-i', SourcePath, '-af', 'volumedetect', '-f', 'null', '-']).catch((Reason) =>
		String(Reason instanceof Error ? Reason.message : Reason)
	);
	const Silences = ParseSilences(SilenceOutput);
	const MeanVolume = VolumeOutput.match(/mean_volume:\s*([^\n]+)/)?.[1]?.trim() ?? null;
	const MaxVolume = VolumeOutput.match(/max_volume:\s*([^\n]+)/)?.[1]?.trim() ?? null;
	const Events = Silences
		.filter((Silence) => (Silence.Duration ?? 0) >= 1)
		.slice(0, 12)
		.map((Silence) => ({ Timestamp: FormatTimestamp(Silence.Start), Label: 'silence break / pacing reset', Strength: Math.min(100, Math.round((Silence.Duration ?? 1) * 20)) }));
	if (MaxVolume && !MaxVolume.startsWith('-inf')) Events.unshift({ Timestamp: '0:00', Label: `peak audio ${MaxVolume}`, Strength: 70 });
	return { MeanVolume, MaxVolume, Silences, Events };
}

async function RunDetector(Command: string | undefined, Context: { SourcePath: string; JobDir: string; SceneFrames: string[]; SampledFrames: string[] }): Promise<DetectorResult> {
	if (!Command?.trim()) return { Status: 'not configured' };
	const Env = {
		...process.env,
		VANTAGE_SOURCE_PATH: Context.SourcePath,
		VANTAGE_SIGNAL_DIR: Context.JobDir,
		VANTAGE_SCENE_FRAMES_JSON: JSON.stringify(Context.SceneFrames),
		VANTAGE_SAMPLE_FRAMES_JSON: JSON.stringify(Context.SampledFrames)
	};
	try {
		const Output = await RunShellCapture(Command, Env, Number(process.env.VANTAGE_DETECTOR_TIMEOUT_MS ?? 120000));
		const Parsed = TryJson(Output);
		if (Parsed && typeof Parsed === 'object') {
			const Source = Parsed as { Summary?: string; Events?: DetectorResult['Events'] };
			return { Status: 'completed', Summary: Source.Summary ?? 'Detector completed', Events: Source.Events ?? [], Raw: Parsed };
		}
		return { Status: 'completed', Summary: Output.slice(0, 1000) || 'Detector completed' };
	} catch (Reason) {
		return { Status: 'failed', Error: Reason instanceof Error ? Reason.message : 'Unknown detector error' };
	}
}

async function EnsureFfmpeg() {
	try {
		await RunCommandCapture('ffmpeg', ['-version']);
		await RunCommandCapture('ffprobe', ['-version']);
	} catch {
		throw new Error('ffmpeg and ffprobe are required for media signal analysis. Install ffmpeg and ensure both commands are available on PATH.');
	}
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
	if (Code !== 0) throw new Error(`${ErrorOutput.trim()}\n${Output.trim()}`.trim() || `${Command} exited with ${Code}`);
	return `${Output}\n${ErrorOutput}`.trim();
}

async function RunShellCapture(Command: string, Env: NodeJS.ProcessEnv, TimeoutMs: number) {
	const Child = spawn(Command, { shell: true, windowsHide: true, env: Env });
	let Output = '';
	let ErrorOutput = '';
	const Timer = setTimeout(() => Child.kill(), TimeoutMs);
	Child.stdout.on('data', (Chunk) => (Output += String(Chunk)));
	Child.stderr.on('data', (Chunk) => (ErrorOutput += String(Chunk)));
	const Code = await new Promise<number | null>((Resolve, Reject) => {
		Child.on('error', Reject);
		Child.on('close', Resolve);
	});
	clearTimeout(Timer);
	if (Code !== 0) throw new Error(`${ErrorOutput.trim()}\n${Output.trim()}`.trim() || `detector exited with ${Code}`);
	return Output.trim();
}

function ParseMetadata(Raw?: string | null) {
	if (!Raw) return {};
	try {
		return JSON.parse(Raw) as Record<string, unknown>;
	} catch {
		return {};
	}
}

function TryJson(Value: string) {
	try {
		return JSON.parse(Value) as unknown;
	} catch {
		return null;
	}
}

function ParseSilences(Output: string) {
	const Silences: Array<{ Start: number; End?: number; Duration?: number }> = [];
	for (const Match of Output.matchAll(/silence_start:\s*([0-9.]+)/g)) Silences.push({ Start: Number(Match[1]) });
	let Index = 0;
	for (const Match of Output.matchAll(/silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/g)) {
		const Silence = Silences[Index++] ?? { Start: Math.max(0, Number(Match[1]) - Number(Match[2])) };
		Silence.End = Number(Match[1]);
		Silence.Duration = Number(Match[2]);
	}
	return Silences;
}

function FormatTimestamp(Value: number) {
	const Seconds = Math.max(0, Math.floor(Value));
	return `${Math.floor(Seconds / 60)}:${String(Seconds % 60).padStart(2, '0')}`;
}
