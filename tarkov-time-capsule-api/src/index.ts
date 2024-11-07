import { D1Database } from '@cloudflare/workers-types';
import { request, gql } from 'graphql-request';

export interface Env {
	DB: D1Database;
}

const graphqlQuery = `
{
  maps {
    name,
    bosses {
      spawnChance
      name
    }
  }
}
`;

interface Boss {
	name: string;
	spawnChance: number;
}

interface Map {
	name: string;
	bosses: Boss[];
}

async function processAndInsertData(data: { maps: Map[] }, d1: D1Database) {
	const currentTimestamp = Date.now() / 1000;

	let timestampId: number;
	const existingTimestamp = await d1.prepare('SELECT TimestampID FROM Timestamps WHERE Timestamp = ?')
		.bind(currentTimestamp)
		.first();

	if (existingTimestamp) {
		timestampId = <number>existingTimestamp.TimestampID;
	} else {
		const timestampResult = await d1.prepare('INSERT INTO Timestamps (Timestamp) VALUES (?)')
			.bind(currentTimestamp)
			.run();
		timestampId = timestampResult.meta.last_row_id;
	}

	for (const map of data.maps) {
		let mapId: number;
		const existingMap = await d1.prepare('SELECT MapID FROM Maps WHERE MapName = ?')
			.bind(map.name)
			.first();

		if (existingMap) {
			mapId = <number>existingMap.MapID;
		} else {
			const mapResult = await d1.prepare('INSERT INTO Maps (MapName) VALUES (?)')
				.bind(map.name)
				.run();
			mapId = mapResult.meta.last_row_id;
		}

		for (const boss of map.bosses) {
			let bossId: number;
			const existingBoss = await d1.prepare('SELECT BossID FROM Bosses WHERE BossName = ?')
				.bind(boss.name)
				.first();

			if (existingBoss) {
				bossId = <number>existingBoss.BossID;
			} else {
				const bossResult = await d1.prepare('INSERT INTO Bosses (BossName) VALUES (?)')
					.bind(boss.name)
					.run();
				bossId = bossResult.meta.last_row_id;
			}

			await d1.prepare(
				'INSERT OR IGNORE INTO SpawnChances (BossID, MapID, Chance, TimestampID) VALUES (?, ?, ?, ?)'
			)
				.bind(bossId, mapId, boss.spawnChance, timestampId)
				.run();
		}
	}
}

async function updateDatabase(d1: D1Database) {
	try {
		let response = {};
		await request('https://api.tarkov.dev/graphql', graphqlQuery).then(data => response = data);

		const maps = response.maps;

		await processAndInsertData({ maps }, d1);

		console.log('D1 database updated successfully');
	} catch (error) {
		console.error('Error updating D1 database:', error);
	}
}

export async function handleSpawnChanceRequest(request: Request, d1: D1Database): Promise<Response> {
	const url = new URL(request.url);

	const params = new Map<string, string>();
	url.searchParams.forEach((value, key) => {
		params.set(key.toLowerCase(), value);
	});

	const mapName = params.get('mapname');
	const bossName = params.get('bossname');
	const startDateParam = params.get('startdate');
	const endDateParam = params.get('enddate');
	const groupBy = params.get('groupby');

	const now = Date.now() / 1000;
	const oneWeekAgo = now - 7 * 24 * 60 * 60;

	const startDate = startDateParam ? new Date(startDateParam).getTime() / 1000 : oneWeekAgo;
	const endDate = endDateParam ? new Date(endDateParam).getTime() / 1000 : now;

	let query = `
		SELECT Maps.MapName, Bosses.BossName, SpawnChances.Chance, Timestamps.Timestamp
		FROM SpawnChances
				 JOIN Maps ON SpawnChances.MapID = Maps.MapID
				 JOIN Bosses ON SpawnChances.BossID = Bosses.BossID
				 JOIN Timestamps ON SpawnChances.TimestampID = Timestamps.TimestampID
		WHERE Timestamps.Timestamp BETWEEN ? AND ?
	`;
	const bindings = [startDate, endDate];

	if (mapName) {
		query += ' AND LOWER(Maps.MapName) = LOWER(?)';
		bindings.push(mapName);
	}

	if (bossName) {
		query += ' AND LOWER(Bosses.BossName) = LOWER(?)';
		bindings.push(bossName);
	}

	const results = await d1.prepare(query).bind(...bindings).all();

	for (const row of results.results) {
		row.Timestamp = new Date(row.Timestamp * 1000).toISOString();
	}

	let groupedResults;

	if (groupBy === 'boss') {
		groupedResults = results.results.reduce((acc, row) => {
			if (!acc[row.BossName]) {
				acc[row.BossName] = {
					bossName: row.BossName,
					maps: [],
				};
			}
			acc[row.BossName].maps.push({
				mapName: row.MapName,
				spawnChance: row.Chance,
				timestamp: row.Timestamp,
			});
			return acc;
		}, {});
		groupedResults = Object.values(groupedResults);

	} else if (groupBy === 'map') {
		groupedResults = results.results.reduce((acc, row) => {
			if (!acc[row.MapName]) {
				acc[row.MapName] = {
					mapName: row.MapName,
					bosses: [],
				};
			}
			acc[row.MapName].bosses.push({
				bossName: row.BossName,
				spawnChance: row.Chance,
				timestamp: row.Timestamp,
			});
			return acc;
		}, {});
		groupedResults = Object.values(groupedResults);

	} else if (groupBy === 'timestamp') {
		groupedResults = results.results.reduce((acc, row) => {
			if (!acc[row.Timestamp]) {
				acc[row.Timestamp] = {
					timestamp: row.Timestamp,
					entries: [],
				};
			}
			acc[row.Timestamp].entries.push({
				bossName: row.BossName,
				mapName: row.MapName,
				spawnChance: row.Chance,
			});
			return acc;
		}, {});
		groupedResults = Object.values(groupedResults);

	} else {
		groupedResults = results.results;
	}

	return new Response(JSON.stringify(groupedResults), {
		headers: {
			'Content-Type': 'application/json',
			'Access-Control-Allow-Origin': '*', // Allow requests from any origin (for development purposes)
			'Access-Control-Allow-Methods': 'GET, OPTIONS', // Allow specific methods
			'Access-Control-Allow-Headers': 'Content-Type',
		},
	});

}

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


