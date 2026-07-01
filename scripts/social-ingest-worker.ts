import { spawn } from 'node:child_process';
import { All, EnsureAppDatabaseReady, Get, NextId, Run } from '../src/lib/server/db/app-db';
import { CalculateOpportunityScore } from '../src/lib/opportunity-score';
import { GetOpportunityWeights } from '../src/lib/server/opportunity-settings';

type SocialAccount = {
	Id: number;
	Creator: string;
	Platform: string;
	Handle: string;
	ExternalId: string;
	SourceUrl?: string | null;
};

type YtDlpItem = {
	id?: string;
	url?: string;
	webpage_url?: string;
	title?: string;
	timestamp?: number;
	upload_date?: string;
	release_timestamp?: number;
	thumbnail?: string;
	duration_string?: string;
	duration?: number;
	view_count?: number;
	like_count?: number;
	repost_count?: number;
	comment_count?: number;
	extractor_key?: string;
};

const RunOnce = process.argv.includes('--once');
const PollMs = Number(process.env.VANTAGE_SOCIAL_WORKER_POLL_MS ?? 1000 * 60 * 20);
const MaxItems = Number(process.env.VANTAGE_SOCIAL_INGEST_MAX_ITEMS ?? 12);
const Platforms = (process.env.VANTAGE_SOCIAL_INGEST_PLATFORMS ?? 'TikTok,Instagram,X').split(',').map((Platform) => Platform.trim()).filter(Boolean);

await EnsureAppDatabaseReady();
await RunWorker();

if (!RunOnce) {
	console.log(JSON.stringify({ Status: 'WatchingSocialSources', PollMs, Platforms }));
	setInterval(RunWorker, PollMs);
}

async function RunWorker() {
	if (!Platforms.length) {
		if (RunOnce) console.log(JSON.stringify({ Status: 'Idle', Message: 'No social platforms configured' }));
		return;
	}
	const Accounts = await All<SocialAccount>(
		`select id as "Id", creator as "Creator", platform as "Platform", handle as "Handle",
		 external_id as "ExternalId", source_url as "SourceUrl"
		 from platform_accounts
		 where platform in (${Platforms.map(() => '?').join(', ')})
		 order by coalesce(last_synced_at, '') asc, id asc
		 limit ?`,
		[...Platforms, Number(process.env.VANTAGE_SOCIAL_INGEST_ACCOUNTS_PER_PASS ?? 8)]
	);
	if (!Accounts.length) {
		if (RunOnce) console.log(JSON.stringify({ Status: 'Idle' }));
		return;
	}
	const RunId = await NextId('sync_runs');
	await Run('insert into sync_runs (id, platform, started_at, status, items_found) values (?, ?, ?, ?, ?)', [
		RunId,
		'Social',
		new Date().toISOString(),
		'Running',
		0
	]);
	let ItemsFound = 0;
	const Errors: string[] = [];
	const Weights = await GetOpportunityWeights();
	for (const Account of Accounts) {
		try {
			const Items = await FetchProfileItems(Account);
			for (const Item of Items.slice(0, MaxItems)) {
				const ExternalId = ExternalItemId(Account, Item);
				if (!ExternalId || await ContentExists(ExternalId)) continue;
				const PublishedAt = PublishedAtIso(Item);
				const Title = Item.title || `${Account.Creator} ${Account.Platform} post`;
				const Views = Number(Item.view_count ?? 0);
				await Run(
					`insert into content_items
					 (id, creator, external_id, platform, kind, title, age, metric, campaign, status, score, live, velocity, source_url, thumbnail_url, published_at)
					 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					[
						await NextId('content_items'),
						Account.Creator,
						ExternalId,
						Account.Platform,
						ContentKind(Account.Platform, Item),
						Title,
						FormatAge(PublishedAt),
						MetricText(Item),
						'Organic',
						'New',
						CalculateOpportunityScore({
							Platform: Account.Platform,
							Kind: ContentKind(Account.Platform, Item),
							PublishedAt,
							Views,
							Campaign: 'Organic',
							Title,
							Status: 'New'
						}, Weights),
						0,
						VelocityText(Item) ?? null,
						String(Item.webpage_url || Item.url || Account.SourceUrl || ''),
						Item.thumbnail ?? null,
						PublishedAt
					]
				);
				ItemsFound += 1;
			}
			await Run('update platform_accounts set connected = ?, last_synced_at = ?, last_error = null where id = ?', [1, new Date().toISOString(), Account.Id]);
		} catch (Reason) {
			const Message = Reason instanceof Error ? Reason.message : 'Unknown social ingest error';
			Errors.push(`${Account.Platform}/${Account.Creator}: ${Message}`);
			await Run('update platform_accounts set last_error = ? where id = ?', [Message, Account.Id]);
		}
	}
	const Status = Errors.length ? 'Partial' : 'Completed';
	const Message = Errors.join(' | ') || `Synced ${Accounts.length} social accounts`;
	await Run('update sync_runs set status = ?, items_found = ?, message = ?, finished_at = ? where id = ?', [Status, ItemsFound, Message, new Date().toISOString(), RunId]);
	console.log(JSON.stringify({ Status, ItemsFound, Accounts: Accounts.length, Message }));
}

async function FetchProfileItems(Account: SocialAccount) {
	await EnsureYtDlp();
	const Url = Account.SourceUrl || Account.ExternalId || ProfileUrl(Account);
	const Output = await RunCommandCapture('yt-dlp', ['--no-update', '--dump-single-json', '--flat-playlist', '--playlist-end', String(MaxItems), Url]);
	const Payload = JSON.parse(Output) as { entries?: YtDlpItem[] } | YtDlpItem;
	if ('entries' in Payload && Array.isArray(Payload.entries)) return Payload.entries;
	return [Payload as YtDlpItem];
}

async function EnsureYtDlp() {
	await RunCommandCapture('yt-dlp', ['--version']);
}

async function RunCommandCapture(Command: string, Args: string[]) {
	const Child = spawn(Command, Args, { windowsHide: true });
	let Output = '';
	let ErrorOutput = '';
	Child.stdout.on('data', (Chunk) => (Output += String(Chunk)));
	Child.stderr.on('data', (Chunk) => (ErrorOutput += String(Chunk)));
	const Code = await new Promise<number | null>((Resolve, Reject) => {
		Child.on('error', Reject);
		Child.on('close', Resolve);
	});
	if (Code !== 0) throw new Error(ErrorOutput.trim() || `${Command} exited with ${Code}`);
	return Output.trim();
}

async function ContentExists(ExternalId: string) {
	return Boolean(await Get('select 1 from content_items where external_id = ? limit 1', [ExternalId]));
}

function ExternalItemId(Account: SocialAccount, Item: YtDlpItem) {
	const RawId = Item.id || Item.url || Item.webpage_url;
	return RawId ? `${Account.Platform.toLowerCase()}-${RawId}`.replace(/\s+/g, '-') : '';
}

function ProfileUrl(Account: SocialAccount) {
	const Handle = Account.Handle.replace(/^@/, '');
	if (Account.Platform === 'TikTok') return `https://www.tiktok.com/@${Handle}`;
	if (Account.Platform === 'Instagram') return `https://www.instagram.com/${Handle}/`;
	if (Account.Platform === 'X') return `https://x.com/${Handle}`;
	return Account.SourceUrl || Account.ExternalId;
}

function PublishedAtIso(Item: YtDlpItem) {
	const Timestamp = Item.timestamp ?? Item.release_timestamp;
	if (Timestamp) return new Date(Timestamp * 1000).toISOString();
	if (Item.upload_date?.length === 8) return new Date(`${Item.upload_date.slice(0, 4)}-${Item.upload_date.slice(4, 6)}-${Item.upload_date.slice(6, 8)}T00:00:00Z`).toISOString();
	return null;
}

function FormatAge(PublishedAt?: string | null) {
	if (!PublishedAt) return 'unknown';
	const HoursOld = Math.max(1, Math.round((Date.now() - new Date(PublishedAt).getTime()) / 36e5));
	return HoursOld < 24 ? `${HoursOld}h ago` : `${Math.round(HoursOld / 24)}d ago`;
}

function ContentKind(Platform: string, Item: YtDlpItem) {
	if (Platform === 'TikTok') return 'TikTok post';
	if (Platform === 'Instagram') return 'Instagram post';
	if (Platform === 'X') return 'X post';
	return Item.duration ? 'Video post' : 'Social post';
}

function MetricText(Item: YtDlpItem) {
	const Parts = [];
	if (Item.view_count) Parts.push(`${Item.view_count.toLocaleString()} views`);
	if (Item.like_count) Parts.push(`${Item.like_count.toLocaleString()} likes`);
	if (Item.comment_count) Parts.push(`${Item.comment_count.toLocaleString()} comments`);
	return Parts.join(' / ') || 'social metadata';
}

function VelocityText(Item: YtDlpItem) {
	if (!Item.view_count || !Item.timestamp) return null;
	const Hours = Math.max(1, (Date.now() - Item.timestamp * 1000) / 36e5);
	return `${Math.round(Item.view_count / Hours).toLocaleString()} views/hr`;
}
