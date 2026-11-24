// Free times for every open day (Joel, 24 Nov 2026: "i want the tables / time slots to show for every restaurant"),
// without a slot read per open day on every pass: near days each pass, far days in turns, the rest carried over.
import { describe, expect, it } from 'vitest';
import { CENSUS_DAYS, readRestaurant, TIMES_DAYS, TIMES_FAR_PER_PASS } from '../src/server/census.js';
import type { DayStateRow, RestaurantRow } from '../src/server/db.js';
import type { Platform } from '../src/server/platforms/types.js';
import { addDays } from '../src/server/time.js';

const today = '2026-11-24';
const r = { id: 'x', platformUid: 'u' } as RestaurantRow;

function fake(open: (d: string) => boolean) {
  const reads: string[] = [];
  const platform = {
    calendar: async (_r: RestaurantRow, dates: string[]) => new Map(dates.map((d) => [d, open(d) ? 'open' : 'full'] as const)),
    getSlots: async (_r: RestaurantRow, date: string) => (reads.push(date), [{ time: '19:00', open: true }, { time: '21:00', open: false }]),
  } as unknown as Platform;
  return { platform, reads };
}

describe('census free times', () => {
  it('reads the near days every pass and only TIMES_FAR_PER_PASS far days', async () => {
    const { platform, reads } = fake(() => true);
    const rows = await readRestaurant(platform, r, today);
    expect(reads.length).toBe(TIMES_DAYS + TIMES_FAR_PER_PASS);
    for (let i = 0; i < TIMES_DAYS; i++) expect(reads).toContain(addDays(today, i));
    expect(rows.find((x) => x.date === today)!.times).toEqual(['19:00']);
  });

  it('carries over far times it did not read, and reads the longest unread first', async () => {
    const { platform, reads } = fake(() => true);
    const before: DayStateRow[] = [];
    for (let i = TIMES_DAYS; i < CENSUS_DAYS; i++) {
      const date = addDays(today, i);
      // Day 10 was read longest ago; day 5 never.
      before.push({ date, state: 'open', times: i === 5 ? null : ['18:00'], timesAt: i === 10 ? '2026-11-24T06:00:00Z' : '2026-11-24T09:00:00Z' });
    }
    const rows = await readRestaurant(platform, r, today, before);
    expect(reads).toContain(addDays(today, 5));
    expect(reads).toContain(addDays(today, 10));
    expect(reads).not.toContain(addDays(today, 40 + TIMES_FAR_PER_PASS)); // read recently, not due
    const kept = rows.find((x) => x.date === addDays(today, 40))!;
    if (!reads.includes(kept.date)) expect(kept).toMatchObject({ times: ['18:00'], timesAt: '2026-11-24T09:00:00Z' });
  });

  it('reaches every open day on the map within a bounded number of passes', async () => {
    const { platform, reads } = fake((d) => d.endsWith('5') || d.endsWith('7') || d.endsWith('8') || d >= addDays(today, 50));
    let before: DayStateRow[] = [];
    let n = 0;
    for (; n < 20; n++) {
      before = (await readRestaurant(platform, r, today, before)).map((x) => (reads.includes(x.date) && !x.timesAt ? { ...x, timesAt: `2026-11-24T10:${String(n).padStart(2, '0')}:00Z` } : x));
      const open = before.filter((x) => x.state === 'open' && x.date <= addDays(today, CENSUS_DAYS - 1));
      if (open.every((x) => x.times)) break;
    }
    expect(n).toBeLessThan(Math.ceil(CENSUS_DAYS / TIMES_FAR_PER_PASS));
    // A full day never gets a slot read, and days past the map are never read.
    expect(reads.every((d) => d <= addDays(today, CENSUS_DAYS - 1))).toBe(true);
  });

  it('drops carried times once the calendar says the day is no longer open', async () => {
    const { platform } = fake((d) => d !== addDays(today, 20));
    const rows = await readRestaurant(platform, r, today, [{ date: addDays(today, 20), state: 'open', times: ['18:00'], timesAt: '2026-11-24T09:00:00Z' }]);
    expect(rows.find((x) => x.date === addDays(today, 20))!.times).toBeNull();
  });
});
