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
	const Platform = Item.platform ?? 'Vantage';
	const Brand = PlatformBrand(Platform);
	const Label = EscapeXml(`${Platform} placeholder`);
	const Svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360" role="img" aria-label="${Label}">
		<defs>
			<linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
				<stop offset="0" stop-color="${Brand.BackgroundStart}"/>
				<stop offset="1" stop-color="${Brand.BackgroundEnd}"/>
			</linearGradient>
		</defs>
		<rect width="640" height="360" fill="url(#bg)"/>
		<rect x="52" y="42" width="536" height="276" rx="28" fill="${Brand.Surface}" opacity=".96"/>
		${Brand.Mark}
		<text x="320" y="265" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="30" font-style="italic" fill="${Brand.Text}">${Brand.Label}</text>
	</svg>`;
	return new Response(Svg, {
		headers: {
			...FallbackHeaders,
			'content-type': 'image/svg+xml; charset=utf-8'
		}
	});
}

function PlatformBrand(Platform: string) {
	if (Platform === 'Twitch') {
		return {
			Label: 'twitch',
			BackgroundStart: '#efe9ff',
			BackgroundEnd: '#ded0ff',
			Surface: '#ffffff',
			Text: '#9146ff',
			Mark: `<text x="320" y="200" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="78" font-weight="900" fill="#9146ff">twitch</text>`
		};
	}
	if (Platform === 'Kick') return LogoBrand('Kick', '#2ed15f', '#e9f8ed', '#d7f0dd', '#ffffff', '#1d7f39');
	if (Platform === 'YouTube') return LogoBrand('YouTube', '#ff0033', '#fff0f0', '#ffe0e0', '#ffffff', '#c2182b');
	if (Platform === 'TikTok') return LogoBrand('TikTok', '#111111', '#f3f2ee', '#e4e0d7', '#ffffff', '#111111');
	if (Platform === 'Instagram') return LogoBrand('Instagram', '#d9468c', '#fff0f7', '#f3dfeb', '#ffffff', '#a92767');
	if (Platform === 'X') return LogoBrand('X', '#111111', '#f4f3ef', '#e1ddd4', '#ffffff', '#111111');
	return LogoBrand('Vantage', '#2b5c3a', '#f5f2eb', '#ded8cd', '#fbfaf6', '#2b5c3a');
}

function LogoBrand(Label: string, Accent: string, BackgroundStart: string, BackgroundEnd: string, Surface: string, Text: string) {
	return {
		Label,
		BackgroundStart,
		BackgroundEnd,
		Surface,
		Text,
		Mark: `<circle cx="320" cy="154" r="54" fill="${Accent}"/><text x="320" y="173" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="50" font-weight="900" fill="#fff">${EscapeXml(Label[0] ?? 'V')}</text>`
	};
}

function EscapeXml(Value?: string | null) {
	return (Value ?? '').replace(/[<>&"']/g, (Character) => ({
		'<': '&lt;',
		'>': '&gt;',
		'&': '&amp;',
		'"': '&quot;',
		"'": '&apos;'
	})[Character] ?? Character);
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
