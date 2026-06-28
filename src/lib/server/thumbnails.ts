import { GetApiCredential } from '$lib/server/api-credentials';

type ContentThumbnailInput = {
	Platform?: string | null;
	SourceUrl?: string | null;
	ExternalId?: string | null;
	ApiThumbnailUrl?: string | null;
};

export function NormalizeThumbnailUrl(Url?: string | null) {
	if (!Url) return null;
	return Url
		.replace(/^\/\//, 'https://')
		.replaceAll('{width}', '640')
		.replaceAll('{height}', '360')
		.replaceAll('%{width}', '640')
		.replaceAll('%{height}', '360');
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
		const TwitchThumbnail = await TwitchThumbnailFromApi(ExternalId);
		if (TwitchThumbnail) return TwitchThumbnail;
	}
	if (!SourceUrl) return null;
	return NormalizeThumbnailUrl(await OpenGraphThumbnail(SourceUrl));
}

function YoutubeThumbnailFromUrl(SourceUrl?: string | null, ExternalId?: string | null) {
	const VideoId = SourceUrl?.match(/(?:watch\?v=|youtu\.be\/|shorts\/)([\w-]{6,})/i)?.[1] ?? ExternalId?.match(/^[\w-]{6,}$/)?.[0];
	return VideoId ? `https://i.ytimg.com/vi/${VideoId}/hqdefault.jpg` : null;
}

async function TwitchThumbnailFromApi(ExternalId?: string | null) {
	const VideoId = ExternalId?.match(/^twitch-video-(\d+)$/)?.[1];
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
		return MatchMeta(Html, 'og:image') ?? MatchMeta(Html, 'twitter:image');
	} catch {
		return null;
	}
}

function MatchMeta(Html: string, Property: string) {
	const Escaped = Property.replace(':', '\\s*:\\s*');
	const Match = Html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${Escaped}["'][^>]+content=["']([^"']+)["']`, 'i'));
	return Match?.[1] ?? null;
}
