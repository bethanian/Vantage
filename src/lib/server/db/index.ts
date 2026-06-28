import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as Schema from './schema';

if (process.env.VERCEL && !process.env.VANTAGE_ALLOW_SQLITE_ON_VERCEL) {
	throw new Error('Vantage hosted deployments require the Postgres runtime adapter before enabling Vercel production.');
}

export const DbPath = resolve('data/vantage.db');
mkdirSync(dirname(DbPath), { recursive: true });

export const Sqlite = new Database(DbPath);
Sqlite.pragma('journal_mode = WAL');
Sqlite.pragma('foreign_keys = ON');

export const Db = drizzle(Sqlite, { schema: Schema });
