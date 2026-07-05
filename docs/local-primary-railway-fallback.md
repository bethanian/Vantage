# Local Primary + Railway Fallback

Use this setup when Vercel hosts the Vantage web app, hosted Postgres stores team data, your PC handles heavy jobs, and Railway stays available as a lightweight fallback.

## Roles

```text
Vercel: web app and form actions
Hosted Postgres: shared database
Local PC: full worker stack, downloads, ffmpeg, transcripts, previews, exports
Railway: lightweight fallback for sync, Gemini analysis, captions, chat, translation
```

Railway should not run the full worker stack by default. Running full workers on both Railway and your PC can duplicate heavy jobs and waste credits.

## Local PC Setup

Install required tools:

```text
Node.js
ffmpeg
yt-dlp
Git
```

Create `.env.local` in the project root:

```text
POSTGRES_URL=postgres://...
YOUTUBE_API_KEY=...
TWITCH_CLIENT_ID=...
TWITCH_CLIENT_SECRET=...
KICK_CLIENT_ID=...
KICK_CLIENT_SECRET=...
GEMINI_API_KEYS=key1,key2,key3
VANTAGE_WORKER_ROLE=local-primary
VANTAGE_DASHBOARD_URL=https://your-vantage-app.vercel.app
VANTAGE_DOWNLOAD_DIR=D:\Vantage\downloads
VANTAGE_TRANSCRIPT_DIR=D:\Vantage\transcripts
VANTAGE_MEDIA_SIGNAL_DIR=D:\Vantage\signals
VANTAGE_PREVIEW_DIR=D:\Vantage\previews
VANTAGE_EXPORT_DIR=D:\Vantage\exports
```

Or let the setup helper create it:

```powershell
npm.cmd run workers:local:setup
```

The helper prompts for your hosted Postgres URL and API keys, writes `.env.local`, creates local media folders, checks readiness, and warns if `ffmpeg` or `yt-dlp` is missing from `PATH`.

To install the local worker on login and start the tray in one pass:

```powershell
npm.cmd run workers:local:setup -- -InstallOnLogin -StartTray
```

Check local worker readiness without exposing secrets:

```powershell
npm.cmd run workers:local:doctor
```

Start the full local worker stack:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-local-workers.ps1
```

Start the tray controller with the moon icon:

```powershell
npm.cmd run workers:local:tray
```

Start it with automatic restart if the worker exits:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-local-workers.ps1 -Restart
```

Install it as a Windows scheduled task that starts on login:

```powershell
npm.cmd run workers:local:install
```

Remove the scheduled task:

```powershell
npm.cmd run workers:local:uninstall
```

One-shot smoke test:

```powershell
npm.cmd run workers:local:once
```

Check whether local or fallback workers are heartbeating:

```powershell
npm.cmd run workers:status
```

## Railway Fallback Setup

Railway reads `railway.json` and starts:

```text
npm run workers:fallback
```

Fallback workers:

```text
sync,translation,chat,analysis,caption
```

Set these Railway variables:

```text
POSTGRES_URL=postgres://...
YOUTUBE_API_KEY=...
TWITCH_CLIENT_ID=...
TWITCH_CLIENT_SECRET=...
KICK_CLIENT_ID=...
KICK_CLIENT_SECRET=...
GEMINI_API_KEYS=key1,key2,key3
VANTAGE_WORKER_ROLE=railway-fallback
```

The same list is in `.env.railway.example` for copy/paste into Railway.

After setting Railway variables, run this from a Railway shell or deployment command override to verify the fallback environment:

```text
npm run workers:fallback:doctor
```

Do not set Railway to `npm run workers:local` unless you intentionally want Railway to process downloads, previews, exports, and other heavy jobs.

## Normal Operation

Keep the local PC worker running when you want full automation:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-local-workers.ps1 -Restart
```

For normal use on a dedicated PC or mini PC, install the scheduled task once and let Windows start it whenever the machine logs in.

If the PC is off:

- team members can still use Vantage on Vercel
- Railway can still process lightweight sync/AI/caption jobs
- media download, transcript generation, previews, exports, and ffmpeg jobs wait until the PC worker comes back online

The top bar shows `local running`, `fallback running`, or `workers offline` based on the shared `worker_heartbeats` table. The page refreshes that status automatically while open.

## Cost Control

Railway fallback is intentionally light. It avoids:

- `media:worker`
- `signals:worker`
- `transcript:worker`
- `preview:worker`
- `export:worker`
- `source:worker`
- `social:worker`

Those workers are best run locally because they use `yt-dlp`, `ffmpeg`, disk space, and longer CPU bursts.
