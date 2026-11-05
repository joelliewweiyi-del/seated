import { describe, expect, it } from 'vitest';
import { frank } from '../src/server/platforms/frank';
import type { Restaurant } from '../src/server/platforms/types';

const sinne: Restaurant = {
  id: 'sinne',
  name: 'Sinne',
  platform: 'frank',
  platformUid: 'a28bb7d4-bddc-4d92-9d97-624c72a88bdb',
  website: 'https://restaurantsinne.nl',
  city: 'Amsterdam',
  address: null,
};

/** A fake fetch that answers by URL pattern and records every call with its headers. */
function fakeFetch(routes: Array<[RegExp, () => Response]>) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const route = routes.find(([re]) => re.test(url));
    if (!route) throw new Error(`unexpected request ${url}`);
    return route[1]();
  }) as typeof fetch;
  return { impl, calls };
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
// Shapes copied from real answers for Sinne (5 Nov 2026).
const day = (date: string, status: string) => ({ date_time: `${date}T00:00:00Z`, status, message: null });
const slot = (date: string, time: string, status: string) => ({ date_time: `${date}T${time}:00+01:00`, number_of_people: 2, status });

describe('Frank', () => {
  it('reads the month calendar: available is open, waitlist is full, unavailable is no table; other days stay unknown', async () => {
    const { impl, calls } = fakeFetch([
      [/time-slots\/month\?month=11&number_of_people=2&year=2026$/, () => json({ data: [day('2026-11-05', 'available'), day('2026-11-06', 'waitlist'), day('2026-11-07', 'unavailable'), day('2026-11-08', 'something-new')] })],
      [/time-slots\/month\?month=12&number_of_people=2&year=2026$/, () => json({ data: [day('2026-12-01', 'available')] })],
    ]);
    const days = await frank({ fetchImpl: impl, gapMs: 0 }).calendar!(sinne, ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-12-01'], 2);
    expect(Object.fromEntries(days)).toEqual({ '2026-11-05': 'open', '2026-11-06': 'full', '2026-11-07': 'none', '2026-12-01': 'open' });
    expect(calls).toHaveLength(2); // one request per month
    expect(calls[0]!.headers['Accept-Language']).toBe('en'); // the API refuses a request without it
  });

  it('pre-checks only available days, and reads a day the month left out rather than calling it full', async () => {
    const { impl } = fakeFetch([[/time-slots\/month/, () => json({ data: [day('2026-11-05', 'available'), day('2026-11-06', 'waitlist'), day('2026-11-07', 'unavailable')] })]]);
    const worth = await frank({ fetchImpl: impl, gapMs: 0 }).openDates!(sinne, ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'], 2);
    expect([...worth].sort()).toEqual(['2026-11-05', '2026-11-08']);
  });

  it('gives restaurant-local times, and only an available time is a table', async () => {
    const { impl } = fakeFetch([
      [/time-slots\/day\?date=2026-11-07&number_of_people=2$/, () => json({ data: [slot('2026-11-07', '18:00', 'waitlist'), slot('2026-11-07', '19:15', 'available')] })],
    ]);
    const slots = await frank({ fetchImpl: impl, gapMs: 0 }).getSlots(sinne, '2026-11-07', 2);
    expect(slots).toEqual([
      { date: '2026-11-07', time: '18:00', open: false, autoBookable: false },
      { date: '2026-11-07', time: '19:15', open: true, autoBookable: false },
    ]);
  });

  it('throws on an error or an unexpected answer: an empty list must mean "no tables", never "failed"', async () => {
    const down = fakeFetch([[/./, () => json({ error: 'The Accept-Language header is required.' }, 400)]]);
    await expect(frank({ fetchImpl: down.impl, gapMs: 0 }).getSlots(sinne, '2026-11-07', 2)).rejects.toThrow(/Frank 400/);
    const odd = fakeFetch([[/./, () => json({ error: 'nope' })]]);
    await expect(frank({ fetchImpl: odd.impl, gapMs: 0 }).calendar!(sinne, ['2026-11-07'], 2)).rejects.toThrow(/unexpected shape/);
  });

  it('links to the plain widget, and has no booking call', () => {
    const p = frank();
    expect(p.bookingUrl(sinne, '2026-11-07', '19:15', 2)).toBe('https://widget.workspace.meetfrank.app/a28bb7d4-bddc-4d92-9d97-624c72a88bdb/open?lang=en');
    expect(p.book).toBeUndefined();
  });
});
