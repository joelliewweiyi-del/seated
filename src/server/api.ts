import { Hono } from 'hono';
import type { Store, Watch, WatchInput, WatchStatus } from './db.js';
import type { Platform } from './platforms/types.js';
import type { DemoPlatform } from './platforms/demo.js';
import type { Notifier } from './notify.js';
import { pollInterval, type Radar } from './radar.js';
import { resolveFormitableUid, slugify } from './restaurants.js';
import { addDays, localDate } from './time.js';
import { coversPrime, isPrime, isPrimeDay, PRIME } from '../shared/prime.js';
import { streamSSE } from 'hono/streaming';

export interface ApiDeps {
  store: Store;
  radar: Radar;
  platforms: Record<string, Platform>;
  notifier: Notifier;
  demo: DemoPlatform | null;
  autoBookEnabled: boolean;
  pollSeconds: number;
  horizonDays: number;
  nextCheckAt: () => string | null;
  /** No password set: only answer requests addressed to this computer. */
  localOnly: boolean;
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

class BadRequest extends Error {}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Validates a full or partial watch body. Throws BadRequest with a message for the user. */
function parseWatch(body: Record<string, unknown>, partial: boolean): Partial<WatchInput> {
  const out: Partial<WatchInput> = {};
  const has = (k: string) => k in body;

  if (!partial || has('partySize')) {
    const n = Number(body.partySize);
    if (!Number.isInteger(n) || n < 1 || n > 20) throw new BadRequest('Party size must be between 1 and 20.');
    out.partySize = n;
  }
  for (const k of ['dateFrom', 'dateTo'] as const) {
    if (!partial || has(k)) {
      const v = body[k];
      if (v === null || v === undefined || v === '') out[k] = null;
      else if (typeof v === 'string' && DATE.test(v)) out[k] = v;
      else throw new BadRequest('Dates must look like 2026-10-31.');
    }
  }
  if (out.dateFrom && out.dateTo && out.dateFrom > out.dateTo) throw new BadRequest('The end date is before the start date.');
  if (!partial || has('weekdays')) {
    const v = body.weekdays;
    if (v === null || v === undefined) out.weekdays = null;
    else if (Array.isArray(v) && v.length > 0 && v.every((d) => Number.isInteger(d) && d >= 1 && d <= 7)) {
      out.weekdays = [...new Set(v as number[])].sort();
    } else throw new BadRequest('Pick at least one day of the week.');
  }
  for (const k of ['timeFrom', 'timeTo'] as const) {
    if (!partial || has(k)) {
      const v = body[k];
      if (typeof v !== 'string' || !TIME.test(v)) throw new BadRequest('Times must look like 19:30.');
      out[k] = v;
    }
  }
  if (out.timeFrom && out.timeTo && out.timeFrom > out.timeTo) throw new BadRequest('The latest time is before the earliest time.');
  if (!partial || has('autoBook')) out.autoBook = body.autoBook === true;
  return out;
}

/** No finished check for this long (with watches to check) means the radar has stopped. */
const HEALTH_STALE_SECONDS = 6 * 60;

interface BoardRow {
  id: string;
  name: string;
  platform: string;
  hot: number | null;
  hotWhy: string | null;
  lastError: string | null;
  lastCheckedAt: string | null;
  /** known: the day was read without error, so an empty cell means fully booked, not unknown. */
  cells: Array<{ date: string; times: string[]; bookingUrl: string | null; known: boolean }>;
  free: number;
  unknown: number;
  /** Seconds between reads of this restaurant right now (scarce restaurants are read more often). */
  everySeconds: number;
  lastChange: { at: string; kind: string; date: string; time: string } | null;
}

export function createApi(d: ApiDeps): Hono {
  const startedAt = Date.now();
  const { store } = d;
  const api = new Hono();

  // Guards against other websites. A page on evil.example can make your browser send a request to
  // http://127.0.0.1:4310, but it cannot add a custom header without CORS approval (Seated never
  // grants it), and with DNS rebinding its requests carry a foreign Host header.
  api.use('*', async (c, next) => {
    if (d.localOnly) {
      const host = (c.req.header('host') ?? '').replace(/:\d+$/, '');
      if (!LOCAL_HOSTS.has(host)) {
        return c.json({ error: 'Seated only answers on localhost. Set SEATED_PASSWORD to host it elsewhere.' }, 403);
      }
    }
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.header('x-seated') !== '1') {
      return c.json({ error: 'Missing the X-Seated header.' }, 403);
    }
    await next();
  });

  api.onError((err, c) => {
    if (err instanceof BadRequest) return c.json({ error: err.message }, 400);
    console.error('[api]', err);
    return c.json({ error: 'Something went wrong on the server.' }, 500);
  });

  const supported = (platform: string, uid: string | null) => Boolean(d.platforms[platform] && uid);

  // For uptime monitors and Docker: 503 when the radar has stopped checking or a check hangs.
  api.get('/health', (c) => {
    const watching = store.listWatches('watching').length;
    const [last] = store.listChecks(1);
    const now = Date.now();
    const ageSeconds = last ? Math.round((now - Date.parse(last.finishedAt)) / 1000) : null;
    const hungSeconds = d.radar.progressAt ? Math.round((now - Date.parse(d.radar.progressAt)) / 1000) : 0;
    const moving = d.radar.progressAt !== null && hungSeconds <= 300; // a long check that still makes progress
    // The slowest schedule (many open tables) reads a restaurant every 2.5 × POLL_SECONDS; allow that plus a minute.
    const staleAfter = Math.max(HEALTH_STALE_SECONDS, Math.round(pollInterval(Infinity, false, d.pollSeconds) / 1000) + 60);
    const sinceSeconds = ageSeconds ?? Math.round((now - startedAt) / 1000); // no check yet: count from start
    const stale = watching > 0 && !d.demo && sinceSeconds > staleAfter && !moving;
    const ok = !stale && hungSeconds <= 300;
    return c.json({ ok, watching, lastCheckAt: last?.finishedAt ?? null, ageSeconds, secondsWithoutProgress: hungSeconds }, ok ? 200 : 503);
  });

  // The live board: hard-to-book restaurants with a prime-time watch, ranked by free prime tables (fewest first).
  api.get('/board', (c) => {
    const today = localDate(new Date());
    const dates = Array.from({ length: d.horizonDays }, (_, i) => addDays(today, i)).filter(isPrimeDay);
    const restaurants = new Map(store.listRestaurants().map((r) => [r.id, r]));
    const events = store.listEvents(1000);
    const rows = new Map<string, BoardRow>();
    for (const w of store.listWatches('watching')) {
      const r = restaurants.get(w.restaurantId);
      if (!r || !coversPrime(w)) continue;
      const row = rows.get(r.id) ?? {
        id: r.id,
        name: r.name,
        platform: r.platform,
        hot: r.hot ?? null,
        hotWhy: r.hotWhy ?? null,
        lastError: r.lastError,
        lastCheckedAt: r.lastCheckedAt,
        cells: dates.map((date) => ({ date, times: [] as string[], bookingUrl: null as string | null, known: false })),
        free: 0,
        unknown: 0,
        everySeconds: Math.round(d.radar.intervalFor(r.id) / 1000),
        lastChange: null as { at: string; kind: string; date: string; time: string } | null,
      };
      const read = store.watchCheckedDates(w.id);
      for (const cell of row.cells) if (read.has(cell.date)) cell.known = true;
      for (const s of store.openSightings(w.id)) {
        const cell = row.cells.find((x) => x.date === s.date);
        if (!cell || !isPrime(s.date, s.time) || cell.times.includes(s.time)) continue;
        cell.known = true;
        cell.times.push(s.time);
        cell.times.sort();
        if (cell.times[0] === s.time) cell.bookingUrl = s.bookingUrl; // the link goes to the earliest table
      }
      rows.set(r.id, row);
    }
    // Only changes to tables for the prime party size; a table for four says nothing about a table for two.
    const primeChange = (e: (typeof events)[number]) =>
      e.kind !== 'listed' && e.partySize === PRIME.partySize && e.date !== null && e.time !== null && isPrime(e.date, e.time);
    for (const row of rows.values()) {
      row.free = row.cells.reduce((n, x) => n + x.times.length, 0);
      row.unknown = row.cells.filter((x) => !x.known).length;
      const last = events.find((e) => e.restaurantId === row.id && primeChange(e));
      if (last) row.lastChange = { at: last.at, kind: last.kind, date: last.date!, time: last.time! };
    }
    // Fewest free tables first. A restaurant not read yet has no known count, so it goes last, not first.
    const neverRead = (r: BoardRow) => (r.cells.length > 0 && r.unknown === r.cells.length ? 1 : 0);
    const ranked = [...rows.values()].sort(
      (a, b) => neverRead(a) - neverRead(b) || a.free - b.free || (b.hot ?? 0) - (a.hot ?? 0) || a.name.localeCompare(b.name),
    );
    const feed = events
      .filter((e) => e.kind === 'gap' || (rows.has(e.restaurantId) && (e.kind === 'error' || e.kind === 'recovered' || primeChange(e))))
      .slice(0, 40)
      .map((e) => ({ ...e, restaurantName: rows.get(e.restaurantId)?.name ?? 'Seated' }));
    const [lastCheck] = store.listChecks(1);
    return c.json({
      dates,
      rows: ranked,
      feed,
      lastCheckAt: lastCheck?.finishedAt ?? null,
      nextCheckAt: d.nextCheckAt(),
      running: d.radar.running,
    });
  });

  // Server-sent events: one 'change' message per logged event or finished check, so the board updates at once.
  api.get('/live', (c) =>
    streamSSE(c, async (stream) => {
      const onChange = (what: string) => void stream.writeSSE({ event: 'change', data: what }).catch(() => undefined);
      store.changes.on('change', onChange);
      stream.onAbort(() => {
        store.changes.off('change', onChange);
      });
      while (!stream.aborted) {
        await stream.writeSSE({ event: 'ping', data: '' }); // keeps proxies from closing a quiet stream
        await stream.sleep(25_000);
      }
    }),
  );

  api.get('/state', (c) => {
    const restaurants = new Map(store.listRestaurants().map((r) => [r.id, r]));
    const watches = store.listWatches().map((w) => ({
      ...w,
      restaurant: restaurants.get(w.restaurantId) ?? null,
      openTables: store.openSightings(w.id),
    }));
    const watchById = new Map(watches.map((w) => [w.id, w]));
    const recent = store.recentSightings(40).map((s) => {
      const w = watchById.get(s.watchId);
      return { ...s, restaurantName: w?.restaurant?.name ?? '?', partySize: w?.partySize ?? null };
    });
    return c.json({
      radar: {
        running: d.radar.running,
        lastReport: d.radar.lastReport,
        nextCheckAt: d.nextCheckAt(),
        pollSeconds: d.pollSeconds,
        horizonDays: d.horizonDays,
        autoBookEnabled: d.autoBookEnabled,
        demo: d.demo !== null,
        today: localDate(new Date()),
      },
      watches,
      recent,
      bookings: store.listBookings(),
      settings: store.getSettings(),
    });
  });

  api.get('/restaurants', (c) =>
    c.json(
      store.listRestaurants().map((r) => ({
        id: r.id,
        name: r.name,
        city: r.city,
        address: r.address,
        platform: r.platform,
        custom: r.custom,
        supported: supported(r.platform, r.platformUid),
        canAutoBook: Boolean(d.platforms[r.platform]?.book),
        hot: r.hot,
        hotWhy: r.hotWhy,
      })),
    ),
  );

  // Add a Formitable restaurant that is not on the curated list.
  api.post('/restaurants', async (c) => {
    const body = await c.req.json<{ name?: string; link?: string; city?: string }>();
    const name = body.name?.trim();
    if (!name) throw new BadRequest('Give the restaurant a name.');
    if (!body.link?.trim()) throw new BadRequest('Paste the restaurant website or its Formitable link.');
    let uid: string | null;
    try {
      uid = await resolveFormitableUid(body.link);
    } catch {
      throw new BadRequest('Could not open that website. Check the link.');
    }
    if (!uid) throw new BadRequest('No Formitable booking widget found there. Seated only supports Formitable for now.');
    const existing = store.findRestaurantByUid('formitable', uid);
    if (existing) return c.json(existing);
    let id = slugify(name) || uid;
    if (store.getRestaurant(id)) id = `${id}-${uid}`;
    const website = /^https?:\/\//i.test(body.link.trim()) ? body.link.trim() : null;
    const created = store.addCustomRestaurant({
      id,
      name,
      platform: 'formitable',
      platformUid: uid,
      website,
      city: body.city?.trim() || null,
      address: null,
    });
    return c.json(created, 201);
  });

  api.post('/watches', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const restaurant = store.getRestaurant(String(body.restaurantId ?? ''));
    if (!restaurant) throw new BadRequest('Pick a restaurant.');
    if (!supported(restaurant.platform, restaurant.platformUid)) {
      throw new BadRequest(`${restaurant.name} uses a booking system Seated cannot read yet.`);
    }
    const input = parseWatch(body, false) as WatchInput;
    const watch = store.createWatch({ ...input, restaurantId: restaurant.id }, new Date().toISOString());
    return c.json(watch, 201);
  });

  api.patch('/watches/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const body = await c.req.json<Record<string, unknown>>();
    const patch: Partial<WatchInput & { status: WatchStatus }> = parseWatch(body, true);
    if ('status' in body) {
      if (body.status !== 'watching' && body.status !== 'paused') throw new BadRequest('Status must be watching or paused.');
      patch.status = body.status;
    }
    const existing = store.getWatch(id);
    if (!existing) return c.json({ error: 'Watch not found.' }, 404);
    // Check the order against the stored values too: a PATCH may send only one end of a window.
    const merged = { ...existing, ...patch };
    if (merged.timeFrom > merged.timeTo) throw new BadRequest('The latest time is before the earliest time.');
    if (merged.dateFrom && merged.dateTo && merged.dateFrom > merged.dateTo) {
      throw new BadRequest('The end date is before the start date.');
    }
    if (patch.status === 'watching' && store.hasLiveBooking(id, localDate(new Date()))) {
      throw new BadRequest('This watch already has a table booked. Add a new watch to look for another one.');
    }
    const watch = store.updateWatch(id, patch)!;
    const fields = (w: Watch) => JSON.stringify([w.partySize, w.dateFrom, w.dateTo, w.weekdays, w.timeFrom, w.timeTo]);
    if (watch.status !== 'watching' || fields(watch) !== fields(existing) || existing.status !== 'watching') {
      // Paused, edited or resumed: the open tables no longer describe this watch. Close them quietly and
      // let the next check start fresh, so the activity log does not report them as taken or new.
      store.closeAllSightings(id, new Date().toISOString());
      store.setWatchCheckedDates(id, null);
    }
    return c.json(watch);
  });

  api.delete('/watches/:id', (c) => {
    const ok = store.deleteWatch(Number(c.req.param('id')));
    return ok ? c.body(null, 204) : c.json({ error: 'Watch not found.' }, 404);
  });

  // The user booked a table themselves. Counts as a win, and stops the watch like any booking would.
  api.post('/watches/:id/got-it', async (c) => {
    const id = Number(c.req.param('id'));
    const body = await c.req.json<{ date?: unknown; time?: unknown }>();
    const watch = store.getWatch(id);
    if (!watch) return c.json({ error: 'Watch not found.' }, 404);
    if (watch.status === 'booked') return c.json({ error: 'This watch already has its table.' }, 409);
    if (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) throw new BadRequest('Date must look like 2026-10-09.');
    if (typeof body.time !== 'string' || !/^\d{2}:\d{2}$/.test(body.time)) throw new BadRequest('Time must look like 19:30.');
    const restaurant = store.getRestaurant(watch.restaurantId);
    const booking = store.addBooking({
      watchId: id,
      restaurantId: watch.restaurantId,
      restaurantName: restaurant?.name ?? watch.restaurantId,
      date: body.date,
      time: body.time,
      partySize: watch.partySize,
      status: 'booked',
      reference: null,
      paymentUrl: null,
      error: null,
      createdAt: new Date().toISOString(),
      source: 'you',
      notified: true, // the user told us; no push needed
    });
    store.updateWatch(id, { status: 'booked' });
    store.closeAllSightings(id, new Date().toISOString());
    return c.json(booking);
  });

  // How the radar is doing: openings per restaurant, how long they last, and what turned into a table.
  api.get('/stats', (c) => {
    const days = Math.min(90, Math.max(1, Number(c.req.query('days') ?? 7) || 7));
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const restaurants = new Map(store.listRestaurants().map((r) => [r.id, r]));
    const events = store.listEvents(20_000).filter((e) => e.at >= since).reverse(); // oldest first
    const rows = new Map<string, { id: string; name: string; platform: string; openings: number; lifetimes: number[]; everySeconds: number }>();
    const row = (id: string) => {
      let r = rows.get(id);
      if (!r) {
        const restaurant = restaurants.get(id);
        r = { id, name: restaurant?.name ?? id, platform: restaurant?.platform ?? '?', openings: 0, lifetimes: [], everySeconds: Math.round(d.radar.intervalFor(id) / 1000) };
        rows.set(id, r);
      }
      return r;
    };
    for (const w of store.listWatches('watching')) row(w.restaurantId);
    // Pair each opening with the moment the same table was taken, to learn how long tables last.
    const openSince = new Map<string, string>();
    for (const e of events) {
      const key = `${e.watchId}|${e.date}|${e.time}`;
      if (e.kind === 'opened' || e.kind === 'reopened') {
        row(e.restaurantId).openings++;
        openSince.set(key, e.at);
      } else if (e.kind === 'taken' && openSince.has(key)) {
        row(e.restaurantId).lifetimes.push((Date.parse(e.at) - Date.parse(openSince.get(key)!)) / 60_000);
        openSince.delete(key);
      }
    }
    const median = (xs: number[]) => {
      if (xs.length === 0) return null;
      const s = [...xs].sort((a, b) => a - b);
      return Math.round(s[Math.floor(s.length / 2)]!);
    };
    // Only confirmed tables are wins: an uncertain or unpaid booking may not exist.
    const bookings = store.listBookings(500).filter((b) => b.createdAt >= since && b.status === 'booked');
    const pushed = store.db
      .prepare('SELECT COUNT(*) AS n FROM sightings WHERE first_seen_at >= ? AND notified = 1')
      .get(since) as { n: number };
    return c.json({
      days,
      since,
      restaurants: [...rows.values()]
        .map(({ lifetimes, ...r }) => {
          const medianMinutes = median(lifetimes);
          return {
            ...r,
            gone: lifetimes.length,
            medianMinutes,
            fastestMinutes: lifetimes.length ? Math.round(Math.min(...lifetimes)) : null,
            // Tables vanish faster than we look: the user misses some, and a shorter interval would help.
            tooSlow: medianMinutes !== null && medianMinutes * 60 < r.everySeconds,
          };
        })
        .sort((a, b) => b.openings - a.openings || a.name.localeCompare(b.name)),
      loudAlerts: pushed.n,
      bookedBySeated: bookings.filter((b) => b.source === 'seated').length,
      bookedByYou: bookings.filter((b) => b.source === 'you').length,
    });
  });

  // The user checked their email after an unclear auto-book: no booking was made.
  api.post('/bookings/:id/not-booked', (c) => {
    const ok = store.resolveUncertainBooking(Number(c.req.param('id')));
    return ok ? c.json({ ok }) : c.json({ error: 'Only an unclear booking can be marked as not booked.' }, 400);
  });

  api.post('/check', async (c) => c.json(await d.radar.tick({ all: true })));

  api.put('/settings', async (c) => c.json(store.saveSettings(await c.req.json())));

  api.post('/settings/test-push', async (c) => {
    const ok = await d.notifier.send({
      title: 'Seated is connected',
      body: 'Pushes for open tables will arrive here.',
      priority: 'default',
      tags: ['wave'],
    });
    return ok
      ? c.json({ ok })
      : c.json({ error: 'The push did not go out. Check the topic and your connection.' }, 502);
  });

  if (d.demo) {
    const demo = d.demo;
    api.post('/demo/open', async (c) => {
      const b = await c.req.json<{ restaurantId: string; date: string; time: string }>();
      demo.open(b.restaurantId, b.date, b.time);
      return c.json({ ok: true });
    });
    api.post('/demo/close', async (c) => {
      const b = await c.req.json<{ restaurantId: string; date: string; time: string }>();
      demo.close(b.restaurantId, b.date, b.time);
      return c.json({ ok: true });
    });
  }

  return api;
}
