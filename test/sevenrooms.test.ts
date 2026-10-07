import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findSevenroomsSlug, sevenrooms, toSlots } from '../src/server/platforms/sevenrooms';
import type { Restaurant } from '../src/server/platforms/types';

// Recorded from Troef (Amsterdam), Fri 9 to Sun 11 Oct 2026, party of 2. Tests never call SevenRooms.
const RANGE = JSON.parse(readFileSync(new URL('./fixtures/sevenrooms-range.json', import.meta.url), 'utf8'));

const troef: Restaurant = {
  id: 'troef',
  name: 'Troef',
  platform: 'sevenrooms',
  platformUid: 'troef',
  website: 'https://troefamsterdam.nl',
  city: 'Amsterdam',
  address: null,
};

function fakeFetch(answer: () => Response) {
  const urls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    urls.push(String(input));
    return answer();
  }) as typeof fetch;
  return { impl, urls };
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

describe('SevenRooms slots', () => {
  it('counts only "book" times as tables: a "request" time is asking, not a table', () => {
    const sat = toSlots('2026-10-10', RANGE.data.availability['2026-10-10']);
    expect(sat.filter((s) => s.open).map((s) => s.time)).toEqual(['17:30', '17:45', '21:30']);
    expect(sat.find((s) => s.time === '12:00')).toMatchObject({ open: false }); // lunch is request-only
    expect(sat.every((s) => !s.autoBookable)).toBe(true); // Seated never books on SevenRooms
  });

  it('lists a time once even when the venue shows it per seating area', () => {
    const shifts = [
      { times: [{ type: 'request', time: '19:00' }] },
      { times: [{ type: 'book', time: '19:00' }] },
    ];
    expect(toSlots('2026-10-09', shifts)).toEqual([{ date: '2026-10-09', time: '19:00', open: true, autoBookable: false }]);
  });

  it('treats a closed shift as no tables, whatever its times say', () => {
    const shifts = [{ is_closed: true, times: [{ type: 'book', time: '19:00' }] }];
    expect(toSlots('2026-10-09', shifts)[0]!.open).toBe(false);
  });
});

describe('SevenRooms reads', () => {
  it('reads a Friday and Saturday in one request, and the day reads reuse it', async () => {
    const { impl, urls } = fakeFetch(() => json(RANGE));
    const platform = sevenrooms({ fetchImpl: impl, gapMs: 0 });
    const worth = await platform.openDates!(troef, ['2026-10-09', '2026-10-10'], 2);
    expect([...worth]).toEqual(['2026-10-09', '2026-10-10']);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('start_date=10-09-2026'); // the widget wants MM-DD-YYYY
    expect(urls[0]).toContain('num_days=2');

    const sat = await platform.getSlots(troef, '2026-10-10', 2);
    expect(sat.filter((s) => s.open)).toHaveLength(3);
    expect(urls).toHaveLength(1); // no second request
  });

  it('throws on an HTTP error, so the radar treats the days as unknown, not fully booked', async () => {
    const { impl } = fakeFetch(() => json({ msg: 'nope' }, 503));
    await expect(sevenrooms({ fetchImpl: impl, gapMs: 0 }).getSlots(troef, '2026-10-09', 2)).rejects.toThrow(/503/);
  });

  it('opens the booking page on the right date, party size and time', () => {
    const url = sevenrooms().bookingUrl(troef, '2026-10-10', '21:30', 2);
    expect(url).toBe('https://www.sevenrooms.com/explore/troef/reservations/create/search/?date=2026-10-10&party_size=2&start_time=21%3A30');
    expect(sevenrooms().book).toBeUndefined();
  });

  it('finds the venue slug on a restaurant website', () => {
    expect(findSevenroomsSlug('<a href="https://www.sevenrooms.com/reservations/troef">Reserve</a>')).toBe('troef');
    expect(findSevenroomsSlug('<a href="https://www.sevenrooms.com/explore/restaurantflore/reservations/create">x</a>')).toBe('restaurantflore');
  });
});
