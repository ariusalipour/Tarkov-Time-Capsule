import { D1Database } from '@cloudflare/workers-types';

export interface Env {
	DB: D1Database;
}

export interface Boss {
	name: string;
	spawnChance: number;
}

export interface Map {
	name: string;
	bosses: Boss[];
}
