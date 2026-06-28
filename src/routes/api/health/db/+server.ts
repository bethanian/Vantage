import { HasPostgres, PostgresClient } from '$lib/server/db/postgres';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	if (!HasPostgres || !PostgresClient) {
		return json({ Database: 'SQLite', Shared: false, ReadyForTeamHosting: false });
	}

	const [Result] = await PostgresClient<{ value: number }[]>`select 1 as value`;
	return json({ Database: 'Postgres', Shared: true, ReadyForTeamHosting: Result?.value === 1 });
};
