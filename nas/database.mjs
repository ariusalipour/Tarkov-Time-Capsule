import { DatabaseSync } from 'node:sqlite';

// Implements the small D1 surface used by the existing application.
export class LocalDatabase {
  constructor(path) {
    this.sqlite = new DatabaseSync(path);
    this.sqlite.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  }
  prepare(sql) {
    const statement = this.sqlite.prepare(sql);
    const wrap = (bindings = []) => ({
      bind: (...values) => wrap(values),
      first: async (column) => {
        const row = statement.get(...bindings);
        return row ? (column ? row[column] : row) : null;
      },
      all: async () => ({ results: statement.all(...bindings), success: true }),
      run: async () => {
        const result = statement.run(...bindings);
        return { success: true, meta: { last_row_id: Number(result.lastInsertRowid), changes: Number(result.changes) } };
      },
    });
    return wrap();
  }
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
  // Additive only: never execute the repository's destructive development schema.
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
