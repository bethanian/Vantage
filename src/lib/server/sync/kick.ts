import { All, EnsureAppDatabaseReady, Get, NextId, Run } from '$lib/server/db/app-db';
import { CalculateOpportunityScore, type OpportunityWeights } from '$lib/opportunity-score';
import { GetApiCredential } from '$lib/server/api-credentials';
import { GetOpportunityWeights } from '$lib/server/opportunity-settings';

type KickTokenResponse = { access_token?: string; message?: string };
type KickLivestreamResponse = {
	data?: {
		broadcaster_user_id: number;
		category?: { name?: string; thumbnail?: string };
		slug: string;
		started_at: string;
		stream_title: string;
		thumbnail?: string;
		viewer_count: number;
	}[];
	message?: string;
};

export async function SyncKickLivestreams() {
	await EnsureAppDatabaseReady();
	const RunId = await NextId('sync_runs');
	await Run('insert into sync_runs (id, platform, started_at, status, items_found) values (?, ?, ?, ?, ?)', [
		RunId,
		'Kick',
		new Date().toISOString(),
		'Running',
		0
	]);

	const ClientId = await GetApiCredential('KICK_CLIENT_ID');
	const ClientSecret = await GetApiCredential('KICK_CLIENT_SECRET');
	if (!ClientId || !ClientSecret) {
		await FinishRun(RunId, 'Skipped', 0, 'Missing KICK_CLIENT_ID or KICK_CLIENT_SECRET');
		return { Status: 'Skipped', ItemsFound: 0, Message: 'Missing KICK_CLIENT_ID or KICK_CLIENT_SECRET' };
	}

	const Accounts = await All<KickAccount>(
		`select id as "Id", creator as "Creator", external_id as "ExternalId", handle as "Handle"
		 from platform_accounts where platform = ?`,
		['Kick']
	);

	let ItemsFound = 0;
	const Errors: string[] = [];
	const ScoreWeights = await GetOpportunityWeights();

	try {
		const Token = await GetAppToken(ClientId, ClientSecret);
		for (const Account of Accounts) {
			if (!/^\d+$/.test(Account.ExternalId)) {
				const Message = 'Kick sync needs numeric broadcaster_user_id; account remains manual';
				Errors.push(`${Account.Creator}: ${Message}`);
				await Run('update platform_accounts set last_error = ? where id = ?', [Message, Account.Id]);
				continue;
			}
			try {
				ItemsFound += await SyncAccount(ClientId, Token, Account, ScoreWeights);
				await Run('update platform_accounts set connected = ?, last_synced_at = ?, last_error = null where id = ?', [
					true,
					new Date().toISOString(),
					Account.Id
				]);
			} catch (Reason) {
				const Message = Reason instanceof Error ? Reason.message : 'Unknown Kick sync error';
				Errors.push(`${Account.Creator}: ${Message}`);
				await Run('update platform_accounts set last_error = ? where id = ?', [Message, Account.Id]);
			}
		}
	} catch (Reason) {
		const Message = Reason instanceof Error ? Reason.message : 'Unknown Kick token error';
		await FinishRun(RunId, 'Failed', 0, Message);
		return { Status: 'Failed', ItemsFound: 0, Message };
	}

	const Status = Errors.length ? 'Partial' : 'Completed';
	const Message = Errors.join(' | ') || `Synced ${Accounts.length} Kick accounts`;
	await FinishRun(RunId, Status, ItemsFound, Message);
	return { Status, ItemsFound, Message };
}

async function GetAppToken(ClientId: string, ClientSecret: string) {
	const Body = new URLSearchParams({
		grant_type: 'client_credentials',
		client_id: ClientId,
		client_secret: ClientSecret
	});
	const Response = await fetch('https://id.kick.com/oauth/token', {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: Body
	});
	const Payload = (await Response.json()) as KickTokenResponse;
	if (!Response.ok || !Payload.access_token) throw new Error(Payload.message ?? `Kick token HTTP ${Response.status}`);
	return Payload.access_token;
}

async function SyncAccount(
	ClientId: string,
	Token: string,
	Account: KickAccount,
	ScoreWeights: OpportunityWeights
) {
	const Url = new URL('https://api.kick.com/public/v1/livestreams');
	Url.searchParams.append('broadcaster_user_id', Account.ExternalId);
	Url.searchParams.set('limit', '1');
	Url.searchParams.set('sort', 'started_at');
	const Payload = await KickGet<KickLivestreamResponse>(Url, ClientId, Token);
	let Count = 0;
	for (const Stream of Payload.data ?? []) {
		const ExternalId = `kick-live-${Stream.broadcaster_user_id}-${Stream.started_at}`;
		if (await ContentExists(ExternalId)) continue;
		await Run(
			`insert into content_items
			 (id, creator, external_id, platform, kind, title, age, metric, campaign, status, score, live, velocity, source_url, thumbnail_url, published_at)
			 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				await NextId('content_items'),
				Account.Creator,
				ExternalId,
				'Kick',
				'Live stream',
				Stream.stream_title,
				FormatAge(Stream.started_at),
				`${Stream.viewer_count.toLocaleString()} watching`,
				'Organic',
				'New',
				CalculateOpportunityScore({
					Platform: 'Kick',
					Kind: 'Live stream',
					PublishedAt: Stream.started_at,
					Viewers: Stream.viewer_count,
					Campaign: 'Organic',
					Title: Stream.stream_title,
					Status: 'New'
				}, ScoreWeights),
				true,
				null,
				`https://kick.com/${Stream.slug || Account.Handle.replace(/^@/, '')}`,
				Stream.thumbnail ?? Stream.category?.thumbnail ?? null,
				Stream.started_at
			]
		);
		Count += 1;
	}
	return Count;
}

async function KickGet<T extends { message?: string }>(Url: URL, ClientId: string, Token: string) {
	const Response = await fetch(Url, {
		headers: {
			Authorization: `Bearer ${Token}`,
			'Client-Id': ClientId
		}
	});
	const Payload = (await Response.json()) as T;
	if (!Response.ok) throw new Error(Payload.message ?? `Kick HTTP ${Response.status}`);
	return Payload;
}

async function ContentExists(ExternalId: string) {
	return Boolean(await Get('select 1 from content_items where external_id = ? limit 1', [ExternalId]));
}

async function FinishRun(Id: number, Status: string, ItemsFound: number, Message: string) {
	await Run('update sync_runs set status = ?, items_found = ?, message = ?, finished_at = ? where id = ?', [
		Status,
		ItemsFound,
		Message,
		new Date().toISOString(),
		Id
	]);
}

function FormatAge(DateText: string) {
	const HoursOld = Math.max(1, Math.round((Date.now() - new Date(DateText).getTime()) / 36e5));
	if (HoursOld < 24) return `${HoursOld}h ago`;
	return `${Math.round(HoursOld / 24)}d ago`;
}

type KickAccount = {
	Id: number;
	Creator: string;
	ExternalId: string;
	Handle: string;
};
