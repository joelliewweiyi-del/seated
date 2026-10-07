import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApi } from '../src/server/api';
import { Store } from '../src/server/db';
import { Radar } from '../src/server/radar';
import { addDays, isoWeekday, localDate } from '../src/server/time';
import { PRIME } from '../src/shared/prime';
import { demoPlatform } from '../src/server/platforms/demo';
import { memoryNotifier } from '../src/server/notify';

function app({ localOnly = false, real = false, pollSeconds = 120 } = {}) {
  const store = new Store(':memory:');
  store.seedRestaurants([
    { id: 'klepel', name: 'Café de Klepel', platform: 'formitable', platformUid: 'd94c781e', website: null, city: 'Amsterdam', address: null },
    { id: 'esra', name: 'Esra', platform: 'tebi', platformUid: '967051_x', website: null, city: 'Amsterdam', address: null },
    { id: 'alba', name: 'Alba', platform: 'formitable', platformUid: 'b1754a7d', website: null, city: 'Amsterdam', address: null, hot: 3 },
  ]);
  const demo = demoPlatform();
  const notifier = memoryNotifier({ quiet: true });
  const platforms = { formitable: demo };
  const radar = new Radar({ store, platforms, notifier, horizonDays: 14, autoBookEnabled: false });
  const api = createApi({
    store,
    radar,
    platforms,
    notifier,
    demo: real ? null : demo,
    autoBookEnabled: false,
    pollSeconds,
    horizonDays: 14,
    nextCheckAt: () => null,
    localOnly,
  });
  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = { 'X-Seated': '1' }) =>
    api.request(path, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { store, call, demo, radar };
}

const valid = {
  restaurantId: 'klepel',
  partySize: 2,
  dateFrom: null,
  dateTo: null,
  weekdays: null,
  timeFrom: '19:00',
  timeTo: '21:00',
  autoBook: false,
};

describe('watch API', () => {
  it('creates a valid watch', async () => {
    const { call } = app();
    expect((await call('POST', '/watches', valid)).status).toBe(201);
  });

  it('refuses a restaurant on a platform Seated cannot read, with a reason the user understands', async () => {
    const { call } = app();
    const res = await call('POST', '/watches', { ...valid, restaurantId: 'esra' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/cannot read yet/);
  });

  it('refuses a time window that ends before it starts', async () => {
    const { call } = app();
    expect((await call('POST', '/watches', { ...valid, timeFrom: '22:00', timeTo: '19:00' })).status).toBe(400);
  });

  it('refuses an edit of one end that would invert the stored window, so a watch cannot silently match nothing', async () => {
    const { call } = app();
    await call('POST', '/watches', valid);
    expect((await call('PATCH', '/watches/1', { timeFrom: '22:00' })).status).toBe(400);
    expect((await call('PATCH', '/watches/1', { timeFrom: '20:00' })).status).toBe(200);
  });

  it('will not resume a watch that already holds a table', async () => {
    const { store, call } = app();
    await call('POST', '/watches', valid);
    await call('PATCH', '/watches/1', { status: 'paused' });
    store.addBooking({
      watchId: 1,
      restaurantId: 'klepel',
      restaurantName: 'Café de Klepel',
      date: '2099-01-01',
      time: '19:00',
      partySize: 2,
      status: 'booked',
      reference: 'R',
      paymentUrl: null,
      error: null,
      createdAt: '',
    });
    expect((await call('PATCH', '/watches/1', { status: 'watching' })).status).toBe(400);
  });
});

describe('protection against other websites (found in review round 3)', () => {
  it('refuses a change request without the X-Seated header, which a cross-site form or fetch cannot add', async () => {
    const { call, store } = app();
    const res = await call('POST', '/watches', { ...valid, autoBook: true }, {});
    expect(res.status).toBe(403);
    expect(store.listWatches()).toHaveLength(0);
  });

  it('still allows reading state without the header', async () => {
    const { call } = app();
    expect((await call('GET', '/state', undefined, {})).status).toBe(200);
  });

  it('refuses requests for a foreign host name when no password is set (DNS rebinding)', async () => {
    const { call } = app({ localOnly: true });
    expect((await call('GET', '/state', undefined, { Host: 'evil.example:4310' })).status).toBe(403);
    expect((await call('GET', '/state', undefined, { Host: '127.0.0.1:4310' })).status).toBe(200);
  });
});

describe('activity log and watch edits', () => {
  it('does not report tables as taken when the user narrows a watch or changes the party size', async () => {
    const { store, call, demo, radar } = app();
    const watch = (await (await call('POST', '/watches', valid)).json()) as { id: number };
    const friday = addDays(localDate(new Date()), 7);
    demo.open('klepel', friday, '19:30');
    await radar.tick({ all: true });
    await call('PATCH', `/watches/${watch.id}`, { timeFrom: '20:00' }); // 19:30 no longer matches
    await radar.tick({ all: true });
    await call('PATCH', `/watches/${watch.id}`, { timeFrom: '19:00', partySize: 4 });
    await radar.tick({ all: true });
    const kinds = store.listEvents(50).map((e) => e.kind);
    expect(kinds).not.toContain('taken');
    expect(kinds).not.toContain('opened'); // after an edit, what is open is "open at start" again
  });
});

describe('live board', () => {
  /** The next Friday from tomorrow on, so the table is never in the past. */
  const nextFriday = () => {
    let d = addDays(localDate(new Date()), 1);
    while (isoWeekday(d) !== 5) d = addDays(d, 1);
    return d;
  };

  it('ranks the fully booked restaurants first, counting only Friday and Saturday dinner tables', async () => {
    const { call, demo, radar } = app();
    await call('POST', '/watches', { restaurantId: 'klepel', ...PRIME });
    await call('POST', '/watches', { restaurantId: 'alba', ...PRIME });
    const friday = nextFriday();
    demo.open('klepel', friday, '19:30'); // prime
    demo.open('klepel', friday, '22:00'); // too late for prime: not on the board
    await radar.tick({ all: true });

    const board = (await (await call('GET', '/board')).json()) as {
      dates: string[];
      rows: Array<{ id: string; free: number; cells: Array<{ date: string; times: string[]; bookingUrl: string | null }> }>;
    };
    expect(board.dates.every((d) => [5, 6].includes(isoWeekday(d)))).toBe(true);
    expect(board.rows.map((r) => [r.id, r.free])).toEqual([
      ['alba', 0], // fully booked: hardest, so first
      ['klepel', 1],
    ]);
    const cell = board.rows[1]!.cells.find((c) => c.date === friday)!;
    expect(cell.times).toEqual(['19:30']);
    expect(cell.bookingUrl).toContain(`date=${friday}`);
  });

  it('says "not read yet" instead of "fully booked" before a restaurant was read, and ranks it last', async () => {
    const { call, radar, demo } = app();
    await call('POST', '/watches', { restaurantId: 'klepel', ...PRIME });
    await radar.tick({ all: true }); // Klepel read: empty, so fully booked
    await call('POST', '/watches', { restaurantId: 'alba', ...PRIME }); // not read yet
    demo.open('alba', nextFriday(), '19:30');
    const board = (await (await call('GET', '/board')).json()) as {
      rows: Array<{ id: string; cells: Array<{ known: boolean }> }>;
    };
    expect(board.rows.map((r) => r.id)).toEqual(['klepel', 'alba']);
    expect(board.rows[0]!.cells.every((c) => c.known)).toBe(true);
    expect(board.rows[1]!.cells.some((c) => c.known)).toBe(false);
  });

  it('only reports changes to tables for two, the party size the board shows', async () => {
    const { call, demo, radar } = app();
    await call('POST', '/watches', { restaurantId: 'klepel', ...PRIME });
    await call('POST', '/watches', { restaurantId: 'klepel', ...PRIME, partySize: 4 });
    await radar.tick({ all: true });
    demo.open('klepel', nextFriday(), '19:30'); // the demo platform answers for any party size
    await radar.tick({ all: true });
    const board = (await (await call('GET', '/board')).json()) as { feed: Array<{ partySize: number }> };
    expect(board.feed.length).toBeGreaterThan(0);
    expect(board.feed.every((e) => e.partySize === 2)).toBe(true);
  });

  it('leaves out restaurants watched only outside prime time', async () => {
    const { call, radar } = app();
    await call('POST', '/watches', { ...valid, weekdays: [1, 2, 3] });
    await radar.tick({ all: true });
    const board = (await (await call('GET', '/board')).json()) as { rows: unknown[] };
    expect(board.rows).toHaveLength(0);
  });

  it('streams a change message the moment a check finishes, so the page needs no polling', async () => {
    const { call, radar } = app();
    await call('POST', '/watches', valid); // a check with nothing to read is not a check
    const res = await call('GET', '/live');
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const text = new TextDecoder();
    let received = '';
    void radar.tick({ all: true });
    const deadline = Date.now() + 3000;
    while (!received.includes('event: change') && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      received += text.decode(value);
    }
    await reader.cancel();
    expect(received).toContain('event: change');
  });
});

describe('health check (what the watchdog and uptime monitors ask)', () => {
  afterEach(() => vi.useRealTimers());
  const MIN = 60_000;
  const check = (store: Store, at: number) =>
    store.addCheck({ startedAt: new Date(at).toISOString(), finishedAt: new Date(at).toISOString(), restaurants: 1, requests: 1, failedRequests: 0, newTables: 0, tablesTaken: 0 });

  it('reports trouble when Seated has watches but never finishes a first check, so the watchdog restarts it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { call } = app({ real: true });
    await call('POST', '/watches', valid);
    expect((await call('GET', '/health')).status).toBe(200); // just started: give it time
    vi.setSystemTime(Date.now() + 7 * MIN);
    expect((await call('GET', '/health')).status).toBe(503);
  });

  it('does not report trouble when a long POLL_SECONDS makes reads rare, so a healthy Seated is not restarted', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { store, call } = app({ real: true, pollSeconds: 300 }); // busy restaurants are read every 12.5 min
    await call('POST', '/watches', valid);
    check(store, Date.now());
    vi.setSystemTime(Date.now() + 12 * MIN);
    expect((await call('GET', '/health')).status).toBe(200);
    vi.setSystemTime(Date.now() + 3 * MIN);
    expect((await call('GET', '/health')).status).toBe(503);
  });
});

describe('health check during a long check', () => {
  afterEach(() => vi.useRealTimers());
  it('stays healthy while a long check still makes progress, and reports a check that stopped moving', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { store, call, radar } = app({ real: true });
    await call('POST', '/watches', valid);
    const t0 = Date.now();
    store.addCheck({ startedAt: new Date(t0).toISOString(), finishedAt: new Date(t0).toISOString(), restaurants: 1, requests: 1, failedRequests: 0, newTables: 0, tablesTaken: 0 });
    vi.setSystemTime(t0 + 10 * 60_000); // e.g. 24 restaurants timing out one after another
    radar.progressAt = new Date(Date.now() - 30_000).toISOString();
    expect((await call('GET', '/health')).status).toBe(200);
    radar.progressAt = new Date(Date.now() - 6 * 60_000).toISOString();
    expect((await call('GET', '/health')).status).toBe(503);
  });
});

describe('stats', () => {
  it('counts only confirmed tables as wins: an unclear or unpaid booking may not exist', async () => {
    const { store, call } = app();
    const row = (status: 'booked' | 'uncertain' | 'needs_payment') => ({
      watchId: null, restaurantId: 'alba', restaurantName: 'Alba', date: addDays(localDate(new Date()), 3), time: '19:00', partySize: 2,
      status, reference: null, paymentUrl: null, error: null, createdAt: new Date().toISOString(),
    });
    store.addBooking(row('booked'));
    store.addBooking(row('uncertain'));
    store.addBooking(row('needs_payment'));
    const stats = (await (await call('GET', '/stats')).json()) as { bookedBySeated: number };
    expect(stats.bookedBySeated).toBe(1);
  });
});

describe('"I got it"', () => {
  it('records a table you booked yourself once, even when the tap arrives twice (two tabs, a retry)', async () => {
    const { store, call } = app();
    await call('POST', '/watches', valid);
    const slot = { date: addDays(localDate(new Date()), 3), time: '19:30' };
    expect((await call('POST', '/watches/1/got-it', slot)).status).toBe(200);
    expect((await call('POST', '/watches/1/got-it', slot)).status).toBe(409);
    expect(store.listBookings(10).map((b) => b.source)).toEqual(['you']);
    expect(store.getWatch(1)!.status).toBe('booked'); // stops the watch, like any booking
  });
});
