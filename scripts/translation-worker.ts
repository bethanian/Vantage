import { EnsureAppDatabaseReady, Get, Run } from '../src/lib/server/db/app-db';
import { GetApiCredential } from '../src/lib/server/api-credentials';

type MediaJobRow = {
	Id: number;
	VideoTitle: string;
	TranscriptText: string;
	TranscriptLanguage?: string | null;
	TranscriptTranslationLanguage?: string | null;
	TranscriptTranslationText?: string | null;
};

type GeminiResponse = {
	candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
	error?: { message?: string; status?: string; code?: number };
};

const RunOnce = process.argv.includes('--once');
const PollMs = Number(process.env.VANTAGE_TRANSLATION_WORKER_POLL_MS ?? 5000);
const GeminiModel = process.env.VANTAGE_GEMINI_MODEL || 'gemini-2.5-flash';

await EnsureAppDatabaseReady();
await RunWorker();

if (!RunOnce) {
	console.log(JSON.stringify({ Status: 'WatchingTranslationJobs', PollMs, GeminiModel }));
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
		const Message = Reason instanceof Error ? Reason.message : 'Unknown translation worker error';
		await Run(
			`update media_jobs
			 set transcript_translation_source = ?, error_message = ?, updated_at = ?
			 where id = ?`,
			['translation failed', Message, new Date().toISOString(), Job.Id]
		);
		console.error(JSON.stringify({ Status: 'Failed', JobId: Job.Id, Message }));
	}
}

async function NextJob() {
	return await Get<MediaJobRow>(
		`select id as "Id", video_title as "VideoTitle", transcript_text as "TranscriptText",
		 transcript_language as "TranscriptLanguage", transcript_translation_language as "TranscriptTranslationLanguage",
		 transcript_translation_text as "TranscriptTranslationText"
		 from media_jobs
		 where transcript_text is not null
		   and transcript_translation_source = 'queued'
		   and cancelled_at is null
		 order by priority desc, id asc
		 limit 1`
	);
}

async function ProcessJob(Job: MediaJobRow) {
	const TargetLanguage = (Job.TranscriptTranslationLanguage || process.env.VANTAGE_TRANSLATION_LANGUAGE || 'en').trim();
	await Run(
		'update media_jobs set transcript_translation_source = ?, error_message = null, updated_at = ? where id = ?',
		['translating', new Date().toISOString(), Job.Id]
	);
	const Text = await TranslateWithGemini(Job, TargetLanguage);
	const Now = new Date().toISOString();
	await Run(
		`update media_jobs
		 set transcript_translation_text = ?, transcript_translation_language = ?, transcript_translation_source = ?,
		 transcript_translation_updated_at = ?, error_message = null, updated_at = ?
		 where id = ?`,
		[Text, TargetLanguage, `gemini:${GeminiModel}`, Now, Now, Job.Id]
	);
	console.log(JSON.stringify({ Status: 'TranslationSaved', JobId: Job.Id, Language: TargetLanguage, Model: GeminiModel }));
}

async function TranslateWithGemini(Job: MediaJobRow, TargetLanguage: string) {
	const Keys = await GeminiKeys();
	if (!Keys.length) throw new Error('No Gemini API keys configured');
	const Prompt = BuildPrompt(Job, TargetLanguage);
	const Errors: string[] = [];
	for (const Key of Keys) {
		try {
			const Text = await GeminiGenerate(Key, Prompt);
			if (Text.trim().length > 20) return Text.trim();
			throw new Error('Gemini returned an empty translation');
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
			generationConfig: { temperature: 0.15 }
		}),
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
	const Numbered = Object.entries(process.env)
		.filter(([Key]) => /^GEMINI_API_KEY_\d+$/i.test(Key))
		.map(([, Value]) => Value ?? '');
	return [...Inline.split(/[\s,;]+/), ...Numbered]
		.map((Key) => Key.trim())
		.filter(Boolean)
		.filter((Key, Index, Keys) => Keys.indexOf(Key) === Index);
}

function BuildPrompt(Job: MediaJobRow, TargetLanguage: string) {
	return `Translate this transcript to ${TargetLanguage}.
Preserve timestamps, speaker labels, line breaks, slang meaning, names, platform terms, and clipping-relevant tone.
Do not summarize. Return only the translated transcript.

Title: ${Job.VideoTitle}
Source language: ${Job.TranscriptLanguage || 'unknown'}

Transcript:
${Job.TranscriptText.slice(0, Number(process.env.VANTAGE_TRANSLATION_TRANSCRIPT_CHARS ?? 70000))}`;
}

function StripFence(Text: string) {
	return Text.replace(/^```(?:text|txt)?/i, '').replace(/```$/i, '').trim();
}
