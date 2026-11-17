import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Store } from '../src/server/db';
import { CENSUS_DAYS, runCensus } from '../src/server/census';
import { buildMapData, dayCodes, loadPlaces, MICHELIN_LENS, MIN_GUIDE_PICKS, type Place } from '../src/server/mapData';
import type { DayState, Platform, Restaurant } from '../src/server/platforms/types';
import { addDays } from '../src/server/time';
import { statusOf, STATUS_WORD } from '../src/map/data';
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
    const days = Array.from({ length: 63 }, (_, i) => addDays('2026-11-15', i));
    const { codes, lastBookable } = dayCodes(new Map<string, DayState>(days.map((d) => [d, 'none'])), days);
    expect(codes.join('')).toBe('?'.repeat(63));
    expect(lastBookable).toBeNull();
  });

  it("infers Graham's Sunday and Monday days off over nine weeks", () => {
    const days = Array.from({ length: 63 }, (_, i) => addDays('2026-11-15', i));
    const states = new Map<string, DayState>(days.map((d, i) => [d, i % 7 < 2 ? 'none' : 'open']));
    expect(dayCodes(states, days).codes.join('')).toBe('ccooooo'.repeat(9));
  });

  it('keeps a weekday with three none days and one full day as mixed availability', () => {
    const days = Array.from({ length: 28 }, (_, i) => addDays('2026-11-15', i));
    const states = new Map<string, DayState>(days.map((d, i) => [d, i % 7 === 0 ? (i === 21 ? 'full' : 'none') : 'open']));
    const { codes } = dayCodes(states, days);
    expect(codes.join('')).toBe('noooooo'.repeat(3) + 'foooooo');
    expect([0, 7, 14, 21].map((i) => statusOf(codes[i]))).toEqual(['none', 'none', 'none', 'full']);
  });

  it('keeps a weekday seen only twice as none, even with unanswered weeks', () => {
    const days = Array.from({ length: 28 }, (_, i) => addDays('2026-11-15', i));
    const states = new Map<string, DayState>(days.flatMap((d, i): [string, DayState][] =>
      i % 7 === 0 ? (i < 14 ? [[d, 'none']] : []) : [[d, 'open']]));
    const { codes } = dayCodes(states, days);
    expect(codes.join('')).toBe('noooooo'.repeat(2) + '?oooooo'.repeat(2));
    expect([0, 7, 14, 21].map((i) => statusOf(codes[i]))).toEqual(['none', 'none', 'unknown', 'unknown']);
  });

  it('marks days after the last bookable day later after inferring days off', () => {
    const days = Array.from({ length: 35 }, (_, i) => addDays('2026-11-15', i));
    const states = new Map<string, DayState>(days.map((d, i) => [d, i >= 21 || i % 7 < 2 ? 'none' : 'open']));
    const { codes, lastBookable } = dayCodes(states, days);
    expect(codes.join('')).toBe('ccooooo'.repeat(3) + 'l'.repeat(14));
    expect(lastBookable).toBe(days[20]);
  });

  it("with known opening days, a no-tables day is full when the place opens and closed when it does not (KID and BAK, 17 Nov 2026)", () => {
    // 2026-11-15 is a Sunday. Open Wednesday to Sunday; Tebi says Unavailable on Mondays and Tuesdays, and on one sold-out Friday.
    const days = Array.from({ length: 14 }, (_, i) => addDays('2026-11-15', i));
    const states = new Map<string, DayState>(days.map((d, i) => [d, i % 7 === 1 || i % 7 === 2 || i === 5 ? 'none' : 'open']));
    const open = [0, 3, 4, 5, 6];
    expect(dayCodes(states, days, open).codes.join('')).toBe('occoofo' + 'occoooo');
    // Without opening days the sold-out Friday stays 'no tables online' (two closed weekdays still need three weeks).
    expect(dayCodes(states, days).codes.join('')).toBe('onnoono' + 'onnoooo');
  });

  it('opening days never turn an open, full or closed answer, an unknown day, or a day after the last bookable one', () => {
    const days = Array.from({ length: 7 }, (_, i) => addDays('2026-11-15', i));
    const states = new Map<string, DayState>([[days[0]!, 'open'], [days[1]!, 'closed'], [days[2]!, 'full'], [days[4]!, 'none'], [days[5]!, 'none']]);
    // Open every day per the hours: the none day before the last bookable one is full; after it they stay later.
    states.set(days[3]!, 'open');
    expect(dayCodes(states, days, [0, 1, 2, 3, 4, 5, 6]).codes.join('')).toBe('ocfoll?');
  });

  it('labels none as No tables online instead of Fully booked', () => {
    expect(statusOf('n')).toBe('none');
    expect(STATUS_WORD[statusOf('n')]).toBe('No tables online');
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

  it('shows unknown once the last good read is over six hours old: failing reads never leave days-old tables (Guestplan, Nov 2026)', async () => {
    const s = setup({ 'bistro-a': { [TODAY]: 'open', [addDays(TODAY, 1)]: 'open' } });
    await runCensus({ store: s.store, platforms: s.platforms, optOut: new Set(), now: () => NOW });
    const at = (now: Date) => buildMapData({ store: s.store, platforms: s.platforms, places: s.places, optOut: new Set(), now }).restaurants.find((r) => r.id === 'bistro-a')!;
    expect(at(new Date(NOW.getTime() + 2 * 3600_000)).d[0]).toBe('o'); // a blip of a few hours: still the last answer
    const failing = fakePlatform({}, { fail: new Set(['bistro-a']) });
    const later = new Date(NOW.getTime() + 7 * 3600_000); // tomorrow 04:00 in Amsterdam: d[0] is tomorrow
    await runCensus({ store: s.store, platforms: { fake: failing.platform }, optOut: new Set(), now: () => later });
    expect(at(later).d[0]).toBe('?');
    expect(at(later).readAt).toBe(NOW.toISOString()); // the card can still say when it was last read
  });

  it('forgets days a successful read no longer answers for: they are unknown, not their old answer', async () => {
    const s = setup({ 'bistro-a': { [TODAY]: 'none', [addDays(TODAY, 1)]: 'none' } });
    await runCensus({ store: s.store, platforms: s.platforms, optOut: new Set(), now: () => NOW });
    // The calendar is switched off: the platform answers, but for no day (Formitable code 1 everywhere).
    const off = fakePlatform({ 'bistro-a': {} });
    await runCensus({ store: s.store, platforms: { fake: off.platform }, optOut: new Set(), now: () => NOW });
    const data = buildMapData({ store: s.store, platforms: s.platforms, places: s.places, optOut: new Set(), now: NOW });
    expect(data.restaurants.find((r) => r.id === 'bistro-a')!.d.slice(0, 2)).toBe('??');
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
      ['area', 'book', 'd', 'g', 'hot', 'id', 'kind', 'lat', 'link', 'lng', 'michelin', 'name', 'platform', 'readAt', 'readable', 'roof', 'site', 't', 'why', 'win'].sort(),
    );
    const phone = data.restaurants.find((r) => r.id === 'phone-e')!;
    expect(phone).toMatchObject({ readable: false, link: 'https://phone-e.example' });
    expect(phone.d).toBe('?'.repeat(CENSUS_DAYS));
  });

  it('lists a guide as a lens only with at least 3 picks on the map, and names only listed guides on a restaurant', () => {
    const s = setup({ 'bistro-a': { [TODAY]: 'open' } });
    const guide = (id: string) => ({ id, name: id, short: id, by: 'x', url: `https://${id}.example`, date: '2026-01-01', line: 'x' });
    const guides = [guide('wide'), guide('thin'), guide('none')];
    const pick = (id: string, g: string[]) => ({ ...s.places[id]!, guides: g });
    // 'wide' picks three restaurants on the map; 'thin' picks two, plus Esra, who is never on the map.
    const places = {
      ...s.places,
      'bistro-a': pick('bistro-a', ['wide', 'thin']),
      'wine-b': pick('wine-b', ['wide', 'thin']),
      'phone-e': pick('phone-e', ['wide']),
      esra: pick('esra', ['thin']),
    };
    const data = buildMapData({ store: s.store, platforms: s.platforms, places, optOut: new Set(), guides, now: NOW });
    expect(MIN_GUIDE_PICKS).toBe(3);
    expect(data.guides.map((g) => g.id)).toEqual(['wide']);
    expect(data.restaurants.find((r) => r.id === 'bistro-a')!.g).toEqual(['wide']);
    expect(data.restaurants.find((r) => r.id === 'phone-e')!.g).toEqual(['wide']);
    expect(data.restaurants.find((r) => r.id === 'quiet-c')!.g).toEqual([]);
  });

  it("a critic's notes reach data.json only for restaurants on the map, and never for Esra", () => {
    const s = setup({});
    const ids = Object.keys(s.places);
    const places = Object.fromEntries(ids.map((id) => [id, { ...s.places[id]!, guides: ['critic'] }]));
    const note = { score: '9', year: '2026', url: 'https://example.com/review' };
    const notes = Object.fromEntries([...ids, 'esra', 'not-on-map'].map((id) => [id, note]));
    const critic = { id: 'critic', name: 'A critic', short: 'Critic', by: 'A paper', url: 'https://example.com', date: '2026-11-15', line: 'One line of our own words.', notes };
    const data = buildMapData({ store: s.store, platforms: s.platforms, places, optOut: new Set(['esra']), guides: [critic], now: NOW });
    expect(Object.keys(data.guides[0]!.notes!).sort()).toEqual(data.restaurants.map((r) => r.id).sort());
    expect(data.guides[0]!.notes).not.toHaveProperty('esra');
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

describe('guides', () => {
  // Joel, 6 Nov 2026: guides as lenses. Kept in their own file, like MICHELIN, so placing restaurants again never drops a pick.
  it('reach the map: each pick carries its guide, and Esra is never a pick', () => {
    const file = JSON.parse(readFileSync('data/map-guides.json', 'utf8')) as { guides: Array<{ id: string }>; picks: Record<string, string[]> };
    const places = loadPlaces();
    for (const [guideId, ids] of Object.entries(file.picks)) {
      expect(file.guides.some((g) => g.id === guideId), `${guideId} has no guide entry`).toBe(true);
      for (const id of ids) {
        expect(places[id], `${guideId} picks ${id}, which has no place`).toBeDefined();
        expect(places[id]!.guides).toContain(guideId);
      }
    }
    expect(Object.values(file.picks).flat()).not.toContain('esra');
  });

  it('the MICHELIN lens picks exactly the restaurants in data/map-michelin.json, and has a guide entry', () => {
    const file = JSON.parse(readFileSync('data/map-guides.json', 'utf8')) as { guides: Array<{ id: string }> };
    const michelin = JSON.parse(readFileSync('data/map-michelin.json', 'utf8')) as { restaurants: Record<string, unknown> };
    const places = loadPlaces();
    expect(file.guides.some((g) => g.id === MICHELIN_LENS)).toBe(true);
    const picked = Object.keys(places).filter((id) => places[id]!.guides?.includes(MICHELIN_LENS)).sort();
    expect(picked).toEqual(Object.keys(michelin.restaurants).filter((id) => places[id]).sort());
    expect(picked.length).toBeGreaterThanOrEqual(MIN_GUIDE_PICKS);
    for (const id of picked) expect(places[id]!.michelin, id).toBeTruthy();
  });

  it("Seated curated holds every pick of Mara Grimm's list, and her list comes first in the picker (Joel, 17 Nov 2026)", () => {
    const file = JSON.parse(readFileSync('data/map-guides.json', 'utf8')) as { guides: Array<{ id: string }>; picks: Record<string, string[]> };
    const curated = new Set(file.picks['seated']);
    expect(file.picks['mara-grimm']!.filter((id) => !curated.has(id))).toEqual([]);
    expect(file.guides[0]!.id).toBe('mara-grimm');
    const optOut = new Set((JSON.parse(readFileSync('data/map-optout.json', 'utf8')) as Array<{ id: string }>).map((x) => x.id));
    expect(file.picks['mara-grimm']!.filter((id) => optOut.has(id))).toEqual([]);
  });

  it('opening days in data/map-hours.json name real places with weekday codes, each with its source, and never Esra', () => {
    const file = JSON.parse(readFileSync('data/map-hours.json', 'utf8')) as { restaurants: Record<string, { open: string[]; from: string }> };
    const places = loadPlaces();
    for (const [id, h] of Object.entries(file.restaurants)) {
      expect(places[id], id).toBeDefined();
      expect(h.open.length, id).toBeGreaterThan(0);
      for (const d of h.open) expect(['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'], id).toContain(d);
      expect(h.from, id).toMatch(/^(osm:(node|way)\/\d+|https?:\/\/)/);
      expect(places[id]!.openDays!.length).toBe(h.open.length);
    }
    expect(Object.keys(file.restaurants)).not.toContain('esra');
  });

  it('each guide has a short name for the picker and one line of our own, never its own title', () => {
    const file = JSON.parse(readFileSync('data/map-guides.json', 'utf8')) as { guides: Array<{ id: string; name: string; short: string; line: string; url: string }> };
    expect(new Set(file.guides.map((g) => g.id)).size).toBe(file.guides.length);
    for (const g of file.guides) {
      expect(g.short.length, g.id).toBeGreaterThan(0);
      expect(g.short.length, g.id).toBeLessThanOrEqual(16);
      expect(g.line.length, g.id).toBeGreaterThan(10);
      expect(g.line.length, g.id).toBeLessThanOrEqual(100);
      expect(g.line.toLowerCase(), g.id).not.toContain(g.name.toLowerCase());
      expect(g.url, g.id).toMatch(/^https:\/\//);
    }
  });
});
