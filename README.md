# Tarkov Time Capsule

Historical Escape from Tarkov boss spawn chances, with a React archive and Discord bot. Observations are Tarkov.dev regular/PvP API values, not guarantees about live raids.

## Production

The frontend, API, SQLite archive and hourly collector run on nas-linux using Docker Compose. Separate NAS containers handle signed Discord interactions and change-only notifications. Cloudflare supplies DNS, Tunnel and TLS only; Workers, Pages and D1 are retired.

- [Archive](https://tarkovcapsule.mockachino.app/)
- [Add the bot](https://discord.com/oauth2/authorize?client_id=1572583284146446438&scope=bot%20applications.commands&permissions=3072&integration_type=0)
- [Project](https://mockachino.app/projects/tarkov-time-capsule/), [Terms](https://mockachino.app/projects/tarkov-time-capsule/terms/), [Privacy](https://mockachino.app/projects/tarkov-time-capsule/privacy/)

The Discord application belongs to Mockachino; verification is complete and Discovery is enabled. Support/privacy requests: app@outdoortechnica.com.

## Development

Clone https://github.com/ariusalipour/Tarkov-Time-Capsule.git and use Node 24. In tarkov-time-capsule-web run npm ci and npm start; configure REACT_APP_API_URL for a reachable API. Production uses same-origin /api/ routes.

The nas directory contains the Node runtime, SQLite adapter, collector and backups. nas-discord handles interactions and subscriptions; nas-discord-updates delivers changes. Historical API handlers in tarkov-time-capsule-api/src are shared with the NAS runtime. The old Discord Worker source is retained for reference; its deploy command is disabled and Wrangler configs are archived.

See [NAS deployment and recovery](NAS-MIGRATION.md) for production operations. Old subproject README deployment instructions are historical.

## Validation

In nas run npm ci, npm test and npm run build. From the root run node --test nas-discord/test.mjs nas-discord-updates/updates.test.mjs. In the web directory run npm ci, npm test -- --watchAll=false and npm run build. Tests use synthetic fixtures and do not send Discord messages.

Use feature branches and run checks for changed components before submitting a pull request. Keep credentials, live databases and Discord runtime state out of Git.
