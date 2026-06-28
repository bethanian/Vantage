# Vantage Vercel Postgres Setup

Vantage runs locally on SQLite when `POSTGRES_URL` is missing and switches to Postgres when `POSTGRES_URL` is present. The hosted Vercel version should use Postgres so every teammate sees the same queue, statuses, API settings, and activity labels.

## Recommended Hosted Database

Use a Vercel Marketplace Postgres provider such as Neon or Supabase. Neon is the easiest fit for Vercel-style serverless deployments.

Required Vercel environment variable:

```text
POSTGRES_URL=postgres://...
```

Keep these existing API settings either in Vantage's settings screen or as Vercel environment variables:

```text
YOUTUBE_API_KEY=
KICK_CLIENT_ID=
KICK_CLIENT_SECRET=
TWITCH_CLIENT_ID=
TWITCH_CLIENT_SECRET=
```

## Generate And Apply Postgres Migrations

After `POSTGRES_URL` is set locally:

```text
npm.cmd run db:pg:generate
npm.cmd run db:pg:migrate
npm.cmd run db:pg:push-local
```

`db:pg:push-local` copies rows from the local SQLite database into Postgres. By default it reads:

```text
data/vantage.db
```

To push from another SQLite file:

```text
set SQLITE_DB_PATH=C:\path\to\vantage.db
npm.cmd run db:pg:push-local
```

The Postgres schema lives at:

```text
src/lib/server/db/pg-schema.ts
```

The migration config lives at:

```text
drizzle.postgres.config.ts
```

## Current State

Implemented:

- Postgres-compatible Drizzle schema.
- Postgres migration config.
- Generated Postgres migration SQL in `drizzle-postgres/`.
- npm scripts for Postgres migration generation and migration apply.
- Local SQLite to Postgres transfer script.
- Database health endpoint at `/api/health/db`.
- `activity_events` table for team action history.
- `last_action`, `last_action_by`, and `last_action_at` fields for feed and queue labels.
- Runtime DB adapter that uses SQLite locally and Postgres on hosted deployments.
- Page reads, form actions, JSON API routes, source ID resolution, and YouTube/Twitch/Kick syncs converted to async runtime DB calls.
- SQLite backup import/export guarded as local-only behavior.

Still recommended before Vercel production:

- Apply the Postgres migration to the hosted database.
- Push your existing local SQLite data into Postgres.
- Add a Vercel Cron endpoint or another scheduled worker for automatic refresh.
- Add a Postgres export/import path if you want hosted backups from the dashboard.

## Runtime Notes

- Without `POSTGRES_URL`, Vantage loads `data/vantage.db`.
- With `POSTGRES_URL`, Vantage uses the async Postgres runtime adapter.
- SQLite backup import/export stays available only in local mode.
- On an empty Postgres database, Vantage seeds the baseline creators, campaigns, content, queue, saved searches, and settings.
