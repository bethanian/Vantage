import {
	type Check,
	CheckDirectory,
	CheckEnv,
	CheckEnvValue,
	CheckPostgres,
	CheckTool,
	LoadEnvFile,
	PrintChecks
} from './worker-doctor-lib';

const Checks: Check[] = [];
LoadEnvFile('.env.local', Checks, true);
if (!process.env.POSTGRES_URL) Checks.push({ Name: 'setup command', Status: 'warn', Message: 'run npm.cmd run workers:local:configure' });

CheckEnv(Checks, 'POSTGRES_URL', true);
CheckEnv(Checks, 'YOUTUBE_API_KEY');
CheckEnv(Checks, 'TWITCH_CLIENT_ID');
CheckEnv(Checks, 'TWITCH_CLIENT_SECRET');
CheckEnv(Checks, 'KICK_CLIENT_ID');
CheckEnv(Checks, 'KICK_CLIENT_SECRET');
CheckEnv(Checks, 'GEMINI_API_KEYS');
CheckEnv(Checks, 'VANTAGE_DASHBOARD_URL');
CheckEnv(Checks, 'VANTAGE_WORKER_INSTANCE_ID');
CheckEnvValue(Checks, 'VANTAGE_WORKER_ROLE', process.env.VANTAGE_WORKER_ROLE, 'local-primary');
await CheckDirectory(Checks, 'VANTAGE_DOWNLOAD_DIR', 'media/downloads');
await CheckDirectory(Checks, 'VANTAGE_TRANSCRIPT_DIR', 'media/transcripts');
await CheckDirectory(Checks, 'VANTAGE_MEDIA_SIGNAL_DIR', 'media/signals');
await CheckDirectory(Checks, 'VANTAGE_PREVIEW_DIR', 'media/previews');
await CheckDirectory(Checks, 'VANTAGE_EXPORT_DIR', 'media/exports');
CheckTool(Checks, 'node');
CheckTool(Checks, 'npm');
CheckTool(Checks, 'ffmpeg', false);
CheckTool(Checks, 'yt-dlp', false);
await CheckPostgres(Checks);

PrintChecks(Checks);
