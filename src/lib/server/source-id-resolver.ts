import { GetApiCredential } from '$lib/server/api-credentials';
import { All, EnsureAppDatabaseReady, NextId, Run } from '$lib/server/db/app-db';

type ResolveResult = { Platform: 'YouTube' | 'Twitch' | 'Kick'; Resolved: number; Skipped: number; Message: string };
type YoutubeChannelListResponse = {
	items?: { id?: string }[];
	error?: { message?: string };
};
type TwitchTokenResponse = { access_token?: string; message?: string };
type TwitchUsersResponse = { data?: { id: string; login: string; display_name: string }[]; message?: string };
type KickTokenResponse = { access_token?: string; message?: string };
type KickChannel = { broadcaster_user_id?: number; slug?: string };
type KickChannelsResponse = { data?: KickChannel[] | KickChannel; message?: string };

export async function ResolveAllSourceIds() {
	await EnsureAppDatabaseReady();
	const Results = [
		await ResolveYoutubeSourceIds(),
		await ResolveTwitchSourceIds(),
		await ResolveKickSourceIds()
	];
	return {
		Status: Results.some((Result) => Result.Resolved > 0) ? 'Completed' : 'Skipped',
		Resolved: Results.reduce((Total, Result) => Total + Result.Resolved, 0),
		Skipped: Results.reduce((Total, Result) => Total + Result.Skipped, 0),
		Results
	};
}

async function ResolveYoutubeSourceIds(): Promise<ResolveResult> {
	const ApiKey = await GetApiCredential('YOUTUBE_API_KEY');
	if (!ApiKey) return { Platform: 'YouTube', Resolved: 0, Skipped: 0, Message: 'Missing YOUTUBE_API_KEY' };
	const Accounts = (await SourceAccounts('YouTube')).filter((Account) => !/^UC[\w-]{20,}$/.test(Account.ExternalId));
	let Resolved = 0;
	let Skipped = 0;
	for (const Account of Accounts) {
		try {
			const ChannelId = await ResolveYoutubeChannelId(ApiKey, Account.Handle);
			if (!ChannelId) {
				Skipped += 1;
				await SetAccountError(Account.Id, 'No matching YouTube channel found');
				continue;
			}
			await SetExternalId(Account.Id, ChannelId);
			Resolved += 1;
		} catch (Reason) {
			Skipped += 1;
			await SetAccountError(Account.Id, Reason instanceof Error ? Reason.message : 'Unknown YouTube resolve error');
		}
	}
	await WriteResolveRun('YouTube', Resolved, Skipped);
	return { Platform: 'YouTube', Resolved, Skipped, Message: `Resolved ${Resolved}, skipped ${Skipped}` };
}

async function ResolveTwitchSourceIds(): Promise<ResolveResult> {
	const ClientId = await GetApiCredential('TWITCH_CLIENT_ID');
	const ClientSecret = await GetApiCredential('TWITCH_CLIENT_SECRET');
	if (!ClientId || !ClientSecret) return { Platform: 'Twitch', Resolved: 0, Skipped: 0, Message: 'Missing Twitch credentials' };
	const Accounts = (await SourceAccounts('Twitch')).filter((Account) => !/^\d+$/.test(Account.ExternalId));
	let Resolved = 0;
	let Skipped = 0;
	try {
		const Token = await GetTwitchAppToken(ClientId, ClientSecret);
		for (const Account of Accounts) {
			try {
				const UserId = await ResolveTwitchUserId(ClientId, Token, Account.Handle);
				if (!UserId) {
					Skipped += 1;
					await SetAccountError(Account.Id, 'No matching Twitch user found');
					continue;
				}
				await SetExternalId(Account.Id, UserId);
				Resolved += 1;
			} catch (Reason) {
				Skipped += 1;
				await SetAccountError(Account.Id, Reason instanceof Error ? Reason.message : 'Unknown Twitch resolve error');
			}
		}
	} catch (Reason) {
		const Message = Reason instanceof Error ? Reason.message : 'Unknown Twitch token error';
		await WriteResolveRun('Twitch', 0, Accounts.length, Message);
		return { Platform: 'Twitch', Resolved: 0, Skipped: Accounts.length, Message };
	}
	await WriteResolveRun('Twitch', Resolved, Skipped);
	return { Platform: 'Twitch', Resolved, Skipped, Message: `Resolved ${Resolved}, skipped ${Skipped}` };
}

async function ResolveKickSourceIds(): Promise<ResolveResult> {
	const ClientId = await GetApiCredential('KICK_CLIENT_ID');
	const ClientSecret = await GetApiCredential('KICK_CLIENT_SECRET');
	if (!ClientId || !ClientSecret) return { Platform: 'Kick', Resolved: 0, Skipped: 0, Message: 'Missing Kick credentials' };
	const Accounts = (await SourceAccounts('Kick')).filter((Account) => !/^\d+$/.test(Account.ExternalId));
	let Resolved = 0;
	let Skipped = 0;
	try {
		const Token = await GetKickAppToken(ClientId, ClientSecret);
		for (const Account of Accounts) {
			try {
				const BroadcasterId = await ResolveKickBroadcasterId(ClientId, Token, Account.Handle);
				if (!BroadcasterId) {
					Skipped += 1;
					await SetAccountError(Account.Id, 'No matching Kick channel found');
					continue;
				}
				await SetExternalId(Account.Id, String(BroadcasterId));
				Resolved += 1;
			} catch (Reason) {
				Skipped += 1;
				await SetAccountError(Account.Id, Reason instanceof Error ? Reason.message : 'Unknown Kick resolve error');
			}
		}
	} catch (Reason) {
		const Message = Reason instanceof Error ? Reason.message : 'Unknown Kick token error';
		await WriteResolveRun('Kick', 0, Accounts.length, Message);
		return { Platform: 'Kick', Resolved: 0, Skipped: Accounts.length, Message };
	}
	await WriteResolveRun('Kick', Resolved, Skipped);
	return { Platform: 'Kick', Resolved, Skipped, Message: `Resolved ${Resolved}, skipped ${Skipped}` };
}

async function ResolveYoutubeChannelId(ApiKey: string, Handle: string) {
	const Url = new URL('https://www.googleapis.com/youtube/v3/channels');
	Url.searchParams.set('part', 'id');
	Url.searchParams.set('forHandle', Handle.replace(/^@/, ''));
	Url.searchParams.set('key', ApiKey);
	const Response = await fetch(Url);
	const Payload = (await Response.json()) as YoutubeChannelListResponse;
	if (!Response.ok) throw new Error(Payload.error?.message ?? `YouTube HTTP ${Response.status}`);
	return Payload.items?.[0]?.id ?? '';
}

async function GetTwitchAppToken(ClientId: string, ClientSecret: string) {
	const Url = new URL('https://id.twitch.tv/oauth2/token');
	Url.searchParams.set('client_id', ClientId);
	Url.searchParams.set('client_secret', ClientSecret);
	Url.searchParams.set('grant_type', 'client_credentials');
	const Response = await fetch(Url, { method: 'POST' });
	const Payload = (await Response.json()) as TwitchTokenResponse;
	if (!Response.ok || !Payload.access_token) throw new Error(Payload.message ?? `Twitch token HTTP ${Response.status}`);
	return Payload.access_token;
}

async function ResolveTwitchUserId(ClientId: string, Token: string, Handle: string) {
	const Url = new URL('https://api.twitch.tv/helix/users');
	Url.searchParams.set('login', Handle.replace(/^@/, '').toLowerCase());
	const Response = await fetch(Url, { headers: { Authorization: `Bearer ${Token}`, 'Client-Id': ClientId } });
	const Payload = (await Response.json()) as TwitchUsersResponse;
	if (!Response.ok) throw new Error(Payload.message ?? `Twitch HTTP ${Response.status}`);
	return Payload.data?.[0]?.id ?? '';
}

async function GetKickAppToken(ClientId: string, ClientSecret: string) {
	const Body = new URLSearchParams({
		grant_type: 'client_credentials',
		client_id: ClientId,
		client_secret: ClientSecret
	});
	const Response = await fetch('https://id.kick.com/oauth/token', {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: Body
	});
	const Payload = (await Response.json()) as KickTokenResponse;
	if (!Response.ok || !Payload.access_token) throw new Error(Payload.message ?? `Kick token HTTP ${Response.status}`);
	return Payload.access_token;
}

async function ResolveKickBroadcasterId(ClientId: string, Token: string, Handle: string) {
	const Slug = Handle.replace(/^@/, '').toLowerCase();
	const Url = new URL('https://api.kick.com/public/v1/channels');
	Url.searchParams.set('slug', Slug);
	const Response = await fetch(Url, { headers: { Authorization: `Bearer ${Token}`, 'Client-Id': ClientId } });
	const Payload = (await Response.json()) as KickChannelsResponse;
	if (!Response.ok) throw new Error(Payload.message ?? `Kick HTTP ${Response.status}`);
	const Channels = Array.isArray(Payload.data) ? Payload.data : Payload.data ? [Payload.data] : [];
	return Channels.find((Channel) => Channel.slug?.toLowerCase() === Slug)?.broadcaster_user_id ?? Channels[0]?.broadcaster_user_id ?? 0;
}

async function SourceAccounts(Platform: string) {
	return All<SourceAccount>(
		`select id as "Id", creator as "Creator", platform as "Platform", handle as "Handle", external_id as "ExternalId"
		 from platform_accounts where platform = ?`,
		[Platform]
	);
}

async function SetExternalId(Id: number, ExternalId: string) {
	await Run('update platform_accounts set external_id = ?, last_error = null, last_synced_at = ? where id = ?', [
		ExternalId,
		new Date().toISOString(),
		Id
	]);
}

async function SetAccountError(Id: number, LastError: string) {
	await Run('update platform_accounts set last_error = ? where id = ?', [LastError, Id]);
}

async function WriteResolveRun(Platform: 'YouTube' | 'Twitch' | 'Kick', Resolved: number, Skipped: number, Message?: string) {
	const Now = new Date().toISOString();
	await Run(
		`insert into sync_runs (id, platform, started_at, finished_at, status, items_found, message)
		 values (?, ?, ?, ?, ?, ?, ?)`,
		[await NextId('sync_runs'), Platform, Now, Now, Resolved ? 'Resolved' : 'Skipped', Resolved, Message ?? `Resolved ${Resolved}, skipped ${Skipped}`]
	);
}

type SourceAccount = {
	Id: number;
	Creator: string;
	Platform: string;
	Handle: string;
	ExternalId: string;
};
