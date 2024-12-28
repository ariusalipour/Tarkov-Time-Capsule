import { D1Database } from '@cloudflare/workers-types';
import { fetchGraphQLData } from './graphql';
import { processAndInsertData } from './database';

export async function updateDatabase(d1: D1Database) {
	try {
		const response = await fetchGraphQLData();
		const maps = response.maps;

		await processAndInsertData({ maps }, d1);

		console.log('D1 database updated successfully');
	} catch (error) {
		console.error('Error updating D1 database:', error);
	}
}

export async function handleBossListRequest(d1: D1Database): Promise<Response> {
	const query = 'SELECT BossName FROM Bosses';
	const results = await d1.prepare(query).all();

	const toPascalCase = (str: string) => {
		return str.replace(/\w+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
	};

	const bosses = results.results.map((row: { BossName: string }) => toPascalCase(row.BossName));

	return new Response(JSON.stringify(bosses), {
		headers: {
			'Content-Type': 'application/json',
			'Access-Control-Allow-Origin': '*', // Allow requests from any origin (for development purposes)
			'Access-Control-Allow-Methods': 'GET, OPTIONS', // Allow specific methods
			'Access-Control-Allow-Headers': 'Content-Type',
		},
	});
}

export async function handleMapListRequest(d1: D1Database): Promise<Response> {
	const query = 'SELECT MapName FROM Maps';
	const results = await d1.prepare(query).all();

	const maps = results.results.map((row: { MapName: string }) => row.MapName);

	return new Response(JSON.stringify(maps), {
		headers: {
			'Content-Type': 'application/json',
			'Access-Control-Allow-Origin': '*', // Allow requests from any origin (for development purposes)
			'Access-Control-Allow-Methods': 'GET, OPTIONS', // Allow specific methods
			'Access-Control-Allow-Headers': 'Content-Type',
		},
	});
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
	const bindings: (string | number)[] = [startDate, endDate];

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
		row.Timestamp = new Date(1000 * <any>row.Timestamp).toISOString();
	}

	let groupedResults;

	if (groupBy === 'boss') {
		groupedResults = results.results.reduce((acc: any, row: any) => {
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
		groupedResults = results.results.reduce((acc: any, row: any) => {
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
		groupedResults = results.results.reduce((acc: any, row: any) => {
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
