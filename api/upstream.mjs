// Official JSON API documented at https://tarkov.dev/api.
// Join and localization follow the-hideout/tarkov-dev's do-fetch-maps.mjs.
export const upstreamSource = Object.freeze({
  gameMode: 'regular',
  maps: 'https://json.tarkov.dev/regular/maps',
  english: 'https://json.tarkov.dev/regular/maps_en',
});

function dictionary(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid upstream ${label}`);
  return value;
}

export function normalizeMaps(payload, localization) {
  const data = dictionary(payload?.data, 'data');
  const maps = Object.values(dictionary(data.maps, 'maps'));
  const mobs = dictionary(data.mobs, 'mobs');
  const english = dictionary(localization?.data, 'English translations');
  if (maps.length === 0) throw new Error('Upstream maps is empty');
  const name = key => {
    const translated = english[key];
    if (typeof translated !== 'string' || !translated.trim()) throw new Error(`Missing upstream English name: ${key}`);
    return translated;
  };
  return { maps: maps.map(map => {
    if (!Array.isArray(map?.bosses)) throw new Error('Invalid upstream map bosses');
    return {
      name: name(map.name),
      bosses: map.bosses.map(spawn => {
        const mob = mobs[spawn?.mob];
        if (!mob) throw new Error(`Missing upstream mob: ${spawn?.mob}`);
        if (typeof spawn.spawnChance !== 'number' || !Number.isFinite(spawn.spawnChance) || spawn.spawnChance < 0 || spawn.spawnChance > 1) {
          throw new Error(`Invalid upstream spawn chance: ${spawn?.mob}`);
        }
        // Preserve source fractions and duplicate spawn order. The existing
        // storage routine retains the first boss/map entry, as it did for GraphQL.
        return { name: name(mob.name), spawnChance: spawn.spawnChance };
      }),
    };
  }) };
}

export async function fetchMaps({ fetchImpl = fetch, timeoutMs = 30000 } = {}) {
  // A shared deadline includes both response bodies and JSON parsing.
  const signal = AbortSignal.timeout(timeoutMs);
  async function read(url) {
    const response = await fetchImpl(url, { signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Upstream HTTP ${response.status}: ${url}`);
    return response.json();
  }
  const [maps, english] = await Promise.all([read(upstreamSource.maps), read(upstreamSource.english)]);
  return normalizeMaps(maps, english);
}
