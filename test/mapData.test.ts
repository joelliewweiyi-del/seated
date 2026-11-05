import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Store } from '../src/server/db';
import { CENSUS_DAYS, runCensus } from '../src/server/census';
import { buildMapData, dayCodes, loadPlaces, type Place } from '../src/server/mapData';
import type { DayState, Platform, Restaurant } from '../src/server/platforms/types';
import { addDays } from '../src/server/time';
import { censusMinutes } from '../src/server/config';

const NOW = new Date('2026-11-04T20:00:00Z'); // 21:00 in Amsterdam
const TODAY = '2026-11-04';

const restaurant = (id: string, name: string, platform = 'fake', city = 'Amsterdam'): Restaurant => ({
  id,
  name,
  platform,
  platformUid: `${id}-uid`,
  website: `https://${id}.example`,
  city,
  address: null,
});

const place: Place = { lat: 52.37, lng: 4.89, area: 'Jordaan', kind: 'bistro' };

/** A fake booking system: the calendar answers from `days`, slot reads list `times`. Never touches the network. */
function fakePlatform(days: Record<string, Record<string, DayState>>, opts: { fail?: Set<string>; times?: string[] } = {}) {
  const calls: string[] = [];
  const platform: Platform = {
    id: 'fake',
    label: 'Fake',
    async getSlots(r, date) {
      calls.push(`slots ${r.id} ${date}`);
      return (opts.times ?? ['19:00']).map((time) => ({ date, time, open: true, autoBookable: false }));
    },
    async calendar(r, dates) {
      calls.push(`calendar ${r.id}`);
      if (opts.fail?.has(r.id)) throw new Error('Fake 503');
      return new Map(dates.filter((d) => days[r.id]?.[d]).map((d) => [d, days[r.id]![d]!]));
    },
    bookingUrl: (r, date, time) => `https://book.example/${r.id}?date=${date}&time=${time}`,
  };
  return { platform, calls };
}

describe('day codes', () => {
  const dates = ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01'];

  it('calls the days after the last bookable day "later": the calendar is not open that far yet (Rijsel, 4 Nov)', () => {
    const states = new Map<string, DayState>([
      ['2026-12-28', 'open'],
      ['2026-12-29', 'none'],
      ['2026-12-30', 'full'],
      ['2026-12-31', 'none'],
      ['2027-01-01', 'closed'],
    ]);
    const { codes, lastBookable } = dayCodes(states, dates);
    expect(codes.join('')).toBe('onfll');
    expect(lastBookable).toBe('2026-12-30');
  });

  it('keeps days the system did not answer for unknown, also after the last bookable day', () => {
    const { codes } = dayCodes(new Map<string, DayState>([['2026-12-28', 'open']]), dates);
    expect(codes.join('')).toBe('o????');
  });

  it('guesses no opening when nothing in the window is bookable (a closed season, or a dead calendar)', () => {
    const { codes, lastBookable } = dayCodes(new Map<string, DayState>(dates.map((d) => [d, 'none'])), dates);
    expect(codes.join('')).toBe('nnnnn');
    expect(lastBookable).toBeNull();
  });
});

describe('census and map data', () => {
  function setup(days: Record<string, Record<string, DayState>>, opts?: Parameters<typeof fakePlatform>[1]) {
    const store = new Store(':memory:');
    store.seedRestaurants([
      restaurant('bistro-a', 'Bistro A'),
      restaurant('wine-b', 'Wine B'),
      restaurant('esra', 'Esra'),
      restaurant('quiet-c', 'Quiet C'),
      restaurant('utrecht-d', 'Utrecht D', 'fake', 'Utrecht'),
      { ...restaurant('phone-e', 'Phone E', 'other'), platformUid: null },
    ]);
    store.saveSettings({ guestFirstName: 'Joel', guestLastName: 'Secret', guestEmail: 'joel@private.example', guestPhone: '+31611112222', ntfyTopic: 'private-topic' });
    const { platform, calls } = fakePlatform(days, opts);
    const places = Object.fromEntries(['bistro-a', 'wine-b', 'esra', 'quiet-c', 'utrecht-d', 'phone-e'].map((id) => [id, place]));
    return { store, platform, calls, places, platforms: { fake: platform } };
  }

  it('reads only Amsterdam restaurants on a system with a calendar, never Esra or an opted-out one', async () => {
    const s = setup({});
    await runCensus({ store: s.store, platforms: s.platforms, optOut: new Set(['quiet-c']), now: () => NOW });
    expect(s.calls.filter((c) => c.startsWith('calendar')).sort()).toEqual(['calendar bistro-a', 'calendar wine-b']);
  });

  it('reads free times only for open days in the next three days', async () => {
    const s = setup({ 'bistro-a': { [TODAY]: 'open', [addDays(TODAY, 2)]: 'open', [addDays(TODAY, 3)]: 'open' } });
    await runCensus({ store: s.store, platforms: s.platforms, optOut: new Set(), now: () => NOW });
    expect(s.calls.filter((c) => c.startsWith('slots'))).toEqual([`slots bistro-a ${TODAY}`, `slots bistro-a ${addDays(TODAY, 2)}`]);
  });

  it('keeps the last answer when a read fails, so one blip does not empty the map', async () => {
    const s = setup({ 'bistro-a': { [TODAY]: 'open' } });
    await runCensus({ store: s.store, platforms: s.platforms, optOut: new Set(), now: () => NOW });
    const failing = fakePlatform({}, { fail: new Set(['bistro-a']) });
    await runCensus({ store: s.store, platforms: { fake: failing.platform }, optOut: new Set(), now: () => NOW });
    const data = buildMapData({ store: s.store, platforms: s.platforms, places: s.places, optOut: new Set(), now: NOW });
    expect(data.restaurants.find((r) => r.id === 'bistro-a')!.d[0]).toBe('o');
    expect(s.store.censusReads().get('bistro-a')).toMatchObject({ error: 'Fake 503' });
  });

  it('reads to the end of the last month, so a full day past the map shows the end of the map is sold out, not unopened (Vuurtoreneiland)', async () => {
    const last = addDays(TODAY, CENSUS_DAYS - 1); // 5 Jan 2027
    const s = setup({ 'bistro-a': { [TODAY]: 'open', [last]: 'none', '2027-01-20': 'full' } });
    await runCensus({ store: s.store, platforms: s.platforms, optOut: new Set(), now: () => NOW });
    const a = buildMapData({ store: s.store, platforms: s.platforms, places: s.places, optOut: new Set(), now: NOW }).restaurants.find(
      (r) => r.id === 'bistro-a',
    )!;
    expect(a.d).toHaveLength(CENSUS_DAYS);
    expect(a.d.at(-1)).toBe('n');
    expect(a.win).toBe(77); // 4 Nov to 20 Jan
  });

  it('builds one day code per day from today, with times and a booking link for open days', async () => {
    const s = setup({ 'bistro-a': { [TODAY]: 'open', [addDays(TODAY, 1)]: 'full', [addDays(TODAY, 2)]: 'none' } }, { times: ['18:00', '20:30'] });
    await runCensus({ store: s.store, platforms: s.platforms, optOut: new Set(), now: () => NOW });
    const a = buildMapData({ store: s.store, platforms: s.platforms, places: s.places, optOut: new Set(), now: NOW }).restaurants.find(
      (r) => r.id === 'bistro-a',
    )!;
    expect(a.d).toHaveLength(CENSUS_DAYS);
    expect(a.d.slice(0, 4)).toBe('ofl?');
    expect(a.t[TODAY]).toEqual(['18:00', '20:30']);
    expect(a.book[TODAY]).toBe(`https://book.example/bistro-a?date=${TODAY}&time=18:00`);
    expect(a.win).toBe(1); // last bookable day is tomorrow
  });

  it('forgets the days read on the old system when a restaurant moves to another one (The White Room, 5 Nov 2026)', async () => {
    const s = setup({ 'bistro-a': { [TODAY]: 'none', [addDays(TODAY, 1)]: 'none' } });
    await runCensus({ store: s.store, platforms: s.platforms, optOut: new Set(), now: () => NOW });
    // Moves to a system Seated cannot read: no census will ever overwrite the old days.
    s.store.seedRestaurants([{ ...restaurant('bistro-a', 'Bistro A', 'tablecheck'), platformUid: null }]);
    const a = buildMapData({ store: s.store, platforms: s.platforms, places: s.places, optOut: new Set(), now: NOW }).restaurants.find(
      (r) => r.id === 'bistro-a',
    )!;
    expect(a.d.slice(0, 2)).toBe('??');
    expect(a.readAt).toBeNull();
  });

  it('lets the radar win: a table it sees open now marks the day open, with its time', async () => {
    const s = setup({ 'wine-b': { [addDays(TODAY, 1)]: 'none' } });
    await runCensus({ store: s.store, platforms: s.platforms, optOut: new Set(), now: () => NOW });
    const w = s.store.createWatch(
      { restaurantId: 'wine-b', partySize: 2, dateFrom: null, dateTo: null, weekdays: null, timeFrom: '18:00', timeTo: '22:00', autoBook: false },
      NOW.toISOString(),
    );
    s.store.addSighting(w.id, addDays(TODAY, 1), '21:15', 'https://x', NOW.toISOString());
    const b = buildMapData({ store: s.store, platforms: s.platforms, places: s.places, optOut: new Set(), now: NOW }).restaurants.find(
      (r) => r.id === 'wine-b',
    )!;
    expect(b.d[1]).toBe('o');
    expect(b.t[addDays(TODAY, 1)]).toEqual(['21:15']);
  });

  it('holds no personal data: no guest details, topic, watches or bookings, and leaves out Esra and opted-out places', async () => {
    const s = setup({ 'bistro-a': { [TODAY]: 'open' } });
    await runCensus({ store: s.store, platforms: s.platforms, optOut: new Set(), now: () => NOW });
    const data = buildMapData({ store: s.store, platforms: s.platforms, places: s.places, optOut: new Set(['quiet-c']), now: NOW });
    const text = JSON.stringify(data);
    for (const secret of ['Secret', 'joel@private.example', '+31611112222', 'private-topic']) expect(text).not.toContain(secret);
    expect(data.restaurants.map((r) => r.id).sort()).toEqual(['bistro-a', 'phone-e', 'wine-b']);
    expect(Object.keys(data.restaurants[0]!).sort()).toEqual(
      ['area', 'book', 'd', 'hot', 'id', 'kind', 'lat', 'link', 'lng', 'michelin', 'name', 'platform', 'readAt', 'readable', 'roof', 'site', 't', 'why', 'win'].sort(),
    );
    const phone = data.restaurants.find((r) => r.id === 'phone-e')!;
    expect(phone).toMatchObject({ readable: false, link: 'https://phone-e.example' });
    expect(phone.d).toBe('?'.repeat(CENSUS_DAYS));
  });
});

describe('census interval', () => {
  it('reads each restaurant at most every 10 minutes, and 0 or junk turns the census off', () => {
    expect(censusMinutes('15')).toBe(15);
    expect(censusMinutes('3')).toBe(10);
    expect(censusMinutes('0')).toBe(0);
    expect(censusMinutes('soon')).toBe(0);
  });
});

describe('MICHELIN distinctions', () => {
  // Kept in their own file so that placing restaurants again (map-places.ts --all) never drops one.
  it('reach the map for every restaurant the guide file names, and only for those', () => {
    const guide = JSON.parse(readFileSync('data/map-michelin.json', 'utf8')) as { restaurants: Record<string, { michelin: string }> };
    const places = loadPlaces();
    for (const [id, { michelin }] of Object.entries(guide.restaurants)) {
      expect(places[id], `${id} has no place`).toBeDefined();
      expect(places[id]!.michelin).toBe(michelin);
    }
    const marked = Object.entries(places).filter(([, p]) => p.michelin).map(([id]) => id);
    expect(marked.sort()).toEqual(Object.keys(guide.restaurants).sort());
    expect(new Set(Object.values(guide.restaurants).map((r) => r.michelin))).toEqual(new Set(['2', '1', 'bib']));
  });
});
