// Checks the map against the booking systems: one fresh read per restaurant, compared day by day with the map's
// data.json, and its booking links checked for the right restaurant, date and party. One pass, one restaurant at
// a time, Esra never (hard rule 2). It never books.
//   npx tsx scripts/map-verify.ts [data.json url or path] [seated.db] [out.json]
// The map is a snapshot up to MAP_CENSUS_MINUTES old: a day that changed since is reported as "moved", and only a
// difference on a day far ahead, or the same difference again on a second read, points at a bug.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { CENSUS_PARTY, readRestaurant, TIMES_DAYS } from '../src/server/census.js';
import { Store } from '../src/server/db.js';
import type { MapData } from '../src/server/mapData.js';
import { createPlatforms } from '../src/server/platforms/index.js';
import { addDays } from '../src/server/time.js';

const [src = 'http://127.0.0.1:4310/map/data.json', dbPath = 'data/seated.db', out = 'verify.json'] = process.argv.slice(2);
const data = (src.startsWith('http') ? await (await fetch(src)).json() : JSON.parse(readFileSync(src, 'utf8'))) as MapData;
if (!existsSync(dbPath)) throw new Error(`no database at ${dbPath}`);
const store = new Store(dbPath);
const platforms = createPlatforms();
const rows = new Map(store.listRestaurants().map((r) => [r.id, r]));
const CODE: Record<string, string> = { open: 'o', full: 'f', closed: 'c', none: 'n' };

interface Result {
  id: string;
  name: string;
  platform: string;
  readAt: string | null;
  error?: string;
  /** Days where the map and the fresh read differ: date, map code, fresh code. */
  days: Array<[string, string, string]>;
  /** Next days whose free times differ: date, map times, fresh times. */
  times: Array<[string, string[], string[]]>;
  links: string[];
}

const results: Result[] = [];
for (const r of data.restaurants) {
  if (/^esra/i.test(r.name) || /^esra/i.test(r.id)) throw new Error('Esra is on the map: hard rule 2');
  const res: Result = { id: r.id, name: r.name, platform: r.platform, readAt: r.readAt, days: [], times: [], links: [] };
  results.push(res);
  // Links: every open day has one; Formitable, Zenchef and SevenRooms links carry the date and party.
  for (let i = 0; i < data.days; i++) {
    const date = addDays(data.start, i);
    if (r.d[i] !== 'o') continue;
    const url = r.book[date];
    if (!url) res.links.push(`${date}: open but no booking link`);
    else if (/formitable|zenchef|sevenrooms/.test(url) && !(url.includes(date) && /(?:partysize|pax|party_size)=2\b/.test(url)))
      res.links.push(`${date}: link lacks the date or party: ${url}`);
  }
  if (!r.readable) continue;
  const row = rows.get(r.id);
  const platform = row && platforms[row.platform];
  if (!row || !platform) {
    res.error = 'not in the database or no platform';
    continue;
  }
  try {
    const fresh = new Map((await readRestaurant(platform, row, data.start)).map((s) => [s.date, s]));
    for (let i = 0; i < data.days; i++) {
      const date = addDays(data.start, i);
      const was = r.d[i]!;
      const now = fresh.has(date) ? CODE[fresh.get(date)!.state]! : '?';
      // 'l' (later) is the map's reading of a day past the calendar's last bookable day: a fresh read calls it none,
      // closed or unknown.
      if (was !== now && !(was === 'l' && 'nc?'.includes(now))) res.days.push([date, was, now]);
    }
    for (let i = 0; i < TIMES_DAYS; i++) {
      const date = addDays(data.start, i);
      const a = r.t[date] ?? [];
      const b = fresh.get(date)?.times ?? [];
      if (a.join() !== b.join() && (a.length || b.length)) res.times.push([date, a, b]);
    }
  } catch (e) {
    res.error = (e as Error).message.slice(0, 200);
  }
  const flag = res.error ? `ERROR ${res.error}` : `${res.days.length} days, ${res.times.length} times differ`;
  console.log(`${r.id.padEnd(30)} ${r.platform.padEnd(11)} ${flag}${res.links.length ? `, ${res.links.length} link problems` : ''}`);
}
writeFileSync(out, JSON.stringify({ checkedAt: new Date().toISOString(), mapGeneratedAt: data.generatedAt, party: CENSUS_PARTY, results }, null, 1));
const bad = results.filter((x) => x.error || x.days.length || x.times.length || x.links.length);
console.log(`[verify] ${results.length} restaurants, ${bad.length} with a difference -> ${out}`);
