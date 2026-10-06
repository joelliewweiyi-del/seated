import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { existsSync, readFileSync } from 'node:fs';
import { config } from './config.js';
import { Store } from './db.js';
import { createApi } from './api.js';
import { Radar } from './radar.js';
import { formitable } from './platforms/formitable.js';
import { demoPlatform } from './platforms/demo.js';
import type { Platform } from './platforms/types.js';
import { memoryNotifier, ntfyNotifier } from './notify.js';
import { loadCuratedRestaurants } from './restaurants.js';
import { addDays, localDate } from './time.js';

const store = new Store(config.dbPath);
store.seedRestaurants(loadCuratedRestaurants());

const demo = config.demo ? demoPlatform() : null;
const platforms: Record<string, Platform> = { formitable: demo ?? formitable() };
const notifier = demo ? memoryNotifier() : ntfyNotifier(() => store.getSettings());
const radar = new Radar({
  store,
  platforms,
  notifier,
  horizonDays: config.horizonDays,
  autoBookEnabled: config.autoBookEnabled,
});

// ── the check loop ─────────────────────────────────────────────────────────
let nextCheckAt: number | null = null;

function scheduleNext(delayMs: number): void {
  nextCheckAt = Date.now() + delayMs;
  setTimeout(async () => {
    nextCheckAt = null;
    try {
      const r = await radar.tick();
      const failed = r.failedRequests ? `, ${r.failedRequests} failed` : '';
      console.log(
        `[radar] ${r.watches} watches, ${r.requests} requests${failed}, ${r.newTables} new tables, ${r.bookings} booked`,
      );
    } catch (err) {
      console.error('[radar] check crashed:', err);
    }
    // ±10% jitter so we never hit the platform on an exact beat.
    const base = config.pollSeconds * 1000;
    scheduleNext(base * (0.9 + Math.random() * 0.2));
  }, delayMs);
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
  app.use('*', basicAuth({ username: 'seated', password: config.password }));
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
  const mode = config.demo ? ' (DEMO: fake restaurants, no real requests)' : '';
  console.log(`[seated] dashboard on http://${config.host}:${info.port}${mode}`);
  console.log(
    `[seated] checks every ${config.pollSeconds}s, auto-book ${config.autoBookEnabled ? 'ENABLED' : 'off'}`,
  );
});

if (config.demo) {
  if (config.seedDemo) await seedDemo();
  // Demo mode checks only when you press "Check now", so tests stay deterministic.
} else {
  scheduleNext(3000);
}
