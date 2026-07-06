import { json } from '@sveltejs/kit';
import { All, EnsureAppDatabaseReady } from '$lib/server/db/app-db';
import type { WorkerHeartbeat } from '$lib/vantage-data';

export async function GET() {
	await EnsureAppDatabaseReady();
	const WorkerHeartbeats = await All<WorkerHeartbeat>(
		`select id as "Id", instance_id as "InstanceId", role as "Role", workers as "Workers", status as "Status",
		 pid as "Pid", host as "Host", started_at as "StartedAt", last_seen_at as "LastSeenAt", message as "Message"
		 from worker_heartbeats order by last_seen_at desc limit 12`
	);

	return json(
		{ WorkerHeartbeats, ServerNow: new Date().toISOString() },
		{
			headers: {
				'cache-control': 'no-store, max-age=0'
			}
		}
	);
}
