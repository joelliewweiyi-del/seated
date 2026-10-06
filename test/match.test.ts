import { describe, expect, it } from 'vitest';
import { datesForWatch, matchingSlots, MAX_DATES_PER_WATCH } from '../src/server/match';
import { localDate, slotLabel } from '../src/server/time';
import type { Watch } from '../src/server/db';

const watch = (over: Partial<Watch> = {}): Watch => ({
  id: 1,
  restaurantId: 'r',
  partySize: 2,
  dateFrom: null,
  dateTo: null,
  weekdays: null,
  timeFrom: '19:00',
  timeTo: '21:00',
  autoBook: false,
  status: 'watching',
  createdAt: '',
  ...over,
});

describe('which dates a watch checks', () => {
  // 2026-10-06 is a Tuesday.
  it('looks at today plus the horizon when no dates are set', () => {
    const dates = datesForWatch(watch(), '2026-10-06', 14);
    expect(dates[0]).toBe('2026-10-06');
    expect(dates).toHaveLength(14);
    expect(dates.at(-1)).toBe('2026-10-19');
  });

  it('only checks the weekdays the user picked, so "Fri and Sat" never wastes requests on Mondays', () => {
    expect(datesForWatch(watch({ weekdays: [5, 6] }), '2026-10-06', 14)).toEqual([
      '2026-10-09',
      '2026-10-10',
      '2026-10-16',
      '2026-10-17',
    ]);
  });

  it('never checks past dates, even when the watch started in the past', () => {
    expect(datesForWatch(watch({ dateFrom: '2026-10-01', dateTo: '2026-10-07' }), '2026-10-06', 14)).toEqual([
      '2026-10-06',
      '2026-10-07',
    ]);
  });

  it('checks a single evening when from and to are the same day', () => {
    expect(datesForWatch(watch({ dateFrom: '2026-12-31', dateTo: '2026-12-31' }), '2026-10-06', 14)).toEqual([
      '2026-12-31',
    ]);
  });

  it('caps a very wide watch so one watch cannot flood the platform', () => {
    const dates = datesForWatch(watch({ dateTo: '2027-06-01' }), '2026-10-06', 14);
    expect(dates).toHaveLength(MAX_DATES_PER_WATCH);
  });

  it('returns nothing for a watch whose dates are over', () => {
    expect(datesForWatch(watch({ dateFrom: '2026-09-01', dateTo: '2026-09-30' }), '2026-10-06', 14)).toEqual([]);
  });
});

describe('which slots match', () => {
  const slot = (time: string, open = true) => ({ date: '2026-10-09', time, open, autoBookable: open });

  it('includes both ends of the time window, because "19:00 to 21:00" means 21:00 is fine', () => {
    const found = matchingSlots(watch(), [slot('18:45'), slot('19:00'), slot('21:00'), slot('21:15')]);
    expect(found.map((s) => s.time)).toEqual(['19:00', '21:00']);
  });

  it('ignores slots that are full or waitlist-only', () => {
    expect(matchingSlots(watch(), [slot('19:30', false)])).toEqual([]);
  });

  it('sorts earliest first, so the push leads with the soonest table', () => {
    const found = matchingSlots(watch(), [slot('20:30'), slot('19:15')]);
    expect(found.map((s) => s.time)).toEqual(['19:15', '20:30']);
  });
});

describe('Amsterdam dates', () => {
  it('gives the local date, not the UTC date, for a slot just after midnight', () => {
    // 22:30 UTC on 9 Oct is 00:30 on 10 Oct in Amsterdam (summer time).
    expect(localDate(new Date('2026-10-09T22:30:00Z'))).toBe('2026-10-10');
  });

  it('labels slots the way the push shows them', () => {
    expect(slotLabel('2026-10-09', '19:30')).toBe('Fri 9 Oct 19:30');
  });
});
