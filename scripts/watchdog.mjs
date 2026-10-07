// Watchdog: checks that Seated is running and checking, restarts it if not, and tells you on your phone.
//   node scripts/watchdog.mjs                          check once, push if down (Docker, cron, any OS)
//   node scripts/watchdog.mjs --restart-task "Seated radar"   also restart the Windows scheduled task
// scripts/windows-autostart.ps1 runs it every 5 minutes. It keeps its state in data/watchdog.json and its log
// in data/watchdog.log. It reads the ntfy topic from the Seated database (or NTFY_TOPIC / NTFY_SERVER).
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * What to do, given the health answer and what we knew before. Pure, so it can be tested.
 * health: { ok: boolean } from /api/health, or null when Seated did not answer at all.
 * state: { downSince: string | null, told: boolean }
 * Returns the next state and the actions: 'restart', 'push-down', 'push-up'.
 */
export function decide(health, state, nowIso) {
  const healthy = health?.ok === true;
  if (healthy) {
    if (!state.downSince) return { state, actions: [] };
    return { state: { downSince: null, told: false }, actions: state.told ? ['push-up'] : [] };
  }
  const downSince = state.downSince ?? nowIso;
  // Restart on every failed look; tell the user once per outage, not every five minutes.
  return { state: { downSince, told: true }, actions: state.told ? ['restart'] : ['restart', 'push-down'] };
}

const minutes = (fromIso, toIso) => Math.max(1, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000));

async function main() {
  const args = process.argv.slice(2);
  const taskIndex = args.indexOf('--restart-task');
  const task = taskIndex >= 0 ? args[taskIndex + 1] : null;
  try {
    process.loadEnvFile();
  } catch {
    // no .env
  }
  const port = Number(process.env.PORT) || 4310;
  const statePath = 'data/watchdog.json';
  const log = (line) => appendFileSync('data/watchdog.log', `${new Date().toISOString()} ${line}\n`);

  const health = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(10_000) })
    .then((r) => r.json())
    .catch(() => null);
  const before = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { downSince: null, told: false };
  const now = new Date().toISOString();
  const { state, actions } = decide(health, before, now);
  if (actions.length === 0) return writeFileSync(statePath, JSON.stringify(state));

  const why = health === null ? 'not answering' : `no check for ${health.ageSeconds ?? '?'} s`;
  if (actions.includes('push-down')) {
    // Not delivered: try again on the next run, so a brief ntfy outage does not hide the whole Seated outage.
    state.told = await push(`Seated stopped (${why})`, task ? 'Restarting it now.' : 'Restart it.', 'high');
  }
  writeFileSync(statePath, JSON.stringify(state));
  if (actions.includes('push-up')) await push('Seated is back', `It was down for about ${minutes(before.downSince, now)} min.`, 'default');
  if (actions.includes('restart')) {
    log(`down (${why}); ${task ? `restarting task "${task}"` : 'no restart configured'}`);
    if (task) restartWindowsTask(task, port);
  } else {
    log('back up');
  }
}

/** Stops the task and whatever still holds the port, waits, starts it again. */
function restartWindowsTask(task, port) {
  const ps = [
    `Stop-ScheduledTask -TaskName '${task.replace(/'/g, "''")}' -ErrorAction SilentlyContinue`,
    `$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue`,
    'if ($c) { Stop-Process -Id $c.OwningProcess -Force -Confirm:$false }',
    'Start-Sleep -Seconds 3',
    `Start-ScheduledTask -TaskName '${task.replace(/'/g, "''")}'`,
  ].join('; ');
  execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'ignore', timeout: 60_000 });
}

/** Push through ntfy. The topic comes from the environment or from Seated's own settings. True when delivered. */
async function push(title, message, priority) {
  let server = process.env.NTFY_SERVER || 'https://ntfy.sh';
  let topic = process.env.NTFY_TOPIC || '';
  if (!topic) {
    try {
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync(process.env.SEATED_DB || 'data/seated.db', { readOnly: true });
      const settings = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));
      topic = settings.ntfyTopic ?? '';
      server = settings.ntfyServer || server;
      db.close();
    } catch {
      // no database: no topic
    }
  }
  if (!topic) return false;
  return fetch(server.replace(/\/$/, ''), {
    method: 'POST',
    body: JSON.stringify({ topic, title, message, priority: priority === 'high' ? 4 : 3, tags: ['rotating_light'] }),
    signal: AbortSignal.timeout(10_000),
  }).then((r) => r.ok, () => false);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
