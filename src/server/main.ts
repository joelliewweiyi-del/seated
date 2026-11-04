import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
import { runCensus } from './census.js';
import { buildMapData, loadOptOut, loadPlaces } from './mapData.js';

const store = new Store(config.dbPath);
store.seedRestaurants(loadCuratedRestaurants());

const demo = config.demo ? demoPlatform() : null;
const platforms: Record<string, Platform> = demo
  ? demoPlatforms(demo)
  : createPlatforms({ onUidChange: (id, uid) => store.updateRestaurantUid(id, uid), maxDepositCents: config.maxDepositCents });
const notifier = demo || config.observe ? memoryNotifier({ quiet: config.observe }) : ntfyNotifier(() => store.getSettings());
const radar = new Radar({
  store,
  platforms,
  notifier,
  horizonDays: config.horizonDays,
  autoBookEnabled: config.autoBookEnabled,
  pollSeconds: config.pollSeconds,
  quietHours: config.quietHours,
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

// ── the public map's census ────────────────────────────────────────────────
// A few times a day, one calendar read per Amsterdam restaurant (see census.ts). Separate from the radar.
const optOut = loadOptOut();
const places = loadPlaces();
let mapCache: { at: number; body: string } | null = null;
function mapJson(): string {
  if (mapCache && Date.now() - mapCache.at < 30_000) return mapCache.body;
  mapCache = { at: Date.now(), body: JSON.stringify(buildMapData({ store, platforms, places, optOut })) };
  return mapCache.body;
}
function exportMap(): void {
  if (!config.mapExportDir) return;
  try {
    mkdirSync(config.mapExportDir, { recursive: true });
    mapCache = null;
    writeFileSync(`${config.mapExportDir}/data.json`, mapJson());
  } catch (err) {
    console.error(`[census] export failed: ${err instanceof Error ? err.message : err}`);
  }
}
let censusRunning = false;
async function census(): Promise<void> {
  if (censusRunning) return;
  censusRunning = true;
  try {
    await runCensus({ store, platforms, optOut, log: (l) => console.log(l) });
    mapCache = null;
    exportMap();
  } catch (err) {
    console.error('[census] crashed:', err);
  } finally {
    censusRunning = false;
  }
}
function scheduleCensus(firstMs: number): void {
  if (!(config.mapCensusHours > 0)) return;
  setTimeout(async () => {
    await census();
    scheduleCensus(config.mapCensusHours * 3600_000 * (0.9 + Math.random() * 0.2));
  }, firstMs);
}
if (config.mapExportDir) setInterval(exportMap, 5 * 60_000);

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

// The public map (dist/map, built by `npm run build`): a static page plus its data, read-only.
app.get('/map/data.json', (c) => c.body(mapJson(), 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }));
app.get('/map', (c) => c.redirect('/map/'));
app.use('/map/*', serveStatic({ root: 'dist/map', rewriteRequestPath: (p) => p.replace(/^\/map/, '') || '/' }));

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
  // Demo mode checks only when you press "Check now", so tests stay deterministic. The demo calendar
  // never touches the network, so the demo map is filled once at start.
  await census();
} else {
  noteDowntime();
  scheduleNext(3000);
  scheduleCensus(90_000);
}
