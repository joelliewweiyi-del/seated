import { describe, expect, it } from 'vitest';
import { findFormitableUid, formitable, type FormitableSlot } from '../src/server/platforms/formitable';
import type { Restaurant } from '../src/server/platforms/types';

const klepel: Restaurant = {
  id: 'cafe-de-klepel',
  name: 'Café de Klepel',
  platform: 'formitable',
  platformUid: 'd94c781e',
  website: 'http://cafedeklepel.nl',
  city: 'Amsterdam',
  address: null,
};

const guest = { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', phone: '+31600000000' };

// Shape copied from a real response of GET /availability/d94c781e/day/2026-10-09/2/en.
const slot = (timeString: string, time: string, status: string): FormitableSlot => ({
  timeString,
  time,
  status,
  minutes: Number(timeString.slice(0, 2)) * 60 + Number(timeString.slice(3)),
  maxDuration: 180,
  spotsOpen: 2,
});

interface Call {
  url: string;
  method: string;
  body: any;
}

/** A fake fetch that answers by URL pattern and records every call. */
function fakeFetch(routes: Array<[RegExp, () => Response | Promise<Response>]>) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
    const route = routes.find(([re]) => re.test(url));
    if (!route) throw new Error(`unexpected request ${url}`);
    return route[1]();
  }) as typeof fetch;
  return { impl, calls };
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

describe('reading availability', () => {
  it('asks for one local date and treats AVAILABLE and SHORT as open', async () => {
    const { impl, calls } = fakeFetch([
      [
        /\/availability\/d94c781e\/day\/2026-10-09\/2\/en$/,
        () =>
          json([
            slot('19:00', '2026-10-09T17:00:00Z', 'AVAILABLE'),
            slot('19:15', '2026-10-09T17:15:00Z', 'SHORT'),
            slot('19:30', '2026-10-09T17:30:00Z', 'WAITLIST'),
            slot('19:45', '2026-10-09T17:45:00Z', 'SOLD_OUT'),
          ]),
      ],
    ]);
    const slots = await formitable({ fetchImpl: impl, gapMs: 0 }).getSlots(klepel, '2026-10-09', 2);
    expect(calls).toHaveLength(1);
    expect(slots.map((s) => [s.time, s.open, s.autoBookable])).toEqual([
      ['19:00', true, true],
      // A SHORT sitting is bookable by a person, who sees the end time. Seated never auto-books it.
      ['19:15', true, false],
      ['19:30', false, false],
      ['19:45', false, false],
    ]);
  });

  it('throws on an HTTP error, so the radar knows the date is unknown rather than empty', async () => {
    const { impl } = fakeFetch([[/availability/, () => json({}, 503)]]);
    await expect(formitable({ fetchImpl: impl, gapMs: 0 }).getSlots(klepel, '2026-10-09', 2)).rejects.toThrow(/503/);
  });
});

describe('the booking link', () => {
  it('opens the widget on the right party size, date and time (minutes since midnight)', () => {
    // Checked by hand in Chrome on 6 Oct 2026: the widget shows "4 people, Friday, 19:30".
    const url = formitable({ gapMs: 0 }).bookingUrl(klepel, '2026-10-09', '19:30', 4);
    expect(url).toBe('https://widget.formitable.com/side/en/d94c781e/book?partysize=4&date=2026-10-09&time=1170');
  });
});

describe('booking a table', () => {
  const day = (status = 'AVAILABLE') => [slot('00:30', '2026-10-09T22:30:00Z', status)];
  const product = () => json([{ uid: 'dinner-1', title: 'Dinner' }]);

  it('sends the restaurant-local date for a slot after midnight (the v1 bug booked a day early)', async () => {
    const { impl, calls } = fakeFetch([
      [/availability/, () => json(day())],
      [/product/, product],
      [/\/booking\/d94c781e$/, () => json({ bookingUid: 'ABC123' })],
    ]);
    const result = await formitable({ fetchImpl: impl, gapMs: 0 }).book!(klepel, '2026-10-10', '00:30', 2, guest);
    expect(result).toEqual({ ok: true, reference: 'ABC123', paymentUrl: null });
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body.booking.bookingDate).toBe('2026-10-10');
    expect(post.body.booking.bookingTime).toBe('00:30');
    expect(post.body.booking.numberOfPeople).toBe(2);
    expect(post.body.ticketUid).toBe('dinner-1');
  });

  it('does not send a booking when the table is no longer AVAILABLE', async () => {
    const { impl, calls } = fakeFetch([[/availability/, () => json(day('SOLD_OUT'))]]);
    const result = await formitable({ fetchImpl: impl, gapMs: 0 }).book!(klepel, '2026-10-10', '00:30', 2, guest);
    expect(result.ok).toBe(false);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('returns the deposit link when the restaurant asks for payment', async () => {
    const { impl } = fakeFetch([
      [/availability/, () => json(day())],
      [/product/, product],
      [/\/booking\//, () => json({ bookingUid: 'DEP1', paymentUrl: 'https://pay.example/1' })],
    ]);
    const result = await formitable({ fetchImpl: impl, gapMs: 0 }).book!(klepel, '2026-10-10', '00:30', 2, guest);
    expect(result).toEqual({ ok: true, reference: 'DEP1', paymentUrl: 'https://pay.example/1' });
  });

  it('calls a network failure during the booking request "uncertain", because the table may be booked', async () => {
    const { impl } = fakeFetch([
      [/availability/, () => json(day())],
      [/product/, product],
      [
        /\/booking\//,
        () => {
          throw new Error('socket hang up');
        },
      ],
    ]);
    const result = await formitable({ fetchImpl: impl, gapMs: 0 }).book!(klepel, '2026-10-10', '00:30', 2, guest);
    expect(result).toMatchObject({ ok: false, uncertain: true });
  });

  it('stays uncertain when the error body of a 5xx cannot be read', async () => {
    const broken = new Response(null, { status: 503 });
    broken.text = () => Promise.reject(new Error('stream broke'));
    const { impl } = fakeFetch([
      [/availability/, () => json(day())],
      [/product/, product],
      [/\/booking\//, () => broken],
    ]);
    const result = await formitable({ fetchImpl: impl, gapMs: 0 }).book!(klepel, '2026-10-10', '00:30', 2, guest);
    expect(result).toMatchObject({ ok: false, uncertain: true });
  });

  it('treats a 5xx as uncertain and a 4xx as a clean refusal', async () => {
    for (const [status, uncertain] of [
      [503, true],
      [400, false],
    ] as const) {
      const { impl } = fakeFetch([
        [/availability/, () => json(day())],
        [/product/, product],
        [/\/booking\//, () => json({ message: 'nope' }, status)],
      ]);
      const result = await formitable({ fetchImpl: impl, gapMs: 0 }).book!(klepel, '2026-10-10', '00:30', 2, guest);
      expect(result).toMatchObject({ ok: false, uncertain });
    }
  });
});

describe('finding a Formitable id on a restaurant website', () => {
  it('reads the widget embed attribute', () => {
    expect(findFormitableUid('<div class="ft-widget-b2" data-restaurant="d94c781e"></div>')).toBe('d94c781e');
  });

  it('reads a widget link', () => {
    expect(findFormitableUid('https://widget.formitable.com/side/nl/b1754a7d/book')).toBe('b1754a7d');
  });

  it('returns null when there is no widget', () => {
    expect(findFormitableUid('<html>Book via Tebi</html>')).toBeNull();
  });
});
