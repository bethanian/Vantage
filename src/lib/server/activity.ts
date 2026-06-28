import { NextId, Run } from '$lib/server/db/app-db';

export type ActivityTarget = {
	EntityType: string;
	EntityId?: number | null;
	Action: string;
	Label?: string;
};

export function ActorFromForm(Form: FormData) {
	return CleanActor(String(Form.get('Actor') ?? ''));
}

export function ActorFromRequest(Request: Request) {
	return CleanActor(Request.headers.get('x-vantage-actor') ?? '');
}

export function CleanActor(Value: string) {
	const Actor = Value.trim().replace(/\s+/g, ' ').slice(0, 40);
	return Actor || 'Someone';
}

export async function WriteActivity(Actor: string, Target: ActivityTarget) {
	const CreatedAt = new Date().toISOString();
	const CleanName = CleanActor(Actor);
	const Label = Target.Label ?? `${Target.Action} - ${CleanName}`;
	await Run(
		`insert into activity_events (id, actor, action, entity_type, entity_id, label, created_at)
		 values (?, ?, ?, ?, ?, ?, ?)`,
		[await NextId('activity_events'), CleanName, Target.Action, Target.EntityType, Target.EntityId ?? null, Label, CreatedAt]
	);
	return { Actor: CleanName, CreatedAt, Label };
}

export async function MarkContentAction(Id: number, Actor: string, Action: string) {
	const Event = await WriteActivity(Actor, { EntityType: 'ContentItem', EntityId: Id, Action });
	await Run('update content_items set last_action = ?, last_action_by = ?, last_action_at = ? where id = ?', [
		Action,
		Event.Actor,
		Event.CreatedAt,
		Id
	]);
	return Event;
}

export async function MarkClipTaskAction(Id: number, Actor: string, Action: string) {
	const Event = await WriteActivity(Actor, { EntityType: 'ClipTask', EntityId: Id, Action });
	await Run('update clip_tasks set last_action = ?, last_action_by = ?, last_action_at = ? where id = ?', [
		Action,
		Event.Actor,
		Event.CreatedAt,
		Id
	]);
	return Event;
}
