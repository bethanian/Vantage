import { GetApiCredential } from '$lib/server/api-credentials';

type ContentThumbnailInput = {
	Platform?: string | null;
	SourceUrl?: string | null;
	ExternalId?: string | null;
	ApiThumbnailUrl?: string | null;
};

export function NormalizeThumbnailUrl(Url?: string | null) {
	if (!Url) return null;
	let Normalized = Url
		.replace(/^\/\//, 'https://')
		.replaceAll('{width}', '320')
		.replaceAll('{height}', '180')
		.replaceAll('%{width}', '320')
		.replaceAll('%{height}', '180');
	if (Normalized.includes('static-cdn.jtvnw.net')) Normalized = Normalized.replace(/-\d+x\d+(\.(?:jpg|jpeg|png|webp))/i, '-320x180$1');
	return Normalized;
}

export async function ResolveThumbnailUrl(SourceUrl?: string | null, ApiThumbnailUrl?: string | null) {
	return ResolveContentThumbnail({ SourceUrl, ApiThumbnailUrl });
}

export async function ResolveContentThumbnail(Input: ContentThumbnailInput) {
	const { Platform, SourceUrl, ExternalId, ApiThumbnailUrl } = Input;
	const Normalized = NormalizeThumbnailUrl(ApiThumbnailUrl);
	if (Normalized) return Normalized;
	const YoutubeThumbnail = YoutubeThumbnailFromUrl(SourceUrl, ExternalId);
	if (YoutubeThumbnail) return YoutubeThumbnail;
	if (Platform === 'Twitch') {
		const TwitchThumbnail = await TwitchThumbnailFromApi(ExternalId, SourceUrl);
		if (TwitchThumbnail) return TwitchThumbnail;
	}
	if (!SourceUrl) return null;
	return NormalizeThumbnailUrl(await OpenGraphThumbnail(SourceUrl));
}

function YoutubeThumbnailFromUrl(SourceUrl?: string | null, ExternalId?: string | null) {
	const VideoId = SourceUrl?.match(/(?:watch\?v=|youtu\.be\/|shorts\/)([\w-]{6,})/i)?.[1] ?? ExternalId?.match(/^[\w-]{6,}$/)?.[0];
	return VideoId ? `https://i.ytimg.com/vi/${VideoId}/hqdefault.jpg` : null;
}

async function TwitchThumbnailFromApi(ExternalId?: string | null, SourceUrl?: string | null) {
	const VideoId = ExternalId?.match(/^twitch-video-(\d+)$/)?.[1] ?? SourceUrl?.match(/videos\/(\d+)/)?.[1];
	if (!VideoId) return null;
	const ClientId = await GetApiCredential('TWITCH_CLIENT_ID');
	const ClientSecret = await GetApiCredential('TWITCH_CLIENT_SECRET');
	if (!ClientId || !ClientSecret) return null;
	const Token = await TwitchToken(ClientId, ClientSecret);
	if (!Token) return null;
	const Url = new URL('https://api.twitch.tv/helix/videos');
	Url.searchParams.set('id', VideoId);
	const Response = await fetch(Url, { headers: { Authorization: `Bearer ${Token}`, 'Client-Id': ClientId } });
	if (!Response.ok) return null;
	const Payload = (await Response.json()) as { data?: { thumbnail_url?: string }[] };
	return NormalizeThumbnailUrl(Payload.data?.[0]?.thumbnail_url);
}

async function TwitchToken(ClientId: string, ClientSecret: string) {
	const Url = new URL('https://id.twitch.tv/oauth2/token');
	Url.searchParams.set('client_id', ClientId);
	Url.searchParams.set('client_secret', ClientSecret);
	Url.searchParams.set('grant_type', 'client_credentials');
	const Response = await fetch(Url, { method: 'POST' });
	if (!Response.ok) return null;
	const Payload = (await Response.json()) as { access_token?: string };
	return Payload.access_token ?? null;
}

async function OpenGraphThumbnail(SourceUrl: string) {
	try {
		const Response = await fetch(SourceUrl, {
			headers: {
				'user-agent': 'Mozilla/5.0 VantageBot/1.0',
				accept: 'text/html,application/xhtml+xml'
			}
		});
		if (!Response.ok) return null;
		const Html = await Response.text();
		return ResolveMaybeRelativeUrl(MatchMeta(Html, 'og:image') ?? MatchMeta(Html, 'twitter:image'), SourceUrl);
	} catch {
		return null;
	}
}

function MatchMeta(Html: string, Property: string) {
	const Escaped = Property.replace(':', '\\s*:\\s*');
	const Tags = Html.match(/<meta[^>]+>/gi) ?? [];
	for (const Tag of Tags) {
		if (!new RegExp(`(?:property|name)=["']${Escaped}["']`, 'i').test(Tag)) continue;
		const Content = Tag.match(/content=["']([^"']+)["']/i)?.[1];
		if (Content) return Content;
	}
	return null;
}

function ResolveMaybeRelativeUrl(Url: string | null, BaseUrl: string) {
	if (!Url) return null;
	try {
		return new URL(Url, BaseUrl).toString();
	} catch {
		return Url;
	}
}
