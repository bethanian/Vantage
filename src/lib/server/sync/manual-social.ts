import { CalculateOpportunityScore, type OpportunityWeights } from '$lib/opportunity-score';
import { All, EnsureAppDatabaseReady, Get, NextId, Run } from '$lib/server/db/app-db';
import { GetOpportunityWeights } from '$lib/server/opportunity-settings';
import { ResolveContentThumbnail } from '$lib/server/thumbnails';

const ManualPlatforms = ['TikTok', 'Instagram', 'X'] as const;

export async function SyncManualSocialSources() {
	await EnsureAppDatabaseReady();
	const Accounts = await All<ManualAccount>(
		`select id as "Id", creator as "Creator", platform as "Platform", handle as "Handle", external_id as "ExternalId", source_url as "SourceUrl"
		 from platform_accounts where platform in (?, ?, ?)`,
		[...ManualPlatforms]
	);
	const ScoreWeights = await GetOpportunityWeights();
	let ItemsFound = 0;
	for (const Account of Accounts) ItemsFound += await UpsertManualProfileItem(Account, ScoreWeights);
	const Now = new Date().toISOString();
	await Run(
		`insert into sync_runs (id, platform, started_at, finished_at, status, items_found, message)
		 values (?, ?, ?, ?, ?, ?, ?)`,
		[await NextId('sync_runs'), 'TikTok', Now, Now, ItemsFound ? 'Completed' : 'Skipped', ItemsFound, `Refreshed ${ItemsFound} manual social sources`]
	);
	return { Status: 'Completed', ItemsFound, Message: `Refreshed ${ItemsFound} manual social sources` };
}

export async function UpsertManualProfileItem(Account: ManualAccount, ScoreWeights?: OpportunityWeights) {
	const Weights = ScoreWeights ?? await GetOpportunityWeights();
	const SourceUrl = Account.SourceUrl ?? DefaultSourceUrl(Account.Platform, Account.Handle);
	const ExternalId = `manual-${Account.Platform.toLowerCase()}-${Account.Id}`;
	const Title = `Check ${Account.Creator} on ${Account.Platform}`;
	const ThumbnailUrl = await ResolveContentThumbnail({ Platform: Account.Platform, SourceUrl, ExternalId: Account.ExternalId });
	const Score = Math.max(62, CalculateOpportunityScore({ Platform: Account.Platform, Kind: 'Profile watch', Title, Status: 'New' }, Weights));
	const Existing = await Get<{ id: number }>('select id from content_items where external_id = ? limit 1', [ExternalId]);
	if (Existing) {
		await Run(
			`update content_items
			 set title = ?, age = ?, metric = ?, score = ?, source_url = ?, thumbnail_url = coalesce(?, thumbnail_url), published_at = ?
			 where id = ?`,
			[Title, 'manual check', Account.Handle, Score, SourceUrl, ThumbnailUrl, new Date().toISOString(), Existing.id]
		);
		return 0;
	}
	await Run(
		`insert into content_items
		 (id, creator, external_id, platform, kind, title, age, metric, campaign, status, score, live, velocity, source_url, thumbnail_url, published_at)
		 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			await NextId('content_items'),
			Account.Creator,
			ExternalId,
			Account.Platform,
			'Profile watch',
			Title,
			'manual check',
			Account.Handle,
			'Organic',
			'New',
			Score,
			false,
			null,
			SourceUrl,
			ThumbnailUrl,
			new Date().toISOString()
		]
	);
	return 1;
}

function DefaultSourceUrl(Platform: string, Handle: string) {
	const CleanHandle = Handle.replace(/^@/, '');
	if (Platform === 'TikTok') return `https://www.tiktok.com/@${CleanHandle}`;
	if (Platform === 'Instagram') return `https://www.instagram.com/${CleanHandle}`;
	if (Platform === 'X') return `https://x.com/${CleanHandle}`;
	return '';
}

export type ManualAccount = {
	Id: number;
	Creator: string;
	Platform: string;
	Handle: string;
	ExternalId: string;
	SourceUrl?: string | null;
};
