import { EnsureAppDatabaseReady, Get, NextId, Run } from '../src/lib/server/db/app-db';
import { GetApiCredential } from '../src/lib/server/api-credentials';

type MediaJobRow = {
	Id: number;
	VideoTitle: string;
	SourcePlatform: string;
	MediaStatus: string;
	TranscriptText: string;
	TranscriptSource?: string | null;
	TranscriptConfidence?: number | null;
	ManualContext?: string | null;
	LiveMarkedMomentsJson?: string | null;
	AnalysisRequestJson?: string | null;
	MetadataJson?: string | null;
};

type AnalysisRequest = {
	DesiredCount?: number;
	MinimumDuration?: string;
	MaximumDuration?: string;
	TargetPlatform?: string;
	PreferredTopics?: string;
	MomentsToAvoid?: string;
	PreferredClipStyle?: string;
	AllowOverlap?: boolean;
	IncludeContext?: boolean;
	LoopEnding?: boolean;
	ProfanityAllowed?: boolean;
	PrioritizeControversy?: boolean;
};

type ClipCandidate = {
	Title?: string;
	StartTime: string;
	EndTime: string;
	Duration?: string;
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
	Variant?: string;
	ReviewNotes?: string;
};

type AnalysisResult = {
	Engine: string;
	Report: Record<string, unknown>;
	Clips: ClipCandidate[];
};

type GeminiResponse = {
	candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
	error?: { message?: string; status?: string; code?: number };
};

const RunOnce = process.argv.includes('--once');
const PollMs = Number(process.env.VANTAGE_ANALYSIS_WORKER_POLL_MS ?? 5000);
const GeminiModel = process.env.VANTAGE_GEMINI_MODEL || 'gemini-2.5-flash';

await EnsureAppDatabaseReady();
await RunWorker();

if (!RunOnce) {
	console.log(JSON.stringify({ Status: 'WatchingAnalysisJobs', PollMs, GeminiModel }));
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
		const Message = Reason instanceof Error ? Reason.message : 'Unknown analysis worker error';
		await UpdateJob(Job.Id, 'failed', 72, Message);
		console.error(JSON.stringify({ Status: 'Failed', JobId: Job.Id, Message }));
	}
}

async function NextJob() {
	return await Get<MediaJobRow>(
		`select id as "Id", video_title as "VideoTitle", source_platform as "SourcePlatform", media_status as "MediaStatus",
		 transcript_text as "TranscriptText", transcript_source as "TranscriptSource", transcript_confidence as "TranscriptConfidence",
		 manual_context as "ManualContext", live_marked_moments_json as "LiveMarkedMomentsJson",
		 analysis_request_json as "AnalysisRequestJson", metadata_json as "MetadataJson"
		 from media_jobs
		 where stage in ('analyzing topics', 'detecting candidate clips', 'scoring clips')
		   and transcript_text is not null
		   and cancelled_at is null
		 order by priority desc, id asc
		 limit 1`
	);
}

async function ProcessJob(Job: MediaJobRow) {
	const Request = ParseRequest(Job.AnalysisRequestJson);
	await UpdateJob(Job.Id, 'detecting candidate clips', 76, null);
	const Result = await AnalyzeWithGemini(Job, Request).catch(async (Reason) => {
		await UpdateJob(Job.Id, 'scoring clips', 80, `Gemini unavailable, using local fallback: ${Reason instanceof Error ? Reason.message : 'unknown error'}`);
		return LocalAnalysis(Job, Request, 'local fallback');
	});

	await UpdateJob(Job.Id, 'scoring clips', 82, null);
	await SaveCandidates(Job.Id, Result.Clips);
	await Run(
		`update media_jobs
		 set stage = ?, progress = ?, analysis_report_json = ?, analysis_updated_at = ?, error_message = null, updated_at = ?
		 where id = ?`,
		['ready for review', 85, JSON.stringify(Result.Report), new Date().toISOString(), new Date().toISOString(), Job.Id]
	);
	console.log(JSON.stringify({ Status: 'AnalysisComplete', JobId: Job.Id, Engine: Result.Engine, Clips: Result.Clips.length }));
}

async function AnalyzeWithGemini(Job: MediaJobRow, Request: AnalysisRequest): Promise<AnalysisResult> {
	const Keys = await GeminiKeys();
	if (!Keys.length) throw new Error('No Gemini API keys configured');
	const Prompt = BuildPrompt(Job, Request);
	const Errors: string[] = [];

	for (const Key of Keys) {
		try {
			const Payload = await GeminiGenerate(Key, Prompt);
			const Result = CoerceGeminiResult(Payload, Job, Request);
			return { ...Result, Engine: `gemini:${GeminiModel}` };
		} catch (Reason) {
			Errors.push(Reason instanceof Error ? Reason.message : 'Unknown Gemini error');
		}
	}
	throw new Error(Errors.join(' | ') || 'All Gemini keys failed');
}

async function GeminiGenerate(ApiKey: string, Prompt: string) {
	const Response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GeminiModel}:generateContent`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'x-goog-api-key': ApiKey
		},
		body: JSON.stringify({
			contents: [{ role: 'user', parts: [{ text: Prompt }] }],
			generationConfig: {
				responseMimeType: 'application/json',
				temperature: 0.35
			}
		}),
		signal: AbortSignal.timeout(Number(process.env.VANTAGE_GEMINI_TIMEOUT_MS ?? 45000))
	});
	const Body = (await Response.json()) as GeminiResponse;
	if (!Response.ok) throw new Error(Body.error?.message ?? `Gemini HTTP ${Response.status}`);
	const Text = Body.candidates?.[0]?.content?.parts?.map((Part) => Part.text ?? '').join('\n').trim();
	if (!Text) throw new Error('Gemini returned no text');
	return JSON.parse(StripJsonFence(Text)) as unknown;
}

function CoerceGeminiResult(Payload: unknown, Job: MediaJobRow, Request: AnalysisRequest): Omit<AnalysisResult, 'Engine'> {
	const Source = Payload as { clips?: unknown[]; report?: Record<string, unknown> };
	const Clips = (Array.isArray(Source.clips) ? Source.clips : [])
		.map((Clip, Index) => CoerceClip(Clip as Partial<ClipCandidate>, Index))
		.filter(Boolean)
		.slice(0, DesiredCount(Request));
	if (!Clips.length) throw new Error('Gemini returned no usable clips');
	return {
		Clips,
		Report: {
			Version: 2,
			Engine: 'gemini',
			Model: GeminiModel,
			GeneratedAt: new Date().toISOString(),
			RequestedClips: DesiredCount(Request),
			Source: SourceSummary(Job),
			...(Source.report ?? {}),
			FinalCandidates: Clips.map((Clip) => ({
				StartTime: Clip.StartTime,
				EndTime: Clip.EndTime,
				Score: Clip.ViralScore,
				Category: Clip.Category,
				Reason: Clip.Explanation
			}))
		}
	};
}

function LocalAnalysis(Job: MediaJobRow, Request: AnalysisRequest, Engine: string): AnalysisResult {
	const Desired = DesiredCount(Request);
	const Sections = TopicSections(Job.TranscriptText);
	const Raw = CandidateMoments(Job.TranscriptText, Math.max(Desired * 3, Desired + 4), Request);
	const Clips = VariedFinalSet(Raw, Desired);
	return {
		Engine,
		Clips,
		Report: {
			Version: 2,
			Engine,
			GeneratedAt: new Date().toISOString(),
			RequestedClips: Desired,
			Source: SourceSummary(Job),
			Stages: [
				{ Name: 'Topic segmentation', Summary: `${Sections.length} transcript sections identified`, Items: Sections },
				{ Name: 'Candidate discovery', Summary: `${Raw.length} candidate moments generated from transcript meaning and manual context` },
				{ Name: 'Signal scoring', Summary: 'Candidates scored for hook, context, emotion, humor, controversy, payoff, retention, shareability, and originality.' },
				{ Name: 'Variety filter', Summary: 'Final clips are selected to reduce repeated categories.' },
				{ Name: 'Manual review', Summary: 'Selections are editable before export.' }
			],
			SignalCoverage: [
				{ Signal: 'Transcript meaning', Status: 'available' },
				{ Signal: 'Manual context', Status: Job.ManualContext ? 'available' : 'not provided' },
				{ Signal: 'Chat activity', Status: ChatActivity(Job).Summary ?? (Job.LiveMarkedMomentsJson ? 'manual live marks available' : 'not connected') },
				{ Signal: 'Scene detection', Status: MediaSignals(Job).Scenes?.length ? `${MediaSignals(Job).Scenes.length} scene changes detected` : 'not available' },
				{ Signal: 'Audio events', Status: MediaSignals(Job).Audio?.Events?.length ? `${MediaSignals(Job).Audio.Events.length} audio pacing events detected` : 'not available' },
				{ Signal: 'Face/gameplay detection', Status: MediaSignals(Job).Visual?.FaceDetection || MediaSignals(Job).Visual?.GameplayDetection || 'not configured' }
			],
			FinalCandidates: Clips.map((Clip) => ({
				StartTime: Clip.StartTime,
				EndTime: Clip.EndTime,
				Score: Clip.ViralScore,
				Category: Clip.Category,
				Reason: Clip.Explanation
			}))
		}
	};
}

async function SaveCandidates(MediaJobId: number, Clips: ClipCandidate[]) {
	await Run('delete from clip_candidates where media_job_id = ?', [MediaJobId]);
	for (const [Index, Clip] of Clips.entries()) {
		await Run(
			`insert into clip_candidates
			 (id, media_job_id, clip_number, title, start_time, end_time, duration, viral_score, category, explanation,
			  hook_score, context_score, emotion_score, humor_score, controversy_score, payoff_score,
			  retention_score, shareability_score, originality_score, status, variant, review_notes, created_at)
			 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				await NextId('clip_candidates'),
				MediaJobId,
				Index + 1,
				Clip.Title || `Clip ${Index + 1}`,
				Clip.StartTime,
				Clip.EndTime,
				Clip.Duration || DurationLabel(Clip.StartTime, Clip.EndTime),
				ClampScore(Clip.ViralScore),
				Clip.Category || 'reaction',
				Clip.Explanation || 'Selected as a high-potential clip candidate.',
				ClampScore(Clip.HookScore),
				ClampScore(Clip.ContextScore),
				ClampScore(Clip.EmotionScore),
				ClampScore(Clip.HumorScore),
				ClampScore(Clip.ControversyScore),
				ClampScore(Clip.PayoffScore),
				ClampScore(Clip.RetentionScore),
				ClampScore(Clip.ShareabilityScore),
				ClampScore(Clip.OriginalityScore),
				'Suggested',
				Clip.Variant || 'ai selected',
				Clip.ReviewNotes || '',
				new Date().toISOString()
			]
		);
	}
}

async function UpdateJob(Id: number, Stage: string, Progress: number, ErrorMessage: string | null) {
	await Run('update media_jobs set stage = ?, progress = ?, error_message = ?, updated_at = ? where id = ?', [
		Stage,
		Progress,
		ErrorMessage,
		new Date().toISOString(),
		Id
	]);
}

async function GeminiKeys() {
	const Stored = await GetApiCredential('GEMINI_API_KEYS');
	const Inline = [process.env.GEMINI_API_KEYS, process.env.GEMINI_API_KEY, Stored].filter(Boolean).join('\n');
	const Numbered = Object.entries(process.env)
		.filter(([Key]) => /^GEMINI_API_KEY_\d+$/i.test(Key))
		.map(([, Value]) => Value ?? '');
	return [...Inline.split(/[\s,;]+/), ...Numbered]
		.map((Key) => Key.trim())
		.filter(Boolean)
		.filter((Key, Index, Keys) => Keys.indexOf(Key) === Index);
}

function BuildPrompt(Job: MediaJobRow, Request: AnalysisRequest) {
	return `You are Vantage, an assisted AI editor for short-form clipping.
Analyze this transcript and return strict JSON only.

Return shape:
{
  "clips": [{
    "Title": "short clip name",
    "StartTime": "0:00",
    "EndTime": "0:45",
    "ViralScore": 1-100,
    "Category": "reaction|conflict|humor|story|payoff|gameplay|controversy|quote",
    "Explanation": "simple reason this moment should work as a clip",
    "HookScore": 1-100,
    "ContextScore": 1-100,
    "EmotionScore": 1-100,
    "HumorScore": 1-100,
    "ControversyScore": 1-100,
    "PayoffScore": 1-100,
    "RetentionScore": 1-100,
    "ShareabilityScore": 1-100,
    "OriginalityScore": 1-100,
    "Variant": "strongest hook|full-context|shortest|highest-retention|clean|uncensored",
    "ReviewNotes": "what to inspect manually"
  }],
  "report": {
    "Stages": [{"Name":"Topic segmentation","Summary":"..."}],
    "SignalCoverage": [{"Signal":"Transcript meaning","Status":"available"}],
    "RejectedWeaknesses": [{"Text":"...","Reason":"..."}]
  }
}

Rules:
- Return ${DesiredCount(Request)} varied clips.
- Clip duration should stay between ${Request.MinimumDuration || '20s'} and ${Request.MaximumDuration || '75s'} unless transcript context forces otherwise.
- Target platform: ${Request.TargetPlatform || 'TikTok'}.
- Preferred style: ${Request.PreferredClipStyle || 'viral clipping'}.
- Preferred topics: ${Request.PreferredTopics || 'none'}.
- Moments to avoid: ${Request.MomentsToAvoid || 'none'}.
- Overlap allowed: ${Boolean(Request.AllowOverlap)}.
- Include earlier context: ${Boolean(Request.IncludeContext)}.
- End on loop: ${Boolean(Request.LoopEnding)}.
- Profanity allowed: ${Boolean(Request.ProfanityAllowed)}.
- Prioritize controversy: ${Boolean(Request.PrioritizeControversy)}.
- Do not choose clips based only on keywords. Score context, emotion, humor, conflict, payoff, standalone clarity, retention, and shareability.

Source:
${JSON.stringify(SourceSummary(Job), null, 2)}

Manual/live context:
${Job.ManualContext || ''}
${Job.LiveMarkedMomentsJson || ''}

Media signals:
${JSON.stringify(MediaSignalSummary(Job), null, 2)}

Chat activity:
${JSON.stringify(ChatActivity(Job), null, 2)}

Transcript:
${Job.TranscriptText.slice(0, Number(process.env.VANTAGE_ANALYSIS_TRANSCRIPT_CHARS ?? 70000))}`;
}

function ParseRequest(Raw?: string | null): AnalysisRequest {
	if (!Raw) return {};
	try {
		return JSON.parse(Raw) as AnalysisRequest;
	} catch {
		return {};
	}
}

function ParseMetadata(Raw?: string | null) {
	if (!Raw) return {};
	try {
		return JSON.parse(Raw) as Record<string, unknown>;
	} catch {
		return {};
	}
}

function SourceSummary(Job: MediaJobRow) {
	return {
		Title: Job.VideoTitle,
		Platform: Job.SourcePlatform,
		MediaStatus: Job.MediaStatus,
		TranscriptSource: Job.TranscriptSource ?? 'unknown',
		TranscriptConfidence: Job.TranscriptConfidence ?? null,
		MediaSignals: MediaSignalSummary(Job),
		ChatActivity: ChatActivity(Job)
	};
}

function MediaSignals(Job: MediaJobRow) {
	const Metadata = ParseMetadata(Job.MetadataJson);
	return (Metadata.MediaSignals ?? {}) as {
		Scenes?: Array<{ Timestamp?: string; FramePath?: string }>;
		Audio?: { MeanVolume?: string | null; MaxVolume?: string | null; Events?: Array<{ Timestamp?: string; Label?: string; Strength?: number }> };
		Visual?: {
			SceneCount?: number;
			FaceDetection?: DetectorResult | string;
			GameplayDetection?: DetectorResult | string;
			SampledFrames?: string[];
		};
	};
}

function MediaSignalSummary(Job: MediaJobRow) {
	const Signals = MediaSignals(Job);
	return {
		SceneCount: Signals.Scenes?.length ?? 0,
		Scenes: Signals.Scenes?.slice(0, 12).map((Scene) => ({ Timestamp: Scene.Timestamp, FramePath: Scene.FramePath })) ?? [],
		Audio: {
			MeanVolume: Signals.Audio?.MeanVolume ?? null,
			MaxVolume: Signals.Audio?.MaxVolume ?? null,
			Events: Signals.Audio?.Events?.slice(0, 12) ?? []
		},
		Visual: Signals.Visual ?? null
	};
}

function ChatActivity(Job: MediaJobRow) {
	const Metadata = ParseMetadata(Job.MetadataJson);
	return (Metadata.ChatActivity ?? {}) as {
		Status?: string;
		Summary?: string;
		Messages?: Array<{ Timestamp?: string; Author?: string; Text?: string; Weight?: number }>;
		Events?: Array<{ Timestamp?: string; Label?: string; Strength?: number; MessageCount?: number }>;
		Error?: string;
	};
}

type DetectorResult = {
	Status?: string;
	Summary?: string;
	Events?: Array<{ Timestamp?: string; Label?: string; Strength?: number; FramePath?: string }>;
	Error?: string;
};

function CandidateMoments(Transcript: string, Count: number, Request: AnalysisRequest) {
	const Sentences = Transcript.split(/(?<=[.!?])\s+|\n+/).map((Sentence) => Sentence.trim()).filter(Boolean);
	const Source = Sentences.length ? Sentences : [Transcript.trim()].filter(Boolean);
	return Source
		.map((Text, Index) => {
			const Signals = SignalVector(Text, Request);
			const StartSeconds = Index * 42;
			const DurationSeconds = Math.max(25, Math.min(75, 20 + Math.ceil(Text.length / 14)));
			const Score = ClampScore(Signals.Overall);
			return {
				Title: `Clip ${Index + 1}`,
				StartTime: FormatTimestamp(StartSeconds),
				EndTime: FormatTimestamp(StartSeconds + DurationSeconds),
				Duration: `${DurationSeconds}s`,
				ViralScore: Score,
				Category: ClipCategory(Text),
				Explanation: `Selected because it has ${ReasonText(Text)} and can stand alone with a clear setup/payoff window.`,
				HookScore: Signals.Hook,
				ContextScore: Signals.Context,
				EmotionScore: Signals.Emotion,
				HumorScore: Signals.Humor,
				ControversyScore: Signals.Controversy,
				PayoffScore: Signals.Payoff,
				RetentionScore: Signals.Retention,
				ShareabilityScore: Signals.Shareability,
				OriginalityScore: Signals.Originality,
				Variant: 'local fallback',
				ReviewNotes: 'Check exact start/end before export.'
			};
		})
		.sort((A, B) => B.ViralScore - A.ViralScore)
		.slice(0, Count);
}

function TopicSections(Transcript: string) {
	const Sentences = Transcript.split(/(?<=[.!?])\s+|\n+/).map((Line) => Line.trim()).filter(Boolean);
	const Size = Math.max(3, Math.ceil(Sentences.length / 6));
	const Sections = [];
	for (let Index = 0; Index < Sentences.length; Index += Size) {
		const Text = Sentences.slice(Index, Index + Size).join(' ');
		Sections.push({ Topic: ClipCategory(Text), Start: FormatTimestamp(Index * 42), Summary: Text.slice(0, 220) });
	}
	return Sections.length ? Sections : [{ Topic: 'conversation', Start: '0:00', Summary: 'No transcript sections were available.' }];
}

function SignalVector(Text: string, Request: AnalysisRequest) {
	const Preferred = (Request.PreferredTopics || '').toLowerCase();
	const Avoid = (Request.MomentsToAvoid || '').toLowerCase();
	const Lower = Text.toLowerCase();
	const PreferredHit = Preferred && Preferred.split(',').some((Term) => Term.trim() && Lower.includes(Term.trim()));
	const AvoidHit = Avoid && Avoid.split(',').some((Term) => Term.trim() && Lower.includes(Term.trim()));
	const Hook = ClampScore(55 + MatchCount(Text, [/^["'A-Z0-9]/, /\?/, /!/, /\b(wait|look|listen|no way|what)\b/i]) * 9);
	const Context = ClampScore(62 + (Text.length > 80 ? 10 : -8) + (/\b(because|after|before|then|but)\b/i.test(Text) ? 7 : 0));
	const Emotion = ClampScore(50 + MatchCount(Text, [/\b(insane|crazy|wild|shocked|angry|cry|scream)\b/i, /!/, /\b(no way)\b/i]) * 11);
	const Humor = ClampScore(45 + MatchCount(Text, [/\b(lol|funny|laugh|bro|chat)\b/i, /\b(troll|joke)\b/i]) * 12);
	const Controversy = ClampScore(42 + MatchCount(Text, [/\b(drama|accuse|expose|ban|scam|fight|wrong|leak)\b/i]) * 16);
	const Payoff = ClampScore(50 + MatchCount(Text, [/\b(finally|actually|because|turns out|then)\b/i]) * 10);
	const Retention = ClampScore(54 + (Hook > 70 ? 8 : 0) + (Emotion > 70 ? 8 : 0) + (Text.length > 150 ? -8 : 4));
	const Shareability = ClampScore(50 + MatchCount(Text, [/\b(everyone|nobody|best|worst|you|they)\b/i]) * 9 + (PreferredHit ? 8 : 0));
	const Originality = ClampScore(48 + MatchCount(Text, [/\b(first|never|only|unexpected|new)\b/i]) * 13);
	const Penalty = AvoidHit ? 18 : 0;
	const Overall = ClampScore((Hook + Context + Emotion + Humor + Controversy + Payoff + Retention + Shareability + Originality) / 9 - Penalty);
	return { Hook, Context, Emotion, Humor, Controversy, Payoff, Retention, Shareability, Originality, Overall };
}

function VariedFinalSet(Candidates: ClipCandidate[], Count: number) {
	const Picked: ClipCandidate[] = [];
	for (const Candidate of Candidates) {
		const CategoryUsed = Picked.some((Item) => Item.Category === Candidate.Category);
		if (!CategoryUsed || Picked.length >= Math.ceil(Count / 2)) Picked.push(Candidate);
		if (Picked.length >= Count) break;
	}
	for (const Candidate of Candidates) {
		if (Picked.length >= Count) break;
		if (!Picked.includes(Candidate)) Picked.push(Candidate);
	}
	return Picked.sort((A, B) => TimestampSeconds(A.StartTime) - TimestampSeconds(B.StartTime));
}

function CoerceClip(Clip: Partial<ClipCandidate>, Index: number): ClipCandidate | null {
	if (!Clip.StartTime || !Clip.EndTime) return null;
	return {
		Title: Clip.Title || `Clip ${Index + 1}`,
		StartTime: Clip.StartTime,
		EndTime: Clip.EndTime,
		Duration: Clip.Duration || DurationLabel(Clip.StartTime, Clip.EndTime),
		ViralScore: ClampScore(Clip.ViralScore ?? 70),
		Category: Clip.Category || 'reaction',
		Explanation: Clip.Explanation || 'Selected as a strong candidate.',
		HookScore: ClampScore(Clip.HookScore ?? 65),
		ContextScore: ClampScore(Clip.ContextScore ?? 65),
		EmotionScore: ClampScore(Clip.EmotionScore ?? 65),
		HumorScore: ClampScore(Clip.HumorScore ?? 50),
		ControversyScore: ClampScore(Clip.ControversyScore ?? 50),
		PayoffScore: ClampScore(Clip.PayoffScore ?? 60),
		RetentionScore: ClampScore(Clip.RetentionScore ?? 65),
		ShareabilityScore: ClampScore(Clip.ShareabilityScore ?? 65),
		OriginalityScore: ClampScore(Clip.OriginalityScore ?? 60),
		Variant: Clip.Variant || 'ai selected',
		ReviewNotes: Clip.ReviewNotes || ''
	};
}

function DesiredCount(Request: AnalysisRequest) {
	return Math.max(1, Math.min(30, Number(Request.DesiredCount ?? 5)));
}

function ClipCategory(Text: string) {
	if (/drama|accuse|fight|ban|scam|wrong/i.test(Text)) return 'conflict';
	if (/laugh|funny|lol|bro|chat/i.test(Text)) return 'humor';
	if (/win|kill|round|game|match|play/i.test(Text)) return 'gameplay';
	if (/why|because|story|remember|then/i.test(Text)) return 'story';
	if (/no way|insane|crazy|wild|shocked/i.test(Text)) return 'reaction';
	return 'conversation';
}

function ReasonText(Text: string) {
	const Reasons = [];
	if (/\?/.test(Text)) Reasons.push('a direct question');
	if (/!|insane|crazy|wild|no way/i.test(Text)) Reasons.push('high emotional intensity');
	if (/laugh|funny|lol|bro/i.test(Text)) Reasons.push('humor');
	if (/drama|accuse|fight|ban|scam|wrong/i.test(Text)) Reasons.push('conflict');
	if (/because|then|but|finally|actually/i.test(Text)) Reasons.push('a payoff turn');
	return Reasons.length ? Reasons.join(', ') : 'a clear standalone idea';
}

function MatchCount(Text: string, Patterns: RegExp[]) {
	return Patterns.reduce((Total, Pattern) => Total + (Pattern.test(Text) ? 1 : 0), 0);
}

function ClampScore(Value: number) {
	return Math.max(1, Math.min(100, Math.round(Number.isFinite(Value) ? Value : 50)));
}

function FormatTimestamp(TotalSeconds: number) {
	const Minutes = Math.floor(TotalSeconds / 60);
	const Seconds = TotalSeconds % 60;
	return `${Minutes}:${String(Seconds).padStart(2, '0')}`;
}

function TimestampSeconds(Timestamp: string) {
	return Timestamp.split(':').map(Number).reduce((Total, Part) => Total * 60 + (Number.isFinite(Part) ? Part : 0), 0);
}

function DurationLabel(StartTime: string, EndTime: string) {
	return `${Math.max(1, TimestampSeconds(EndTime) - TimestampSeconds(StartTime))}s`;
}

function StripJsonFence(Text: string) {
	return Text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
}
