import { EnsureAppDatabaseReady, Get, Run } from '../src/lib/server/db/app-db';
import { GetApiCredential } from '../src/lib/server/api-credentials';

type CandidateRow = {
	Id: number;
	MediaJobId: number;
	ClipNumber: number;
	Title?: string | null;
	StartTime: string;
	EndTime: string;
	Category: string;
	Explanation: string;
	CutSegmentsJson?: string | null;
	CaptionJson?: string | null;
	VideoTitle: string;
	Creator: string;
	TranscriptText?: string | null;
};

type CaptionRequest = { Style?: string; Platform?: string; RequestedBy?: string; RequestedAt?: string };
type GeminiResponse = { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; error?: { message?: string } };

const RunOnce = process.argv.includes('--once');
const PollMs = Number(process.env.VANTAGE_CAPTION_WORKER_POLL_MS ?? 5000);
const GeminiModel = process.env.VANTAGE_GEMINI_MODEL || 'gemini-2.5-flash';

await EnsureAppDatabaseReady();
await RunWorker();

if (!RunOnce) {
	console.log(JSON.stringify({ Status: 'WatchingClipCaptions', PollMs, GeminiModel }));
	setInterval(RunWorker, PollMs);
}

async function RunWorker() {
	const Candidate = await NextCandidate();
	if (!Candidate) {
		if (RunOnce) console.log(JSON.stringify({ Status: 'Idle' }));
		return;
	}
	try {
		await ProcessCandidate(Candidate);
	} catch (Reason) {
		const Message = Reason instanceof Error ? Reason.message : 'Unknown caption worker error';
		await Run('update clip_candidates set caption_status = ?, caption_json = ? where id = ?', [
			'failed',
			JSON.stringify({ Error: Message, FailedAt: new Date().toISOString() }),
			Candidate.Id
		]);
		console.error(JSON.stringify({ Status: 'Failed', CandidateId: Candidate.Id, Message }));
	}
}

async function NextCandidate() {
	return await Get<CandidateRow>(
		`select clip_candidates.id as "Id", clip_candidates.media_job_id as "MediaJobId", clip_number as "ClipNumber",
		 title as "Title", start_time as "StartTime", end_time as "EndTime", category as "Category",
		 explanation as "Explanation", cut_segments_json as "CutSegmentsJson", caption_json as "CaptionJson",
		 media_jobs.video_title as "VideoTitle", media_jobs.creator as "Creator", media_jobs.transcript_text as "TranscriptText"
		 from clip_candidates
		 inner join media_jobs on media_jobs.id = clip_candidates.media_job_id
		 where caption_status = 'queued'
		 order by coalesce(media_jobs.priority, 0) desc, clip_candidates.id asc
		 limit 1`
	);
}

async function ProcessCandidate(Candidate: CandidateRow) {
	await Run('update clip_candidates set caption_status = ? where id = ?', ['generating', Candidate.Id]);
	const Request = ParseRequest(Candidate.CaptionJson);
	const Text = await GenerateCaption(Candidate, Request);
	const Payload = {
		Source: `gemini:${GeminiModel}`,
		Style: Request.Style ?? 'short-form punchy',
		Platform: Request.Platform ?? 'TikTok',
		GeneratedAt: new Date().toISOString()
	};
	await Run('update clip_candidates set caption_text = ?, caption_status = ?, caption_json = ? where id = ?', [
		Text,
		'generated',
		JSON.stringify(Payload),
		Candidate.Id
	]);
	console.log(JSON.stringify({ Status: 'CaptionGenerated', CandidateId: Candidate.Id, Model: GeminiModel }));
}

async function GenerateCaption(Candidate: CandidateRow, Request: CaptionRequest) {
	const Keys = await GeminiKeys();
	if (!Keys.length) throw new Error('No Gemini API keys configured');
	const Prompt = BuildPrompt(Candidate, Request);
	const Errors: string[] = [];
	for (const Key of Keys) {
		try {
			const Text = await GeminiGenerate(Key, Prompt);
			if (Text.trim()) return Text.trim();
			throw new Error('Gemini returned an empty caption');
		} catch (Reason) {
			Errors.push(Reason instanceof Error ? Reason.message : 'Unknown Gemini error');
		}
	}
	throw new Error(Errors.join(' | ') || 'All Gemini keys failed');
}

async function GeminiGenerate(ApiKey: string, Prompt: string) {
	const Response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GeminiModel}:generateContent`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'x-goog-api-key': ApiKey },
		body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: Prompt }] }], generationConfig: { temperature: 0.55 } }),
		signal: AbortSignal.timeout(Number(process.env.VANTAGE_GEMINI_TIMEOUT_MS ?? 45000))
	});
	const Body = (await Response.json()) as GeminiResponse;
	if (!Response.ok) throw new Error(Body.error?.message ?? `Gemini HTTP ${Response.status}`);
	const Text = Body.candidates?.[0]?.content?.parts?.map((Part) => Part.text ?? '').join('\n').trim();
	if (!Text) throw new Error('Gemini returned no text');
	return StripFence(Text);
}

async function GeminiKeys() {
	const Stored = await GetApiCredential('GEMINI_API_KEYS');
	const Inline = [process.env.GEMINI_API_KEYS, process.env.GEMINI_API_KEY, Stored].filter(Boolean).join('\n');
	const Numbered = Object.entries(process.env).filter(([Key]) => /^GEMINI_API_KEY_\d+$/i.test(Key)).map(([, Value]) => Value ?? '');
	return [...Inline.split(/[\s,;]+/), ...Numbered].map((Key) => Key.trim()).filter(Boolean).filter((Key, Index, Keys) => Keys.indexOf(Key) === Index);
}

function BuildPrompt(Candidate: CandidateRow, Request: CaptionRequest) {
	return `Write a short-form social caption for this clip.
Return only the final caption text. No markdown.

Platform: ${Request.Platform || 'TikTok'}
Style: ${Request.Style || 'short-form punchy'}
Creator: ${Candidate.Creator}
Source video: ${Candidate.VideoTitle}
Clip: ${Candidate.Title || `Clip ${Candidate.ClipNumber}`}
Time range: ${Candidate.StartTime} - ${Candidate.EndTime}
Removed sections: ${Candidate.CutSegmentsJson || 'none'}
Category: ${Candidate.Category}
Why this clip works: ${Candidate.Explanation}

Requirements:
- 1-3 lines.
- Strong hook first.
- Natural human language.
- Include 2-5 relevant hashtags only if useful.
- Do not invent claims not supported by the transcript/context.

Transcript around clip:
${TranscriptWindow(Candidate)}`;
}

function TranscriptWindow(Candidate: CandidateRow) {
	const Text = Candidate.TranscriptText ?? '';
	const Start = TimestampSeconds(Candidate.StartTime);
	const End = TimestampSeconds(Candidate.EndTime);
	const Lines = Text.split(/\r?\n/);
	const Matching = Lines.filter((Line) => {
		const Match = Line.match(/\[?(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)\s*(?:-|–|-->|to)/);
		if (!Match) return false;
		const Seconds = TimestampSeconds(Match[1]);
		return Seconds >= Math.max(0, Start - 20) && Seconds <= End + 20;
	});
	return (Matching.length ? Matching : Lines).slice(0, 80).join('\n').slice(0, 8000);
}

function ParseRequest(Raw?: string | null): CaptionRequest {
	if (!Raw) return {};
	try {
		return JSON.parse(Raw) as CaptionRequest;
	} catch {
		return {};
	}
}

function TimestampSeconds(Value: string) {
	const Parts = Value.split(':').map(Number);
	if (Parts.some((Part) => !Number.isFinite(Part))) return 0;
	if (Parts.length === 3) return Parts[0] * 3600 + Parts[1] * 60 + Parts[2];
	if (Parts.length === 2) return Parts[0] * 60 + Parts[1];
	return Parts[0] ?? 0;
}

function StripFence(Text: string) {
	return Text.replace(/^```(?:text|txt)?/i, '').replace(/```$/i, '').trim();
}
