// Builds the public map's data: restaurant facts and what their booking calendars say. Nothing personal goes in:
// no settings, no guest details, no watches, no bookings. test/mapData.test.ts holds that line.
import { readFileSync } from 'node:fs';
import type { Store } from './db.js';
import type { DayState, Platform } from './platforms/types.js';
import { CENSUS_DAYS, CENSUS_PARTY, censusDates } from './census.js';
import { addDays, localDate } from './time.js';

/** One character per day: open, full, closed, none (no table; closed or full, the system does not say), later, unknown. */
export type DayCode = 'o' | 'f' | 'c' | 'n' | 'l' | '?';
const CODE: Record<DayState, DayCode> = { open: 'o', full: 'f', closed: 'c', none: 'n' };

export interface Place {
  lat: number;
  lng: number;
  area: string;
  /** Picks the room drawn for the restaurant: bistro, wine, japanese, fine, cafe, greenhouse, island, brasserie, bar. */
  kind: string;
  /** Roof height in metres of the building at the address (3DBAG), so the map's sign stands on its roof. */
  roof?: number;
  /** MICHELIN Guide distinction, merged in from data/map-michelin.json (press coverage of the current edition). */
  michelin?: Michelin;
}

/** Stars or Bib Gourmand. */
export type Michelin = '3' | '2' | '1' | 'bib';

export interface MapRestaurant {
  id: string;
  name: string;
  area: string;
  lat: number;
  lng: number;
  kind: string;
  /** Roof height in metres, or null when 3DBAG has no building there. */
  roof: number | null;
  michelin: Michelin | null;
  platform: string;
  site: string | null;
  hot: number | null;
  why: string | null;
  readable: boolean;
  /** Day codes from `start`, one per day. */
  d: string;
  /** Free times for some open days. */
  t: Record<string, string[]>;
  /** Booking link per open day, pre-filled where the system allows. */
  book: Record<string, string>;
  /** The booking page without a date. */
  link: string | null;
  /** How many days ahead the calendar seems to open, from the last bookable day. Null = unknown. */
  win: number | null;
  readAt: string | null;
}

export interface MapData {
  v: 1;
  generatedAt: string;
  city: string;
  partySize: number;
  start: string;
  days: number;
  restaurants: MapRestaurant[];
}

const PLACES_URL = new URL('../../data/map-places.json', import.meta.url);
const OPTOUT_URL = new URL('../../data/map-optout.json', import.meta.url);
const MICHELIN_URL = new URL('../../data/map-michelin.json', import.meta.url);

/** data/map-places.json, with each restaurant's MICHELIN distinction from data/map-michelin.json. They are separate
 * files so that placing restaurants again never drops a distinction. */
export function loadPlaces(): Record<string, Place> {
  const places = JSON.parse(readFileSync(PLACES_URL, 'utf8')) as Record<string, Place>;
  const guide = JSON.parse(readFileSync(MICHELIN_URL, 'utf8')) as { restaurants: Record<string, { michelin: Michelin }> };
  for (const [id, { michelin }] of Object.entries(guide.restaurants)) if (places[id]) places[id].michelin = michelin;
  return places;
}

/** data/map-optout.json: restaurants that asked to be left off the map. Esra is on it from the start. */
export function loadOptOut(): Set<string> {
  const list = JSON.parse(readFileSync(OPTOUT_URL, 'utf8')) as Array<{ id: string }>;
  return new Set(list.map((x) => x.id));
}

/**
 * Turns per-day states into day codes. A calendar shows only so many days ahead: the days after the last day
 * that takes bookings (open or full) are "later" when the system answered for them with no table.
 * Days the system did not answer for stay unknown.
 */
export function dayCodes(states: Map<string, DayState>, dates: string[]): { codes: DayCode[]; lastBookable: string | null } {
  const codes = dates.map((d) => (states.has(d) ? CODE[states.get(d)!] : '?'));
  let last = -1;
  codes.forEach((c, i) => {
    if (c === 'o' || c === 'f') last = i;
  });
  // Nothing bookable at all in nine weeks: a closed season or a dead calendar. Do not guess an opening.
  if (last === -1) return { codes, lastBookable: null };
  for (let i = last + 1; i < codes.length; i++) if (codes[i] === 'n' || codes[i] === 'c') codes[i] = 'l';
  return { codes, lastBookable: dates[last]! };
}

const readDay = (at: string | null | undefined) => (at ? localDate(new Date(at)) : null);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

export interface MapDataInput {
  store: Store;
  platforms: Record<string, Platform>;
  places: Record<string, Place>;
  optOut: Set<string>;
  city?: string;
  now?: Date;
}

export function buildMapData({ store, platforms, places, optOut, city = 'Amsterdam', now = new Date() }: MapDataInput): MapData {
  const start = localDate(now);
  // Day codes are worked out over every day read (to the end of the last month), then cut to the days shown.
  const dates = censusDates(start);
  const byRestaurant = new Map<string, Map<string, { state: DayState; times: string[] | null }>>();
  for (const row of store.dayStates(CENSUS_PARTY, start)) {
    const m = byRestaurant.get(row.restaurantId) ?? new Map();
    m.set(row.date, { state: row.state, times: row.times });
    byRestaurant.set(row.restaurantId, m);
  }
  // The radar's open tables for a party of the same size are fresher than the census: they win.
  const live = new Map<string, Map<string, Set<string>>>();
  for (const w of store.listWatches('watching').filter((x) => x.partySize === CENSUS_PARTY)) {
    for (const s of store.openSightings(w.id)) {
      const m = live.get(w.restaurantId) ?? new Map<string, Set<string>>();
      m.set(s.date, (m.get(s.date) ?? new Set()).add(s.time));
      live.set(w.restaurantId, m);
    }
  }
  const reads = store.censusReads();

  const restaurants: MapRestaurant[] = [];
  for (const r of store.listRestaurants()) {
    const place = places[r.id];
    if (r.city !== city || !place || optOut.has(r.id) || /^esra/i.test(r.name)) continue;
    const platform = platforms[r.platform];
    const readable = Boolean(platform?.calendar && r.platformUid);
    const known = byRestaurant.get(r.id) ?? new Map();
    const states = new Map<string, DayState>([...known].map(([d, v]) => [d, v.state]));
    const times: Record<string, string[]> = {};
    for (const [d, v] of known) if (v.times?.length) times[d] = v.times;
    for (const [d, set] of live.get(r.id) ?? []) {
      states.set(d, 'open');
      times[d] = [...new Set([...(times[d] ?? []), ...set])].sort();
    }
    const all = dayCodes(states, dates);
    const codes = all.codes.slice(0, CENSUS_DAYS);
    const lastBookable = all.lastBookable;
    const book: Record<string, string> = {};
    if (platform && r.platformUid) {
      codes.forEach((c, i) => {
        if (c === 'o') book[dates[i]!] = platform.bookingUrl(r, dates[i]!, times[dates[i]!]?.[0] ?? '19:00', CENSUS_PARTY);
      });
    }
    restaurants.push({
      id: r.id,
      name: r.name,
      area: place.area,
      lat: place.lat,
      lng: place.lng,
      kind: place.kind,
      roof: place.roof ?? null,
      michelin: place.michelin ?? null,
      platform: platform?.label ?? r.platform,
      site: r.website,
      hot: r.hot ?? null,
      why: r.hotWhy ?? null,
      readable,
      d: codes.join(''),
      t: times,
      book,
      link: platform && r.platformUid ? platform.bookingUrl(r, start, '19:00', CENSUS_PARTY) : r.website,
      win: lastBookable ? daysBetween(readDay(reads.get(r.id)?.readAt) ?? start, lastBookable) : null,
      readAt: reads.get(r.id)?.readAt ?? null,
    });
  }
  return { v: 1, generatedAt: now.toISOString(), city, partySize: CENSUS_PARTY, start, days: CENSUS_DAYS, restaurants };
}
