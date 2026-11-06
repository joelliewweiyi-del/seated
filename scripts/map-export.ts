// Writes the public map's data.json from a Seated database, for a static host.
//   npm run map:export -- [data/seated.db] [dist/map/data.json]
// Reads only: restaurant facts and calendar states. No request goes to any booking system.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Store } from '../src/server/db.js';
import { buildMapData, loadGuides, loadOptOut, loadPlaces } from '../src/server/mapData.js';
import { createPlatforms } from '../src/server/platforms/index.js';

const [dbPath = process.env.SEATED_DB || 'data/seated.db', out = 'dist/map/data.json'] = process.argv.slice(2);
const data = buildMapData({ store: new Store(dbPath), platforms: createPlatforms(), places: loadPlaces(), optOut: loadOptOut(), guides: loadGuides() });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(data));
const open = data.restaurants.filter((r) => r.d[0] === 'o').length;
console.log(`[map] ${data.restaurants.length} restaurants (${open} with a table today) -> ${out}`);
