import { GetApiCredential } from '$lib/server/api-credentials';
import { All, EnsureAppDatabaseReady } from '$lib/server/db/app-db';
import { IsGenericThumbnailUrl, NormalizeThumbnailUrl, ResolveCreatorImage } from '$lib/server/thumbnails';
import { json } from '@sveltejs/kit';

export async function GET() {
	await EnsureAppDatabaseReady();
	const Accounts = await All<TwitchAccount>(
		`select creator as "Creator", handle as "Handle", external_id as "ExternalId", source_url as "SourceUrl",
		 connected as "Connected", last_error as "LastError"
		 from platform_accounts
		 where platform = ?
		 order by creator`,
		['Twitch']
	);
	const Items = await All<TwitchItem>(
		`select creator as "Creator", title as "Title", source_url as "SourceUrl", thumbnail_url as "ThumbnailUrl"
		 from content_items
		 where platform = ?
		 order by creator, id desc`,
		['Twitch']
	);
	const ItemsByCreator = new Map<string, TwitchItem[]>();
	for (const Item of Items) ItemsByCreator.set(Item.Creator.toLowerCase(), [...(ItemsByCreator.get(Item.Creator.toLowerCase()) ?? []), Item]);

	return json({
		TwitchCredentials: {
			ClientId: Boolean(await GetApiCredential('TWITCH_CLIENT_ID')),
			ClientSecret: Boolean(await GetApiCredential('TWITCH_CLIENT_SECRET'))
		},
		Accounts: await Promise.all(Accounts.map(async (Account) => {
			const CreatorImage = await ResolveCreatorImage({
				Platform: 'Twitch',
				ExternalId: Account.ExternalId,
				Handle: Account.Handle,
				SourceUrl: Account.SourceUrl
			});
			const CreatorItems = ItemsByCreator.get(Account.Creator.toLowerCase()) ?? [];
			return {
				...Account,
				Connected: Boolean(Account.Connected),
				ResolvedCreatorImage: CreatorImage,
				FeedItems: CreatorItems.length,
				ItemsWithoutStoredThumbnail: CreatorItems.filter((Item) => !NormalizeThumbnailUrl(Item.ThumbnailUrl)).length,
				ItemsWithGenericThumbnail: CreatorItems.filter((Item) => IsGenericThumbnailUrl(Item.ThumbnailUrl)).length
			};
		}))
	});
}

type TwitchAccount = {
	Creator: string;
	Handle: string;
	ExternalId: string;
	SourceUrl?: string | null;
	Connected?: boolean | number | null;
	LastError?: string | null;
};

type TwitchItem = {
	Creator: string;
	Title: string;
	SourceUrl?: string | null;
	ThumbnailUrl?: string | null;
};
