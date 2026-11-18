# Discord bot

Dependency-free Node 24 Discord interactions service. No Gateway connection, bot token, command-registration action or outgoing Discord message is needed by this interactions service. It acknowledges signed requests directly, with a 1.7-second total upstream timeout so Discord's 3-second deadline has headroom. An unavailable API produces a private retry message rather than a late acknowledgement.

Configuration:

- `DISCORD_PUBLIC_KEY`: the application's 64-character hexadecimal Ed25519 public key (not its client secret).
- `DISCORD_COMPONENT_SECRET_FILE`: a mounted file holding at least 32 random characters, for example `/run/secrets/discord_component_secret`. Alternatively `DISCORD_COMPONENT_SECRET`.
- `API_BASE_URL`: defaults to `http://app:3000` on the Compose network.
- `PORT`: defaults to `3000`.
- `DISCORD_SUBSCRIPTIONS_DIR`: defaults to `/data/subscriptions`; mount the subscription directory writable for this service and read-only for the delivery service.
- `PUBLIC_APP_URL`: defaults to `https://tarkovcapsule.mockachino.app`, used for result links.

Serve the application's Discord Interactions Endpoint URL at `https://tarkovcapsule.mockachino.app/discord/interactions` through your reverse proxy. `/interactions` is also accepted. `GET /healthz` only checks this process; `/status` checks the archive and collector. Only signature-valid requests are processed. Timestamp skew is bounded to five minutes. Requests over 64 KiB are rejected; request/header read timeouts are five seconds. No tokens or request bodies are logged. Buttons expire after 15 minutes, are HMAC authenticated and restricted to the command's invoking user. The host clock must be synchronized.

`commands.json` is the registration payload for the application's commands. Registration is deliberately separate from startup. Use Discord's authenticated application-command bulk overwrite endpoint for the application after reviewing the payload; global commands may take time to propagate. `/boss` uses API-backed autocomplete rather than a fixed list of 25 bosses. `/bosses` returns paginated latest-snapshot observations; `/status` reports freshness and paused/error state. `/ping` and `/hello` remain aliases/help. No message-content or privileged Gateway intent is needed.

The bot queries `/healthz` first and reads a tight history window around the latest stored timestamp. A stale archive still returns the last saved snapshot, with a visible UTC timestamp and stale warning. Bosses absent from that snapshot are described as missing observations, never assumed to have zero chance. Recorded zero and above-100% values are preserved. This is PvP/regular source data. It does not claim live game guarantees. Historical per-boss queries and PvE selection are outside this version's scope. Boss-specific pagination stores its filter in a bounded 1,000-entry in-memory cache; restarting the container expires those buttons safely and asks users to rerun the command.

Run `npm --prefix discord test` from the repository root. Tests use generated Ed25519 fixtures, synthetic API responses and a loopback HTTP server only; they neither register commands nor send Discord messages. Docker build runs the same suite. Runtime should use read-only root filesystem, temporary `/tmp`, dropped capabilities and `no-new-privileges`; it needs outbound access only to the API service. Scheduled change delivery is a separate service that reads subscriptions configured by this process.

## Channel setup with slash commands

A server member with **Manage Server** or **Administrator** permission runs `/updates enable` in the channel where changes should appear. The bot needs **View Channel** and **Send Messages** there. Standard server text and announcement channels are accepted; threads and DMs are not. Replies are private. `/updates status` shows the destination; `/updates disable` stops updates for that server. Each server has one destination, and running enable in a different channel moves it. There are no daily summary posts.

Permission checks are enforced on the signed interaction, including member and bot effective channel permissions, rather than relying solely on Discord's command visibility. Only the invoking channel can be selected; no manual webhook is needed. Register the bot with application-command and bot scopes, with View Channel + Send Messages permissions and no privileged intents.

Subscriptions are atomic JSON files named `<guildId>.json` in `DISCORD_SUBSCRIPTIONS_DIR`, containing `{guildId,channelId,enabled,revision,updatedAt}`. They contain no token or webhook. Writes are serialized per server within the single interactions process. Re-enabling the same active channel keeps its revision and delivery baseline; changing channels, disabling or re-enabling a disabled subscription changes its revision. The delivery service maintains its own independent state and checks the subscription again before sending. A new revision establishes a current-data baseline without posting old changes. Use one interactions writer process per subscription directory.
