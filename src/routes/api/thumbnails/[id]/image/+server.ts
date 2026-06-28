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
	const Accent = PlatformColor(Item.platform);
	const Title = Clamp(EscapeXml(Item.title), 76);
	const Creator = Clamp(EscapeXml(Item.creator), 28);
	const Kind = Clamp(EscapeXml(Item.kind || Item.platform || 'Source'), 22);
	const Score = Number.isFinite(Number(Item.score)) ? String(Item.score) : '';
	const Svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360" role="img" aria-label="${Title}">
		<defs>
			<linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
				<stop offset="0" stop-color="#f3f0e8"/>
				<stop offset="1" stop-color="#ded8cd"/>
			</linearGradient>
			<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
				<feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#1a1916" flood-opacity=".18"/>
			</filter>
		</defs>
		<rect width="640" height="360" fill="url(#bg)"/>
		<rect x="34" y="34" width="572" height="292" rx="24" fill="#fbfaf6" filter="url(#shadow)"/>
		<rect x="34" y="34" width="572" height="292" rx="24" fill="none" stroke="#cec7ba"/>
		<rect x="58" y="58" width="116" height="40" rx="20" fill="${Accent}"/>
		<text x="116" y="84" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#fff">${EscapeXml(Item.platform || 'Source')}</text>
		<text x="58" y="143" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#2a2925">${Creator}</text>
		<text x="58" y="184" font-family="Arial, sans-serif" font-size="30" font-weight="800" fill="#111" letter-spacing=".2">${Title}</text>
		<text x="58" y="244" font-family="Arial, sans-serif" font-size="18" fill="#6f6a61">${Kind}</text>
		<circle cx="548" cy="94" r="42" fill="#fff4e0" stroke="#ead8b5"/>
		<text x="548" y="104" text-anchor="middle" font-family="Arial, sans-serif" font-size="28" font-weight="800" fill="#a66a16">${Score}</text>
		<path d="M58 286h410" stroke="${Accent}" stroke-width="10" stroke-linecap="round"/>
		<path d="M492 286h56" stroke="#d5cec2" stroke-width="10" stroke-linecap="round"/>
	</svg>`;
	return new Response(Svg, {
		headers: {
			...FallbackHeaders,
			'content-type': 'image/svg+xml; charset=utf-8'
		}
	});
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

function Clamp(Value: string, MaxLength: number) {
	return Value.length > MaxLength ? `${Value.slice(0, MaxLength - 3)}...` : Value;
}

function PlatformColor(Platform?: string | null) {
	if (Platform === 'Twitch') return '#6441a5';
	if (Platform === 'Kick') return '#2b8f43';
	if (Platform === 'YouTube') return '#c5322e';
	if (Platform === 'TikTok') return '#111111';
	return '#2b5c3a';
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
