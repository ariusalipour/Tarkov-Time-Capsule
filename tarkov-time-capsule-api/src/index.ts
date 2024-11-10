import { Env } from './types';
import { updateDatabase, handleSpawnChanceRequest } from './handlers';

export default {
	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
		await updateDatabase(env.DB);
	},

	async fetch(request: Request, env: Env): Promise<Response> {
		const { pathname } = new URL(request.url);

		if (pathname === "/api/spawnchance") {
			return await handleSpawnChanceRequest(request, env.DB);
		}

		return new Response(
			`Welcome to the Tarkov Time Capsule API!

Use the /api/spawnchance endpoint to query boss spawn chances with optional parameters:
  - ?mapName=[mapName] : Filter by specific map name.
  - ?bossName=[bossName] : Filter by specific boss name.
  - ?startDate=[YYYY-MM-DD] : Filter results from this start date.
  - ?endDate=[YYYY-MM-DD] : Filter results until this end date.
  - ?groupBy=[boss|map|timestamp] : Group results by boss, map, or timestamp. Defaults to no grouping if not specified.

Examples:
  - /api/spawnchance?mapName=Customs
  - /api/spawnchance?bossName=Reshala
  - /api/spawnchance?mapName=Customs&startDate=2024-10-01&endDate=2024-10-07
  - /api/spawnchance?groupBy=boss
  - /api/spawnchance?groupBy=map&startDate=2024-10-01
  - /api/spawnchance?groupBy=timestamp

By default, the endpoint returns results from the last week if no date range is specified, and the response is ungrouped unless specified by the groupBy parameter.
`,
			{ headers: { 'Content-Type': 'text/plain' } }
		);
	},
} satisfies ExportedHandler<Env>;
