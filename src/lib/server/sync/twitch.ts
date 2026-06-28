import { All, EnsureAppDatabaseReady, Get, NextId, Run } from '$lib/server/db/app-db';
import { CalculateOpportunityScore, type OpportunityWeights } from '$lib/opportunity-score';
import { GetApiCredential } from '$lib/server/api-credentials';
import { GetOpportunityWeights } from '$lib/server/opportunity-settings';
import { ResolveTwitchSourceIds } from '$lib/server/source-id-resolver';
import { ResolveThumbnailUrl } from '$lib/server/thumbnails';

type TwitchTokenResponse = { access_token?: string; message?: string };
type TwitchStreamResponse = {
	data?: {
		id: string;
		user_id: string;
		user_name: string;
		title: string;
		viewer_count: number;
		started_at: string;
		thumbnail_url?: string;
	}[];
	message?: string;
};
type TwitchVideosResponse = {
	data?: {
		id: string;
		user_id: string;
		user_name: string;
		title: string;
		url: string;
		view_count: number;
		created_at: string;
		thumbnail_url?: string;
	}[];
	message?: string;
};

export async function SyncTwitchSources() {
	await EnsureAppDatabaseReady();
	const RunId = await NextId('sync_runs');
	await Run('insert into sync_runs (id, platform, started_at, status, items_found) values (?, ?, ?, ?, ?)', [
		RunId,
		'Twitch',
		new Date().toISOString(),
		'Running',
		0
	]);

	const ClientId = await GetApiCredential('TWITCH_CLIENT_ID');
	const ClientSecret = await GetApiCredential('TWITCH_CLIENT_SECRET');
	if (!ClientId || !ClientSecret) {
		await FinishRun(RunId, 'Skipped', 0, 'Missing TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET');
		return { Status: 'Skipped', ItemsFound: 0, Message: 'Missing TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET' };
	}
	await ResolveTwitchSourceIds();

	const Accounts = await All<SourceAccount>(
		`select id as "Id", creator as "Creator", external_id as "ExternalId"
		 from platform_accounts where platform = ?`,
		['Twitch']
	);

	let ItemsFound = 0;
	const Errors: string[] = [];
	const ScoreWeights = await GetOpportunityWeights();

	try {
		const Token = await GetAppToken(ClientId, ClientSecret);
		for (const Account of Accounts) {
			try {
				ItemsFound += await SyncLiveStream(ClientId, Token, Account, ScoreWeights);
				ItemsFound += await SyncVideos(ClientId, Token, Account, ScoreWeights);
				await Run('update platform_accounts set connected = ?, last_synced_at = ?, last_error = null where id = ?', [
					true,
					new Date().toISOString(),
					Account.Id
				]);
			} catch (Reason) {
				const Message = Reason instanceof Error ? Reason.message : 'Unknown Twitch sync error';
				Errors.push(`${Account.Creator}: ${Message}`);
				await Run('update platform_accounts set last_error = ? where id = ?', [Message, Account.Id]);
			}
		}
	} catch (Reason) {
		const Message = Reason instanceof Error ? Reason.message : 'Unknown Twitch token error';
		await FinishRun(RunId, 'Failed', 0, Message);
		return { Status: 'Failed', ItemsFound: 0, Message };
	}

	const Status = Errors.length ? 'Partial' : 'Completed';
	const Message = Errors.join(' | ') || `Synced ${Accounts.length} Twitch accounts`;
	await FinishRun(RunId, Status, ItemsFound, Message);
	return { Status, ItemsFound, Message };
}

async function GetAppToken(ClientId: string, ClientSecret: string) {
	const Url = new URL('https://id.twitch.tv/oauth2/token');
	Url.searchParams.set('client_id', ClientId);
	Url.searchParams.set('client_secret', ClientSecret);
	Url.searchParams.set('grant_type', 'client_credentials');
	const Response = await fetch(Url, { method: 'POST' });
	const Payload = (await Response.json()) as TwitchTokenResponse;
	if (!Response.ok || !Payload.access_token) throw new Error(Payload.message ?? `Twitch token HTTP ${Response.status}`);
	return Payload.access_token;
}

async function SyncLiveStream(ClientId: string, Token: string, Account: SourceAccount, ScoreWeights: OpportunityWeights) {
	const Url = new URL('https://api.twitch.tv/helix/streams');
	Url.searchParams.set('user_id', Account.ExternalId);
	const Payload = await TwitchGet<TwitchStreamResponse>(Url, ClientId, Token);
	let Count = 0;
	for (const Stream of Payload.data ?? []) {
		const ExternalId = `twitch-stream-${Stream.id}`;
		const SourceUrl = `https://www.twitch.tv/${Stream.user_name.toLowerCase()}`;
		const ThumbnailUrl = await ResolveThumbnailUrl(SourceUrl, Stream.thumbnail_url);
		const Score = CalculateOpportunityScore({
			Platform: 'Twitch',
			Kind: 'Live stream',
			PublishedAt: Stream.started_at,
			Viewers: Stream.viewer_count,
			Campaign: 'Organic',
			Title: Stream.title,
			Status: 'New'
		}, ScoreWeights);
		const ExistingId = await ContentId(ExternalId);
		if (ExistingId) {
			await UpdateExistingContent(ExistingId, {
				Title: Stream.title,
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
				'Twitch',
				'Live stream',
				Stream.title,
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
	return Count;
}

async function SyncVideos(ClientId: string, Token: string, Account: SourceAccount, ScoreWeights: OpportunityWeights) {
	const Url = new URL('https://api.twitch.tv/helix/videos');
	Url.searchParams.set('user_id', Account.ExternalId);
	Url.searchParams.set('first', '5');
	Url.searchParams.set('type', 'archive');
	const Payload = await TwitchGet<TwitchVideosResponse>(Url, ClientId, Token);
	let Count = 0;
	for (const Video of Payload.data ?? []) {
		const ExternalId = `twitch-video-${Video.id}`;
		const ThumbnailUrl = await ResolveThumbnailUrl(Video.url, Video.thumbnail_url);
		const Score = CalculateOpportunityScore({
			Platform: 'Twitch',
			Kind: 'VOD',
			PublishedAt: Video.created_at,
			Views: Video.view_count,
			Campaign: 'Organic',
			Title: Video.title,
			Status: 'New'
		}, ScoreWeights);
		const ExistingId = await ContentId(ExternalId);
		if (ExistingId) {
			await UpdateExistingContent(ExistingId, {
				Title: Video.title,
				Age: FormatAge(Video.created_at),
				Metric: `${Video.view_count.toLocaleString()} views`,
				Score,
				Live: false,
				SourceUrl: Video.url,
				ThumbnailUrl,
				PublishedAt: Video.created_at
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
				'Twitch',
				'VOD',
				Video.title,
				FormatAge(Video.created_at),
				`${Video.view_count.toLocaleString()} views`,
				'Organic',
				'New',
				Score,
				false,
				null,
				Video.url,
				ThumbnailUrl,
				Video.created_at
			]
		);
		Count += 1;
	}
	return Count;
}

async function TwitchGet<T extends { message?: string }>(Url: URL, ClientId: string, Token: string) {
	const Response = await fetch(Url, {
		headers: {
			Authorization: `Bearer ${Token}`,
			'Client-Id': ClientId
		}
	});
	const Payload = (await Response.json()) as T;
	if (!Response.ok) throw new Error(Payload.message ?? `Twitch HTTP ${Response.status}`);
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

type SourceAccount = {
	Id: number;
	Creator: string;
	ExternalId: string;
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
