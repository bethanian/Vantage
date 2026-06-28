import { All, EnsureAppDatabaseReady, Get, NextId, Run } from '$lib/server/db/app-db';
import { CalculateOpportunityScore, type OpportunityWeights } from '$lib/opportunity-score';
import { GetApiCredential } from '$lib/server/api-credentials';
import { GetOpportunityWeights } from '$lib/server/opportunity-settings';
import { ResolveKickSourceIds } from '$lib/server/source-id-resolver';
import { ResolveThumbnailUrl } from '$lib/server/thumbnails';

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

	const Accounts = await All<KickAccount>(
		`select id as "Id", creator as "Creator", external_id as "ExternalId", handle as "Handle", source_url as "SourceUrl"
		 from platform_accounts where platform = ?`,
		['Kick']
	);
	const ScoreWeights = await GetOpportunityWeights();
	const ClientId = await GetApiCredential('KICK_CLIENT_ID');
	const ClientSecret = await GetApiCredential('KICK_CLIENT_SECRET');
	if (!ClientId || !ClientSecret) {
		const ItemsFound = await UpsertKickFallbacks(Accounts, ScoreWeights);
		await FinishRun(RunId, 'Completed', ItemsFound, `Kick API missing; refreshed ${ItemsFound} channel watches`);
		return { Status: 'Completed', ItemsFound, Message: `Kick API missing; refreshed ${ItemsFound} channel watches` };
	}
	await ResolveKickSourceIds();

	let ItemsFound = 0;
	const Errors: string[] = [];

	try {
		const Token = await GetAppToken(ClientId, ClientSecret);
		for (const Account of Accounts) {
			if (!/^\d+$/.test(Account.ExternalId)) {
				const Message = 'Kick sync needs numeric broadcaster_user_id; account remains manual';
				Errors.push(`${Account.Creator}: ${Message}`);
				await Run('update platform_accounts set last_error = ? where id = ?', [Message, Account.Id]);
				ItemsFound += await UpsertKickChannelFallback(Account, ScoreWeights);
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
		ItemsFound += await UpsertKickFallbacks(Accounts, ScoreWeights);
		await FinishRun(RunId, 'Partial', ItemsFound, `${Message}; refreshed channel watches`);
		return { Status: 'Partial', ItemsFound, Message: `${Message}; refreshed channel watches` };
	}

	const Status = Errors.length ? 'Partial' : 'Completed';
	const Message = Errors.join(' | ') || `Synced ${Accounts.length} Kick accounts`;
	await FinishRun(RunId, Status, ItemsFound, Message);
	return { Status, ItemsFound, Message };
}

async function UpsertKickFallbacks(Accounts: KickAccount[], ScoreWeights: OpportunityWeights) {
	let Count = 0;
	for (const Account of Accounts) Count += await UpsertKickChannelFallback(Account, ScoreWeights);
	return Count;
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
		const SourceUrl = `https://kick.com/${Stream.slug || Account.Handle.replace(/^@/, '')}`;
		const ThumbnailUrl = await ResolveThumbnailUrl(SourceUrl, Stream.thumbnail ?? Stream.category?.thumbnail);
		const Score = CalculateOpportunityScore({
			Platform: 'Kick',
			Kind: 'Live stream',
			PublishedAt: Stream.started_at,
			Viewers: Stream.viewer_count,
			Campaign: 'Organic',
			Title: Stream.stream_title,
			Status: 'New'
		}, ScoreWeights);
		const ExistingId = await ContentId(ExternalId);
		if (ExistingId) {
			await UpdateExistingContent(ExistingId, {
				Title: Stream.stream_title,
				Age: FormatAge(Stream.started_at),
				Metric: `${Stream.viewer_count.toLocaleString()} watching`,
				Score,
				Live: true,
				SourceUrl,
				ThumbnailUrl,
				PublishedAt: Stream.started_at
			});
			continue;
		}
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
				Score,
				true,
				null,
				SourceUrl,
				ThumbnailUrl,
				Stream.started_at
			]
		);
		Count += 1;
	}
	if (Count === 0) Count += await UpsertKickChannelFallback(Account, ScoreWeights);
	return Count;
}

async function UpsertKickChannelFallback(Account: KickAccount, ScoreWeights: OpportunityWeights) {
	const SourceUrl = Account.SourceUrl ?? `https://kick.com/${Account.Handle.replace(/^@/, '')}`;
	const ExternalId = `kick-channel-${Account.Id}`;
	const Title = `Check ${Account.Creator} on Kick`;
	const ThumbnailUrl = await ResolveThumbnailUrl(SourceUrl, null);
	const Score = Math.max(66, CalculateOpportunityScore({ Platform: 'Kick', Kind: 'Channel watch', Title, Status: 'New' }, ScoreWeights));
	const ExistingId = await ContentId(ExternalId);
	if (ExistingId) {
		await UpdateExistingContent(ExistingId, {
			Title,
			Age: 'channel check',
			Metric: Account.Handle,
			Score,
			Live: false,
			SourceUrl,
			ThumbnailUrl,
			PublishedAt: new Date().toISOString()
		});
		return 0;
	}
	await Run(
		`insert into content_items
		 (id, creator, external_id, platform, kind, title, age, metric, campaign, status, score, live, velocity, source_url, thumbnail_url, published_at)
		 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			await NextId('content_items'),
			Account.Creator,
			ExternalId,
			'Kick',
			'Channel watch',
			Title,
			'channel check',
			Account.Handle,
			'Organic',
			'New',
			Score,
			false,
			null,
			SourceUrl,
			ThumbnailUrl,
			new Date().toISOString()
		]
	);
	return 1;
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

async function ContentId(ExternalId: string) {
	const Row = await Get<{ id: number }>('select id from content_items where external_id = ? limit 1', [ExternalId]);
	return Row?.id ?? 0;
}

async function UpdateExistingContent(Id: number, Item: ExistingContentUpdate) {
	await Run(
		`update content_items
		 set title = ?, age = ?, metric = ?, score = ?, live = ?, source_url = ?, thumbnail_url = coalesce(?, thumbnail_url), published_at = ?
		 where id = ?`,
		[Item.Title, Item.Age, Item.Metric, Item.Score, Item.Live, Item.SourceUrl, Item.ThumbnailUrl, Item.PublishedAt, Id]
	);
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
	SourceUrl?: string | null;
};

type ExistingContentUpdate = {
	Title: string;
	Age: string;
	Metric: string;
	Score: number;
	Live: boolean;
	SourceUrl: string;
	ThumbnailUrl: string | null;
	PublishedAt: string;
};
