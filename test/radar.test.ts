import { describe, expect, it } from 'vitest';
import { Store, type WatchInput } from '../src/server/db';
import { Radar, QUIET_REOPEN_MS } from '../src/server/radar';
import { demoPlatform } from '../src/server/platforms/demo';
import { memoryNotifier } from '../src/server/notify';
import type { BookResult, Platform, Slot } from '../src/server/platforms/types';

// Tuesday 6 Oct 2026, 12:00 in Amsterdam.
const START = new Date('2026-10-06T10:00:00Z');
const FRI = '2026-10-09';
const SAT = '2026-10-10';

function setup({ autoBookEnabled = false, platform }: { autoBookEnabled?: boolean; platform?: Platform } = {}) {
  const store = new Store(':memory:');
  store.seedRestaurants([
    { id: 'klepel', name: 'Café de Klepel', platform: 'formitable', platformUid: 'd94c781e', website: null, city: 'Amsterdam', address: null },
    { id: 'alba', name: 'Alba', platform: 'formitable', platformUid: 'b1754a7d', website: null, city: 'Amsterdam', address: null },
  ]);
  store.saveSettings({ guestFirstName: 'Ada', guestLastName: 'Lovelace', guestEmail: 'ada@example.com', guestPhone: '+31600000000' });
  const demo = demoPlatform();
  const notifier = memoryNotifier({ quiet: true });
  let now = START;
  const radar = new Radar({
    store,
    platforms: { formitable: platform ?? demo },
    notifier,
    horizonDays: 14,
    autoBookEnabled,
    now: () => now,
  });
  const watch = (over: Partial<WatchInput> = {}) =>
    store.createWatch(
      {
        restaurantId: 'klepel',
        partySize: 2,
        dateFrom: null,
        dateTo: null,
        weekdays: null,
        timeFrom: '19:00',
        timeTo: '21:00',
        autoBook: false,
        ...over,
      },
      now.toISOString(),
    );
  const advance = (ms: number) => {
    now = new Date(now.getTime() + ms);
  };
  return { store, demo, notifier, radar, watch, advance };
}

const MIN = 60_000;

describe('alerts', () => {
  it('pushes once when a matching table opens, then stays quiet while it stays open', async () => {
    const { demo, notifier, radar, watch } = setup();
    watch();
    await radar.tick();
    expect(notifier.sent).toHaveLength(0);

    demo.open('klepel', FRI, '19:30');
    await radar.tick();
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]!.title).toBe('Table open: Café de Klepel');
    expect(notifier.sent[0]!.body).toContain('Fri 9 Oct 19:30');
    expect(notifier.sent[0]!.url).toContain('date=2026-10-09');

    // The same table on the next three checks is not news. Repeats would train the user to ignore pushes.
    await radar.tick();
    await radar.tick();
    await radar.tick();
    expect(notifier.sent).toHaveLength(1);
  });

  it('ignores tables outside the time window', async () => {
    const { demo, notifier, radar, watch } = setup();
    watch({ timeFrom: '19:00', timeTo: '20:00' });
    demo.open('klepel', FRI, '17:30');
    demo.open('klepel', FRI, '21:30');
    await radar.tick();
    expect(notifier.sent).toHaveLength(0);
  });

  it('puts several new tables in one push instead of a burst of pushes', async () => {
    const { demo, notifier, radar, watch } = setup();
    watch();
    demo.open('klepel', SAT, '20:00');
    demo.open('klepel', FRI, '19:00');
    demo.open('klepel', FRI, '19:15');
    await radar.tick();
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]!.title).toBe('3 tables open: Café de Klepel');
    // The tap goes to the earliest table.
    expect(notifier.sent[0]!.url).toContain('date=2026-10-09');
  });

  it('pushes again when a table comes back later: a cancellation is a new chance', async () => {
    const { demo, notifier, radar, watch, advance } = setup();
    watch();
    demo.open('klepel', FRI, '19:30');
    await radar.tick();
    demo.close('klepel', FRI, '19:30');
    advance(2 * MIN);
    await radar.tick();
    advance(QUIET_REOPEN_MS + MIN);
    demo.open('klepel', FRI, '19:30');
    await radar.tick();
    expect(notifier.sent).toHaveLength(2);
  });

  it('stays quiet when a table flickers closed and open within the quiet window (someone else was mid-checkout)', async () => {
    const { demo, notifier, radar, watch, advance } = setup();
    watch();
    demo.open('klepel', FRI, '19:30');
    await radar.tick();
    demo.close('klepel', FRI, '19:30');
    advance(2 * MIN);
    await radar.tick();
    demo.open('klepel', FRI, '19:30');
    advance(2 * MIN);
    await radar.tick();
    expect(notifier.sent).toHaveLength(1);
  });

  it('keeps open tables open when a read fails, so a network blip does not cause a repeat push', async () => {
    const demo = demoPlatform();
    let failing = false;
    const flaky: Platform = {
      ...demo,
      getSlots: (r, d, p) => (failing ? Promise.reject(new Error('timeout')) : demo.getSlots(r, d, p)),
    };
    const { store, notifier, radar, watch } = setup({ platform: flaky });
    const w = watch();
    demo.open('klepel', FRI, '19:30');
    await radar.tick();

    failing = true;
    const report = await radar.tick();
    expect(report.failedRequests).toBeGreaterThan(0);
    expect(store.openSightings(w.id)).toHaveLength(1);
    expect(store.getRestaurant('klepel')!.lastError).toMatch(/timeout/);

    failing = false;
    await radar.tick();
    expect(notifier.sent).toHaveLength(1);
  });

  it('does not check paused watches', async () => {
    const { store, demo, notifier, radar, watch } = setup();
    const w = watch();
    store.updateWatch(w.id, { status: 'paused' });
    demo.open('klepel', FRI, '19:30');
    const report = await radar.tick();
    expect(report.requests).toBe(0);
    expect(notifier.sent).toHaveLength(0);
  });

  it('reads each restaurant, date and party size once, even with several watches on it', async () => {
    const { radar, watch } = setup();
    watch({ weekdays: [5] });
    watch({ weekdays: [5], timeFrom: '12:00', timeTo: '14:00' });
    const report = await radar.tick();
    // Two Fridays in the 14-day horizon; the second watch reuses the first watch's reads.
    expect(report.requests).toBe(2);
  });
});

describe('auto-book', () => {
  it('books once, marks the watch booked and never books it again', async () => {
    const { store, demo, notifier, radar, watch } = setup({ autoBookEnabled: true });
    const w = watch({ autoBook: true });
    demo.open('klepel', FRI, '19:30');
    demo.open('klepel', SAT, '20:00');
    const report = await radar.tick();

    expect(report.bookings).toBe(1);
    expect(demo.bookings).toEqual([{ restaurantId: 'klepel', date: FRI, time: '19:30', partySize: 2 }]);
    expect(store.getWatch(w.id)!.status).toBe('booked');
    expect(notifier.sent.map((n) => n.title)).toEqual(['Booked: Café de Klepel']);

    // More tables open. The watch already has its table, so nothing happens.
    demo.open('klepel', FRI, '20:30');
    await radar.tick();
    expect(demo.bookings).toHaveLength(1);
  });

  it('never re-books a watch that already holds a table, even if its status was reset (the June 2026 duplicate booking)', async () => {
    const { store, demo, radar, watch } = setup({ autoBookEnabled: true });
    const w = watch({ autoBook: true });
    store.addBooking({
      watchId: w.id,
      restaurantId: 'klepel',
      restaurantName: 'Café de Klepel',
      date: SAT,
      time: '19:00',
      partySize: 2,
      status: 'booked',
      reference: 'OLD1',
      paymentUrl: null,
      error: null,
      createdAt: START.toISOString(),
    });
    demo.open('klepel', FRI, '19:30');
    await radar.tick();
    expect(demo.bookings).toHaveLength(0);
    expect(store.getWatch(w.id)!.status).toBe('booked');
  });

  it('only alerts when the server switch is off, even if the watch opted in', async () => {
    const { demo, notifier, radar, watch } = setup({ autoBookEnabled: false });
    watch({ autoBook: true });
    demo.open('klepel', FRI, '19:30');
    await radar.tick();
    expect(demo.bookings).toHaveLength(0);
    expect(notifier.sent[0]!.title).toBe('Table open: Café de Klepel');
  });

  it('does not book without the guest details, and says why in the push', async () => {
    const { store, demo, notifier, radar, watch } = setup({ autoBookEnabled: true });
    store.saveSettings({ guestPhone: '' });
    watch({ autoBook: true });
    demo.open('klepel', FRI, '19:30');
    await radar.tick();
    expect(demo.bookings).toHaveLength(0);
    expect(notifier.sent[0]!.body).toContain('missing in Settings');
  });

  it('only auto-books slots marked auto-bookable (never a SHORT sitting)', async () => {
    let booked = 0;
    const short: Platform = {
      id: 'formitable',
      label: 'test',
      getSlots: async (_r, date) => (date === FRI ? [{ date, time: '19:30', open: true, autoBookable: false } as Slot] : []),
      bookingUrl: () => 'https://example.com/book',
      book: async () => {
        booked++;
        return { ok: true, reference: 'X', paymentUrl: null };
      },
    };
    const { notifier, radar, watch } = setup({ autoBookEnabled: true, platform: short });
    watch({ autoBook: true });
    await radar.tick();
    expect(booked).toBe(0);
    expect(notifier.sent[0]!.title).toBe('Table open: Café de Klepel');
  });

  const failingPlatform = (result: BookResult) => {
    const demo = demoPlatform();
    let attempts = 0;
    const platform: Platform = {
      ...demo,
      book: async () => {
        attempts++;
        return result;
      },
    };
    return { demo, platform, attempts: () => attempts };
  };

  it('falls back to an alert and keeps watching when the restaurant refuses the booking', async () => {
    const f = failingPlatform({ ok: false, error: 'Formitable answered 400: nope' });
    const { store, notifier, radar, watch } = setup({ autoBookEnabled: true, platform: f.platform });
    const w = watch({ autoBook: true });
    f.demo.open('klepel', FRI, '19:30');
    await radar.tick();
    expect(notifier.sent[0]!.title).toBe('Table open: Café de Klepel');
    expect(notifier.sent[0]!.body).toContain('Auto-book failed');
    expect(store.getWatch(w.id)!.status).toBe('watching');
    expect(store.listBookings()[0]!.status).toBe('failed');
  });

  it('pauses the watch and never retries when the booking outcome is unclear', async () => {
    const f = failingPlatform({ ok: false, uncertain: true, error: 'No answer from Formitable' });
    const { store, notifier, radar, watch, advance } = setup({ autoBookEnabled: true, platform: f.platform });
    const w = watch({ autoBook: true });
    f.demo.open('klepel', FRI, '19:30');
    await radar.tick();
    expect(store.getWatch(w.id)!.status).toBe('paused');
    expect(notifier.sent.map((n) => n.title)).toContain('Check your email: Café de Klepel');

    // Even if the user resumes it by mistake, the unclear booking blocks a second attempt.
    store.updateWatch(w.id, { status: 'watching' });
    f.demo.open('klepel', SAT, '19:30');
    advance(5 * MIN);
    await radar.tick();
    expect(f.attempts()).toBe(1);
    expect(store.getWatch(w.id)!.status).toBe('booked');
  });
});

describe('found in review (Codex, Oct 2026)', () => {
  it('does not book when the user paused the watch while the check was reading', async () => {
    const demo = demoPlatform();
    let pauseDuringRead: (() => void) | null = null;
    const slow: Platform = {
      ...demo,
      getSlots: async (r, d, p) => {
        pauseDuringRead?.();
        return demo.getSlots(r, d, p);
      },
    };
    const { store, notifier, radar, watch } = setup({ autoBookEnabled: true, platform: slow });
    const w = watch({ autoBook: true });
    pauseDuringRead = () => store.updateWatch(w.id, { status: 'paused' });
    demo.open('klepel', FRI, '19:30');
    await radar.tick();
    expect(demo.bookings).toHaveLength(0);
    expect(notifier.sent).toHaveLength(0);
  });

  it('retries a push that did not go out, and sends it only once', async () => {
    const { demo, radar, watch, store } = setup();
    const sent: string[] = [];
    let up = false;
    // Swap in a notifier that is down for the first check.
    (radar as unknown as { o: { notifier: { send: (n: { title: string }) => Promise<boolean> } } }).o.notifier = {
      send: async (n) => {
        if (!up) return false;
        sent.push(n.title);
        return true;
      },
    };
    const w = watch();
    demo.open('klepel', FRI, '19:30');
    await radar.tick();
    expect(sent).toHaveLength(0);
    expect(store.openSightings(w.id)[0]!.notified).toBe(false);

    up = true;
    await radar.tick();
    await radar.tick();
    expect(sent).toEqual(['Table open: Café de Klepel']);
  });

  it('auto-books a table that was already open once it becomes bookable (SHORT, then AVAILABLE)', async () => {
    let bookable = false;
    const booked: string[] = [];
    const platform: Platform = {
      id: 'formitable',
      label: 'test',
      getSlots: async (_r, date) => (date === FRI ? [{ date, time: '19:30', open: true, autoBookable: bookable }] : []),
      bookingUrl: () => 'https://example.com/book',
      book: async (_r, date, time) => {
        booked.push(`${date} ${time}`);
        return { ok: true, reference: 'R1', paymentUrl: null };
      },
    };
    const { radar, watch } = setup({ autoBookEnabled: true, platform });
    watch({ autoBook: true });
    await radar.tick();
    expect(booked).toHaveLength(0);
    bookable = true;
    await radar.tick();
    expect(booked).toEqual([`${FRI} 19:30`]);
  });

  it('never tries the same slot twice after a refused booking, so it cannot hammer the restaurant', async () => {
    const demo = demoPlatform();
    let attempts = 0;
    const platform: Platform = {
      ...demo,
      book: async () => {
        attempts++;
        return { ok: false, error: 'Formitable answered 400' };
      },
    };
    const { radar, watch, advance } = setup({ autoBookEnabled: true, platform });
    watch({ autoBook: true });
    demo.open('klepel', FRI, '19:30');
    await radar.tick();
    advance(2 * MIN);
    await radar.tick();
    advance(2 * MIN);
    await radar.tick();
    expect(attempts).toBe(1);
  });

  it('tells the user when an auto-book on an already-pushed table goes wrong', async () => {
    let bookable = false;
    const platform: Platform = {
      id: 'formitable',
      label: 'test',
      getSlots: async (_r, date) => (date === FRI ? [{ date, time: '19:30', open: true, autoBookable: bookable }] : []),
      bookingUrl: () => 'https://example.com/book',
      book: async () => ({ ok: false, uncertain: true, error: 'timeout' }),
    };
    const { notifier, radar, watch, store } = setup({ autoBookEnabled: true, platform });
    const w = watch({ autoBook: true });
    await radar.tick(); // pushed as an alert, not bookable yet
    bookable = true;
    await radar.tick();
    // Exactly one warning, not a warning plus a second "problem" push.
    expect(notifier.sent.map((n) => n.title)).toEqual(['Table open: Café de Klepel', 'Check your email: Café de Klepel']);
    expect(store.getWatch(w.id)!.status).toBe('paused');
  });
});

describe('push text', () => {
  it('groups times by day, so 20 slots read as a few lines', async () => {
    const { summarize } = await import('../src/server/radar');
    const slots = ['19:00', '19:15', '19:30'].map((time) => ({ date: FRI, time }));
    expect(summarize([...slots, { date: SAT, time: '20:00' }])).toBe('Fri 9 Oct 19:00–19:30 (3 times)\nSat 10 Oct 20:00');
  });
});

type SendFn = (n: { title: string }) => Promise<boolean>;
/** Replaces the radar's notifier with one that is down until `up()` is called. */
function flakyNotifier(radar: Radar) {
  const sent: string[] = [];
  let isUp = false;
  (radar as unknown as { o: { notifier: { send: SendFn } } }).o.notifier = {
    send: async (n) => {
      if (isUp) sent.push(n.title);
      return isUp;
    },
  };
  return { sent, up: () => (isUp = true) };
}

describe('found in review round 2 (Codex, Oct 2026)', () => {
  it('saves the booking attempt before the request goes out, so a crash mid-request still blocks a second booking', async () => {
    const demo = demoPlatform();
    let statusDuringRequest: string | undefined;
    const holder: { store?: Store } = {};
    const { store, radar, watch } = setup({
      autoBookEnabled: true,
      platform: {
        ...demo,
        book: async () => {
          statusDuringRequest = holder.store!.listBookings()[0]?.status;
          throw new Error('process killed'); // stands in for Seated dying mid-request
        },
      },
    });
    holder.store = store;
    const w = watch({ autoBook: true });
    demo.open('klepel', FRI, '19:30');
    await radar.tick().catch(() => undefined);
    expect(statusDuringRequest).toBe('uncertain');
    expect(store.hasLiveBooking(w.id, '2026-10-06')).toBe(true);
  });

  it('keeps the booking record when the user removes the watch while the booking is in flight', async () => {
    const demo = demoPlatform();
    const holder: { store?: Store } = {};
    const { store, notifier, radar, watch } = setup({
      autoBookEnabled: true,
      platform: {
        ...demo,
        book: async () => {
          holder.store!.deleteWatch(1);
          return { ok: true, reference: 'KEEP1', paymentUrl: 'https://pay.example/1' };
        },
      },
    });
    holder.store = store;
    watch({ autoBook: true });
    demo.open('klepel', FRI, '19:30');
    await radar.tick();
    expect(store.listBookings()[0]).toMatchObject({ status: 'needs_payment', reference: 'KEEP1', watchId: null });
    expect(notifier.sent.map((n) => n.title)).toContain('Held: Café de Klepel. Pay the deposit to confirm');
  });

  it('retries a "pay the deposit" push until it goes out, because missing it can cost the table', async () => {
    const demo = demoPlatform();
    const { store, radar, watch } = setup({
      autoBookEnabled: true,
      platform: { ...demo, book: async () => ({ ok: true, reference: 'D1', paymentUrl: 'https://pay.example/1' }) },
    });
    const n = flakyNotifier(radar);
    watch({ autoBook: true });
    demo.open('klepel', FRI, '19:30');
    await radar.tick();
    expect(store.listBookings()[0]!.notified).toBe(false);
    n.up();
    await radar.tick();
    await radar.tick();
    expect(n.sent.filter((t) => t.startsWith('Held:'))).toHaveLength(1);
  });

  it('does not treat a quick reopen as "already pushed" when the first push failed', async () => {
    const { demo, radar, watch, advance } = setup();
    const n = flakyNotifier(radar);
    watch();
    demo.open('klepel', FRI, '19:30');
    await radar.tick(); // push fails
    demo.close('klepel', FRI, '19:30');
    advance(2 * MIN);
    await radar.tick();
    n.up();
    demo.open('klepel', FRI, '19:30');
    advance(2 * MIN);
    await radar.tick();
    expect(n.sent).toEqual(['Table open: Café de Klepel']);
  });
});

describe('found in review round 3 (Codex, Oct 2026)', () => {
  it('does not book with old criteria when the user edits the watch during a check', async () => {
    const demo = demoPlatform();
    const holder: { store?: Store } = {};
    const { store, radar, watch } = setup({
      autoBookEnabled: true,
      platform: {
        ...demo,
        getSlots: async (r, d, p) => {
          holder.store!.updateWatch(1, { timeFrom: '20:00', timeTo: '21:00' });
          return demo.getSlots(r, d, p);
        },
      },
    });
    holder.store = store;
    watch({ autoBook: true, timeFrom: '19:00', timeTo: '21:00' });
    demo.open('klepel', FRI, '19:00');
    await radar.tick();
    expect(demo.bookings).toHaveLength(0);
  });

  it('takes a table off "Open now" when the user narrows the watch to other days', async () => {
    const { store, demo, radar, watch } = setup();
    const w = watch();
    demo.open('klepel', FRI, '19:30');
    await radar.tick();
    expect(store.openSightings(w.id)).toHaveLength(1);
    store.updateWatch(w.id, { weekdays: [6] }); // Saturdays only
    await radar.tick();
    expect(store.openSightings(w.id)).toHaveLength(0);
  });
});
