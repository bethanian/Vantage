import { ActorFromRequest, WriteActivity } from '$lib/server/activity';
import { ResolveAllSourceIds } from '$lib/server/source-id-resolver';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const Result = await ResolveAllSourceIds();
	await WriteActivity(ActorFromRequest(request), { EntityType: 'SourceAccount', EntityId: null, Action: 'Resolved source IDs' });
	return json(Result);
};
