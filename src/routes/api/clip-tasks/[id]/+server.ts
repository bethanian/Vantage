import { ActorFromRequest, MarkClipTaskAction } from '$lib/server/activity';
import { EnsureAppDatabaseReady, Run } from '$lib/server/db/app-db';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const StatusAliases: Record<string, string> = {
	'To Clip': 'To clip',
	Finished: 'Done'
};

const ValidStatuses = new Set(['To clip', 'To upload', 'Editing', 'Uploading', 'Watched', 'Done', 'Uploaded']);

export const PATCH: RequestHandler = async ({ params, request }) => {
	await EnsureAppDatabaseReady();
	const Id = Number(params.id);
	if (!Number.isInteger(Id) || Id < 1) error(400, 'Invalid clip task id');

	const Body = (await request.json()) as { Status?: string };
	const Status = Body.Status ? (StatusAliases[Body.Status] ?? Body.Status) : '';
	if (!Status || !ValidStatuses.has(Status)) error(400, 'Invalid status');

	await Run('update clip_tasks set status = ? where id = ?', [Status, Id]);
	const Event = await MarkClipTaskAction(Id, ActorFromRequest(request), Status);
	return json({ Id, Status, Label: Event.Label });
};
