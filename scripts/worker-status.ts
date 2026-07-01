import { EnsureAppDatabaseReady, All } from '../src/lib/server/db/app-db';

type WorkerHeartbeat = {
	InstanceId: string;
	Role: string;
	Workers: string;
	Status: string;
	Host: string | null;
	LastSeenAt: string;
	Message: string | null;
};

await EnsureAppDatabaseReady();

const Heartbeats = await All<WorkerHeartbeat>(
	`select instance_id as "InstanceId", role as "Role", workers as "Workers", status as "Status",
	 host as "Host", last_seen_at as "LastSeenAt", message as "Message"
	 from worker_heartbeats order by last_seen_at desc limit 12`
);

if (!Heartbeats.length) {
	console.log(JSON.stringify({ Status: 'NoWorkerHeartbeats' }, null, 2));
	process.exit(0);
}

console.log(
	JSON.stringify(
		Heartbeats.map((Heartbeat) => ({
			...Heartbeat,
			AgeSeconds: Math.round((Date.now() - new Date(Heartbeat.LastSeenAt).getTime()) / 1000),
			Online: IsOnline(Heartbeat)
		})),
		null,
		2
	)
);

function IsOnline(Heartbeat: WorkerHeartbeat) {
	const AgeMs = Date.now() - new Date(Heartbeat.LastSeenAt).getTime();
	return AgeMs < 75000 && ['running', 'running-once'].includes(Heartbeat.Status);
}
