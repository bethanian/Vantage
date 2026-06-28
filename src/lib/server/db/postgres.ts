import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as Schema from './pg-schema';

const PostgresUrl = process.env.POSTGRES_URL;

export const HasPostgres = Boolean(PostgresUrl);

export const PostgresClient = PostgresUrl
	? postgres(PostgresUrl, {
			max: 1,
			prepare: false
		})
	: null;

export const PgDb = PostgresClient ? drizzle(PostgresClient, { schema: Schema }) : null;
