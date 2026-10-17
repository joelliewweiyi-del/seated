// Infrastructure settings come from the environment (.env). Things the user edits
// in the dashboard (ntfy topic, guest details) live in the database instead.

try {
  process.loadEnvFile();
} catch {
  // no .env file: defaults apply
}

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const num = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** "00:00-08:00" -> { from, to }. Empty or "off" turns quiet hours off. */
function quietHours(value: string): { from: string; to: string } | null {
  const m = value.trim().match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);
  return m && m[1] !== m[2] ? { from: m[1]!, to: m[2]! } : null;
}

const demo = flag('demo');
/** Observe mode: real restaurants, but record tables only and never push or book. For research. */
const observe = flag('observe');

export const config = {
  demo,
  observe,
  /** Demo mode: also create sample watches and open tables so the dashboard has content. */
  seedDemo: demo && flag('seed'),
  port: num(process.env.PORT, 4310),
  host: process.env.HOST || '127.0.0.1',
  dbPath: demo ? ':memory:' : process.env.SEATED_DB || 'data/seated.db',
  pollSeconds: Math.max(60, num(process.env.POLL_SECONDS, 120)),
  horizonDays: num(process.env.HORIZON_DAYS, 14),
  autoBookEnabled: !observe && (demo || process.env.AUTOBOOK === 'true'),
  password: process.env.SEATED_PASSWORD || '',
  /** Optional: a URL pinged after each check (healthchecks.io and similar). If the pings stop, you get an alert. */
  healthcheckUrl: process.env.HEALTHCHECK_URL || '',
  /** No table pushes in this restaurant-local window; held tables are pushed when it ends. Default 00:00-08:00. */
  quietHours: quietHours(process.env.QUIET_HOURS ?? '00:00-08:00'),
};

export type Config = typeof config;
