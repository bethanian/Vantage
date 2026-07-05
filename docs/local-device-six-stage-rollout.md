# Vantage Local Device Rollout

Vantage stays hosted for shared team state, but heavy work belongs to team PCs. Mobile remains useful for feed review and queue decisions without exposing download, transcript, preview, or export controls.

## Stage 1 - Hosted Feed

- Vercel hosts the dashboard.
- Postgres stores shared feed, queue, creator, campaign, account, and activity data.
- Mobile and desktop can browse the feed, mark items, queue clips, and review status.

## Stage 2 - Capability Gating

- The app reads worker heartbeats from `worker_heartbeats`.
- Heavy tools unlock only when the current device is desktop-class and a fresh local worker exposes the required capabilities.
- Mobile keeps Feed and Queue access, but Editor and processing controls stay locked.

## Stage 3 - Vantage Local Tray

- Each PC runs `npm.cmd run workers:local:tray`.
- The tray app uses `static/tray/moon.ico`.
- Right-click controls start/stop local processing, open the dashboard, and show session status.

## Stage 4 - Local Processing Claims

- Media, transcript, signal, preview, and export workers run locally.
- Jobs are claimed by a local worker before processing so multiple PCs do not duplicate heavy work.
- Claims are stored on `media_jobs`, `clip_previews`, and `clip_exports` with `claimed_by`, `claimed_at`, and `claim_expires_at`.
- Expired claims are automatically eligible for another PC, so a crashed worker does not strand a job.
- Railway does not run heavy workers by default.

## Stage 5 - Railway Fallback

- Railway runs lightweight fallback workers only: sync, translation, chat, analysis, and captions.
- If no PC is online, lightweight automation can continue.
- Heavy media jobs wait until a PC worker comes back online.

## Stage 6 - Installer Polish

- Package the tray launcher and setup flow into a teammate-friendly install path: `npm.cmd run workers:local:setup`.
- Keep `.env.local` creation, worker diagnostics, scheduled start, and tray controls in one guided flow.
- Add clear health labels in the dashboard for this device, local workers, and fallback workers.

## Current Commands

```powershell
npm.cmd run workers:local:setup
npm.cmd run workers:local:configure
npm.cmd run workers:local:doctor
npm.cmd run workers:local:tray
```

To configure, install on login, and start the tray in one pass:

```powershell
npm.cmd run workers:local:setup -- -InstallOnLogin -StartTray
```

Set `VANTAGE_DASHBOARD_URL` in `.env.local` when the tray should open the hosted Vercel dashboard instead of `http://localhost:5173`.
