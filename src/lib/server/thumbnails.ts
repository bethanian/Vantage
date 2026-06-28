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
	const Normalized = NormalizeThumbnailUrl(ApiThumbnailUrl);
	if (Normalized) return Normalized;
	if (!SourceUrl) return null;
	const YoutubeThumbnail = YoutubeThumbnailFromUrl(SourceUrl);
	if (YoutubeThumbnail) return YoutubeThumbnail;
	return NormalizeThumbnailUrl(await OpenGraphThumbnail(SourceUrl));
}

function YoutubeThumbnailFromUrl(SourceUrl: string) {
	const Match = SourceUrl.match(/(?:watch\?v=|youtu\.be\/|shorts\/)([\w-]{6,})/i);
	return Match ? `https://i.ytimg.com/vi/${Match[1]}/hqdefault.jpg` : null;
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
