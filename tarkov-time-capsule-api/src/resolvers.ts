import { D1Database } from '@cloudflare/workers-types';

export interface Env {
	DB: D1Database;
}

const resolvers = {
	Query: {
		SpawnChances: async (_, { mapName, bossName, startDate, endDate }, { env }: { env: Env }) => {
			const d1 = env.DB;

			// Determine date range
			const now = Date.now() / 1000;
			const oneWeekAgo = now - 7 * 24 * 60 * 60;
			const start = startDate ? new Date(startDate).getTime() / 1000 : oneWeekAgo;
			const end = endDate ? new Date(endDate).getTime() / 1000 : now;

			// Construct SQL query dynamically based on provided filters
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

			// Execute query
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

		// Add similar implementations for Timestamps, Maps, and Bosses queries.
	},
};

export default resolvers;
