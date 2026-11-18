# Tarkov Time Capsule

Historical Escape from Tarkov boss spawn chances, with a web archive, HTTP API and Discord bot. Observations come from Tarkov.dev regular/PvP data and are not guarantees about live raids.

- [Web app](https://tarkovcapsule.mockachino.app/)
- [Add the bot](https://discord.com/oauth2/authorize?client_id=1572583284146446438&scope=bot%20applications.commands&permissions=3072&integration_type=0)
- [Terms](https://mockachino.app/projects/tarkov-time-capsule/terms/) · [Privacy](https://mockachino.app/projects/tarkov-time-capsule/privacy/)
- Support and privacy requests: app@outdoortechnica.com

## Structure

- `web/` — React interface with filters, charts and historical tables.
- `api/` — Node HTTP server, SQLite storage and hourly collection.
- `discord/` — signed interactions, commands, channel subscriptions and change notifications.

The app container serves both the web build and API. The bot runs an interaction receiver and a notification process, with persistent subscription and delivery state.

## Run

Use Node 24.15 or newer, Python 3 for backup scripts, and Docker Compose.

Copy `.env.example` to `.env`. Create `data/` owned by UID/GID 1000, then run:

```sh
docker compose up -d --build app
```

Collection is disabled by default. Set `SCHEDULER_ENABLED=true` after checking the database and ensuring only one collector runs. Collection occurs each UTC hour. `/healthz` reports counts, latest observation and collector status; check freshness as well as HTTP status.

For local web development, run `npm ci` and `npm start` in `web/`, with `VITE_API_URL` pointing to the API. In `api/`, run `npm ci`, `npm run build`, then `DATABASE_PATH=../data/tarkov-time-capsule.sqlite STATIC_DIR=../web/dist npm start`.

## API

- `GET /api/maps`
- `GET /api/bosses`
- `GET /api/spawnchance?startDate=2026-11-18&endDate=2026-11-19` — optional `mapName`, `bossName` and `groupBy` (`boss`, `map`, `timestamp`).
- `GET /api/latestspawnchance` — observations from the preceding hour.
- `GET /healthz`

History responses contain at most **10,000 observations**. Larger queries return `413` with guidance to shorten the date range or select a map/boss; results are never silently truncated. Invalid dates, reversed ranges, oversized filters and long queries return `400`. Dates accept `YYYY-MM-DD` or an ISO UTC timestamp ending in `Z`.

API reads have a shared budget of 120 requests/minute (burst 30) and a socket-address budget of 60/minute (burst 15). `429` includes `Retry-After`. Reverse-proxy users share an address budget; arbitrary forwarded headers are not trusted. Add client-aware rate limits at your trusted HTTPS edge if needed. `/healthz` caches expensive counts while recalculating freshness on each read.

Missing observations do not represent zero spawn chances. Archive timestamps are UTC and chances are stored as fractions.

## Discord

Set `DISCORD_PUBLIC_KEY` for your application. Place a cryptographically random component secret (at least 32 characters) in `../secrets/discord_component_secret` and the bot token in `../secrets/discord_bot_token`. Restrict access while allowing container UID 1000 to read them. Create `../discord-state/subscriptions`, `../discord-state/delivery` and `../discord-state/replays` writable by UID 1000. The receiver persists short-lived replay records so previously accepted settings commands cannot run again after a restart.

```sh
docker compose --profile discord --profile discord-updates up -d --build
```

Set the application's public interactions endpoint through your reverse proxy, review `discord/commands.json` and register commands with `node discord/register-commands.mjs --apply` using its required environment variables. Enable `DISCORD_UPDATES_ENABLED=true` and `DISCORD_UPDATES_DRY_RUN=false` when ready to post.

See [bot setup](discord/README.md). Server managers use `/updates enable` in the destination channel, `/updates status` to inspect it and `/updates disable` to stop posts. Each server has one destination; only changes are posted. New subscriptions start with the current observation rather than posting a backlog.

## Backups and recovery

Run `python3 api/backup.py data/tarkov-time-capsule.sqlite ../backups` for an online SQLite backup with integrity checks and a hash/count manifest. `api/scheduled-backup.py` creates verified daily backups and retains 14 pairs. Schedule it with your host's scheduler. Store an encrypted independent copy of the database, configuration, secrets, Discord state and privacy deletion register.

Stop services before restoring. Verify backup hashes, restore compatible source and state, and keep collection/notifications disabled until database integrity, historical queries and destinations are checked. Restore the privacy deletion register and reapply deletions before enabling delivery. Inspect pending delivery markers before restarting notifications, because a pending message may already have been sent. Run one collector and one notification sender per state directory.

## Checks

```sh
npm ci --prefix api
npm test --prefix api
npm run build --prefix api
node --test discord/test.mjs discord/updates/updates.test.mjs
npm ci --prefix web
npm test --prefix web
npm run build --prefix web
```

Compose limits the app to 512 MiB and one CPU, and each bot process to 128 MiB and half a CPU, with PID and Node heap limits. Adjust deliberately after measuring usage. Production images use a pinned minimal Node runtime without a shell, npm or build tools; use `/nodejs/bin/node` for deliberate runtime diagnostics. The app sends a restrictive Content Security Policy, framing protection, `nosniff` and a referrer policy. Terminate HTTPS and configure HSTS at the public edge.

GitHub Actions runs these checks, dependency audits and container builds on changes and weekly. Dependabot proposes npm, image and Actions updates. See [security policy](SECURITY.md) for reporting and the narrowly scoped, expiring exception for a withdrawn advisory still reported by npm.

Keep live databases, credentials and Discord state out of Git. Runtime mounts and secrets are configured in `compose.yaml`.
