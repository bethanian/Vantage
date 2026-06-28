import { EnsureDatabaseReady } from '../src/lib/server/db/seed';
import { Sqlite } from '../src/lib/server/db/index';
import { SyncAllSources } from '../src/lib/server/sync/all';

const IntervalMinutes = ResolveIntervalMinutes();
const RunOnce = process.argv.includes('--once') || IntervalMinutes <= 0;

await RunSync();

if (!RunOnce) {
	console.log(JSON.stringify({ Status: 'Watching', IntervalMinutes }));
	setInterval(RunSync, IntervalMinutes * 60_000);
}

async function RunSync() {
	const StartedAt = new Date().toISOString();
	try {
		const Result = await SyncAllSources();
		console.log(
			JSON.stringify({
				StartedAt,
				FinishedAt: new Date().toISOString(),
				...Result
			})
		);
	} catch (Reason) {
		console.error(
			JSON.stringify({
				StartedAt,
				FinishedAt: new Date().toISOString(),
				Status: 'Failed',
				Message: Reason instanceof Error ? Reason.message : 'Unknown sync worker error'
			})
		);
		process.exitCode = 1;
	}
}

function ResolveIntervalMinutes() {
	const EnvInterval = Number(process.env.VANTAGE_SYNC_INTERVAL_MINUTES);
	if (Number.isFinite(EnvInterval) && EnvInterval > 0) return EnvInterval;
	EnsureDatabaseReady();
	const Row = Sqlite.prepare("select value as Value from app_settings where key = 'RefreshSchedule' limit 1").get() as
		| { Value?: string }
		| undefined;
	const SavedInterval = Number(Row?.Value);
	return Number.isFinite(SavedInterval) ? SavedInterval : 30;
}
