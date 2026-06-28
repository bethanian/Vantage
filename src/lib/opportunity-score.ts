export type OpportunityInput = {
	Platform: string;
	Kind: string;
	PublishedAt?: string | null;
	Viewers?: number;
	Views?: number;
	Campaign?: string | null;
	Title?: string | null;
	Status?: string | null;
};

export type OpportunityWeights = {
	Recency: number;
	Engagement: number;
	Platform: number;
	Campaign: number;
	Title: number;
	Status: number;
};

export const DefaultOpportunityWeights: OpportunityWeights = {
	Recency: 1,
	Engagement: 1,
	Platform: 1,
	Campaign: 1,
	Title: 1,
	Status: 1
};

const HighIntentTerms = ['challenge', 'reacts', 'reaction', 'leaked', 'unexpected', 'wrong', 'won', 'live', 'record'];

export function CalculateOpportunityScore(Input: OpportunityInput, Weights = DefaultOpportunityWeights) {
	const Score =
		RecencyScore(Input.PublishedAt) * Weights.Recency +
		EngagementScore(Input.Viewers ?? Input.Views ?? 0, Input.Kind) * Weights.Engagement +
		PlatformScore(Input.Platform) * Weights.Platform +
		CampaignScore(Input.Campaign) * Weights.Campaign +
		TitleScore(Input.Title) * Weights.Title +
		StatusScore(Input.Status) * Weights.Status;
	return Math.max(0, Math.min(100, Math.round(Score)));
}

function RecencyScore(PublishedAt?: string | null) {
	if (!PublishedAt) return 14;
	const HoursOld = (Date.now() - new Date(PublishedAt).getTime()) / 36e5;
	if (HoursOld <= 2) return 30;
	if (HoursOld <= 6) return 26;
	if (HoursOld <= 24) return 20;
	if (HoursOld <= 72) return 12;
	return 6;
}

function EngagementScore(Count: number, Kind: string) {
	const LiveMultiplier = Kind.toLowerCase().includes('live') ? 1.2 : 1;
	if (Count >= 100000) return 34 * LiveMultiplier;
	if (Count >= 25000) return 28 * LiveMultiplier;
	if (Count >= 5000) return 22 * LiveMultiplier;
	if (Count >= 1000) return 14 * LiveMultiplier;
	return 8;
}

function PlatformScore(Platform: string) {
	if (Platform === 'Kick') return 12;
	if (Platform === 'Twitch') return 10;
	if (Platform === 'YouTube') return 9;
	return 6;
}

function CampaignScore(Campaign?: string | null) {
	return Campaign && Campaign !== 'Organic' ? 12 : 5;
}

function TitleScore(Title?: string | null) {
	const Text = Title?.toLowerCase() ?? '';
	return HighIntentTerms.some((Term) => Text.includes(Term)) ? 10 : 4;
}

function StatusScore(Status?: string | null) {
	if (!Status || Status === 'New') return 2;
	if (Status === 'Watched') return -3;
	if (Status === 'Clipped' || Status === 'Uploaded') return -15;
	return 0;
}
