import { EnsureAppDatabaseReady, IsPostgresRuntime } from '$lib/server/db/app-db';
import { error } from '@sveltejs/kit';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

export async function GET() {
	await EnsureAppDatabaseReady();
	if (IsPostgresRuntime) error(400, 'SQLite backup export is only available in local mode');
	const { DbPath, Sqlite } = await import('$lib/server/db');
	const Stamp = new Date().toISOString().replace(/[:.]/g, '-');
	const BackupPath = join(dirname(DbPath), `vantage-backup-${Stamp}.db`);
	try {
		mkdirSync(dirname(BackupPath), { recursive: true });
		await Sqlite.backup(BackupPath);
		const Body = readFileSync(BackupPath);
		return new Response(Body, {
			headers: {
				'content-disposition': `attachment; filename="vantage-backup-${Stamp}.db"`,
				'content-type': 'application/vnd.sqlite3',
				'content-length': String(Body.byteLength)
			}
		});
	} catch (Reason) {
		const Message = Reason instanceof Error ? Reason.message : 'Backup failed';
		error(500, Message);
	} finally {
		rmSync(BackupPath, { force: true });
	}
}
