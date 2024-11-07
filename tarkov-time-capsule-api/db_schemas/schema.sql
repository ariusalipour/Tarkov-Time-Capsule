DROP TABLE IF EXISTS SpawnChances;
DROP TABLE IF EXISTS Bosses;
DROP TABLE IF EXISTS TimeStamps;
DROP TABLE IF EXISTS Maps;

CREATE TABLE IF NOT EXISTS Bosses (
	BossID INTEGER PRIMARY KEY,
	BossName TEXT
);

CREATE TABLE IF NOT EXISTS Maps (
	MapID INTEGER PRIMARY KEY,
	MapName TEXT
);

CREATE TABLE IF NOT EXISTS Timestamps (
	TimestampID INTEGER PRIMARY KEY,
	Timestamp REAL UNIQUE -- Store UTC time as Unix epoch in seconds, ensuring each timestamp is unique
);

CREATE TABLE IF NOT EXISTS SpawnChances (
	SpawnChanceID INTEGER PRIMARY KEY,
	BossID INTEGER,
	MapID INTEGER,
	Chance INTEGER,
	TimestampID INTEGER,
	FOREIGN KEY (BossID) REFERENCES Bosses(BossID),
	FOREIGN KEY (MapID) REFERENCES Maps(MapID),
	FOREIGN KEY (TimestampID) REFERENCES Timestamps(TimestampID),
	UNIQUE (BossID, MapID, TimestampID) -- Ensure uniqueness by BossID, MapID, and TimestampID
	);
