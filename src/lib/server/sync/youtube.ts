import { All, EnsureAppDatabaseReady, Get, NextId, Run } from '$lib/server/db/app-db';
import { CalculateOpportunityScore } from '$lib/opportunity-score';
import { GetApiCredential } from '$lib/server/api-credentials';
import { GetOpportunityWeights } from '$lib/server/opportunity-settings';
import { ResolveYoutubeSourceIds } from '$lib/server/source-id-resolver';
import { ResolveCreatorImage, ResolveThumbnailUrl } from '$lib/server/thumbnails';

type YoutubeSearchResponse = {
	items?: {
		id?: { videoId?: string };
		snippet?: {
			channelTitle?: string;
			publishedAt?: string;
			title?: string;
			thumbnails?: { medium?: { url?: string }; default?: { url?: string } };
		};
	}[];
	error?: { message?: string };
};

export async function SyncYoutubeUploads() {
	await EnsureAppDatabaseReady();
	const StartedAt = new Date().toISOString();
	const RunId = await NextId('sync_runs');
	await Run('insert into sync_runs (id, platform, started_at, status, items_found) values (?, ?, ?, ?, ?)', [
		RunId,
		'YouTube',
		StartedAt,
		'Running',
		0
	]);

	const ApiKey = await GetApiCredential('YOUTUBE_API_KEY');
	if (!ApiKey) {
		await FinishRun(RunId, 'Skipped', 0, 'Missing YOUTUBE_API_KEY');
		return { Status: 'Skipped', ItemsFound: 0, Message: 'Missing YOUTUBE_API_KEY' };
	}
	await ResolveYoutubeSourceIds();

	const Accounts = await All<YoutubeAccount>(
		`select id as "Id", creator as "Creator", external_id as "ExternalId", handle as "Handle", source_url as "SourceUrl"
		 from platform_accounts where platform = ?`,
		['YouTube']
	);

	let ItemsFound = 0;
	const Errors: string[] = [];
	const ScoreWeights = await GetOpportunityWeights();

	for (const Account of Accounts) {
		try {
			const Items = await FetchRecentChannelVideos(ApiKey, Account.ExternalId);
			for (const Item of Items) {
				const VideoId = Item.id?.videoId;
				const Snippet = Item.snippet;
				if (!VideoId || !Snippet?.title) continue;
				const SourceUrl = `https://www.youtube.com/watch?v=${VideoId}`;
				const ThumbnailUrl = await ResolveThumbnailUrl(SourceUrl, Snippet.thumbnails?.medium?.url ?? Snippet.thumbnails?.default?.url) ??
					await ResolveCreatorImage({ Platform: 'YouTube', ExternalId: Account.ExternalId, Handle: Account.Handle, SourceUrl: Account.SourceUrl ?? SourceUrl });
				const Score = CalculateOpportunityScore({
					Platform: 'YouTube',
					Kind: 'Upload',
					PublishedAt: Snippet.publishedAt,
					Campaign: 'Organic',
					Title: Snippet.title,
					Status: 'New'
				}, ScoreWeights);
				const ExistingId = await ContentId(VideoId);
				if (ExistingId) {
					await UpdateExistingContent(ExistingId, {
						Title: Snippet.title,
						Age: FormatAge(Snippet.publishedAt),
						Metric: 'fresh upload',
						Score,
						SourceUrl,
						ThumbnailUrl,
						PublishedAt: Snippet.publishedAt ?? null
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
						VideoId,
						'YouTube',
						'Upload',
						Snippet.title,
						FormatAge(Snippet.publishedAt),
						'fresh upload',
						'Organic',
						'New',
						Score,
						false,
						null,
						SourceUrl,
						ThumbnailUrl,
						Snippet.publishedAt ?? null
					]
				);
				ItemsFound += 1;
			}
			await Run('update platform_accounts set connected = ?, last_synced_at = ?, last_error = null where id = ?', [
				true,
				new Date().toISOString(),
				Account.Id
			]);
		} catch (Reason) {
			const Message = Reason instanceof Error ? Reason.message : 'Unknown YouTube sync error';
			Errors.push(`${Account.Creator}: ${Message}`);
			await Run('update platform_accounts set last_error = ? where id = ?', [Message, Account.Id]);
		}
	}

	const Status = Errors.length ? 'Partial' : 'Completed';
	const Message = Errors.join(' | ') || `Synced ${Accounts.length} YouTube accounts`;
	await FinishRun(RunId, Status, ItemsFound, Message);
	return { Status, ItemsFound, Message };
}

async function FetchRecentChannelVideos(ApiKey: string, ChannelId: string) {
	const PublishedAfter = new Date(Date.now() - 1000 * 60 * 60 * 24 * 14).toISOString();
	const Url = new URL('https://www.googleapis.com/youtube/v3/search');
	Url.searchParams.set('part', 'snippet');
	Url.searchParams.set('channelId', ChannelId);
	Url.searchParams.set('maxResults', '10');
	Url.searchParams.set('order', 'date');
	Url.searchParams.set('publishedAfter', PublishedAfter);
	Url.searchParams.set('type', 'video');
	Url.searchParams.set('key', ApiKey);

	const Response = await fetch(Url);
	const Payload = (await Response.json()) as YoutubeSearchResponse;
	if (!Response.ok) throw new Error(Payload.error?.message ?? `YouTube HTTP ${Response.status}`);
	return Payload.items ?? [];
}

async function ContentId(ExternalId: string) {
	const Row = await Get<{ id: number }>('select id from content_items where external_id = ? limit 1', [ExternalId]);
	return Row?.id ?? 0;
}

async function UpdateExistingContent(Id: number, Item: ExistingContentUpdate) {
	await Run(
		`update content_items
		 set title = ?, age = ?, metric = ?, score = ?, source_url = ?, thumbnail_url = coalesce(?, thumbnail_url), published_at = ?
		 where id = ?`,
		[Item.Title, Item.Age, Item.Metric, Item.Score, Item.SourceUrl, Item.ThumbnailUrl, Item.PublishedAt, Id]
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

function FormatAge(PublishedAt?: string) {
	if (!PublishedAt) return 'unknown';
	const HoursOld = Math.max(1, Math.round((Date.now() - new Date(PublishedAt).getTime()) / 36e5));
	if (HoursOld < 24) return `${HoursOld}h ago`;
	return `${Math.round(HoursOld / 24)}d ago`;
}

type YoutubeAccount = {
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
	SourceUrl: string;
	ThumbnailUrl: string | null;
	PublishedAt: string | null;
};
