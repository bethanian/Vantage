import { DefaultOpportunityWeights, type OpportunityWeights } from '$lib/opportunity-score';
import { All } from '$lib/server/db/app-db';

const SettingKeys: Record<keyof OpportunityWeights, string> = {
	Recency: 'ScoreRecencyWeight',
	Engagement: 'ScoreEngagementWeight',
	Platform: 'ScorePlatformWeight',
	Campaign: 'ScoreCampaignWeight',
	Title: 'ScoreTitleWeight',
	Status: 'ScoreStatusWeight'
};

export async function GetOpportunityWeights(): Promise<OpportunityWeights> {
	const Rows = await All<{ Key: string; Value: string }>('select key as "Key", value as "Value" from app_settings');
	const Settings = Object.fromEntries(Rows.map((Row) => [Row.Key, Row.Value]));
	return Object.fromEntries(
		Object.entries(SettingKeys).map(([Name, Key]) => [Name, CleanWeight(Settings[Key], DefaultOpportunityWeights[Name as keyof OpportunityWeights])])
	) as OpportunityWeights;
}

function CleanWeight(Value: string | undefined, Fallback: number) {
	const NumberValue = Number(Value);
	return Number.isFinite(NumberValue) ? Math.max(0, Math.min(3, NumberValue)) : Fallback;
}
