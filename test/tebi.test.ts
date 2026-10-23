import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findTebiUid, tebi, toSlots } from '../src/server/platforms/tebi';
import { chooseOption, dutchPhone, monthLabel, readAnswer, refusal } from '../src/server/platforms/tebi-browser';
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

  it('offers only open slots for auto-book; bar seats and deposits are checked on the booking page', () => {
    const slots = toSlots('2026-10-09', DAY.timeslots);
    expect(slots.every((s) => s.autoBookable === s.open)).toBe(true);
  });
});

describe('Tebi booking', () => {
  const guest = { firstName: 'Test', lastName: 'Droog', email: 'test@example.com', phone: '+31612345678' };

  it('books on the current ledger id, because Tebi rotates ids and an old one answers 400', async () => {
    const calls: string[] = [];
    const platform = tebi({
      bookImpl: async (uid, date, time, party) => {
        calls.push(`${uid} ${date} ${time} ${party}`);
        return { ok: true, reference: 'R1', paymentUrl: null };
      },
    });
    expect(await platform.book!(bacalar, '2026-10-24', '20:30', 2, guest)).toEqual({ ok: true, reference: 'R1', paymentUrl: null });
    expect(calls).toEqual([`${OLD} 2026-10-24 20:30 2`]);
  });

  it('skips bar and counter seats: Joel wants a seat at a table', () => {
    const pick = (names: [string, boolean][]) => chooseOption(names.map(([name, disabled]) => ({ name, disabled })))?.name ?? null;
    expect(pick([['Cocktailbar', false], ['Restaurant', false]])).toBe('Restaurant');
    expect(pick([['Dinner @the bar', false], ['Dinner', true]])).toBeNull(); // September, 29 Oct 2026
    expect(pick([['Counter', false], ['Toog', false]])).toBeNull();
    expect(pick([['Communal Table', false]])).toBe('Communal Table');
  });

  it('never submits when money or a waitlist is on the page', () => {
    expect(refusal('€ 10,00 aanbetaling per gast')).toMatch(/deposit/); // KID, 24 Oct 2026
    expect(refusal('Inschrijven op de wachtlijst')).toMatch(/waitlist/); // Toscanini, 29 Oct 2026
    expect(refusal('Bevestig je reservering. Door te reserveren ga je akkoord met onze Algemene voorwaarden')).toBeNull();
  });

  it('fills the nine digits after the fixed +31 prefix, and refuses other countries before anything is sent', () => {
    expect(dutchPhone('+31 6 12345678')).toBe('612345678');
    expect(dutchPhone('0612345678')).toBe('612345678');
    expect(dutchPhone('+32470123456')).toBeNull();
  });

  it('calls only a reservation in the answer a booking; anything unclear is uncertain so the watch pauses', () => {
    expect(readAnswer(201, JSON.stringify({ reservation: { id: 'abc' } }))).toEqual({ ok: true, reference: 'abc', paymentUrl: null });
    expect(readAnswer(200, '{}')).toMatchObject({ ok: false, uncertain: true });
    expect(readAnswer(200, JSON.stringify({ reservation: { id: 'x' }, paymentPageInput: { a: 1 } }))).toMatchObject({ ok: false, uncertain: true });
    expect(readAnswer(null, '')).toMatchObject({ ok: false, uncertain: true });
    expect(readAnswer(502, 'Bad gateway')).toMatchObject({ ok: false, uncertain: true });
  });

  it('treats a 4xx with reasons as a clear "not booked", so a later table can still be tried', () => {
    const r = readAnswer(400, JSON.stringify({ message: 'invalid', validation: [{ key: 'NothingAvailable' }] }));
    expect(r).toEqual({ ok: false, error: 'Tebi refused the booking (400): NothingAvailable' });
  });

  it('names the month the way Tebi\'s date page shows it', () => {
    expect(monthLabel('2026-10-24')).toBe('oktober 2026');
    expect(monthLabel('2026-11-02')).toBe('november 2026');
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
