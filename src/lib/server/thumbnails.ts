import { GetApiCredential } from '$lib/server/api-credentials';

type ContentThumbnailInput = {
	Platform?: string | null;
	SourceUrl?: string | null;
	ExternalId?: string | null;
	ApiThumbnailUrl?: string | null;
};

export type CreatorImageInput = {
	Platform?: string | null;
	SourceUrl?: string | null;
	ExternalId?: string | null;
	Handle?: string | null;
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

export function IsGenericThumbnailUrl(Url?: string | null) {
	const Normalized = NormalizeThumbnailUrl(Url)?.toLowerCase() ?? '';
	return Boolean(
		Normalized.includes('/social-placeholders/') ||
		Normalized.includes('ttv-static-metadata/twitch_logo') ||
		Normalized.includes('static-cdn.jtvnw.net/jtv_user_pictures/xarth/404_user')
	);
}

export async function ResolveThumbnailUrl(SourceUrl?: string | null, ApiThumbnailUrl?: string | null) {
	return ResolveContentThumbnail({ SourceUrl, ApiThumbnailUrl });
}

export async function ResolveContentThumbnail(Input: ContentThumbnailInput) {
	const { Platform, SourceUrl, ExternalId, ApiThumbnailUrl } = Input;
	const Normalized = NormalizeThumbnailUrl(ApiThumbnailUrl);
	if (Normalized && !IsGenericThumbnailUrl(Normalized)) return Normalized;
	const YoutubeThumbnail = YoutubeThumbnailFromUrl(SourceUrl, ExternalId);
	if (YoutubeThumbnail) return YoutubeThumbnail;
	if (Platform === 'Twitch') {
		const TwitchThumbnail = await TwitchThumbnailFromApi(ExternalId, SourceUrl);
		if (TwitchThumbnail) return TwitchThumbnail;
	}
	if (!SourceUrl) return null;
	return NormalizeThumbnailUrl(await OpenGraphThumbnail(SourceUrl));
}

export async function ResolveCreatorImage(Input: CreatorImageInput) {
	const { Platform, SourceUrl, ExternalId, Handle } = Input;
	if (Platform === 'Twitch') {
		const TwitchImage = await TwitchProfileImage(ExternalId, Handle);
		return FirstReachableImage([
			TwitchImage,
			SourceUrl ? await OpenGraphThumbnail(SourceUrl) : null,
			...AvatarCandidates(Platform, Handle)
		]);
	}
	if (Platform === 'YouTube') {
		const YoutubeImage = await YoutubeChannelImage(ExternalId, Handle);
		return FirstReachableImage([
			YoutubeImage,
			SourceUrl ? await OpenGraphThumbnail(SourceUrl) : null,
			...AvatarCandidates(Platform, Handle)
		]);
	}
	return FirstReachableImage([
		SourceUrl ? await OpenGraphThumbnail(SourceUrl) : null,
		...AvatarCandidates(Platform, Handle)
	]);
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

async function TwitchProfileImage(ExternalId?: string | null, Handle?: string | null) {
	const ClientId = await GetApiCredential('TWITCH_CLIENT_ID');
	const ClientSecret = await GetApiCredential('TWITCH_CLIENT_SECRET');
	if (!ClientId || !ClientSecret) return null;
	const Token = await TwitchToken(ClientId, ClientSecret);
	if (!Token) return null;
	const Url = new URL('https://api.twitch.tv/helix/users');
	if (ExternalId && /^\d+$/.test(ExternalId)) Url.searchParams.set('id', ExternalId);
	else if (Handle) Url.searchParams.set('login', Handle.replace(/^@/, '').toLowerCase());
	else return null;
	const Response = await fetch(Url, { headers: { Authorization: `Bearer ${Token}`, 'Client-Id': ClientId } });
	if (!Response.ok) return null;
	const Payload = (await Response.json()) as { data?: { profile_image_url?: string }[] };
	return NormalizeThumbnailUrl(Payload.data?.[0]?.profile_image_url);
}

async function YoutubeChannelImage(ExternalId?: string | null, Handle?: string | null) {
	const ApiKey = await GetApiCredential('YOUTUBE_API_KEY');
	if (!ApiKey) return null;
	const Url = new URL('https://www.googleapis.com/youtube/v3/channels');
	Url.searchParams.set('part', 'snippet');
	if (ExternalId && /^UC[\w-]{20,}$/.test(ExternalId)) Url.searchParams.set('id', ExternalId);
	else if (Handle) Url.searchParams.set('forHandle', Handle.replace(/^@/, ''));
	else return null;
	Url.searchParams.set('key', ApiKey);
	const Response = await fetch(Url);
	if (!Response.ok) return null;
	const Payload = (await Response.json()) as {
		items?: { snippet?: { thumbnails?: { high?: { url?: string }; medium?: { url?: string }; default?: { url?: string } } } }[];
	};
	return NormalizeThumbnailUrl(
		Payload.items?.[0]?.snippet?.thumbnails?.high?.url ??
			Payload.items?.[0]?.snippet?.thumbnails?.medium?.url ??
			Payload.items?.[0]?.snippet?.thumbnails?.default?.url
	);
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
				'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
				accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
				'accept-language': 'en-US,en;q=0.9'
			}
		});
		if (!Response.ok) return null;
		const Html = await Response.text();
		return ResolveMaybeRelativeUrl(
			MatchMeta(Html, 'og:image:secure_url') ?? MatchMeta(Html, 'og:image') ?? MatchMeta(Html, 'twitter:image') ?? MatchMeta(Html, 'twitter:image:src'),
			SourceUrl
		);
	} catch {
		return null;
	}
}

async function FirstReachableImage(Candidates: (string | null | undefined)[]) {
	for (const Candidate of Candidates) {
		const Url = NormalizeThumbnailUrl(Candidate);
		if (Url && !IsGenericThumbnailUrl(Url) && await ImageUrlExists(Url)) return Url;
	}
	return null;
}

async function ImageUrlExists(Url: string) {
	try {
		const Controller = new AbortController();
		const Timeout = setTimeout(() => Controller.abort(), 4500);
		const Response = await fetch(Url, {
			headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8' },
			signal: Controller.signal
		});
		clearTimeout(Timeout);
		return Response.ok && Boolean(Response.headers.get('content-type')?.startsWith('image/'));
	} catch {
		return false;
	}
}

function AvatarCandidates(Platform?: string | null, Handle?: string | null) {
	const CleanHandle = Handle?.replace(/^@/, '');
	if (!CleanHandle) return [];
	if (Platform === 'Twitch') return [`https://unavatar.io/twitch/${CleanHandle}`];
	if (Platform === 'YouTube') return [`https://unavatar.io/youtube/${CleanHandle}`];
	if (Platform === 'X') return [`https://unavatar.io/x/${CleanHandle}`];
	return [];
}

function MatchMeta(Html: string, Property: string) {
	const Escaped = Property.replace(':', '\\s*:\\s*');
	const Tags = Html.match(/<meta[^>]+>/gi) ?? [];
	for (const Tag of Tags) {
		if (!new RegExp(`(?:property|name)=["']${Escaped}["']`, 'i').test(Tag)) continue;
		const Content = Tag.match(/content=["']([^"']+)["']/i)?.[1];
		if (Content) return DecodeHtmlEntities(Content);
	}
	return null;
}

function DecodeHtmlEntities(Value: string) {
	return Value
		.replaceAll('&amp;', '&')
		.replaceAll('&quot;', '"')
		.replaceAll('&#39;', "'")
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>');
}

function ResolveMaybeRelativeUrl(Url: string | null, BaseUrl: string) {
	if (!Url) return null;
	try {
		return new URL(Url, BaseUrl).toString();
	} catch {
		return Url;
	}
}
