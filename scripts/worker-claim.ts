import { hostname } from 'node:os';
import { Get, Run } from '../src/lib/server/db/app-db';

type ClaimOptions = {
	Table: 'media_jobs' | 'clip_previews' | 'clip_exports';
	Select: string;
	Where: string;
	OrderBy: string;
	Params?: unknown[];
	ClaimSeconds?: number;
};

export const WorkerInstanceId =
	process.env.VANTAGE_WORKER_INSTANCE_ID ||
	`${process.env.VANTAGE_WORKER_ROLE || 'worker'}-${hostname()}-${process.pid}`;

export async function ClaimNext<T>(Options: ClaimOptions) {
	const Now = new Date();
	const ClaimExpiresAt = new Date(Now.getTime() + (Options.ClaimSeconds ?? 10 * 60) * 1000);
	const Row = await Get<T>(
		`update ${Options.Table}
		 set claimed_by = ?, claimed_at = ?, claim_expires_at = ?
		 where id = (
			select id from ${Options.Table}
			where ${Options.Where}
			  and (claim_expires_at is null or claim_expires_at < ?)
			order by ${Options.OrderBy}
			limit 1
		 )
		 returning ${Options.Select}`,
		[WorkerInstanceId, Now.toISOString(), ClaimExpiresAt.toISOString(), Now.toISOString(), ...(Options.Params ?? [])]
	);
	return Row;
}

export async function ReleaseClaim(Table: ClaimOptions['Table'], Id: number) {
	await Run(`update ${Table} set claimed_by = null, claimed_at = null, claim_expires_at = null where id = ? and claimed_by = ?`, [
		Id,
		WorkerInstanceId
	]);
}
