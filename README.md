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
- `GET /api/history?startDate=2024-11-01&endDate=2026-11-19&limit=250` — paginated raw observations, with optional `mapName`, `bossName` and `cursor`.
- `GET /api/history/summary?startDate=2024-11-01&endDate=2026-11-19&resolution=auto` — bounded chart aggregates, with optional `mapName` and `bossName`.
- `GET /api/spawnchance?startDate=2026-11-18&endDate=2026-11-19` — array response with optional `mapName`, `bossName` and `groupBy` (`boss`, `map`, `timestamp`).
- `GET /api/latestspawnchance` — observations from the preceding hour.
- `GET /healthz`

Dates accept `YYYY-MM-DD` or an ISO UTC timestamp ending in `Z`. History defaults to the preceding seven days. Invalid dates, reversed ranges, oversized filters and long queries return `400`; the paginated and summary endpoints also reject duplicate query parameters and ranges exceeding 3,660 days.

### Raw history

`/api/history` returns `{ records, nextCursor, snapshotId }`. Each record contains `id`, `mapName`, `bossName`, `spawnChance` and `timestamp`. The default page size is 250; `limit` accepts integers from 1 to 1,000.

Pass `nextCursor` unchanged as the next request's `cursor`, retaining the same filters and any explicit date bounds. Pagination orders by timestamp and observation ID and fixes the maximum observation ID at the first page, so new collector inserts do not shift subsequent pages. A `null` cursor means there are no more records in that snapshot. Cursors are authenticated and expire on application restart; a `400` response asks the client to restart pagination. They are not permanent links or export checkpoints.

### Chart summaries

`/api/history/summary` returns `{ resolution, bucketSeconds, series }`, with one series per map/boss pair. Each point contains its bucket `timestamp`, actual `firstTimestamp` and `lastTimestamp`, `min`, `max`, `average`, `latest`, `count` and collection-gap `segment`. Aggregation runs in SQL; it does not load the full archive into application memory. The web chart displays aggregate averages and exposes observed ranges, counts and latest values in its tooltips, while the table and CSV use raw pages.

`resolution` accepts `auto`, `hour`, `day` or `week`. Automatic resolution uses hourly buckets for ranges up to seven days, daily buckets up to 180 days, and weekly buckets thereafter. Buckets align to UTC Unix-epoch intervals; weekly buckets start on Thursday. Gaps greater than six hours split segments before aggregation, including gaps within one bucket. Missing observations do not represent zero spawn chances, and aggregates must not be presented as continuous observations across gaps.

Summaries allow at most 100 series and 25,000 points. Requests exceeding those bounds return `413` with guidance to filter or select a coarser resolution. The array-based `/api/spawnchance` endpoint retains its 10,000-observation cap and also returns `413` for overflow. Results are never silently truncated. Archive timestamps are UTC and chances are stored as fractions.

### Request budgets

API reads have a shared budget of 120 requests/minute (burst 30). By default each socket address also has a 60/minute budget (burst 15). Arbitrary forwarded headers, including `CF-Connecting-IP` and `X-Forwarded-For`, never establish client identity or buy a new budget. `/healthz` caches expensive counts while recalculating freshness on each read.

`API_EDGE_RATE_LIMITED` defaults to `false`. Set it to `true` only after verifying a trusted public edge enforces per-client rate limits on every public `/api/*` route. This raises the socket-address budget to match the shared 120/minute, burst-30 budget, avoiding a second, tighter shared-address limit on tunnel traffic. Global containment remains active. Direct origin access still shares that budget and should be restricted to trusted networks.

Summary requests additionally share a separate budget of 12/minute (burst 3), because aggregation scans the archive. `429` responses include `Retry-After`; summary-budget exhaustion asks clients to retry after five seconds. These limits bound resource use rather than guaranteeing throughput for every visitor.

## Discord

Set `DISCORD_PUBLIC_KEY` for your application. Place a cryptographically random component secret (at least 32 characters) in `../secrets/discord_component_secret` and the bot token in `../secrets/discord_bot_token`. Restrict access while allowing container UID 1000 to read them. Create `../discord-state/subscriptions`, `../discord-state/delivery` and `../discord-state/replays` writable by UID 1000. The receiver persists short-lived replay records so previously accepted settings commands cannot run again after a restart.

```sh
docker compose --profile discord --profile discord-updates up -d --build
```

Set the application's public interactions endpoint through your reverse proxy, review `discord/commands.json` and register commands with `node discord/register-commands.mjs --apply` using its required environment variables. Enable `DISCORD_UPDATES_ENABLED=true` and `DISCORD_UPDATES_DRY_RUN=false` when ready to post.

See [bot setup](discord/README.md). Server managers use `/updates enable` in the destination channel, `/updates status` to inspect it and `/updates disable` to stop posts. Each server has one destination; only changes are posted. New subscriptions start with the current observation rather than posting a backlog.

## Backups and recovery

Run `python3 api/backup.py data/tarkov-time-capsule.sqlite ../backups` for an online SQLite backup with integrity checks and a hash/count manifest. `api/scheduled-backup.py` creates verified daily backups and retains 14 pairs. Schedule it with your host's scheduler. Store an encrypted independent copy of the database, configuration, secrets, Discord state and privacy deletion register.

Run `api/restore-rehearsal.py` weekly against the newest verified backup and the installed production image. It starts an isolated container with collection disabled, verifies application health and a historical API query, removes the disposable container and writes an atomic pass/fail report. See [restore rehearsal](api/RESTORE-REHEARSAL.md) for scheduling, isolation and failure handling.

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

GitHub Actions runs these checks, dependency audits and container builds on changes and weekly. Dependabot proposes npm, image and Actions updates. See [security policy](SECURITY.md) for vulnerability reporting. Dependency audits have no advisory exceptions.

Keep live databases, credentials and Discord state out of Git. Runtime mounts and secrets are configured in `compose.yaml`.
