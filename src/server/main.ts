import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { existsSync, readFileSync } from 'node:fs';
import { config } from './config.js';
import { Store } from './db.js';
import { createApi } from './api.js';
import { Radar } from './radar.js';
import { demoPlatform } from './platforms/demo.js';
import { createPlatforms, demoPlatforms } from './platforms/index.js';
import type { Platform } from './platforms/types.js';
import { memoryNotifier, ntfyNotifier } from './notify.js';
import { loadCuratedRestaurants } from './restaurants.js';
import { addDays, localDate } from './time.js';

const store = new Store(config.dbPath);
store.seedRestaurants(loadCuratedRestaurants());

const demo = config.demo ? demoPlatform() : null;
const platforms: Record<string, Platform> = demo
  ? demoPlatforms(demo)
  : createPlatforms({ onUidChange: (id, uid) => store.updateRestaurantUid(id, uid) });
const notifier = demo || config.observe ? memoryNotifier({ quiet: config.observe }) : ntfyNotifier(() => store.getSettings());
const radar = new Radar({
  store,
  platforms,
  notifier,
  horizonDays: config.horizonDays,
  autoBookEnabled: config.autoBookEnabled,
  pollSeconds: config.pollSeconds,
});

// ── the check loop ─────────────────────────────────────────────────────────
// The loop wakes every ~15 s and reads the restaurants that are due. Each restaurant has its own
// interval (scarce ones every minute, plentiful ones every few minutes; see pollInterval in radar.ts).
const LOOP_MS = 15_000;
/** A loop that wakes this late was not running in between: the process stalled or the computer slept. */
const GAP_MS = 5 * 60_000;
let nextCheckAt: number | null = null;
let lastLoopAt = Date.now();
let lastPingAt = 0;
/** Did the last check that read anything get at least one answer? Idle loops keep this, so they cannot hide an outage. */
let lastReadsOk = true;

/** Optional dead man's switch: at most one ping a minute while the loop runs. If the pings stop, the service (e.g. healthchecks.io) alerts you. */
async function pingHealthcheck(): Promise<void> {
  if (!config.healthcheckUrl || Date.now() - lastPingAt < 60_000) return;
  lastPingAt = Date.now();
  await fetch(config.healthcheckUrl, { signal: AbortSignal.timeout(10_000) }).catch((err: Error) =>
    console.warn(`[health] ping failed: ${err.message}`),
  );
}

function scheduleNext(delayMs: number): void {
  nextCheckAt = Date.now() + delayMs;
  setTimeout(async () => {
    nextCheckAt = null;
    const now = Date.now();
    if (now - lastLoopAt > GAP_MS) {
      radar.noteGap(new Date(lastLoopAt).toISOString(), new Date(now).toISOString(), 'Seated was paused (computer asleep?)');
    }
    lastLoopAt = now;
    try {
      const r = await radar.tick();
      if (r.restaurants > 0) {
        const failed = r.failedRequests ? `, ${r.failedRequests} failed` : '';
        console.log(
          `[radar] ${r.restaurants} restaurants, ${r.requests} requests${failed}, ${r.newTables} new tables, ${r.bookings} booked`,
        );
      }
      // An idle loop (all watches paused, or nothing due) pings too, unless the last real reads all failed.
      if (r.restaurants > 0) lastReadsOk = r.requests === 0 || r.failedRequests < r.requests;
      if (lastReadsOk) await pingHealthcheck();
    } catch (err) {
      console.error('[radar] check crashed:', err);
    }
    lastLoopAt = Date.now();
    // ±20% jitter so we never hit a platform on an exact beat.
    scheduleNext(LOOP_MS * (0.8 + Math.random() * 0.4));
  }, delayMs);
}

/** On start: if the last check is long ago, Seated was not running. Say so in the log. */
function noteDowntime(): void {
  const [last] = store.listChecks(1);
  if (last && Date.now() - Date.parse(last.finishedAt) > GAP_MS) {
    radar.noteGap(last.finishedAt, new Date().toISOString(), 'Seated was not running');
  }
}

// ── demo data ──────────────────────────────────────────────────────────────
async function seedDemo(): Promise<void> {
  if (!demo) return;
  const today = localDate(new Date());
  const now = new Date().toISOString();
  const evenings = { dateFrom: null, dateTo: null, timeFrom: '18:30', timeTo: '21:00' };
  store.createWatch({ restaurantId: 'cafe-de-klepel', partySize: 2, weekdays: [5, 6], autoBook: false, ...evenings }, now);
  store.createWatch({ restaurantId: 'alba', partySize: 4, weekdays: null, autoBook: false, ...evenings }, now);
  store.createWatch({ restaurantId: 'bistro-feline', partySize: 2, weekdays: null, autoBook: true, ...evenings }, now);
  store.saveSettings({ guestFirstName: 'Demo', guestLastName: 'Guest', guestEmail: 'demo@example.com', guestPhone: '+31600000000' });
  demo.open('alba', addDays(today, 2), '19:30');
  demo.open('alba', addDays(today, 5), '20:00');
  demo.open('bistro-feline', addDays(today, 3), '19:00');
  await radar.tick();
}

// ── http ───────────────────────────────────────────────────────────────────
const app = new Hono();

if (config.password) {
  const auth = basicAuth({ username: 'seated', password: config.password });
  // The health check stays open so uptime monitors and Docker can reach it. It shows no personal data.
  app.use('*', (c, next) => (c.req.path === '/api/health' ? next() : auth(c, next)));
} else if (config.host !== '127.0.0.1' && config.host !== 'localhost') {
  console.warn('[seated] Listening beyond localhost without SEATED_PASSWORD: the API answers only requests to localhost.');
}

app.route(
  '/api',
  createApi({
    store,
    radar,
    platforms,
    notifier,
    demo,
    autoBookEnabled: config.autoBookEnabled,
    pollSeconds: config.pollSeconds,
    horizonDays: config.horizonDays,
    nextCheckAt: () => (nextCheckAt ? new Date(nextCheckAt).toISOString() : null),
    localOnly: !config.password,
  }),
);

const WEB_ROOT = 'dist/web';
if (existsSync(`${WEB_ROOT}/index.html`)) {
  const indexHtml = readFileSync(`${WEB_ROOT}/index.html`, 'utf8');
  app.use('/*', serveStatic({ root: WEB_ROOT }));
  app.get('*', (c) => c.html(indexHtml)); // single-page app: every other path is the dashboard
} else {
  app.get('/', (c) => c.text('Dashboard not built. Run `npm run build`, or use `npm run dev` and open port 5173.'));
}

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  const mode = config.demo
    ? ' (DEMO: fake restaurants, no real requests)'
    : config.observe
      ? ' (OBSERVE: records tables, never pushes or books)'
      : '';
  console.log(`[seated] dashboard on http://${config.host}:${info.port}${mode}`);
  console.log(
    `[seated] reads each restaurant every ${Math.max(60, config.pollSeconds / 2)}-${config.pollSeconds * 2.5}s (scarce ones most often), auto-book ${config.autoBookEnabled ? 'ENABLED' : 'off'}`,
  );
});

if (config.demo) {
  if (config.seedDemo) await seedDemo();
  // Demo mode checks only when you press "Check now", so tests stay deterministic.
} else {
  noteDowntime();
  scheduleNext(3000);
}
