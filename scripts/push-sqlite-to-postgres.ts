import Database from 'better-sqlite3';
import postgres from 'postgres';
import { resolve } from 'node:path';
import { ImportTables } from '../src/lib/server/db/metadata';

const PostgresUrl = process.env.POSTGRES_URL;
if (!PostgresUrl) throw new Error('POSTGRES_URL is required');

const SqlitePath = resolve(process.env.SQLITE_DB_PATH ?? 'data/vantage.db');
const Sqlite = new Database(SqlitePath, { readonly: true });
const Pg = postgres(PostgresUrl, { max: 1 });

try {
	await Pg.begin(async (Tx) => {
		for (const Table of ImportTables) {
			const Rows = Sqlite.prepare(`select ${Table.Columns.join(', ')} from ${Table.Name}`).all() as Record<string, unknown>[];
			if (!Rows.length) continue;
			await Tx`delete from ${Tx(Table.Name)}`;
			await Tx`insert into ${Tx(Table.Name)} ${Tx(Rows, Table.Columns as unknown as string[])}`;
			console.log(`Pushed ${Rows.length} ${Table.Name}`);
		}
	});
} finally {
	Sqlite.close();
	await Pg.end();
}
