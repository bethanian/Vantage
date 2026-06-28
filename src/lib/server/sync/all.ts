import { ResolveAllSourceIds } from '$lib/server/source-id-resolver';
import { SyncKickLivestreams } from './kick';
import { SyncManualSocialSources } from './manual-social';
import { SyncTwitchSources } from './twitch';
import { SyncYoutubeUploads } from './youtube';

export type SyncResult = {
	Platform: 'YouTube' | 'Twitch' | 'Kick' | 'TikTok';
	Status: string;
	ItemsFound: number;
	Message: string;
};

export async function SyncAllSources() {
	const Results: SyncResult[] = [];
	await ResolveAllSourceIds();
	Results.push(NormalizeResult('YouTube', await SyncYoutubeUploads()));
	Results.push(NormalizeResult('Twitch', await SyncTwitchSources()));
	Results.push(NormalizeResult('Kick', await SyncKickLivestreams()));
	Results.push(NormalizeResult('TikTok', await SyncManualSocialSources()));
	return {
		Status: Results.every((Result) => Result.Status === 'Skipped') ? 'Skipped' : 'Completed',
		ItemsFound: Results.reduce((Total, Result) => Total + Result.ItemsFound, 0),
		Results
	};
}

function NormalizeResult(Platform: SyncResult['Platform'], Result: { Status: string; ItemsFound: number; Message: string }) {
	return { Platform, ...Result };
}
