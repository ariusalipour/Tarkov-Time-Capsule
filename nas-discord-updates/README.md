# Scheduled Discord channel updates

Optional independent Node 24 service, separate from interaction handling. Disabled and dry-run by default. No dependencies. Start with `node updates.mjs`; one check with `node updates.mjs --once`; tests with `node --test updates.test.mjs`.

For the NAS bot, use `UPDATES_MODE=bot`. Server administrators configure notifications with `/updates enable` in the destination channel, `/updates disable`, and `/updates status`. The interactions service writes `/data/subscriptions/<guildId>.json`; mount this directory read-only into the updater. Mount `/data/delivery` writable and persistent, and mount the bot token at `/run/secrets/discord_bot_token` read-only. Set `UPDATES_ENABLED=true` and `UPDATES_DRY_RUN=false` when ready. Run only one updater instance. No message-reading intent or webhook is needed.

Bot mode posts **only spawn chance changes**, regardless of daily-summary settings. Each newly enabled destination or changed channel gets a fresh baseline without a welcome/backlog post. Identical repeated enable commands retain the baseline. Every poll uses one latest snapshot for all destinations, and rechecks subscription enabled/revision/channel immediately before delivery. Disabled subscriptions are skipped. A destination with failed/uncertain delivery is held for review independently; other servers continue normally. A completed delivery is persisted to survive restart. There is an unavoidable narrow external-send race if a disable command arrives after the final check while Discord is accepting a message.

Bot delivery state files are `/data/delivery/<guildId>-<revision>.json`. Permission errors (including revoked channel access), timeouts, unsuccessful responses, or crash during send preserve `pending`. Review the channel before clearing pending because delivery may have succeeded. Re-enabling after disabling creates a new revision and clean baseline; old pending files cannot block it. Logs contain a guild ID and controlled generic error only. Retired revision files may be retained for audit or removed when inactive. Back up subscriptions and delivery state alongside the database.

| Environment variable | Default / purpose |
| --- | --- |
| `UPDATES_MODE` | `webhook` compatibility default; set `bot` for command-managed subscriptions |
| `UPDATES_SUBSCRIPTIONS_DIR` | `/data/subscriptions`; updater read-only shared directory |
| `UPDATES_DELIVERY_DIR` | `/data/delivery`; updater writable persistent directory |
| `DISCORD_BOT_TOKEN_FILE` | `/run/secrets/discord_bot_token`; bot mode secret file |
| `UPDATES_ENABLED` | `false`; explicitly set `true` to run |
| `UPDATES_DRY_RUN` | `true`; explicitly set `false` to permit posting |
| `UPDATES_API_URL` | `http://app:3000`; internal NAS app service |
| `UPDATES_PUBLIC_URL` | `https://tarkovcapsule.mockachino.app/` |
| `UPDATES_DAILY` | `true`; daily complete summary |
| `UPDATES_DAILY_TIME` | `09:00`, 24-hour local time |
| `UPDATES_TIMEZONE` | `Europe/London`; follows GMT/BST |
| `UPDATES_CHANGES` | `true`; check once per UTC hour, post only changed values |
| `UPDATES_STATE_PATH` | `/data/discord-updates.json`; persistent writable volume required |
| `DISCORD_UPDATES_WEBHOOK_FILE` | Secret file containing channel-specific webhook URL; preferred |
| `DISCORD_UPDATES_WEBHOOK_URL` | Alternative environment secret; never commit |

Run only one scheduler instance per state file. Mount `/data` persistently and mount the webhook secret read-only. Container can otherwise use a read-only root filesystem, no privileges and a non-root user. Parent deployment owns Compose integration. A webhook determines the destination channel; never post until the user has supplied destination and approved timing.

Initial successful check records a baseline without posting. The daily summary is eligible once at/after the configured local time, including catch-up after downtime on that date. Hourly checks do not replay a backlog. At the hour boundary, polling waits for the new collection before consuming that hour, avoiding a race with the collector. Daily summaries can use the latest valid prior-hour snapshot and leave the new hour eligible for a later change check. Daily and change updates due together become one summary. Changed, added, and missing entries are distinguished; missing never means 0%. Raw fractional chances are compared unchanged and multiplied by 100 only for display (up to three decimal places). Summaries fit one Discord message and link to full history. Every message disables mentions. Data older than two hours or missing/invalid snapshots stop posting. API errors preserve previous state.

Successful posts persist snapshot/date/hour to avoid repeat delivery across restarts. Delivery intent is persisted before posting: network failure, non-success response, or crash during delivery leaves `pending` in the state and halts future posts. Check the channel and service logs, then remove only the `pending` field to resume; a message may already have arrived. This intentionally favors manual review over duplicate spam. State corruption also stops delivery. Only HTTP 429 is retried (up to three attempts, retry delays capped at 60 seconds); other failures require review. Never log webhook secrets. Dry-run logs preview payloads and does not mutate state; an initial dry-run reports baseline only, so preview against a copied initialized state.
