import { D1Database } from '@cloudflare/workers-types';
import { Map } from './types';

export async function processAndInsertData(data: { maps: Map[] }, d1: D1Database) {
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
