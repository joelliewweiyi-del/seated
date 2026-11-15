// Nightly backup of the map's Supabase project "seated" (characters, lists, reports) to the Mac mini: Supabase's
// free plan keeps none (Joel's go, 15 Nov 2026). Writes ~/.seated-archive/supabase/seated-YYYY-MM-DD.json (mode 600:
// key hashes and IP hashes, never in the repo), keeps the newest 30. A failure pushes to the radar's ntfy topic.
//   SUPABASE_ACCESS_TOKEN=... npx tsx scripts/api-backup.ts              back up now
//   SUPABASE_ACCESS_TOKEN=... npx tsx scripts/api-backup.ts --restore <file>   put a backup back (adds only what is missing)
// The launchd job sh.seated.backup runs it every night (deploy/launchd/sh.seated.backup.plist).
import { chmodSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DUMP_SQL, restoreSql, type Backup } from '../src/server/apiBackup';

const SEATED_PROJECT = 'vczosuhhqvzombqtlscc'; // as in scripts/api-schema.ts (importing it would run it)
const DIR = join(homedir(), '.seated-archive', 'supabase');
const KEEP = 30;

async function query<T>(sql: string): Promise<T> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is not set. Fix: the launchd job reads it from 1Password bara-dev "Supabase CLI:supabase"; check that item and the service account.');
  const res = await fetch(`https://api.supabase.com/v1/projects/${SEATED_PROJECT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase answered ${res.status}: ${text.slice(0, 300)}. Fix: a paused project wakes from the dashboard (supabase.com, project "seated"); a 401 means a new access token in 1Password.`);
  return JSON.parse(text) as T;
}

async function push(message: string): Promise<void> {
  try {
    const db = new DatabaseSync(join(import.meta.dirname, '..', 'data', 'seated.db'), { readOnly: true });
    const row = db.prepare("select value from settings where key = 'ntfyTopic'").get() as { value: string } | undefined;
    db.close();
    if (!row?.value) return;
    await fetch('https://ntfy.sh', { method: 'POST', body: JSON.stringify({ topic: row.value, title: 'Seated backup failed', message, priority: 3 }) });
  } catch {
    // The log has it; a push is a courtesy.
  }
}

async function backup(): Promise<void> {
  const [{ backup: b }] = await query<Array<{ backup: Backup }>>(DUMP_SQL);
  if (!b || !Array.isArray(b.accounts) || !Array.isArray(b.lists) || !Array.isArray(b.reports)) {
    throw new Error('The backup came back without its tables. Fix: run `npx tsx scripts/api-schema.ts`, then this script again.');
  }
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const file = join(DIR, `seated-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(file, JSON.stringify(b));
  chmodSync(file, 0o600);
  const old = readdirSync(DIR).filter((f) => /^seated-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(0, -KEEP);
  for (const f of old) unlinkSync(join(DIR, f));
  console.log(`[backup] ${file}: ${b.accounts.length} characters, ${b.lists.length} lists, ${b.reports.length} reports`);
}

async function restore(path: string): Promise<void> {
  const b = JSON.parse(readFileSync(path, 'utf8')) as Backup;
  await query(restoreSql(b));
  console.log(`[backup] restored ${path}: rows that were missing are back; rows that existed are unchanged.`);
}

const i = process.argv.indexOf('--restore');
try {
  if (i > 0) await restore(process.argv[i + 1] ?? '');
  else await backup();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[backup] failed: ${message}`);
  if (i < 0) await push(message);
  process.exit(1);
}
