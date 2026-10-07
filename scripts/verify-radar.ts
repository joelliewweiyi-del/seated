// Checks the radar against the booking systems themselves.
//   npx tsx scripts/verify-radar.ts [data/seated.db]
// For every active watch, reads the restaurant directly (not through the radar) and compares the matching
// open tables with the radar's open tables. A table that opened or closed between the radar's last check
// and this read shows up as a difference, so expect a few; many differences mean a bug.
// Skips Esra (see CLAUDE.md). Read-only: never writes to the database.
import { DatabaseSync } from 'node:sqlite';
import { createPlatforms } from '../src/server/platforms/index.js';
import type { Platform, Restaurant } from '../src/server/platforms/types.js';
import { datesForWatch, matchingSlots } from '../src/server/match.js';
import { localDate } from '../src/server/time.js';

const db = new DatabaseSync(process.argv[2] ?? 'data/seated.db', { readOnly: true });
const platforms: Record<string, Platform> = createPlatforms();
const horizonDays = Number(process.env.HORIZON_DAYS ?? 14);
const today = localDate(new Date());

type Row = Record<string, string | number | null>;
const watches = db
  .prepare(
    `SELECT w.*, r.name, r.platform, r.platform_uid, r.website, r.last_checked_at FROM watches w
     JOIN restaurants r ON r.id = w.restaurant_id WHERE w.status = 'watching' ORDER BY r.name`,
  )
  .all() as Row[];

let differences = 0;
for (const w of watches) {
  const platform = platforms[w.platform as string];
  if (!platform || !w.platform_uid || /^esra/i.test(w.name as string)) continue;
  const restaurant: Restaurant = {
    id: w.restaurant_id as string,
    name: w.name as string,
    platform: w.platform as string,
    platformUid: w.platform_uid as string,
    website: w.website as string | null,
    city: null,
    address: null,
  };
  const watch = {
    dateFrom: w.date_from as string | null,
    dateTo: w.date_to as string | null,
    weekdays: w.weekdays ? String(w.weekdays).split(',').map(Number) : null,
    timeFrom: w.time_from as string,
    timeTo: w.time_to as string,
  };
  const dates = datesForWatch(watch, today, horizonDays);
  const worth = platform.openDates ? await platform.openDates(restaurant, dates, w.party_size as number) : new Set(dates);
  const direct = new Set<string>();
  for (const date of dates.filter((d) => worth.has(d))) {
    for (const s of matchingSlots(watch, await platform.getSlots(restaurant, date, w.party_size as number))) direct.add(`${s.date} ${s.time}`);
  }
  const radar = new Set(
    (db.prepare('SELECT date, time FROM sightings WHERE watch_id = ? AND gone_at IS NULL AND date >= ?').all(w.id, today) as Row[]).map(
      (s) => `${s.date} ${s.time}`,
    ),
  );
  const missed = [...direct].filter((k) => !radar.has(k)).sort();
  const stale = [...radar].filter((k) => !direct.has(k)).sort();
  differences += missed.length + stale.length;
  const verdict = missed.length || stale.length ? 'DIFF' : 'same';
  console.log(
    `${verdict.padEnd(4)} ${String(w.name).padEnd(20)} direct ${String(direct.size).padStart(3)} · radar ${String(radar.size).padStart(3)}` +
      (missed.length ? ` · radar misses ${missed.join(', ')}` : '') +
      (stale.length ? ` · radar still shows ${stale.join(', ')}` : ''),
  );
}
console.log(`\n${differences} difference(s). Radar checks run every ~2 min; a few differences can be real changes in between.`);
