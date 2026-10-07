import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findGuestplanKey, guestplan, parseGuestplanUid, toSlots } from '../src/server/platforms/guestplan';
import type { Restaurant } from '../src/server/platforms/types';

// Recorded 7 Oct 2026: Blauw Amsterdam, Sat 10 Oct, party 2 (day); Choux, October, party 4 (month).
const DAY = JSON.parse(readFileSync(new URL('./fixtures/guestplan-day.json', import.meta.url), 'utf8'));
const MONTH = JSON.parse(readFileSync(new URL('./fixtures/guestplan-month.json', import.meta.url), 'utf8'));

const KEY = 'd68cd1acdde24b607eb39d33c205eec8f8d4f8b6';
const blauw: Restaurant = {
  id: 'blauw',
  name: 'Blauw',
  platform: 'guestplan',
  platformUid: `${KEY}:54656`,
  website: 'https://restaurantblauw.nl/',
  city: 'Amsterdam',
  address: null,
};

function fakeFetch(answer: () => Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return answer();
  }) as typeof fetch;
  return { impl, calls };
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

describe('Guestplan slots', () => {
  it('counts a time as a table only when it is open and bookable: a waitlist time is not a table', () => {
    const slots = toSlots('2026-10-10', DAY.trs);
    expect(slots.filter((s) => s.open).map((s) => s.time)).toEqual([
      '17:00', '17:15', '17:30', '18:00', '20:15', '20:30', '20:45', '21:00', '21:15', '21:30',
    ]);
    expect(slots.find((s) => s.time === '20:00')).toMatchObject({ open: false }); // waitlist only
    expect(slots.find((s) => s.time === '06:00')).toBeUndefined(); // outside opening hours: not a slot
    expect(slots.every((s) => !s.autoBookable)).toBe(true);
  });
});

describe('Guestplan reads', () => {
  it('sends the public key and the account, and reads the day in the restaurant-local format', async () => {
    const { impl, calls } = fakeFetch(() => json(DAY));
    await guestplan({ fetchImpl: impl, gapMs: 0 }).getSlots(blauw, '2026-10-10', 2);
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`AccessKey ${KEY}`);
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ accountId: 54656, date: '20261010', partySize: 2 });
  });

  it('asks which days have tables in one request, and skips waitlist-only and closed days', async () => {
    const { impl, calls } = fakeFetch(() => json(MONTH));
    const choux = { ...blauw, platformUid: `${KEY}:60771` };
    // In the recording: 13 Oct open, 10 Oct waitlist only, 11 Oct closed.
    const worth = await guestplan({ fetchImpl: impl, gapMs: 0 }).openDates!(choux, ['2026-10-10', '2026-10-11', '2026-10-13'], 4);
    expect([...worth]).toEqual(['2026-10-13']);
    expect(calls).toHaveLength(1);
  });

  it('throws on an HTTP error, so the radar treats the day as unknown', async () => {
    const { impl } = fakeFetch(() => json({}, 401));
    await expect(guestplan({ fetchImpl: impl, gapMs: 0 }).getSlots(blauw, '2026-10-10', 2)).rejects.toThrow(/401/);
  });

  it('links to the plain widget: it never fakes a Reserve with Google token to pre-fill the form', () => {
    const url = guestplan().bookingUrl(blauw, '2026-10-10', '20:15', 2);
    expect(url).toBe(`https://widget.guestplan.com/?i=${KEY}&account=54656&locale=en`);
    expect(url).not.toContain('rwg_token');
    expect(guestplan().book).toBeUndefined();
  });

  it('rejects a malformed id instead of reading the wrong restaurant', () => {
    expect(() => parseGuestplanUid(KEY)).toThrow(/accessKey/);
  });

  it('finds the widget key on a site, also when the snippet is URL-encoded', () => {
    expect(findGuestplanKey(`<script>_gstpln.accessKey = "${KEY}";</script>`)).toBe(KEY);
    expect(findGuestplanKey(`<script data-src="data:text/javascript,_gstpln.accessKey%20%3D%20%22${KEY}%22"></script>`)).toBe(KEY);
  });
});
