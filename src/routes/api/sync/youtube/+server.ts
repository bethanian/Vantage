import { ActorFromRequest, WriteActivity } from '$lib/server/activity';
import { SyncYoutubeUploads } from '$lib/server/sync/youtube';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const Result = await SyncYoutubeUploads();
	await WriteActivity(ActorFromRequest(request), { EntityType: 'SyncRun', EntityId: null, Action: 'Synced YouTube' });
	return json(Result);
};
