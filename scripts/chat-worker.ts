import { spawn } from 'node:child_process';
import { All, EnsureAppDatabaseReady, Run } from '../src/lib/server/db/app-db';

type MediaJobRow = {
	Id: number;
	SourceUrl: string;
	SourcePlatform: string;
	VideoTitle: string;
	OutputPath?: string | null;
	LiveMarkedMomentsJson?: string | null;
	MetadataJson?: string | null;
};

type ChatMessage = {
	Timestamp?: string;
	Author?: string;
	Text: string;
	Weight?: number;
};

type ChatEvent = {
	Timestamp?: string;
	Label: string;
	Strength?: number;
	MessageCount?: number;
};

type ChatActivity = {
	Status: 'completed' | 'failed' | 'manual marks' | 'not configured';
	GeneratedAt: string;
	Source?: string;
	Summary?: string;
	Messages?: ChatMessage[];
	Events?: ChatEvent[];
	Error?: string;
	Raw?: unknown;
};

const RunOnce = process.argv.includes('--once');
const PollMs = Number(process.env.VANTAGE_CHAT_WORKER_POLL_MS ?? 5000);

await EnsureAppDatabaseReady();
await RunWorker();

if (!RunOnce) {
	console.log(JSON.stringify({ Status: 'WatchingChatActivity', PollMs }));
	setInterval(RunWorker, PollMs);
}

async function RunWorker() {
	const Job = await NextJob();
	if (!Job) {
		if (RunOnce) console.log(JSON.stringify({ Status: 'Idle' }));
		return;
	}

	const Activity = await BuildChatActivity(Job);
	const Metadata = ParseMetadata(Job.MetadataJson);
	await Run('update media_jobs set metadata_json = ?, updated_at = ? where id = ?', [
		JSON.stringify({ ...Metadata, ChatActivity: Activity }),
		new Date().toISOString(),
		Job.Id
	]);
	console.log(JSON.stringify({ Status: 'ChatActivitySaved', JobId: Job.Id, ChatStatus: Activity.Status, Events: Activity.Events?.length ?? 0 }));
}

async function NextJob() {
	const Jobs = await All<MediaJobRow>(
		`select id as "Id", source_url as "SourceUrl", source_platform as "SourcePlatform", video_title as "VideoTitle",
		 output_path as "OutputPath", live_marked_moments_json as "LiveMarkedMomentsJson", metadata_json as "MetadataJson"
		 from media_jobs
		 where cancelled_at is null
		 order by priority desc, id asc
		 limit 50`
	);
	return Jobs.find((Job) => !ParseMetadata(Job.MetadataJson).ChatActivity && (HasLiveMarks(Job) || Boolean(process.env.VANTAGE_CHAT_INGEST_COMMAND?.trim())));
}

async function BuildChatActivity(Job: MediaJobRow): Promise<ChatActivity> {
	const Manual = ManualMarkActivity(Job);
	const Command = process.env.VANTAGE_CHAT_INGEST_COMMAND;
	if (!Command?.trim()) return Manual ?? { Status: 'not configured', GeneratedAt: new Date().toISOString(), Summary: 'No chat ingestion command configured.' };
	try {
		const Output = await RunShellCapture(Command, {
			...process.env,
			VANTAGE_CHAT_SOURCE_URL: Job.SourceUrl,
			VANTAGE_SOURCE_PATH: Job.OutputPath ?? '',
			VANTAGE_SOURCE_PLATFORM: Job.SourcePlatform,
			VANTAGE_VIDEO_TITLE: Job.VideoTitle
		}, Number(process.env.VANTAGE_CHAT_INGEST_TIMEOUT_MS ?? 120000));
		const Parsed = JSON.parse(Output) as Partial<ChatActivity>;
		return {
			Status: 'completed',
			GeneratedAt: new Date().toISOString(),
			Source: 'external command',
			Summary: Parsed.Summary ?? 'Chat activity ingested.',
			Messages: Array.isArray(Parsed.Messages) ? Parsed.Messages.filter(IsMessage).slice(0, 500) : Manual?.Messages,
			Events: [...(Manual?.Events ?? []), ...(Array.isArray(Parsed.Events) ? Parsed.Events.filter(IsEvent) : [])].slice(0, 100),
			Raw: Parsed
		};
	} catch (Reason) {
		return {
			...(Manual ?? {}),
			Status: Manual ? 'manual marks' : 'failed',
			GeneratedAt: new Date().toISOString(),
			Source: Manual ? 'manual marks' : 'external command',
			Summary: Manual ? 'External chat ingest failed; manual live marks preserved.' : 'External chat ingest failed.',
			Error: Reason instanceof Error ? Reason.message : 'Unknown chat ingestion error'
		};
	}
}

function ManualMarkActivity(Job: MediaJobRow): ChatActivity | null {
	const Marks = ParseJsonArray(Job.LiveMarkedMomentsJson);
	if (!Marks.length) return null;
	const Events = Marks.map((Mark) => {
		const Source = Mark as { Timestamp?: string; Label?: string; Actor?: string };
		return { Timestamp: Source.Timestamp ?? 'live', Label: Source.Label ?? 'Marked live moment', Strength: 80, MessageCount: 1 };
	});
	return {
		Status: 'manual marks',
		GeneratedAt: new Date().toISOString(),
		Source: 'manual live marks',
		Summary: `${Events.length} manually marked live moments available as chat/activity context.`,
		Events
	};
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
	if (Code !== 0) throw new Error(`${ErrorOutput.trim()}\n${Output.trim()}`.trim() || `chat ingest exited with ${Code}`);
	return Output.trim();
}

function HasLiveMarks(Job: MediaJobRow) {
	return ParseJsonArray(Job.LiveMarkedMomentsJson).length > 0;
}

function ParseMetadata(Raw?: string | null) {
	if (!Raw) return {};
	try {
		return JSON.parse(Raw) as Record<string, unknown>;
	} catch {
		return {};
	}
}

function ParseJsonArray(Raw?: string | null) {
	if (!Raw) return [];
	try {
		const Parsed = JSON.parse(Raw) as unknown;
		return Array.isArray(Parsed) ? Parsed : [];
	} catch {
		return [];
	}
}

function IsMessage(Value: unknown): Value is ChatMessage {
	return Boolean(Value && typeof Value === 'object' && typeof (Value as Partial<ChatMessage>).Text === 'string');
}

function IsEvent(Value: unknown): Value is ChatEvent {
	return Boolean(Value && typeof Value === 'object' && typeof (Value as Partial<ChatEvent>).Label === 'string');
}
