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

Use Node 24, Python 3 for backup scripts, and Docker Compose.

Copy `.env.example` to `.env`. Create `data/` owned by UID/GID 1000, then run:

```sh
docker compose up -d --build app
```

Collection is disabled by default. Set `SCHEDULER_ENABLED=true` after checking the database and ensuring only one collector runs. Collection occurs each UTC hour. `/healthz` reports counts, latest observation and collector status; check freshness as well as HTTP status.

For local web development, run `npm ci` and `npm start` in `web/`, with `REACT_APP_API_URL` pointing to the API. In `api/`, run `npm ci`, `npm run build`, then `DATABASE_PATH=../data/tarkov-time-capsule.sqlite STATIC_DIR=../web/build npm start`.

## API

- `GET /api/maps`
- `GET /api/bosses`
- `GET /api/spawnchance?startDate=2026-11-18&endDate=2026-11-19` — optional `mapName`, `bossName` and `groupBy` (`boss`, `map`, `timestamp`).
- `GET /api/latestspawnchance` — observations from the preceding hour.
- `GET /healthz`

Missing observations do not represent zero spawn chances. Archive timestamps are UTC and chances are stored as fractions.

## Discord

Set `DISCORD_PUBLIC_KEY` for your application. Place a cryptographically random component secret (at least 32 characters) in `../secrets/discord_component_secret` and the bot token in `../secrets/discord_bot_token`. Restrict access while allowing container UID 1000 to read them. Create `../discord-state/subscriptions` and `../discord-state/delivery` writable by UID 1000.

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
CI=true npm test --prefix web -- --watchAll=false --runInBand
npm run build --prefix web
```

Keep live databases, credentials and Discord state out of Git. Runtime mounts and secrets are configured in `compose.yaml`.
