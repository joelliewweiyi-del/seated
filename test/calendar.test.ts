// The public map's day states, per booking system. Answers are shaped like the real ones read on 4 Nov 2026.
// Tests never call a booking system.
import { describe, expect, it } from 'vitest';
import { formitable } from '../src/server/platforms/formitable';
import { guestplan } from '../src/server/platforms/guestplan';
import { sevenrooms } from '../src/server/platforms/sevenrooms';
import { tebi } from '../src/server/platforms/tebi';
import { zenchef, zenchefDayState } from '../src/server/platforms/zenchef';
import type { Restaurant } from '../src/server/platforms/types';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

function fakeFetch(routes: Array<[RegExp, (url: string) => Response]>) {
  const urls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    const route = routes.find(([re]) => re.test(url));
    if (!route) throw new Error(`unexpected request ${url}`);
    return route[1](url);
  }) as typeof fetch;
  return { impl, urls };
}

const r = (platform: string, platformUid: string): Restaurant => ({
  id: 'x',
  name: 'X',
  platform,
  platformUid,
  website: 'https://example.com',
  city: 'Amsterdam',
  address: null,
});

describe('Tebi calendar', () => {
  it('maps Available to open, Waitlist to full, and Unavailable to none (closed and sold out look the same)', async () => {
    const { impl, urls } = fakeFetch([
      [
        /reservation-months\/2026-12/,
        () =>
          json([
            { date: '2026-12-30T00:00:00', availability: 'Available' },
            { date: '2026-12-31T00:00:00', availability: 'Unavailable' },
            { date: '2026-12-29T00:00:00', availability: 'Waitlist' },
            { date: '2026-12-28T00:00:00', availability: 'Something new' },
          ]),
      ],
      [/reservation-months\/2027-01/, () => json([{ date: '2027-01-01', availability: 'Unavailable' }])],
    ]);
    const days = await tebi({ fetchImpl: impl, gapMs: 0 }).calendar!(
      r('tebi', '1_aaaaaaaaaaaaaaaaaaaaaaaa'),
      ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01'],
      2,
    );
    expect(Object.fromEntries(days)).toEqual({
      '2026-12-29': 'full',
      '2026-12-30': 'open',
      '2026-12-31': 'none',
      '2027-01-01': 'none',
    });
    expect(urls).toHaveLength(2); // one call per month
  });
});

describe('Formitable calendar', () => {
  it('maps code 0 to open and the known empty codes to none; past and unknown codes stay unknown', async () => {
    const { impl } = fakeFetch([
      [/\/status$/, () => json({ zenchefId: null })],
      [
        /monthWeeks\/12\/2026\/2\/en$/,
        () =>
          json([
            { dayString: '2026-12-30', status: 0 },
            { dayString: '2026-12-31', status: 1 },
            { dayString: '2026-12-29', status: 6 },
            { dayString: '2026-12-28', status: 2 },
            { dayString: '2026-12-27', status: 4 },
          ]),
      ],
    ]);
    const days = await formitable({ fetchImpl: impl, gapMs: 0 }).calendar!(
      r('formitable', 'abcd1234'),
      ['2026-12-27', '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31'],
      2,
    );
    expect(Object.fromEntries(days)).toEqual({ '2026-12-29': 'none', '2026-12-30': 'open', '2026-12-31': 'none' });
  });

  it('refuses a restaurant that moved to Zenchef, so a frozen calendar never shows as open', async () => {
    const { impl } = fakeFetch([
      [/\/status$/, () => json({ zenchefId: 387672 })],
      [/monthWeeks/, () => json([{ dayString: '2026-12-31', status: 0 }])],
    ]);
    await expect(formitable({ fetchImpl: impl, gapMs: 0 }).calendar!(r('formitable', 'abcd1234'), ['2026-12-31'], 2)).rejects.toThrow(
      /Zenchef/,
    );
  });
});

describe('Zenchef calendar', () => {
  it('tells closed (no shift or all shifts closed), full (no room for the party) and open apart', () => {
    expect(zenchefDayState([], 2)).toBe('closed');
    expect(zenchefDayState([{ closed: true, possible_guests: [2] }], 2)).toBe('closed');
    expect(zenchefDayState([{ possible_guests: [] }], 2)).toBe('full'); // Goudfazant on 31 Dec 2026
    expect(zenchefDayState([{ possible_guests: [4, 6] }], 2)).toBe('full');
    expect(zenchefDayState([{ marked_as_full: true, possible_guests: [2] }], 2)).toBe('full');
    expect(zenchefDayState([{ possible_guests: [] }, { possible_guests: [1, 2] }], 2)).toBe('open');
  });

  it('asks one summary per calendar month, because a three-month range answers an error', async () => {
    const { impl, urls } = fakeFetch([
      [
        /getAvailabilitiesSummary/,
        (url) => {
          const begin = new URL(url).searchParams.get('date_begin')!;
          return json(
            begin.startsWith('2026-12')
              ? [{ date: '2026-12-31', shifts: [{ closed: true }] }, { date: '2026-12-30', shifts: [{ possible_guests: [2] }] }]
              : [{ date: '2027-01-02', shifts: [] }],
          );
        },
      ],
    ]);
    const days = await zenchef({ fetchImpl: impl, gapMs: 0 }).calendar!(r('zenchef', '123'), ['2026-12-30', '2026-12-31', '2027-01-02'], 2);
    expect(Object.fromEntries(days)).toEqual({ '2026-12-30': 'open', '2026-12-31': 'closed', '2027-01-02': 'closed' });
    expect(urls.map((u) => new URL(u).searchParams.get('date_begin'))).toEqual(['2026-12-30', '2027-01-02']);
    expect(urls.map((u) => new URL(u).searchParams.get('date_end'))).toEqual(['2026-12-31', '2027-01-02']);
  });
});

describe('Guestplan calendar', () => {
  it('a day not open online is closed; open online with a table is open; open online without one is full', async () => {
    const { impl } = fakeFetch([
      [
        /getAvailability/,
        () =>
          json({
            drs: [
              { d: '20261231' }, // Choux and Blauw on 31 Dec 2026
              { d: '20261219', do: true, a: true },
              { d: '20261220', do: true },
            ],
          }),
      ],
    ]);
    const days = await guestplan({ fetchImpl: impl, gapMs: 0 }).calendar!(
      r('guestplan', `${'a'.repeat(40)}:1`),
      ['2026-12-19', '2026-12-20', '2026-12-31', '2027-01-15'],
      2,
    );
    expect(Object.fromEntries(days)).toEqual({ '2026-12-19': 'open', '2026-12-20': 'full', '2026-12-31': 'closed' });
  });
});

describe('SevenRooms calendar', () => {
  const shift = (type: string, closed = false) => [{ is_closed: closed, times: [{ type, time: '19:00' }] }];

  it('a "book" time is open, only "request" times is full, no times is closed; reads at most three weeks', async () => {
    const { impl, urls } = fakeFetch([
      [
        /widget\/range/,
        () =>
          json({
            data: {
              availability: {
                '2026-12-29': shift('book'),
                '2026-12-30': shift('book', true),
                '2026-12-31': shift('request'), // Troef on 31 Dec 2026
              },
            },
          }),
      ],
    ]);
    const dates = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 11, 29 + i)).toISOString().slice(0, 10));
    const days = await sevenrooms({ fetchImpl: impl, gapMs: 0 }).calendar!(r('sevenrooms', 'troef'), dates, 2);
    expect(days.get('2026-12-29')).toBe('open');
    expect(days.get('2026-12-30')).toBe('full'); // a closed shift lists its times, none of them a table
    expect(days.get('2026-12-31')).toBe('full');
    expect(days.get('2027-01-01')).toBe('closed'); // missing from the answer
    expect(days.size).toBe(21);
    expect(urls).toHaveLength(7);
  });
});
