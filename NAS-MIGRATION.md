# NAS deployment and recovery

## Production architecture

As of 18 November 2026 all application execution runs on nas-linux. The app serves React and historical API routes, stores SQLite on local ext4, and collects each UTC hour. Separate containers receive signed Discord interactions and deliver spawn-chance changes. Cloudflare supplies DNS, Tunnel and TLS only.

The API Worker, compatibility redirect Worker, Discord Worker, Pages project and D1 database are deleted. Archived Wrangler files are reference only. The old Discord application may remain installed in some servers, but its backend is gone.

Source: /home/mockachino/apps/tarkov-time-capsule/source. LAN bindings: 192.168.55.156:3040 (app) and :3042 (Discord receiver). Canonical site: https://tarkovcapsule.mockachino.app with same-origin /api/ routes. A path-specific tunnel ingress routes /discord/interactions before the general app ingress.

## Deployment

Use Docker Compose and Node 24. Copy .env.example to .env, choose bind address/ports and leave collection and notifications disabled in staging. Build with docker compose build; start with docker compose up -d app.

The ./data bind mount must belong to UID/GID 1000. Restore a verified closed archive backup to data/tarkov-time-capsule.sqlite before starting. Empty databases can initialize for development. Never initialize restored data using tarkov-time-capsule-api/db_schemas/schema.sql: it drops tables.

Check /healthz, /api/maps, /api/bosses and a fixed historical /api/spawnchance query before enabling SCHEDULER_ENABLED=true and recreating the app. Run only one collector. Collections prevent overlaps and commit transactionally. Verify the next UTC-hour boundary using collection.lastSuccess, collection.lastError and latest timestamp. Health HTTP 200 alone does not establish freshness.

## Source and history

The collector reads official JSON endpoints https://json.tarkov.dev/regular/maps and https://json.tarkov.dev/regular/maps_en, joins mob IDs to the mobs dictionary and resolves English names. Requests share a 30-second deadline and malformed/empty data fails before writes. The former GraphQL upstream returned HTTP 422 during migration.

The imported archive ends in July 2026 and collection resumed 18 November 2026. Current data cannot recreate missing months. The failure observed during migration does not establish the cause of the whole gap.

Fractions and floating-point UTC timestamp IDs preserve original units. Duplicate boss appearances in a map retain first-entry behavior through INSERT OR IGNORE. Historical response ordering is not guaranteed. /api/latestspawnchance only searches the preceding hour; empty results do not mean zero chance. Discord reads the latest archived snapshot and labels stale data.

## Discord

Application 1572583284146446438 belongs to Mockachino. Verification is complete and Discovery is enabled, using MOCKA Dojo Casa House as support server. Public policies: https://mockachino.app/projects/tarkov-time-capsule/terms/ and https://mockachino.app/projects/tarkov-time-capsule/privacy/. Support/privacy/deletion contact: app@outdoortechnica.com.

The discord profile runs the signed receiver. Configure DISCORD_PUBLIC_KEY for the application and create ../secrets/discord_component_secret with at least 32 cryptographically random characters. The receiver needs no bot token. The discord-updates profile mounts ../secrets/discord_bot_token. Restrict secret-file access while allowing the non-root containers to read their mounts. Never commit either secret.

Run docker compose --profile discord --profile discord-updates up -d. Enable DISCORD_UPDATES_ENABLED=true and DISCORD_UPDATES_DRY_RUN=false only for the intended sender. Run one receiver writer and updater per state directory.

Commands: /boss, /bosses, /status, /ping, /hello and /updates. Server managers run /updates enable in a text/announcement channel where the bot has View Channel and Send Messages. /updates status shows configuration; /updates disable stops posts. Each server has one destination. New destinations establish a baseline without backlog. Only spawn-chance changes post; no daily summary or webhook setup is needed.

Subscriptions persist under ../discord-state/subscriptions; delivery baselines persist separately under ../discord-state/delivery. The updater mounts subscriptions read-only and rechecks revision/destination before sending. Ambiguous delivery leaves pending state and pauses only that subscription. Inspect the channel and logs before clearing pending: delivery may have succeeded. Disabling does not delete records; follow the privacy policy for deletion and backup handling.

Command registration is an explicit operator action. nas-discord/register-commands.mjs validates the token application ID and only writes with --apply. Review commands.json before bulk replacement. No message-reading or privileged Gateway intent is required. See [receiver operations](nas-discord/README.md) and [delivery operations](nas-discord-updates/README.md).

## Backups

Run python3 nas/backup.py from source. It uses SQLite's online backup API, including committed WAL content, and verifies integrity/foreign keys before producing SQLite plus SHA256/count manifest in ../backups. Never copy only the live database while it writes.

The user systemd timer runs nas/scheduled-backup.py daily at 02:45 UTC plus up to five minutes randomized delay, retaining 14 verified pairs in ../backups/daily. Manual recovery points are preserved. Unit templates are in nas; production uses user lingering.

The existing Sunday 03:15 Europe/London encrypted off-NAS Restic capture includes the parent project directory, including source, secrets, database and Discord state. All three containers are in the strict backup inventory; update that inventory when changing containers. Keep independently stored restore-tested recovery copies.

## Recovery

1. Stop affected app and Discord services. Preserve database, WAL/SHM companions, source, secrets and state for rollback.
2. Verify recovery manifest/hashes. Restore a verified SQLite backup into an empty data directory with UID/GID 1000 ownership, never over an open database.
3. Restore compatible source/configuration, secrets and state from restricted recovery storage. Restore the privacy-request runbook and deletion register from ../privacy-requests as well. Keep collection and delivery disabled initially.
4. Build/start the app; verify integrity/counts, fixed historical queries, health and UI. Check restored Discord destinations/baselines and inspect pending markers before starting delivery.
5. Enable one collector and verify a scheduled boundary; reapply recorded privacy deletions to restored Discord state before enabling the sender, then enable delivery after configuration checks. Preserve newer observations before rollback to older history.

Recovery uses NAS and independent backups, not deleted Cloudflare resources. Deployment-specific evidence is maintained separately under D:/GIT/agent-artefacts/Tarkov-Time-Capsule.
