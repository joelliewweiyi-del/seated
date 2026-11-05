// Runs one census now (one calendar read per Amsterdam restaurant, Esra and opted-out places skipped), then
// writes the map's data.json. The server does this by itself every MAP_CENSUS_MINUTES; this is for a first fill
// or a static host.
//   npx tsx scripts/map-census.ts [data/seated.db] [dist/map/data.json]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { runCensus } from '../src/server/census.js';
import { Store } from '../src/server/db.js';
import { buildMapData, loadOptOut, loadPlaces } from '../src/server/mapData.js';
import { createPlatforms } from '../src/server/platforms/index.js';

const [dbPath = process.env.SEATED_DB || 'data/seated.db', out = 'dist/map/data.json'] = process.argv.slice(2);
const store = new Store(dbPath);
const platforms = createPlatforms({ onUidChange: (id, uid) => store.updateRestaurantUid(id, uid) });
const optOut = loadOptOut();
const started = Date.now();
const result = await runCensus({ store, platforms, optOut, log: console.log });
const data = buildMapData({ store, platforms, places: loadPlaces(), optOut });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(data));
const failed = [...store.censusReads()].filter(([, r]) => r.error).map(([id, r]) => `${id}: ${r.error}`);
console.log(`[map] ${result.restaurants} read in ${Math.round((Date.now() - started) / 1000)} s, ${result.failed} failed -> ${out}`);
for (const f of failed) console.log(`  ${f.slice(0, 160)}`);
