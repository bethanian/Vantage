import { ActorFromRequest, WriteActivity } from '$lib/server/activity';
import { SyncAllSources } from '$lib/server/sync/all';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const Result = await SyncAllSources();
	await WriteActivity(ActorFromRequest(request), { EntityType: 'SyncRun', EntityId: null, Action: 'Synced all sources' });
	return json(Result);
};
