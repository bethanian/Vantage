import { spawn, type ChildProcess } from 'node:child_process';
import { hostname } from 'node:os';
import { EnsureAppDatabaseReady, NextId, Run } from '../src/lib/server/db/app-db';

type WorkerSpec = {
	Name: string;
	Script: string;
	Default: boolean;
};

const Workers: WorkerSpec[] = [
	{ Name: 'sync', Script: 'scripts/sync-worker.ts', Default: true },
	{ Name: 'source', Script: 'scripts/source-validation-worker.ts', Default: true },
	{ Name: 'social', Script: 'scripts/social-ingest-worker.ts', Default: true },
	{ Name: 'media', Script: 'scripts/media-worker.ts', Default: true },
	{ Name: 'live', Script: 'scripts/live-chunk-worker.ts', Default: true },
	{ Name: 'signals', Script: 'scripts/media-signal-worker.ts', Default: true },
	{ Name: 'transcript', Script: 'scripts/transcript-worker.ts', Default: true },
	{ Name: 'translation', Script: 'scripts/translation-worker.ts', Default: true },
	{ Name: 'chat', Script: 'scripts/chat-worker.ts', Default: true },
	{ Name: 'analysis', Script: 'scripts/analysis-worker.ts', Default: true },
	{ Name: 'caption', Script: 'scripts/caption-worker.ts', Default: true },
	{ Name: 'preview', Script: 'scripts/preview-worker.ts', Default: true },
	{ Name: 'export', Script: 'scripts/export-worker.ts', Default: true }
];

const RunOnce = process.argv.includes('--once');
const Selected = SelectedWorkers();
const Children = new Map<string, ChildProcess>();
const StartedAt = new Date().toISOString();
const WorkerNames = Selected.map((Worker) => Worker.Name);
const WorkerRole = process.env.VANTAGE_WORKER_ROLE || (WorkerNames.includes('media') ? 'local-primary' : 'fallback');
const InstanceId = process.env.VANTAGE_WORKER_INSTANCE_ID || `${WorkerRole}-${hostname()}-${process.pid}`;
const ChildRestartDelayMs = Number(process.env.VANTAGE_CHILD_WORKER_RESTART_DELAY_MS ?? 5000);
let ShuttingDown = false;

if (!Selected.length) {
	console.error(JSON.stringify({ Status: 'NoWorkersSelected', Available: Workers.map((Worker) => Worker.Name) }));
	process.exit(1);
}

await WriteHeartbeat(RunOnce ? 'running-once' : 'running', 'worker stack starting');
const HeartbeatTimer = RunOnce ? undefined : setInterval(() => void WriteHeartbeat('running'), Number(process.env.VANTAGE_WORKER_HEARTBEAT_MS ?? 30000));

process.on('SIGINT', Shutdown);
process.on('SIGTERM', Shutdown);

console.log(JSON.stringify({ Status: RunOnce ? 'RunningWorkerStackOnce' : 'RunningWorkerStack', Role: WorkerRole, InstanceId, Workers: WorkerNames }));
await Promise.all(Selected.map((Worker) => RunWorker(Worker)));
if (HeartbeatTimer) clearInterval(HeartbeatTimer);
await WriteHeartbeat(RunOnce ? 'completed-once' : 'exited', 'worker stack finished');
if (!RunOnce) process.exit(process.exitCode ?? 0);

async function RunWorker(Worker: WorkerSpec) {
	while (!ShuttingDown) {
		const Code = await RunWorkerProcess(Worker);
		if (RunOnce) {
			if (Code) process.exitCode = Code;
			return;
		}
		if (ShuttingDown) return;
		console.error(JSON.stringify({ Worker: Worker.Name, Status: 'Exited', Code, Action: 'Restarting' }));
		await WriteHeartbeat('running', `${Worker.Name} worker restarted after exit code ${Code ?? 'unknown'}`);
		await Sleep(ChildRestartDelayMs);
	}
}

async function RunWorkerProcess(Worker: WorkerSpec) {
	const Args = [Worker.Script, ...(RunOnce ? ['--once'] : [])];
	const Child = spawn(process.execPath, ['--import', 'tsx', ...Args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
	Children.set(Worker.Name, Child);
	Child.stdout?.on('data', (Chunk) => WriteLog(Worker.Name, Chunk));
	Child.stderr?.on('data', (Chunk) => WriteLog(Worker.Name, Chunk, true));
	const Code = await new Promise<number | null>((Resolve) => {
		Child.on('error', (Reason) => {
			console.error(JSON.stringify({ Worker: Worker.Name, Status: 'SpawnError', Message: Reason.message }));
			Resolve(1);
		});
		Child.on('close', Resolve);
	});
	Children.delete(Worker.Name);
	return Code;
}

function SelectedWorkers() {
	const Names = ArgValue('--workers')?.split(',').map((Name) => Name.trim().toLowerCase()).filter(Boolean);
	if (!Names?.length) return Workers.filter((Worker) => Worker.Default);
	return Workers.filter((Worker) => Names.includes(Worker.Name));
}

function ArgValue(Name: string) {
	const Inline = process.argv.find((Arg) => Arg.startsWith(`${Name}=`));
	if (Inline) return Inline.slice(Name.length + 1);
	const Index = process.argv.indexOf(Name);
	return Index >= 0 ? process.argv[Index + 1] : undefined;
}

function WriteLog(Worker: string, Chunk: Buffer, IsError = false) {
	for (const Line of String(Chunk).split(/\r?\n/).filter(Boolean)) {
		const Output = JSON.stringify({ Worker, Line });
		(IsError ? process.stderr : process.stdout).write(`${Output}\n`);
	}
}

function Shutdown() {
	ShuttingDown = true;
	void WriteHeartbeat('stopping', 'worker stack stopping');
	for (const Child of Children.values()) Child.kill();
}

async function WriteHeartbeat(Status: string, Message = '') {
	try {
		await EnsureAppDatabaseReady();
		const Now = new Date().toISOString();
		for (let Attempt = 0; Attempt < 3; Attempt++) {
			try {
				const HeartbeatId = await NextId('worker_heartbeats');
				await Run(
					`insert into worker_heartbeats
					 (id, instance_id, role, workers, status, pid, host, started_at, last_seen_at, message)
					 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					[
						HeartbeatId,
						InstanceId,
						WorkerRole,
						WorkerNames.join(','),
						Status,
						process.pid,
						hostname(),
						StartedAt,
						Now,
						Message
					]
				);
				await Run('delete from worker_heartbeats where instance_id = ? and id <> ?', [InstanceId, HeartbeatId]);
				return;
			} catch (Reason) {
				if (Attempt === 2) throw Reason;
				await Sleep(50);
			}
		}
	} catch (Reason) {
		const MessageText = Reason instanceof Error ? Reason.message : 'Unknown heartbeat error';
		console.error(JSON.stringify({ Status: 'HeartbeatFailed', Message: MessageText }));
	}
}

function Sleep(Milliseconds: number) {
	return new Promise((Resolve) => setTimeout(Resolve, Milliseconds));
}
