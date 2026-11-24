// The census feeds the public map: a few times a day, one calendar read per restaurant for the coming weeks.
// It asks each booking system the cheapest question it answers (one call per month on most systems), and reads
// the free times of open days: the next few days on every pass, the later ones a few per pass, oldest first
// (Joel, 24 Nov 2026: "i want the tables / time slots to show for every restaurant"). The radar stays the fast path for watched tables.
import type { DayStateRow, RestaurantRow, Store } from './db.js';
import type { Platform } from './platforms/types.js';
import { addDays, localDate } from './time.js';

export const CENSUS_PARTY = 2;
/** Nine weeks: far enough to see when the calendars of most hard-to-book places open. */
export const CENSUS_DAYS = 63;
/**
 * The days asked for: the 63 the map shows, plus the rest of the last month. Month calls answer whole months at
 * no extra cost, and those extra days show whether the calendar reaches past the map's last day: without them a
 * sold-out end of the window looks like a calendar that has not opened yet (Vuurtoreneiland, 4 Nov 2026).
 */
export function censusDates(today: string): string[] {
  const last = addDays(today, CENSUS_DAYS - 1);
  const [y, m] = last.split('-').map(Number) as [number, number];
  const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // day 0 of the next month
  const dates: string[] = [];
  for (let d = today; d <= monthEnd; d = addDays(d, 1)) dates.push(d);
  return dates;
}

/** Free times of open days this close are read on every pass, one slot read each. */
export const TIMES_DAYS = 3;
/**
 * Later open days (up to the map's last day) get this many slot reads per restaurant per pass, the longest unread
 * first; the rest keep their last times. About 60 open days a restaurant: each is read again within about 2 hours,
 * at 8 extra calls per restaurant per 15-minute pass instead of 60.
 */
export const TIMES_FAR_PER_PASS = 8;
const READ_TIMEOUT_MS = 45_000;

export interface CensusOptions {
  store: Store;
  platforms: Record<string, Platform>;
  /** Restaurant ids that are never read or shown (data/map-optout.json). */
  optOut: Set<string>;
  city?: string;
  now?: () => Date;
  log?: (line: string) => void;
}

export interface CensusResult {
  restaurants: number;
  failed: number;
}

/** The restaurants the census reads: in the city, on a system with a calendar, with an id, and not opted out. */
export function censusTargets(
  restaurants: RestaurantRow[],
  platforms: Record<string, Platform>,
  optOut: Set<string>,
  city = 'Amsterdam',
): RestaurantRow[] {
  return restaurants.filter(
    (r) => r.city === city && r.platformUid && platforms[r.platform]?.calendar && !optOut.has(r.id) && !/^esra/i.test(r.name),
  );
}

function withTimeout<T>(work: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what}: no answer in ${READ_TIMEOUT_MS / 1000} s`)), READ_TIMEOUT_MS);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

/**
 * Reads one restaurant. Throws on errors; the caller keeps the last answer. `before` is what the last passes found
 * (times and when they were read), so the far days not read this pass keep their times.
 */
export async function readRestaurant(
  platform: Platform,
  r: RestaurantRow,
  today: string,
  before: DayStateRow[] = [],
): Promise<DayStateRow[]> {
  const dates = censusDates(today);
  const states = await withTimeout(platform.calendar!(r, dates, CENSUS_PARTY), 'calendar');
  const prev = new Map(before.map((b) => [b.date, b]));
  const near = addDays(today, TIMES_DAYS - 1);
  const shown = addDays(today, CENSUS_DAYS - 1);
  const open = dates.filter((d) => states.get(d) === 'open' && d <= shown);
  const far = open
    .filter((d) => d > near)
    .sort((a, b) => (prev.get(a)?.timesAt ?? '').localeCompare(prev.get(b)?.timesAt ?? '') || a.localeCompare(b))
    .slice(0, TIMES_FAR_PER_PASS);
  const toRead = new Set([...open.filter((d) => d <= near), ...far]);
  const rows: DayStateRow[] = [];
  for (const date of dates) {
    const state = states.get(date);
    if (!state) continue;
    let times: string[] | null = null;
    let timesAt: string | null = null;
    if (toRead.has(date)) {
      // A failed slot read leaves the times unknown; the day stays open, as the calendar said.
      times = await withTimeout(platform.getSlots(r, date, CENSUS_PARTY), 'slots')
        .then((slots) => slots.filter((s) => s.open).map((s) => s.time))
        .catch(() => null);
    } else if (state === 'open' && prev.get(date)?.times) {
      times = prev.get(date)!.times;
      timesAt = prev.get(date)!.timesAt ?? null;
    }
    rows.push({ date, state, times, timesAt });
  }
  return rows;
}

export async function runCensus(o: CensusOptions): Promise<CensusResult> {
  const now = o.now ?? (() => new Date());
  const today = localDate(now());
  const targets = censusTargets(o.store.listRestaurants(), o.platforms, o.optOut, o.city);
  let failed = 0;
  for (const r of targets) {
    const at = now().toISOString();
    try {
      const rows = await readRestaurant(o.platforms[r.platform]!, r, today, o.store.dayStates(CENSUS_PARTY, today, r.id));
      o.store.saveDayStates(r.id, CENSUS_PARTY, at, rows, today);
      o.store.markCensusRead(r.id, at, null);
    } catch (err) {
      failed++;
      o.store.markCensusRead(r.id, at, err instanceof Error ? err.message : String(err));
    }
  }
  o.store.forgetDayStatesBefore(today);
  o.log?.(`[census] ${targets.length} restaurants read for the map, ${failed} failed`);
  return { restaurants: targets.length, failed };
}
