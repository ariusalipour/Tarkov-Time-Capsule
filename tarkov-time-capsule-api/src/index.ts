import { graphql, buildSchema } from 'graphql';
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

// GraphQL Schema
type SpawnChance = {
	id: string;
	map: Map;
	boss: Boss;
	chance: number;
	timestamp: Timestamp;
};

const schema = buildSchema(`
  type Map {
    id: ID!
    name: String!
  }

  type Boss {
    id: ID!
    name: String!
  }

  type Timestamp {
    id: ID!
    timestamp: String!
  }

  type SpawnChance {
    id: ID!
    map: Map!
    boss: Boss!
    chance: Float!
    timestamp: Timestamp!
  }

  type Query {
    Timestamps(startDate: String, endDate: String): [TimestampGroup]
    Maps(mapName: String, startDate: String, endDate: String): [MapGroup]
    Bosses(bossName: String, startDate: String, endDate: String): [BossGroup]
    SpawnChances(mapName: String, bossName: String, startDate: String, endDate: String): [SpawnChance]
  }

  type TimestampGroup {
    timestamp: String!
    spawnChances: [SpawnChance!]!
  }

  type MapGroup {
    map: Map!
    spawnChances: [SpawnChance!]!
  }

  type BossGroup {
    boss: Boss!
    spawnChances: [SpawnChance!]!
  }
`);

// Resolver Functions
const resolvers = {
	Query: {
		SpawnChances: async (
			_,
			{ mapName, bossName, startDate, endDate },
			{ env }: { env: Env }
		) => {
			const d1 = env.DB;

			const now = Date.now() / 1000;
			const oneWeekAgo = now - 7 * 24 * 60 * 60;
			const start = startDate ? new Date(startDate).getTime() / 1000 : oneWeekAgo;
			const end = endDate ? new Date(endDate).getTime() / 1000 : now;

			let query = `
        SELECT Maps.MapID, Maps.MapName, Bosses.BossID, Bosses.BossName, SpawnChances.Chance, Timestamps.Timestamp, Timestamps.TimestampID
        FROM SpawnChances
        JOIN Maps ON SpawnChances.MapID = Maps.MapID
        JOIN Bosses ON SpawnChances.BossID = Bosses.BossID
        JOIN Timestamps ON SpawnChances.TimestampID = Timestamps.TimestampID
        WHERE Timestamps.Timestamp BETWEEN ? AND ?
      `;
			const bindings = [start, end];

			if (mapName) {
				query += ' AND LOWER(Maps.MapName) = LOWER(?)';
				bindings.push(mapName);
			}

			if (bossName) {
				query += ' AND LOWER(Bosses.BossName) = LOWER(?)';
				bindings.push(bossName);
			}

			const results = await d1.prepare(query).bind(...bindings).all();

			return results.results.map((item) => ({
				id: `${item.MapID}-${item.BossID}-${item.TimestampID}`,
				map: { id: item.MapID, name: item.MapName },
				boss: { id: item.BossID, name: item.BossName },
				chance: item.Chance,
				timestamp: {
					id: item.TimestampID,
					timestamp: new Date(item.Timestamp * 1000).toISOString(),
				},
			}));
		},
		// Implement similar resolvers for Timestamps, Maps, and Bosses queries
	},
};

// Data Processing and Insert Function
async function processAndInsertData(data: { maps: Map[] }, d1: D1Database) {
	const currentTimestamp = Date.now() / 1000;

	let timestampId: number;
	const existingTimestamp = await d1
		.prepare('SELECT TimestampID FROM Timestamps WHERE Timestamp = ?')
		.bind(currentTimestamp)
		.first();

	if (existingTimestamp) {
		timestampId = <number>existingTimestamp.TimestampID;
	} else {
		const timestampResult = await d1
			.prepare('INSERT INTO Timestamps (Timestamp) VALUES (?)')
			.bind(currentTimestamp)
			.run();
		timestampId = timestampResult.meta.last_row_id;
	}

	for (const map of data.maps) {
		let mapId: number;
		const existingMap = await d1.prepare('SELECT MapID FROM Maps WHERE MapName = ?').bind(map.name).first();

		if (existingMap) {
			mapId = <number>existingMap.MapID;
		} else {
			const mapResult = await d1.prepare('INSERT INTO Maps (MapName) VALUES (?)').bind(map.name).run();
			mapId = mapResult.meta.last_row_id;
		}

		for (const boss of map.bosses) {
			let bossId: number;
			const existingBoss = await d1.prepare('SELECT BossID FROM Bosses WHERE BossName = ?').bind(boss.name).first();

			if (existingBoss) {
				bossId = <number>existingBoss.BossID;
			} else {
				const bossResult = await d1.prepare('INSERT INTO Bosses (BossName) VALUES (?)').bind(boss.name).run();
				bossId = bossResult.meta.last_row_id;
			}

			await d1
				.prepare('INSERT OR IGNORE INTO SpawnChances (BossID, MapID, Chance, TimestampID) VALUES (?, ?, ?, ?)')
				.bind(bossId, mapId, boss.spawnChance, timestampId)
				.run();
		}
	}
}

// Database Update Function
async function updateDatabase(d1: D1Database) {
	try {
		let response = {};
		await request('https://api.tarkov.dev/graphql', graphqlQuery).then((data) => (response = data));

		const maps = response.maps;

		await processAndInsertData({ maps }, d1);

		console.log('D1 database updated successfully');
	} catch (error) {
		console.error('Error updating D1 database:', error);
	}
}

// Cloudflare Worker Export
export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (request.method === 'OPTIONS') {
			// Handle CORS preflight
			return new Response(null, {
				headers: {
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
					'Access-Control-Allow-Headers': 'Content-Type',
				},
			});
		}

		if (request.method === 'POST') {
			try {
				const requestBody = await request.json();
				const response = await graphql({
					schema,
					source: requestBody.query,
					variableValues: requestBody.variables,
					rootValue: resolvers.Query,
					contextValue: { env },
				});

				return new Response(JSON.stringify(response), {
					headers: {
						'Content-Type': 'application/json',
						'Access-Control-Allow-Origin': '*',
					},
				});
			} catch (error) {
				return new Response(JSON.stringify({ error: error.message }), {
					headers: {
						'Content-Type': 'application/json',
						'Access-Control-Allow-Origin': '*',
					},
					status: 500,
				});
			}
		}

		return new Response('Welcome to the Tarkov Time Capsule GraphQL API', {
			headers: { 'Content-Type': 'text/plain' },
		});
	},

	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
		await updateDatabase(env.DB);
	},
};
