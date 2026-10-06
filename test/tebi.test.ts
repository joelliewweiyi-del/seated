import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findTebiUid, tebi, toSlots } from '../src/server/platforms/tebi';
import type { Restaurant } from '../src/server/platforms/types';

// Recorded from Bacalar (Amsterdam) on 6 Oct 2026. Tests never call Tebi.
const DAY = JSON.parse(readFileSync(new URL('./fixtures/tebi-day.json', import.meta.url), 'utf8'));
const MONTH = JSON.parse(readFileSync(new URL('./fixtures/tebi-month.json', import.meta.url), 'utf8'));

const OLD = '643067_c82547a90e248d497f4b62ee18bc822033395230d66242a4b4e2518c48005c54';
const NEW = '643067_1cc3c9024be71ed4dd1c7e47de7b2081b10e5b2f513be93161842c1213d32637';
const bacalar: Restaurant = {
  id: 'bacalar',
  name: 'Bacalar',
  platform: 'tebi',
  platformUid: OLD,
  website: 'https://bacalar.amsterdam',
  city: 'Amsterdam',
  address: null,
};

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

function fakeFetch(handler: (url: string, init?: RequestInit) => Response) {
  const urls: string[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    urls.push(String(input));
    return handler(String(input), init);
  }) as typeof fetch;
  return { impl, urls };
}

describe('Tebi slots', () => {
  it('only counts "Available" as open: a waitlist spot is not a table', () => {
    const slots = toSlots('2026-10-09', DAY.timeslots);
    expect(slots.find((s) => s.time === '17:30')).toMatchObject({ open: true });
    expect(slots.find((s) => s.time === '18:00')).toMatchObject({ open: false }); // Waitlist
    expect(slots.find((s) => s.time === '19:00')).toMatchObject({ open: false }); // Unavailable
  });

  it('never marks a Tebi slot auto-bookable, because Tebi bookings sit behind a captcha', () => {
    expect(toSlots('2026-10-09', DAY.timeslots).every((s) => !s.autoBookable)).toBe(true);
    expect(tebi().book).toBeUndefined();
  });
});

describe('Tebi restaurant ids rotate', () => {
  it('finds the fresh id through the widget redirect, retries, and reports it so Seated can save it', async () => {
    const changes: string[] = [];
    const { impl, urls } = fakeFetch((url) => {
      if (url.includes(`/ledgers/${OLD}/`)) return json({ message: 'invalid ledger id' }, 400);
      if (url.includes(`/api/widget/${OLD}`)) {
        return new Response(null, { status: 302, headers: { location: `https://live.tebi.co/ecom/widget/${NEW}` } });
      }
      if (url.includes(`/ledgers/${NEW}/reservation-dates/2026-10-09`)) return json(DAY);
      throw new Error(`unexpected ${url}`);
    });
    const platform = tebi({ fetchImpl: impl, gapMs: 0, onUidChange: (id, uid) => changes.push(`${id}=${uid}`) });
    const slots = await platform.getSlots(bacalar, '2026-10-09', 2);
    expect(slots.filter((s) => s.open).map((s) => s.time)).toEqual(['17:30', '17:45', '20:45']);
    expect(changes).toEqual([`bacalar=${NEW}`]);
    expect(platform.bookingUrl(bacalar, '2026-10-09', '17:30', 2)).toBe(`https://live.tebi.co/ecom/reservations/${NEW}`);

    // The next read goes straight to the fresh id.
    await platform.getSlots(bacalar, '2026-10-09', 2);
    expect(urls.at(-1)).toContain(`/ledgers/${NEW}/`);
  });

  it('throws when the id cannot be refreshed, so the radar treats the day as unknown, not empty', async () => {
    const { impl } = fakeFetch((url) =>
      url.includes('/api/widget/') ? new Response(null, { status: 404 }) : json({ message: 'invalid ledger id' }, 400),
    );
    await expect(tebi({ fetchImpl: impl, gapMs: 0 }).getSlots(bacalar, '2026-10-09', 2)).rejects.toThrow(/400/);
  });
});

describe('Tebi month pre-check', () => {
  it('keeps only days the month calendar marks Available, in one request', async () => {
    const { impl, urls } = fakeFetch(() => json(MONTH));
    const platform = tebi({ fetchImpl: impl, gapMs: 0 });
    const worth = await platform.openDates!({ ...bacalar, platformUid: NEW }, ['2026-10-07', '2026-10-08', '2026-10-12', '2026-10-15'], 2);
    expect([...worth]).toEqual(['2026-10-08', '2026-10-15']);
    expect(urls).toHaveLength(1);
  });
});

describe('finding a Tebi id on a restaurant website', () => {
  it('reads a booking link', () => {
    expect(findTebiUid(`<a href="https://live.tebi.co/ecom/reservations/${NEW}">Reserve</a>`)).toBe(NEW);
  });
  it('reads the widget token', () => {
    expect(findTebiUid(`<div data-widget-token="${NEW}"></div>`)).toBe(NEW);
  });
  it('ignores a Tebi link that is not a booking link (Tebi is also a till and web shop)', () => {
    expect(findTebiUid('<a href="https://live.tebi.co/ecom/order/123">Order online</a>')).toBeNull();
  });
});
