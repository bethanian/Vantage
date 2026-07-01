import { All, EnsureAppDatabaseReady, Get, NextId, Run } from '../src/lib/server/db/app-db';

type MediaJobRow = {
	Id: number;
	VideoTitle: string;
	Creator: string;
	Stage: string;
	Duration: string;
	TranscriptText?: string | null;
	LiveChunkSeconds?: number | null;
	LiveAnalyzeWhileRecording?: boolean | number | null;
	LiveGeneratePeriodicClips?: boolean | number | null;
	LiveMarkedMomentsJson?: string | null;
	MetadataJson?: string | null;
	ManualContext?: string | null;
};

type LiveMoment = { At?: string; Timestamp?: string; Label?: string; Actor?: string };
type LiveState = { ProcessedMomentKeys?: string[]; LastChunkIndex?: number; UpdatedAt?: string };

const RunOnce = process.argv.includes('--once');
const PollMs = Number(process.env.VANTAGE_LIVE_CHUNK_WORKER_POLL_MS ?? 5000);
const DefaultChunkSeconds = Number(process.env.VANTAGE_LIVE_CHUNK_SECONDS ?? 300);
const MaxCandidatesPerPass = Number(process.env.VANTAGE_LIVE_CHUNK_MAX_PER_PASS ?? 5);

await EnsureAppDatabaseReady();
await RunWorker();

if (!RunOnce) {
	console.log(JSON.stringify({ Status: 'WatchingLiveChunks', PollMs }));
	setInterval(RunWorker, PollMs);
}

async function RunWorker() {
	const Jobs = await NextJobs();
	if (!Jobs.length) {
		if (RunOnce) console.log(JSON.stringify({ Status: 'Idle' }));
		return;
	}
	for (const Job of Jobs) {
		try {
			await ProcessJob(Job);
		} catch (Reason) {
			const Message = Reason instanceof Error ? Reason.message : 'Unknown live chunk worker error';
			await Run('update media_jobs set error_message = ?, updated_at = ? where id = ?', [Message, new Date().toISOString(), Job.Id]);
			console.error(JSON.stringify({ Status: 'Failed', JobId: Job.Id, Message }));
		}
	}
}

async function NextJobs() {
	return await All<MediaJobRow>(
		`select id as "Id", video_title as "VideoTitle", creator as "Creator", stage as "Stage", duration as "Duration",
		 transcript_text as "TranscriptText", live_chunk_seconds as "LiveChunkSeconds",
		 live_analyze_while_recording as "LiveAnalyzeWhileRecording", live_generate_periodic_clips as "LiveGeneratePeriodicClips",
		 live_marked_moments_json as "LiveMarkedMomentsJson", metadata_json as "MetadataJson", manual_context as "ManualContext"
		 from media_jobs
		 where cancelled_at is null
		   and (live_analyze_while_recording = 1 or live_analyze_while_recording = true or live_generate_periodic_clips = 1 or live_generate_periodic_clips = true)
		   and stage not in ('failed', 'paused', 'requires manual review')
		 order by priority desc, id asc
		 limit 8`
	);
}

async function ProcessJob(Job: MediaJobRow) {
	const Metadata = ParseMetadata(Job.MetadataJson);
	const State = ((Metadata.LiveChunkAnalysis ?? {}) as LiveState) || {};
	const Created = [];
	for (const Candidate of CandidateMoments(Job, State).slice(0, MaxCandidatesPerPass)) {
		const Exists = await Get<{ Id: number }>(
			'select id as "Id" from clip_candidates where media_job_id = ? and start_time = ? and end_time = ? and variant = ? limit 1',
			[Job.Id, Candidate.StartTime, Candidate.EndTime, Candidate.Variant]
		);
		if (Exists) continue;
		await InsertCandidate(Job.Id, Candidate);
		Created.push(Candidate);
	}
	const NextState = NextLiveState(Job, State, Created);
	await Run('update media_jobs set metadata_json = ?, updated_at = ? where id = ?', [
		JSON.stringify({ ...Metadata, LiveChunkAnalysis: NextState }),
		new Date().toISOString(),
		Job.Id
	]);
	if (Created.length) console.log(JSON.stringify({ Status: 'LiveChunksGenerated', JobId: Job.Id, Created: Created.length }));
	else if (RunOnce) console.log(JSON.stringify({ Status: 'NoLiveChunksReady', JobId: Job.Id }));
}

function CandidateMoments(Job: MediaJobRow, State: LiveState) {
	const ChunkSeconds = Math.max(30, Number(Job.LiveChunkSeconds ?? DefaultChunkSeconds));
	const Processed = new Set(State.ProcessedMomentKeys ?? []);
	const Moments = ParseMoments(Job.LiveMarkedMomentsJson)
		.map((Moment) => ({ ...Moment, Key: MomentKey(Moment), Seconds: MomentSeconds(Moment) }))
		.filter((Moment) => !Processed.has(Moment.Key));
	const Marked = Moments.map((Moment) => {
		const Start = Math.max(0, Moment.Seconds - Math.floor(ChunkSeconds * 0.35));
		const End = Start + ChunkSeconds;
		return Candidate(Job, Start, End, `Marked live moment: ${Moment.Label || 'Live moment'}`, 'live marked moment');
	});
	if (!Truthy(Job.LiveGeneratePeriodicClips)) return Marked;
	const LastIndex = Number(State.LastChunkIndex ?? -1);
	const Duration = MediaDurationSeconds(Job);
	const NextIndex = LastIndex + 1;
	const Start = NextIndex * ChunkSeconds;
	const Periodic = Duration && Start + 20 <= Duration ? [Candidate(Job, Start, Math.min(Duration, Start + ChunkSeconds), `Rolling live chunk ${NextIndex + 1}`, 'live rolling chunk')] : [];
	return [...Marked, ...Periodic];
}

function Candidate(Job: MediaJobRow, Start: number, End: number, Reason: string, Variant: string) {
	const Snippet = TranscriptSnippet(Job.TranscriptText, Start, End);
	const HasMarkedContext = /moment|mark|chat|clip/i.test(`${Reason} ${Job.ManualContext ?? ''}`);
	const Score = Math.min(92, 66 + (Snippet ? 8 : 0) + (HasMarkedContext ? 12 : 0));
	return {
		Title: `${Job.Creator} live: ${Reason}`,
		StartTime: FormatTimestamp(Start),
		EndTime: FormatTimestamp(Math.max(Start + 10, End)),
		Duration: `${Math.max(10, Math.round(End - Start))}s`,
		Score,
		Category: HasMarkedContext ? 'reaction' : 'live',
		Explanation: `${Reason}. ${Snippet ? `Transcript cue: ${Snippet.slice(0, 180)}` : 'Review this rolling live section for clip potential.'}`,
		Variant
	};
}

async function InsertCandidate(MediaJobId: number, Candidate: ReturnType<typeof Candidate>) {
	const ClipNumber = await NextClipNumber(MediaJobId);
	await Run(
		`insert into clip_candidates
		 (id, media_job_id, clip_number, title, start_time, end_time, duration, viral_score, category, explanation,
		  hook_score, context_score, emotion_score, humor_score, controversy_score, payoff_score, retention_score,
		  shareability_score, originality_score, status, variant, review_notes, created_at)
		 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			await NextId('clip_candidates'),
			MediaJobId,
			ClipNumber,
			Candidate.Title,
			Candidate.StartTime,
			Candidate.EndTime,
			Candidate.Duration,
			Candidate.Score,
			Candidate.Category,
			Candidate.Explanation,
			Math.min(100, Candidate.Score + 4),
			72,
			76,
			55,
			50,
			70,
			76,
			74,
			68,
			'Suggested',
			Candidate.Variant,
			'Generated by live chunk worker. Verify exact timing before export.',
			new Date().toISOString()
		]
	);
}

function NextLiveState(Job: MediaJobRow, State: LiveState, Created: Array<{ Variant: string; StartTime: string }>): LiveState {
	const Processed = new Set(State.ProcessedMomentKeys ?? []);
	for (const Moment of ParseMoments(Job.LiveMarkedMomentsJson)) Processed.add(MomentKey(Moment));
	const Rolling = Created.filter((Candidate) => Candidate.Variant === 'live rolling chunk').map((Candidate) => TimestampSeconds(Candidate.StartTime));
	const ChunkSeconds = Math.max(30, Number(Job.LiveChunkSeconds ?? DefaultChunkSeconds));
	const LastChunkIndex = Rolling.length ? Math.max(Number(State.LastChunkIndex ?? -1), ...Rolling.map((Start) => Math.floor(Start / ChunkSeconds))) : State.LastChunkIndex;
	return { ProcessedMomentKeys: [...Processed].slice(-200), LastChunkIndex, UpdatedAt: new Date().toISOString() };
}

async function NextClipNumber(MediaJobId: number) {
	const Row = await Get<{ MaxClip?: number | null }>('select max(clip_number) as "MaxClip" from clip_candidates where media_job_id = ?', [MediaJobId]);
	return Number(Row?.MaxClip ?? 0) + 1;
}

function ParseMetadata(Raw?: string | null) {
	if (!Raw) return {};
	try {
		return JSON.parse(Raw) as Record<string, unknown>;
	} catch {
		return {};
	}
}

function ParseMoments(Raw?: string | null): LiveMoment[] {
	if (!Raw) return [];
	try {
		const Parsed = JSON.parse(Raw) as LiveMoment[];
		return Array.isArray(Parsed) ? Parsed : [];
	} catch {
		return [];
	}
}

function MomentKey(Moment: LiveMoment) {
	return `${Moment.At ?? ''}:${Moment.Timestamp ?? ''}:${Moment.Label ?? ''}:${Moment.Actor ?? ''}`;
}

function MomentSeconds(Moment: LiveMoment) {
	if (Moment.Timestamp && Moment.Timestamp !== 'live') return TimestampSeconds(Moment.Timestamp);
	return 0;
}

function MediaDurationSeconds(Job: MediaJobRow) {
	const Match = `${Job.Duration} ${Job.TranscriptText ?? ''}`.match(/(\d{1,2}:\d{2}(?::\d{2})?)/g);
	return Match?.length ? Math.max(...Match.map(TimestampSeconds)) : 0;
}

function TranscriptSnippet(Text: string | null | undefined, Start: number, End: number) {
	if (!Text) return '';
	const Lines = Text.split(/\r?\n/).filter((Line) => {
		const Match = Line.match(/\[?(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)\s*(?:-|–|-->|to)/);
		if (!Match) return false;
		const Seconds = TimestampSeconds(Match[1]);
		return Seconds >= Math.max(0, Start - 12) && Seconds <= End + 12;
	});
	return Lines.slice(0, 6).join(' ');
}

function TimestampSeconds(Value: string) {
	const Parts = Value.split(':').map(Number);
	if (Parts.some((Part) => !Number.isFinite(Part))) return 0;
	if (Parts.length === 3) return Parts[0] * 3600 + Parts[1] * 60 + Parts[2];
	if (Parts.length === 2) return Parts[0] * 60 + Parts[1];
	return Parts[0] ?? 0;
}

function FormatTimestamp(Value: number) {
	const Seconds = Math.max(0, Math.floor(Value));
	return `${Math.floor(Seconds / 60)}:${String(Seconds % 60).padStart(2, '0')}`;
}

function Truthy(Value: unknown) {
	return Value === true || Value === 1 || Value === '1';
}
