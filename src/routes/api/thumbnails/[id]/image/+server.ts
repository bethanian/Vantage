import { All, EnsureAppDatabaseReady, Get, Run } from '$lib/server/db/app-db';
import { NormalizeThumbnailUrl, ResolveContentThumbnail, ResolveCreatorImage } from '$lib/server/thumbnails';

const CacheHeaders = {
	'cache-control': 'public, max-age=3600, stale-while-revalidate=86400'
};

const FallbackHeaders = {
	'cache-control': 'no-store'
};

export async function GET({ params }) {
	await EnsureAppDatabaseReady();
	const Id = Number(params.id);
	if (!Number.isFinite(Id) || Id <= 0) return new Response('', { status: 404 });
	const Item = await Get<ThumbnailImageRow>(
		`select id, creator, platform, kind, title, score, external_id, source_url, thumbnail_url
		 from content_items where id = ? limit 1`,
		[Id]
	);
	if (!Item) return new Response('', { status: 404 });

	const Existing = NormalizeThumbnailUrl(Item.thumbnail_url);
	const ExistingImage = Existing ? await FetchImage(Existing) : null;
	if (ExistingImage) return ExistingImage;

	const Resolved = await ResolveContentThumbnail({
		Platform: Item.platform,
		ExternalId: Item.external_id,
		SourceUrl: Item.source_url,
		ApiThumbnailUrl: null
	});
	if (Resolved) {
		const ResolvedImage = await FetchImage(Resolved);
		if (ResolvedImage) {
			await Run('update content_items set thumbnail_url = ? where id = ?', [Resolved, Id]);
			return ResolvedImage;
		}
	}

	const Accounts = await All<SourceAccountRow>(
		`select platform, handle, external_id, source_url
		 from platform_accounts
		 where lower(creator) = lower(?)
		 order by case platform
			when ? then 0
			when 'YouTube' then 1
			when 'Twitch' then 2
			when 'X' then 3
			when 'Kick' then 4
			else 5
		 end`,
		[Item.creator ?? '', Item.platform ?? '']
	);
	const CreatorImage = await FirstCreatorImage(Item, Accounts);
	if (CreatorImage) {
		const CreatorImageResponse = await FetchImage(CreatorImage);
		if (CreatorImageResponse) {
			await Run('update content_items set thumbnail_url = ? where id = ?', [CreatorImage, Id]);
			return CreatorImageResponse;
		}
	}

	return GeneratedFallback(Item);
}

async function FirstCreatorImage(Item: ThumbnailImageRow, Accounts: SourceAccountRow[]) {
	for (const Account of [
		...Accounts,
		{ platform: Item.platform, external_id: Item.external_id, source_url: Item.source_url }
	]) {
		const CreatorImage = await ResolveCreatorImage({
			Platform: Account.platform,
			ExternalId: Account.external_id,
			Handle: Account.handle,
			SourceUrl: Account.source_url
		});
		if (CreatorImage) return CreatorImage;
	}
	return null;
}

async function FetchImage(Url: string) {
	try {
		const Controller = new AbortController();
		const Timeout = setTimeout(() => Controller.abort(), 7000);
		const RemoteResponse = await fetch(Url, {
			headers: {
				accept: 'image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8',
				'user-agent': 'Mozilla/5.0 VantageThumbnailProxy/1.0'
			},
			signal: Controller.signal
		});
		clearTimeout(Timeout);
		const ContentType = RemoteResponse.headers.get('content-type') ?? '';
		if (!RemoteResponse.ok || !ContentType.startsWith('image/')) return null;
		return new Response(RemoteResponse.body, {
			headers: {
				...CacheHeaders,
				'content-type': ContentType
			}
		});
	} catch {
		return null;
	}
}

function GeneratedFallback(Item: ThumbnailImageRow) {
	const StaticPath = StaticFallbackPath(Item.platform);
	if (StaticPath) {
		return new Response(null, {
			status: 302,
			headers: {
				...FallbackHeaders,
				location: StaticPath
			}
		});
	}
	return AppLogoFallback();
}

function StaticFallbackPath(Platform?: string | null) {
	if (Platform === 'Twitch') return '/social-placeholders/twitch.png?v=1';
	if (Platform === 'Kick') return '/social-placeholders/kick.png?v=1';
	if (Platform === 'TikTok') return '/social-placeholders/tiktok.png?v=1';
	if (Platform === 'Instagram') return '/social-placeholders/instagram.png?v=1';
	return null;
}

function AppLogoFallback() {
	const Svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360" role="img" aria-label="Vantage placeholder">
		<defs>
			<linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
				<stop offset="0" stop-color="#f5f2eb"/>
				<stop offset="1" stop-color="#ded8cd"/>
			</linearGradient>
		</defs>
		<rect width="640" height="360" fill="url(#bg)"/>
		<rect x="52" y="42" width="536" height="276" rx="28" fill="#fbfaf6" opacity=".96"/>
		<circle cx="320" cy="150" r="58" fill="#2b5c3a"/>
		<text x="320" y="171" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="58" font-style="italic" fill="#c7e6cf">V</text>
		<text x="320" y="260" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="34" font-style="italic" fill="#2b5c3a">Vantage</text>
	</svg>`;
	return new Response(Svg, {
		headers: {
			...FallbackHeaders,
			'content-type': 'image/svg+xml; charset=utf-8'
		}
	});
}

type ThumbnailImageRow = {
	id: number;
	creator?: string | null;
	platform?: string | null;
	kind?: string | null;
	title?: string | null;
	score?: number | string | null;
	external_id?: string | null;
	source_url?: string | null;
	thumbnail_url?: string | null;
};

type SourceAccountRow = {
	platform?: string | null;
	handle?: string | null;
	external_id?: string | null;
	source_url?: string | null;
};
