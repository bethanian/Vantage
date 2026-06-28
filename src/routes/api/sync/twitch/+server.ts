import { ActorFromRequest, WriteActivity } from '$lib/server/activity';
import { SyncTwitchSources } from '$lib/server/sync/twitch';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const Result = await SyncTwitchSources();
	await WriteActivity(ActorFromRequest(request), { EntityType: 'SyncRun', EntityId: null, Action: 'Synced Twitch' });
	return json(Result);
};
