import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	dialect: 'postgresql',
	schema: './src/lib/server/db/pg-schema.ts',
	out: './drizzle-postgres',
	dbCredentials: {
		url: process.env.POSTGRES_URL ?? 'postgres://postgres:postgres@localhost:5432/vantage'
	}
});
