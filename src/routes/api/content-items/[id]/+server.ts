import { ActorFromRequest, MarkContentAction } from '$lib/server/activity';
import { EnsureAppDatabaseReady, Run } from '$lib/server/db/app-db';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const ValidStatuses = new Set(['New', 'Watched', 'Clipped', 'Uploaded', 'Rejected']);

export const PATCH: RequestHandler = async ({ params, request }) => {
	await EnsureAppDatabaseReady();
	const Id = Number(params.id);
	if (!Number.isInteger(Id) || Id < 1) error(400, 'Invalid content item id');

	const Body = (await request.json()) as { Status?: string };
	if (!Body.Status || !ValidStatuses.has(Body.Status)) error(400, 'Invalid status');

	await Run('update content_items set status = ? where id = ?', [Body.Status, Id]);
	const Event = await MarkContentAction(Id, ActorFromRequest(request), Body.Status);
	return json({ Id, Status: Body.Status, Label: Event.Label });
};
