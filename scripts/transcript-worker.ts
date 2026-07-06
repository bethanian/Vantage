import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { EnsureAppDatabaseReady, Get, Run } from '../src/lib/server/db/app-db';
import { ClaimNext, WorkerInstanceId } from './worker-claim';

type MediaJobRow = {
	Id: number;
	SourceUrl: string;
	VideoTitle: string;
	OutputPath?: string | null;
	TranscriptModel?: string | null;
	MetadataJson?: string | null;
	CancelledAt?: string | null;
	Stage?: string | null;
};

type Segment = {
	Start: string;
	End: string;
	Text: string;
	Speaker?: string;
	Confidence?: number;
};

type TranscriptWord = {
	Word: string;
	Start?: string;
	End?: string;
	Speaker?: string;
	Confidence?: number;
};

type EnrichmentResult = {
	Segments?: Segment[];
	Words?: TranscriptWord[];
	Summary?: string;
	Raw?: unknown;
	Error?: string;
};

type SmartChunk = {
	Index: number;
	Start: number;
	End: number;
	Duration: number;
	Path: string;
	Status: 'ready' | 'failed';
	Label: string;
};

type SmartChunkPlan = {
	Status?: 'skipped' | 'ready' | 'failed';
	Reason?: string;
	Chunks?: SmartChunk[];
};

const RunOnce = process.argv.includes('--once');
const PollMs = Number(process.env.VANTAGE_TRANSCRIPT_WORKER_POLL_MS ?? 5000);
const TranscriptRoot = resolve(process.env.VANTAGE_TRANSCRIPT_DIR ?? 'media/transcripts');
const TranscriptClaimSeconds = Number(process.env.VANTAGE_TRANSCRIPT_CLAIM_SECONDS ?? 20 * 60);

await EnsureAppDatabaseReady();
mkdirSync(TranscriptRoot, { recursive: true });

await RunWorker();

if (!RunOnce) {
	console.log(JSON.stringify({ Status: 'WatchingTranscriptJobs', PollMs, TranscriptRoot }));
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
		const Message = Reason instanceof Error ? Reason.message : 'Unknown transcript worker error';
		await UpdateJob(Job.Id, { Stage: 'failed', ErrorMessage: Message });
		console.error(JSON.stringify({ Status: 'Failed', JobId: Job.Id, Message }));
	}
}

async function NextJob() {
	return await ClaimNext<MediaJobRow>({
		Table: 'media_jobs',
		Select: `id as "Id", source_url as "SourceUrl", video_title as "VideoTitle", output_path as "OutputPath",
		 transcript_model as "TranscriptModel", metadata_json as "MetadataJson", cancelled_at as "CancelledAt", stage as "Stage"
		`,
		Where: `stage in ('retrieving transcript', 'generating transcript')
		   and transcript_text is null
		   and cancelled_at is null`,
		OrderBy: 'priority desc, id asc',
		ClaimSeconds: TranscriptClaimSeconds
	});
}

async function ProcessJob(Job: MediaJobRow) {
	await UpdateJob(Job.Id, { Stage: 'retrieving transcript', Progress: 55, ErrorMessage: null });
	const Caption = await TryPlatformCaptions(Job);
	if (Caption) {
		await SaveTranscript(Job, Caption.Text, Caption.Segments, 'platform captions', Caption.Language, 0.92, 'platform');
		console.log(JSON.stringify({ Status: 'TranscriptSaved', JobId: Job.Id, Source: 'platform captions' }));
		return;
	}

	await UpdateJob(Job.Id, { Stage: 'generating transcript', Progress: 58 });
	const Generated = await TryLocalTranscription(Job);
	if (Generated) {
		await SaveTranscript(Job, Generated.Text, Generated.Segments, 'local speech-to-text', Generated.Language, 0.78, TranscriptModel(Job));
		console.log(JSON.stringify({ Status: 'TranscriptSaved', JobId: Job.Id, Source: 'local speech-to-text' }));
		return;
	}

	throw new Error('No platform captions were found. Set VANTAGE_TRANSCRIBE_COMMAND to enable local speech-to-text, or paste/upload a transcript manually.');
}

async function TryPlatformCaptions(Job: MediaJobRow) {
	const Dir = join(TranscriptRoot, `job-${Job.Id}`, 'captions');
	mkdirSync(Dir, { recursive: true });
	try {
		await RunCommand('yt-dlp', [
			'--skip-download',
			'--write-subs',
			'--write-auto-subs',
			'--sub-langs',
			process.env.VANTAGE_TRANSCRIPT_LANGS ?? 'en.*,en',
			'--sub-format',
			'vtt',
			'--convert-subs',
			'vtt',
			'--no-playlist',
			'--paths',
			Dir,
			'-o',
			`job-${Job.Id}.%(ext)s`,
			Job.SourceUrl
		]);
	} catch {
		return null;
	}

	const File = readdirSync(Dir).find((Name) => Name.toLowerCase().endsWith('.vtt'));
	if (!File) return null;
	const Segments = ParseVtt(readFileSync(join(Dir, File), 'utf8'));
	if (!Segments.length) return null;
	return {
		Text: SegmentsToText(Segments),
		Segments,
		Language: CaptionLanguage(File)
	};
}

async function TryLocalTranscription(Job: MediaJobRow) {
	const Model = TranscriptModel(Job);
	const Command = ModelCommand(Model);
	if (!Command || !Job.OutputPath || !existsSync(Job.OutputPath)) return null;
	const ChunkPlan = SmartChunkPlanForJob(Job);
	if (ChunkPlan?.Chunks?.some((Chunk) => Chunk.Status === 'ready')) {
		return await TryChunkedLocalTranscription(Job, Command, Model, ChunkPlan);
	}
	const Dir = join(TranscriptRoot, `job-${Job.Id}`, 'generated');
	const Output = join(Dir, 'transcript.vtt');
	mkdirSync(Dir, { recursive: true });
	const ResolvedCommand = Command
		.replaceAll('{input}', Quote(Job.OutputPath))
		.replaceAll('{output}', Quote(Output))
		.replaceAll('{model}', Model);
	await RunCommand(ResolvedCommand, [], { Shell: true });
	if (!existsSync(Output)) throw new Error('Local speech-to-text command finished but did not create transcript.vtt');
	const Segments = ParseVtt(readFileSync(Output, 'utf8'));
	if (!Segments.length) throw new Error('Generated transcript.vtt did not contain readable timestamp segments');
	return {
		Text: SegmentsToText(Segments),
		Segments,
		Language: process.env.VANTAGE_TRANSCRIPT_LANGUAGE ?? 'unknown'
	};
}

async function TryChunkedLocalTranscription(Job: MediaJobRow, Command: string, Model: string, ChunkPlan: SmartChunkPlan) {
	const Chunks = (ChunkPlan.Chunks ?? []).filter((Chunk) => Chunk.Status === 'ready' && existsSync(Chunk.Path));
	if (!Chunks.length) return null;
	const Dir = join(TranscriptRoot, `job-${Job.Id}`, 'generated', 'chunks');
	mkdirSync(Dir, { recursive: true });
	const Segments: Segment[] = [];
	const ChunkStatuses: Array<{ Index: number; Label: string; Status: string; SegmentCount?: number; Error?: string }> = [];

	for (const Chunk of Chunks) {
		const Output = join(Dir, `chunk-${String(Chunk.Index).padStart(3, '0')}.vtt`);
		await SaveChunkTranscriptStatus(Job, ChunkPlan, ChunkStatuses, Chunk, 'transcribing');
		const ResolvedCommand = Command
			.replaceAll('{input}', Quote(Chunk.Path))
			.replaceAll('{output}', Quote(Output))
			.replaceAll('{model}', Model);
		try {
			await RunCommand(ResolvedCommand, [], { Shell: true });
			if (!existsSync(Output)) throw new Error('transcript.vtt was not created for this chunk');
			const ChunkSegments = ParseVtt(readFileSync(Output, 'utf8')).map((Segment) => OffsetSegment(Segment, Chunk.Start));
			Segments.push(...ChunkSegments);
			ChunkStatuses.push({ Index: Chunk.Index, Label: Chunk.Label, Status: 'done', SegmentCount: ChunkSegments.length });
			await SaveChunkTranscriptStatus(Job, ChunkPlan, ChunkStatuses, Chunk, 'done');
		} catch (Reason) {
			ChunkStatuses.push({
				Index: Chunk.Index,
				Label: Chunk.Label,
				Status: 'failed',
				Error: Reason instanceof Error ? Reason.message : 'Unknown chunk transcription error'
			});
			await SaveChunkTranscriptStatus(Job, ChunkPlan, ChunkStatuses, Chunk, 'failed');
		}
	}

	const FinalSegments = MergeDuplicateSegments(Segments.sort((A, B) => TimestampSeconds(A.Start) - TimestampSeconds(B.Start)));
	if (!FinalSegments.length) throw new Error('Chunked transcription finished but did not produce readable timestamp segments');
	return {
		Text: SegmentsToText(FinalSegments),
		Segments: FinalSegments,
		Language: process.env.VANTAGE_TRANSCRIPT_LANGUAGE ?? 'unknown'
	};
}

async function SaveTranscript(Job: MediaJobRow, Text: string, Segments: Segment[], Source: string, Language: string, Confidence: number, Model: string) {
	const Now = new Date().toISOString();
	const Enriched = await EnrichTranscript(Job, Text, Segments);
	const FinalSegments = Enriched?.Segments?.length ? Enriched.Segments : Segments;
	const FinalText = SegmentsToText(FinalSegments);
	const Metadata = await CurrentMetadata(Job.Id, Job.MetadataJson);
	await Run(
		`update media_jobs
		 set transcript_text = ?, transcript_format = ?, transcript_language = ?, transcript_confidence = ?, transcript_model = ?,
		 transcript_source = ?, transcript_segments_json = ?, transcript_words_json = ?, transcript_updated_at = ?,
		 metadata_json = ?, stage = ?, progress = ?, error_message = null, updated_at = ?
		 where id = ?`,
		[
			FinalText,
			'vtt-derived',
			Language,
			Confidence,
			Model,
			Enriched && !Enriched.Error ? `${Source} + transcript enrichment` : Source,
			JSON.stringify(FinalSegments),
			Enriched?.Words?.length ? JSON.stringify(Enriched.Words) : null,
			Now,
			JSON.stringify({ ...Metadata, TranscriptEnrichment: Enriched ? { Summary: Enriched.Summary ?? (Enriched.Error ? 'failed' : 'completed'), Error: Enriched.Error ?? null, Raw: Enriched.Raw ?? null } : { Summary: 'not configured' } }),
			'ready for review',
			70,
			Now,
			Job.Id
		]
	);
}

async function EnrichTranscript(Job: MediaJobRow, Text: string, Segments: Segment[]): Promise<EnrichmentResult | null> {
	const Command = process.env.VANTAGE_TRANSCRIPT_ENRICH_COMMAND;
	if (!Command?.trim()) return null;
	try {
		const Dir = join(TranscriptRoot, `job-${Job.Id}`, 'enrichment');
		const InputPath = join(Dir, 'transcript-input.json');
		mkdirSync(Dir, { recursive: true });
		writeFileSync(InputPath, JSON.stringify({ JobId: Job.Id, SourceUrl: Job.SourceUrl, VideoTitle: Job.VideoTitle, OutputPath: Job.OutputPath, Text, Segments }, null, 2));
		const Output = await RunShellCapture(Command, {
			...process.env,
			VANTAGE_TRANSCRIPT_INPUT_JSON: InputPath,
			VANTAGE_SOURCE_PATH: Job.OutputPath ?? '',
			VANTAGE_TRANSCRIPT_TEXT: Text.slice(0, 30000)
		}, Number(process.env.VANTAGE_TRANSCRIPT_ENRICH_TIMEOUT_MS ?? 180000));
		const Parsed = JSON.parse(Output) as EnrichmentResult;
		return {
			Segments: Array.isArray(Parsed.Segments) ? Parsed.Segments.filter(IsSegment) : undefined,
			Words: Array.isArray(Parsed.Words) ? Parsed.Words.filter(IsWord) : undefined,
			Summary: typeof Parsed.Summary === 'string' ? Parsed.Summary : undefined,
			Raw: Parsed
		};
	} catch (Reason) {
		return { Summary: 'failed', Error: Reason instanceof Error ? Reason.message : 'Unknown transcript enrichment error' };
	}
}

async function UpdateJob(
	Id: number,
	Patch: Partial<{ Stage: string; Progress: number; ErrorMessage: string | null }>
) {
	const Entries = Object.entries({
		stage: Patch.Stage,
		progress: Patch.Progress,
		error_message: Patch.ErrorMessage,
		updated_at: new Date().toISOString()
	}).filter(([, Value]) => Value !== undefined);
	const SetSql = Entries.map(([Key]) => `${Key} = ?`).join(', ');
	await Run(`update media_jobs set ${SetSql} where id = ?`, [...Entries.map(([, Value]) => Value), Id]);
}

async function RunCommand(Command: string, Args: string[], Options: { Shell?: boolean } = {}) {
	const Child = spawn(Command, Args, { shell: Options.Shell, windowsHide: true });
	let ErrorOutput = '';
	Child.stderr.on('data', (Chunk) => (ErrorOutput += String(Chunk)));
	const Code = await new Promise<number | null>((Resolve, Reject) => {
		Child.on('error', Reject);
		Child.on('close', Resolve);
	});
	if (Code !== 0) throw new Error(ErrorOutput.trim() || `${basename(Command)} exited with ${Code}`);
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
	if (Code !== 0) throw new Error(`${ErrorOutput.trim()}\n${Output.trim()}`.trim() || `${basename(Command)} exited with ${Code}`);
	return Output.trim();
}

function ParseVtt(Vtt: string): Segment[] {
	const Blocks = Vtt.replace(/\r/g, '').split(/\n\n+/);
	const Segments: Segment[] = [];
	for (const Block of Blocks) {
		const Lines = Block.split('\n').map((Line) => Line.trim()).filter(Boolean);
		const TimeIndex = Lines.findIndex((Line) => Line.includes('-->'));
		if (TimeIndex === -1) continue;
		const [StartRaw, EndRaw] = Lines[TimeIndex].split('-->').map((Part) => Part.trim().split(/\s+/)[0]);
		const Text = Lines.slice(TimeIndex + 1).map(CleanCaptionText).filter(Boolean).join(' ');
		if (!Text) continue;
		Segments.push({
			Start: NormalizeTimestamp(StartRaw),
			End: NormalizeTimestamp(EndRaw),
			Text,
			Speaker: DetectSpeaker(Text),
			Confidence: 0.92
		});
	}
	return MergeDuplicateSegments(Segments);
}

function MergeDuplicateSegments(Segments: Segment[]) {
	const Result: Segment[] = [];
	for (const Segment of Segments) {
		const Previous = Result.at(-1);
		if (Previous?.Text === Segment.Text) continue;
		Result.push(Segment);
	}
	return Result;
}

function CleanCaptionText(Text: string) {
	return Text
		.replace(/<[^>]+>/g, '')
		.replace(/\{\\[^}]+}/g, '')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/\s+/g, ' ')
		.trim();
}

function NormalizeTimestamp(Value = '00:00:00.000') {
	return Value.replace(',', '.');
}

function OffsetSegment(Segment: Segment, OffsetSeconds: number): Segment {
	return {
		...Segment,
		Start: FormatTimestamp(TimestampSeconds(Segment.Start) + OffsetSeconds),
		End: FormatTimestamp(TimestampSeconds(Segment.End) + OffsetSeconds)
	};
}

function TimestampSeconds(Value: string) {
	const Parts = Value.replace(',', '.').split(':').map(Number);
	if (Parts.some((Part) => !Number.isFinite(Part))) return 0;
	if (Parts.length === 3) return Parts[0] * 3600 + Parts[1] * 60 + Parts[2];
	if (Parts.length === 2) return Parts[0] * 60 + Parts[1];
	return Parts[0] || 0;
}

function FormatTimestamp(Seconds: number) {
	const Safe = Math.max(0, Seconds);
	const Hours = Math.floor(Safe / 3600);
	const Minutes = Math.floor((Safe % 3600) / 60);
	const WholeSeconds = Math.floor(Safe % 60);
	const Milliseconds = Math.round((Safe - Math.floor(Safe)) * 1000);
	return `${String(Hours).padStart(2, '0')}:${String(Minutes).padStart(2, '0')}:${String(WholeSeconds).padStart(2, '0')}.${String(Milliseconds).padStart(3, '0')}`;
}

function SegmentsToText(Segments: Segment[]) {
	return Segments.map((Segment) => `[${Segment.Start} - ${Segment.End}] ${Segment.Text}`).join('\n');
}

function CaptionLanguage(File: string) {
	const Match = File.match(/\.([a-z]{2}(?:-[A-Z]{2})?)\.vtt$/);
	return Match?.[1] ?? process.env.VANTAGE_TRANSCRIPT_LANGUAGE ?? 'unknown';
}

function DetectSpeaker(Text: string) {
	const Match = Text.match(/^([^:]{2,32}):\s+/);
	return Match?.[1]?.trim();
}

function TranscriptModel(Job: MediaJobRow) {
	return (Job.TranscriptModel || process.env.VANTAGE_TRANSCRIPT_MODEL || 'auto').trim();
}

function ModelCommand(Model: string) {
	const Key = `VANTAGE_TRANSCRIBE_COMMAND_${Model.replace(/[^a-z0-9]/gi, '_').toUpperCase()}`;
	return process.env[Key] || process.env.VANTAGE_TRANSCRIBE_COMMAND;
}

function Quote(Value: string) {
	return `"${Value.replaceAll('"', '\\"')}"`;
}

function ParseMetadata(Raw?: string | null) {
	if (!Raw) return {};
	try {
		return JSON.parse(Raw) as Record<string, unknown>;
	} catch {
		return {};
	}
}

function SmartChunkPlanForJob(Job: MediaJobRow): SmartChunkPlan | null {
	const Metadata = ParseMetadata(Job.MetadataJson) as { SmartChunks?: SmartChunkPlan };
	return Metadata.SmartChunks?.Status === 'ready' ? Metadata.SmartChunks : null;
}

async function SaveChunkTranscriptStatus(
	Job: MediaJobRow,
	ChunkPlan: SmartChunkPlan,
	Statuses: Array<{ Index: number; Label: string; Status: string; SegmentCount?: number; Error?: string }>,
	CurrentChunk: SmartChunk,
	Status: string
) {
	const Metadata = ParseMetadata(Job.MetadataJson);
	const Done = Statuses.filter((Chunk) => Chunk.Status === 'done').length;
	const Total = ChunkPlan.Chunks?.filter((Chunk) => Chunk.Status === 'ready').length ?? 0;
	const Progress = Total ? Math.min(68, 58 + Math.round((Done / Total) * 10)) : 58;
	const Now = new Date().toISOString();
	await Run(
		`update media_jobs
		 set progress = ?, metadata_json = ?, updated_at = ?, claim_expires_at = ?
		 where id = ?`,
		[
			Progress,
			JSON.stringify({
				...Metadata,
				SmartChunks: ChunkPlan,
				ChunkTranscript: {
					Status,
					CurrentIndex: CurrentChunk.Index,
					CurrentLabel: CurrentChunk.Label,
					Done,
					Total,
					UpdatedAt: Now,
					Chunks: Statuses
				}
			}),
			Now,
			new Date(Date.now() + TranscriptClaimSeconds * 1000).toISOString(),
			Job.Id
		]
	);
}

async function CurrentMetadata(Id: number, Fallback?: string | null) {
	const Row = await Get<{ MetadataJson?: string | null }>('select metadata_json as "MetadataJson" from media_jobs where id = ? and claimed_by = ?', [Id, WorkerInstanceId]);
	return ParseMetadata(Row?.MetadataJson ?? Fallback);
}

function IsSegment(Value: unknown): Value is Segment {
	if (!Value || typeof Value !== 'object') return false;
	const Segment = Value as Partial<Segment>;
	return typeof Segment.Start === 'string' && typeof Segment.End === 'string' && typeof Segment.Text === 'string';
}

function IsWord(Value: unknown): Value is TranscriptWord {
	if (!Value || typeof Value !== 'object') return false;
	return typeof (Value as Partial<TranscriptWord>).Word === 'string';
}
