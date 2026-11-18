import { DatabaseSync } from 'node:sqlite';

export class LocalDatabase {
  constructor(path) {
    this.sqlite = new DatabaseSync(path);
    this.sqlite.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  }
  prepare(sql) { return this.sqlite.prepare(sql); }
  async transaction(callback) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const result = await callback();
      this.sqlite.exec('COMMIT');
      return result;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
  close() { this.sqlite.close(); }
}

export function initializeDatabase(database) {
  database.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS Bosses (BossID INTEGER PRIMARY KEY, BossName TEXT);
    CREATE TABLE IF NOT EXISTS Maps (MapID INTEGER PRIMARY KEY, MapName TEXT);
    CREATE TABLE IF NOT EXISTS Timestamps (TimestampID INTEGER PRIMARY KEY, Timestamp REAL UNIQUE);
    CREATE TABLE IF NOT EXISTS SpawnChances (
      SpawnChanceID INTEGER PRIMARY KEY, BossID INTEGER, MapID INTEGER, Chance INTEGER, TimestampID INTEGER,
      FOREIGN KEY (BossID) REFERENCES Bosses(BossID), FOREIGN KEY (MapID) REFERENCES Maps(MapID),
      FOREIGN KEY (TimestampID) REFERENCES Timestamps(TimestampID), UNIQUE (BossID, MapID, TimestampID)
    );
    CREATE INDEX IF NOT EXISTS idx_timestamps_timestamp ON Timestamps(Timestamp);
    CREATE INDEX IF NOT EXISTS idx_spawnchances_timestamp ON SpawnChances(TimestampID);
  `);
}

export function processAndInsertData(data, db) {
  const timestamp = Date.now() / 1000;
  const insertTimestamp = db.prepare('INSERT OR IGNORE INTO Timestamps (Timestamp) VALUES (?)');
  insertTimestamp.run(timestamp);
  const timestampId = db.prepare('SELECT TimestampID FROM Timestamps WHERE Timestamp = ?').get(timestamp).TimestampID;
  const findMap = db.prepare('SELECT MapID FROM Maps WHERE MapName = ?');
  const insertMap = db.prepare('INSERT INTO Maps (MapName) VALUES (?)');
  const findBoss = db.prepare('SELECT BossID FROM Bosses WHERE BossName = ?');
  const insertBoss = db.prepare('INSERT INTO Bosses (BossName) VALUES (?)');
  const insertChance = db.prepare('INSERT OR IGNORE INTO SpawnChances (BossID, MapID, Chance, TimestampID) VALUES (?, ?, ?, ?)');
  for (const map of data.maps) {
    const mapId = findMap.get(map.name)?.MapID ?? Number(insertMap.run(map.name).lastInsertRowid);
    for (const boss of map.bosses) {
      const bossId = findBoss.get(boss.name)?.BossID ?? Number(insertBoss.run(boss.name).lastInsertRowid);
      insertChance.run(bossId, mapId, boss.spawnChance, timestampId);
    }
  }
}
