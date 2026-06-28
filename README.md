# Vantage

Private social feed and clipping queue for a small team.

Vantage is built around one workflow:

```text
Open feed -> inspect fresh source -> open original link -> queue to clip -> finish/upload
```

## Local Development

```powershell
npm install
npm run dev
```

The local app uses SQLite when `POSTGRES_URL` is not set.

## Production

Vercel should have:

```text
POSTGRES_URL
YOUTUBE_API_KEY
KICK_CLIENT_ID
KICK_CLIENT_SECRET
TWITCH_CLIENT_ID
TWITCH_CLIENT_SECRET
```

Apply Postgres migrations:

```powershell
npm run db:pg:migrate
```

Push local SQLite data to Postgres:

```powershell
$env:SQLITE_DB_PATH="C:\Users\Dean\Documents\holygrail\Vantage\data\vantage.db"
npm run db:pg:push-local
```

## Checks

```powershell
npm run check
npm run build
```
