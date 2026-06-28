import { EnsureAppDatabaseReady, Run } from '$lib/server/db/app-db';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, request }) => {
	await EnsureAppDatabaseReady();
	const Name = params.name ? decodeURIComponent(params.name) : '';
	if (!Name) error(400, 'Invalid creator name');

	const Body = (await request.json()) as { Notes?: string };
	if (typeof Body.Notes !== 'string') error(400, 'Invalid notes');

	await Run('update creators set notes = ? where name = ?', [Body.Notes, Name]);
	return json({ Name, Notes: Body.Notes });
};
