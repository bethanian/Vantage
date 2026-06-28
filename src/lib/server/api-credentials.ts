import { Get } from '$lib/server/db/app-db';

export const ApiCredentialFields = [
	{ Key: 'YOUTUBE_API_KEY', Label: 'YouTube API key' },
	{ Key: 'TWITCH_CLIENT_ID', Label: 'Twitch client ID' },
	{ Key: 'TWITCH_CLIENT_SECRET', Label: 'Twitch client secret' },
	{ Key: 'KICK_CLIENT_ID', Label: 'Kick client ID' },
	{ Key: 'KICK_CLIENT_SECRET', Label: 'Kick client secret' }
] as const;

export async function GetApiCredential(Key: string) {
	return process.env[Key] || await GetStoredCredential(Key);
}

export async function GetApiCredentialStatuses() {
	return Promise.all(ApiCredentialFields.map(async ({ Key, Label }) => {
		const EnvValue = process.env[Key];
		const StoredValue = await GetStoredCredential(Key);
		const Value = EnvValue || StoredValue;
		const Row = await Get<{ UpdatedAt?: string }>('select updated_at as "UpdatedAt" from api_credentials where key = ? limit 1', [Key]);
		return {
			Key,
			Label,
			Configured: Boolean(Value),
			LastFour: Value ? Value.slice(-4) : null,
			UpdatedAt: Row?.UpdatedAt ?? null,
			Source: EnvValue ? 'Environment' : StoredValue ? 'Database' : 'Missing'
		};
	}));
}

async function GetStoredCredential(Key: string) {
	const Row = await Get<{ Value?: string }>('select value as "Value" from api_credentials where key = ? limit 1', [Key]);
	return Row?.Value || '';
}
