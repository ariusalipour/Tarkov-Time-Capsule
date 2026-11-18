# Spawn chance notifications

The Discord bot includes an independent Node 24 notification process. It posts only changes to spawn chances in channels selected with `/updates enable`. `/updates disable` stops notifications; `/updates status` reports the destination. Each server has one destination.

Run `npm --prefix discord run updates` from the repository root, or run `node discord/updates/updates.mjs --once` for one poll. Run the interaction and notification tests with `npm --prefix discord test`.

| Variable | Default / purpose |
| --- | --- |
| `UPDATES_ENABLED` | `false`; set `true` to run |
| `UPDATES_DRY_RUN` | `true`; set `false` to permit posting |
| `UPDATES_API_URL` | `http://app:3000` |
| `UPDATES_PUBLIC_URL` | `https://tarkovcapsule.mockachino.app/` |
| `UPDATES_SUBSCRIPTIONS_DIR` | `/data/subscriptions`; shared subscription directory, read-only here |
| `UPDATES_DELIVERY_DIR` | `/data/delivery`; writable persistent delivery state |
| `DISCORD_BOT_TOKEN_FILE` | `/run/secrets/discord_bot_token`; read-only secret file |

Run one notification process. It polls every 30 seconds and checks each new hourly collection. New or changed destinations establish a baseline without posting old changes. Repeating `/updates enable` for the same active channel keeps the baseline. Unchanged observations produce no message. Missing observations never mean zero; raw chances, including recorded outliers, are preserved.

Every poll uses one consistent snapshot for all destinations and rechecks channel, revision and enabled state immediately before delivery. Stale or invalid data stops posting. A completed delivery is persisted across restarts. All outgoing messages suppress mentions and fit Discord's message limit. HTTP 429 retries are bounded to three attempts with delays no longer than 60 seconds.

Delivery state is stored in `<guildId>-<revision>.json`. Before posting, a pending marker is persisted. Permission errors, ambiguous responses or a crash during delivery leave that destination pending for review while other servers continue. Check the channel before removing a pending marker: the message may already have arrived. Re-enabling after disabling creates a new revision and baseline. There is a narrow external-send race when a disable request arrives while Discord is already accepting the message.

Keep subscription and delivery directories persistent and back them up with the database. Restore applicable privacy deletion records before starting notifications after recovery. The container otherwise supports a read-only root filesystem, dropped capabilities and a non-root user. Logs contain controlled errors and guild IDs, never bot credentials.
