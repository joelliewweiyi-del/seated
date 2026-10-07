import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findZenchefId, toSlots, zenchef } from '../src/server/platforms/zenchef';
import type { Restaurant } from '../src/server/platforms/types';

// Recorded 7 Oct 2026: Hotel de Goudfazant, Fri 9 and Sat 10 Oct (slots); De Kas, 5 to 12 Oct (summary).
const DAYS = JSON.parse(readFileSync(new URL('./fixtures/zenchef-day.json', import.meta.url), 'utf8'));
const SUMMARY = JSON.parse(readFileSync(new URL('./fixtures/zenchef-range.json', import.meta.url), 'utf8'));

const goudfazant: Restaurant = {
  id: 'hotel-de-goudfazant',
  name: 'Hotel de Goudfazant',
  platform: 'zenchef',
  platformUid: '367072',
  website: 'https://hoteldegoudfazant.nl/',
  city: 'Amsterdam',
  address: null,
};
const deKas = { ...goudfazant, id: 'de-kas', name: 'De Kas', platformUid: '386643' };

function fakeFetch(answer: (url: string) => Response) {
  const urls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    urls.push(String(input));
    return answer(String(input));
  }) as typeof fetch;
  return { impl, urls };
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

describe('Zenchef slots', () => {
  it('a slot is a table only if the party size fits now: a waitlist place is not a table', () => {
    const fri = DAYS.find((d: { date: string }) => d.date === '2026-10-09');
    expect(toSlots('2026-10-09', fri.shifts, 2).filter((s) => s.open).map((s) => s.time)).toEqual(['17:30', '18:00', '18:30', '21:00', '21:30']);
    expect(toSlots('2026-10-09', fri.shifts, 2).every((s) => !s.autoBookable)).toBe(true);
  });

  it('treats a closed or full slot as no table, whatever its party sizes say', () => {
    const shifts = [{ shift_slots: [{ name: '19:00', marked_as_full: true, possible_guests: [2] }, { name: '19:30', closed: true, possible_guests: [2] }] }];
    expect(toSlots('2026-10-09', shifts, 2).some((s) => s.open)).toBe(false);
  });
});

describe('Zenchef full services', () => {
  it('treats every slot of a shift the restaurant marked full as no table, so a full service never alerts', () => {
    const shifts = [{ marked_as_full: true, shift_slots: [{ name: '19:00', possible_guests: [2] }] }];
    expect(toSlots('2026-10-09', shifts, 2).filter((s) => s.open)).toHaveLength(0);
  });
});

describe('Zenchef reads', () => {
  it('asks the summary once and reads only days where a shift fits the party (De Kas: big groups only is not a table for two)', async () => {
    const { impl, urls } = fakeFetch(() => json(SUMMARY));
    const worth = await zenchef({ fetchImpl: impl, gapMs: 0 }).openDates!(deKas, ['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'], 2);
    expect([...worth]).toEqual(['2026-10-07']); // the 8th and 10th are open only for 7 to 12 people; the 9th is full
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('date_begin=2026-10-07');
    expect(urls[0]).toContain('date_end=2026-10-10');
  });

  it('uses only the asked day from an answer padded with other days', async () => {
    const { impl } = fakeFetch(() => json(DAYS));
    const sat = await zenchef({ fetchImpl: impl, gapMs: 0 }).getSlots(goudfazant, '2026-10-10', 2);
    expect(sat.filter((s) => s.open).map((s) => s.time)).toEqual(['17:30', '18:00', '20:00', '20:30', '21:00', '21:30']);
  });

  it('treats a bot-check answer (202) as a failed read, never as "fully booked"', async () => {
    const { impl } = fakeFetch(() => new Response('', { status: 202 }));
    await expect(zenchef({ fetchImpl: impl, gapMs: 0 }).getSlots(goudfazant, '2026-10-10', 2)).rejects.toThrow(/202/);
  });

  it('opens the booking page on the right day and party size', () => {
    expect(zenchef().bookingUrl(goudfazant, '2026-10-10', '20:00', 4)).toBe(
      'https://bookings.zenchef.com/results?rid=367072&pid=1001&pax=4&day=2026-10-10',
    );
    expect(zenchef().book).toBeUndefined();
  });

  it('finds the Zenchef id on a restaurant website', () => {
    expect(findZenchefId('<div class="zc-widget-config" data-restaurant="367072"></div>')).toBe('367072');
    expect(findZenchefId('<a href="https://bookings.zenchef.com/results?rid=386643&pid=1001">Book</a>')).toBe('386643');
  });
});
