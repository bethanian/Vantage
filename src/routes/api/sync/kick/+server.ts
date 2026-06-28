import { ActorFromRequest, WriteActivity } from '$lib/server/activity';
import { SyncKickLivestreams } from '$lib/server/sync/kick';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const Result = await SyncKickLivestreams();
	await WriteActivity(ActorFromRequest(request), { EntityType: 'SyncRun', EntityId: null, Action: 'Synced Kick' });
	return json(Result);
};
