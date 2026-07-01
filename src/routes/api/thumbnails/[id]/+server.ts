import { Get, Run, EnsureAppDatabaseReady } from '$lib/server/db/app-db';
import { NormalizeThumbnailUrl, ResolveContentThumbnail } from '$lib/server/thumbnails';
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	await EnsureAppDatabaseReady();
	const Id = Number(params.id);
	if (!Number.isFinite(Id) || Id <= 0) return new Response('', { status: 404 });
	const Item = await Get<ThumbnailRow>(
		`select id, platform, external_id, source_url, thumbnail_url
		 from content_items where id = ? limit 1`,
		[Id]
	);
	if (!Item) return new Response('', { status: 404 });
	const Existing = NormalizeThumbnailUrl(Item.thumbnail_url);
	if (Existing && await ImageExists(Existing)) throw redirect(302, Existing);
	const Resolved = await ResolveContentThumbnail({
		Platform: Item.platform,
		ExternalId: Item.external_id,
		SourceUrl: Item.source_url,
		ApiThumbnailUrl: null
	});
	if (!Resolved) return new Response('', { status: 404 });
	await Run('update content_items set thumbnail_url = ? where id = ?', [Resolved, Id]);
	throw redirect(302, Resolved);
};

async function ImageExists(Url: string) {
	try {
		const Controller = new AbortController();
		const Timeout = setTimeout(() => Controller.abort(), 4500);
		const Response = await fetch(Url, { method: 'HEAD', signal: Controller.signal });
		clearTimeout(Timeout);
		if (Response.ok && Response.headers.get('content-type')?.startsWith('image/')) return true;
		const Fallback = await fetch(Url, { headers: { range: 'bytes=0-64' } });
		return Fallback.ok && Boolean(Fallback.headers.get('content-type')?.startsWith('image/'));
	} catch {
		return false;
	}
}

type ThumbnailRow = {
	id: number;
	platform?: string | null;
	external_id?: string | null;
	source_url?: string | null;
	thumbnail_url?: string | null;
};
