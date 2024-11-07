import { D1Database } from '@cloudflare/workers-types';
import { request, gql } from 'graphql-request';

export interface Env {
	DB: D1Database;
}

// Define GraphQL query to fetch boss spawn data from Tarkov API
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
	// Step 1: Generate a single timestamp for this response
	const currentTimestamp = Date.now() / 1000; // Unix epoch time in seconds

	// Step 2: Insert or retrieve the timestamp
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

	// Step 3: Process each map and boss, using the same TimestampID for all records
	for (const map of data.maps) {
		// Check if the map exists in the database
		let mapId: number;
		const existingMap = await d1.prepare('SELECT MapID FROM Maps WHERE MapName = ?')
			.bind(map.name)
			.first();

		if (existingMap) {
			mapId = <number>existingMap.MapID;
		} else {
			// Insert the map if it doesn't exist
			const mapResult = await d1.prepare('INSERT INTO Maps (MapName) VALUES (?)')
				.bind(map.name)
				.run();
			mapId = mapResult.meta.last_row_id;
		}

		for (const boss of map.bosses) {
			// Check if the boss exists in the database
			let bossId: number;
			const existingBoss = await d1.prepare('SELECT BossID FROM Bosses WHERE BossName = ?')
				.bind(boss.name)
				.first();

			if (existingBoss) {
				bossId = <number>existingBoss.BossID;
			} else {
				// Insert the boss if it doesn't exist
				const bossResult = await d1.prepare('INSERT INTO Bosses (BossName) VALUES (?)')
					.bind(boss.name)
					.run();
				bossId = bossResult.meta.last_row_id;
			}

			// Insert spawn chance with the shared TimestampID
			await d1.prepare(
				'INSERT OR IGNORE INTO SpawnChances (BossID, MapID, Chance, TimestampID) VALUES (?, ?, ?, ?)'
			)
				.bind(bossId, mapId, boss.spawnChance, timestampId)
				.run();
		}
	}
}

// Function to update D1 database with data from GraphQL API
async function updateDatabase(d1: D1Database) {
	try {
		let response = {};
		await request('https://api.tarkov.dev/graphql', graphqlQuery).then(data => response = data);

		const maps = response.maps;

		// Process and insert data into D1 database
		await processAndInsertData({ maps }, d1);

		console.log('D1 database updated successfully');
	} catch (error) {
		console.error('Error updating D1 database:', error);
	}
}

export async function handleSpawnChanceRequest(request: Request, d1: D1Database): Promise<Response> {
	const url = new URL(request.url);
	const mapName = url.searchParams.get('mapName');
	const bossName = url.searchParams.get('bossName');
	const startDateParam = url.searchParams.get('startDate');
	const endDateParam = url.searchParams.get('endDate');
	const groupBy = url.searchParams.get('groupBy'); // Parameter to control grouping

	// Step 1: Determine date range
	const now = Date.now() / 1000; // Current time in Unix epoch seconds
	const oneWeekAgo = now - 7 * 24 * 60 * 60; // Timestamp for one week ago

	// Convert start and end dates to Unix timestamps, or use defaults
	const startDate = startDateParam ? new Date(startDateParam).getTime() / 1000 : oneWeekAgo;
	const endDate = endDateParam ? new Date(endDateParam).getTime() / 1000 : now;

	// Step 2: Build SQL query and bindings array dynamically
	let query = `
		SELECT Maps.MapName, Bosses.BossName, SpawnChances.Chance, Timestamps.Timestamp
		FROM SpawnChances
				 JOIN Maps ON SpawnChances.MapID = Maps.MapID
				 JOIN Bosses ON SpawnChances.BossID = Bosses.BossID
				 JOIN Timestamps ON SpawnChances.TimestampID = Timestamps.TimestampID
		WHERE Timestamps.Timestamp BETWEEN ? AND ?
	`;
	const bindings = [startDate, endDate];

	// Append conditions based on parameter presence
	if (mapName) {
		query += ' AND Maps.MapName = ?';
		bindings.push(mapName);
	}

	if (bossName) {
		query += ' AND Bosses.BossName = ?';
		bindings.push(bossName);
	}

	// Step 3: Execute the query
	const results = await d1.prepare(query).bind(...bindings).all();

	// Step 4: Convert Unix timestamps to ISO date-time strings
	for (const row of results.results) {
		row.Timestamp = new Date(row.Timestamp * 1000).toISOString(); // Convert seconds to milliseconds and format
	}

	// Step 5: Group the results based on the groupBy parameter, if specified
	let groupedResults;

	if (groupBy === 'boss') {
		// Group by boss
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
		groupedResults = Object.values(groupedResults); // Convert to array format

	} else if (groupBy === 'map') {
		// Group by map
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
		groupedResults = Object.values(groupedResults); // Convert to array format

	} else if (groupBy === 'timestamp') {
		// Group by timestamp
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
		groupedResults = Object.values(groupedResults); // Convert to array format

	} else {
		// Default flat response if no grouping is specified
		groupedResults = results.results;
	}

	// Step 6: Return the grouped results as JSON
	return new Response(JSON.stringify(groupedResults), {
		headers: { 'Content-Type': 'application/json' },
	});
}


export default {
	// Scheduled function to update database on a cron schedule
	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
		await updateDatabase(env.DB);
	},

	// Fetch request handler
	async fetch(request: Request, env: Env): Promise<Response> {
		const { pathname } = new URL(request.url);

		if (pathname === "/api/spawnchance") {
			return await handleSpawnChanceRequest(request, env.DB);
		}

		// Default response with usage instructions for the /api/spawnchance endpoint
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


