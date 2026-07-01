import {
	type Check,
	CheckEnv,
	CheckEnvValue,
	CheckPostgres,
	CheckTool,
	LoadEnvFile,
	PrintChecks
} from './worker-doctor-lib';

const Checks: Check[] = [];
LoadEnvFile('.env.railway.local', Checks, false);

CheckEnv(Checks, 'POSTGRES_URL', true);
CheckEnv(Checks, 'YOUTUBE_API_KEY');
CheckEnv(Checks, 'TWITCH_CLIENT_ID');
CheckEnv(Checks, 'TWITCH_CLIENT_SECRET');
CheckEnv(Checks, 'KICK_CLIENT_ID');
CheckEnv(Checks, 'KICK_CLIENT_SECRET');
CheckEnv(Checks, 'GEMINI_API_KEYS');
CheckEnvValue(Checks, 'VANTAGE_WORKER_ROLE', process.env.VANTAGE_WORKER_ROLE, 'railway-fallback');
CheckTool(Checks, 'node');
CheckTool(Checks, 'npm');
Checks.push({ Name: 'heavy media workers', Status: 'pass', Message: 'not required for Railway fallback' });
await CheckPostgres(Checks);

PrintChecks(Checks);
