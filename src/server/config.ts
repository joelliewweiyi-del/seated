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

const demo = flag('demo');

export const config = {
  demo,
  /** Demo mode: also create sample watches and open tables so the dashboard has content. */
  seedDemo: demo && flag('seed'),
  port: num(process.env.PORT, 4310),
  host: process.env.HOST || '127.0.0.1',
  dbPath: demo ? ':memory:' : process.env.SEATED_DB || 'data/seated.db',
  pollSeconds: Math.max(60, num(process.env.POLL_SECONDS, 120)),
  horizonDays: num(process.env.HORIZON_DAYS, 14),
  autoBookEnabled: demo || process.env.AUTOBOOK === 'true',
  password: process.env.SEATED_PASSWORD || '',
};

export type Config = typeof config;
