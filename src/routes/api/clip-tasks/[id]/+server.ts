import { ActorFromRequest, MarkClipTaskAction } from '$lib/server/activity';
import { EnsureAppDatabaseReady, Run } from '$lib/server/db/app-db';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const ValidStatuses = new Set(['To upload', 'Editing', 'Done', 'Uploading', 'Watched', 'To clip']);

export const PATCH: RequestHandler = async ({ params, request }) => {
	await EnsureAppDatabaseReady();
	const Id = Number(params.id);
	if (!Number.isInteger(Id) || Id < 1) error(400, 'Invalid clip task id');

	const Body = (await request.json()) as { Status?: string };
	if (!Body.Status || !ValidStatuses.has(Body.Status)) error(400, 'Invalid status');

	await Run('update clip_tasks set status = ? where id = ?', [Body.Status, Id]);
	const Event = await MarkClipTaskAction(Id, ActorFromRequest(request), Body.Status);
	return json({ Id, Status: Body.Status, Label: Event.Label });
};
