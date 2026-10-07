import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Board, type EventKind, type Stats } from './api';
import { ago, Badge, Card, dayLabel, SectionLabel } from './ui';
import { PRIME } from '../shared/prime';
import { platformName } from '../shared/platforms';

const TOP = 10;
/** No finished check for this long means the radar has probably stopped. */
const STALE_MS = 6 * 60_000;
const LEVEL = ['', 'Hard to book', 'Very hard to book', 'Nearly impossible'];
const KIND: Partial<Record<EventKind, { label: string; tone: 'amber' | 'stone' | 'red' | 'green' }>> = {
  opened: { label: 'Opened', tone: 'amber' },
  reopened: { label: 'Back', tone: 'amber' },
  taken: { label: 'Taken', tone: 'stone' },
  error: { label: 'Error', tone: 'red' },
  recovered: { label: 'Recovered', tone: 'green' },
  gap: { label: 'Not checking', tone: 'red' },
};

/** "every 1 min", "every 5 min", "every 90 s". */
const every = (seconds: number) => (seconds === 60 ? 'every minute' : seconds % 60 === 0 ? `every ${seconds / 60} min` : `every ${seconds} s`);
const VERB: Partial<Record<EventKind, string>> = { opened: 'Opened', reopened: 'Back', taken: 'Taken' };

const shortDay = (date: string) => dayLabel(date).split(' ').slice(0, 2).join(' '); // "Fri 9"
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit' });

function Difficulty({ level }: { level: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={LEVEL[level]} title={LEVEL[level]}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={`h-1.5 w-2 rounded-sm ${i <= level ? 'bg-copper-600' : 'bg-stone-300'}`} />
      ))}
    </span>
  );
}

/** Hard-to-book restaurants, ranked live by free prime-time tables. Updates the moment the radar sees a change. */
export function LivePage() {
  const [board, setBoard] = useState<Board | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const [, setClock] = useState(0);
  const seen = useRef<{ rows: Map<string, string>; feedMax: number } | null>(null);
  const requests = useRef({ sent: 0, applied: 0 });

  const load = useCallback(() => {
    api.stats().then(setStats, () => undefined); // the board matters more; stats can wait for the next change
    const id = ++requests.current.sent;
    api.board().then(
      (b) => {
        if (id < requests.current.applied) return; // an older answer that arrived late: keep the newer board
        requests.current.applied = id;
        // Mark what changed since the last load, so it can glow for a moment.
        const sigs = new Map(b.rows.map((r) => [r.id, r.cells.map((c) => c.times.join(',')).join('|')]));
        const fresh = new Set<string>();
        if (seen.current) {
          for (const [id, sig] of sigs) if (seen.current.rows.has(id) && seen.current.rows.get(id) !== sig) fresh.add(id);
          for (const e of b.feed) if (e.id > seen.current.feedMax) fresh.add(`feed-${e.id}`);
        }
        seen.current = { rows: sigs, feedMax: Math.max(0, ...b.feed.map((e) => e.id)) };
        setChanged(fresh);
        setBoard(b);
        setError(null);
      },
      (e: Error) => setError(e.message),
    );
  }, []);

  useEffect(() => {
    load();
    // The server says when something changed; no polling while the stream is up.
    const stream = new EventSource('/api/live');
    let pending: ReturnType<typeof setTimeout> | undefined;
    stream.addEventListener('change', () => {
      clearTimeout(pending);
      pending = setTimeout(load, 400); // one check logs many events: load once they settle
    });
    stream.onopen = () => {
      setConnected(true);
      load(); // changes made while the stream was down are not replayed, so reload on every (re)connect
    };
    stream.onerror = () => setConnected(false); // EventSource reconnects by itself
    const fallback = setInterval(load, 60_000); // in case the stream is down
    const tick = setInterval(() => setClock((c) => c + 1), 5_000); // keeps "x min ago" fresh
    return () => {
      stream.close();
      clearTimeout(pending);
      clearInterval(fallback);
      clearInterval(tick);
    };
  }, [load]);

  if (!board) return <p className="text-sm text-stone-500">{error ? `Cannot load the live board: ${error}` : 'Loading…'}</p>;

  const top = board.rows.slice(0, TOP);
  const rest = board.rows.slice(TOP);
  const soldOut = top.filter((r) => r.free === 0 && r.unknown === 0).length;
  const stale = !board.running && (!board.lastCheckAt || Date.now() - Date.parse(board.lastCheckAt) > STALE_MS);

  return (
    <div className="space-y-8">
      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Cannot reach Seated ({error}). What you see below may be out of date.
        </p>
      )}

      <div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h1 className="text-[28px] leading-tight font-semibold tracking-tight text-ink">Hardest tables in Amsterdam</h1>
          <p className="flex items-center gap-2 text-xs text-stone-500" data-testid="live-status">
            <span className="relative flex size-2">
              {connected && <span className="absolute inline-flex size-full animate-ping rounded-full bg-copper-600 opacity-60 motion-reduce:hidden" />}
              <span className={`relative inline-flex size-2 rounded-full ${connected ? 'bg-copper-600' : 'bg-stone-400'}`} />
            </span>
            <span className="font-mono uppercase tracking-wide">{connected ? 'Live' : 'Reconnecting'}</span>
            <span className={stale ? 'font-medium text-red-700' : ''}>
              · {board.running ? 'checking now…' : `checked ${ago(board.lastCheckAt)}`}
              {stale && '. Is Seated still running?'}
            </span>
          </p>
        </div>
        <p className="mt-1 max-w-2xl text-pretty text-[15px] text-stone-500">
          Fridays and Saturdays, <span className="whitespace-nowrap">{PRIME.timeFrom}–{PRIME.timeTo}</span>, for{' '}
          {PRIME.partySize}. Ranked live: fewest free tables first.{' '}
          {top.length > 0 && (
            <strong className="font-medium text-stone-700">
              {soldOut} of {top.length} are fully booked.
            </strong>
          )}
        </p>
      </div>

      {top.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-stone-600">
            Nothing to rank yet. Search for a restaurant at the top and tap <strong className="font-medium">+ Watch</strong>.
          </p>
        </Card>
      ) : (
        <section aria-labelledby="board">
          <SectionLabel aside={<span className="text-xs text-stone-500">Free tables per evening · tap a number to book</span>}>
            <span id="board">Top {top.length}</span>
          </SectionLabel>
          <Card>
            <div className="hidden items-center gap-3 border-b border-stone-100 px-4 py-2 sm:flex" aria-hidden="true">
              <span className="w-5" />
              <span className="flex-1" />
              {board.dates.map((d) => (
                <span key={d} className="w-12 text-center font-mono text-[10px] uppercase tracking-wide text-stone-500">
                  {shortDay(d)}
                </span>
              ))}
              <span className="w-10 text-right font-mono text-[10px] uppercase tracking-wide text-stone-500">Free</span>
            </div>
            <ol className="divide-y divide-stone-100" data-testid="board">
              {top.map((r, i) => (
                <li
                  key={r.id}
                  data-testid="board-row"
                  className={`${r.lastError ? 'edge-urgent' : r.free ? 'edge-open' : 'edge-neutral'} ${changed.has(r.id) ? 'just-changed' : ''} flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3`}
                >
                  <span className="w-5 font-mono text-sm text-stone-500">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-medium text-ink">{r.name}</span>
                      {r.hot && <Difficulty level={r.hot} />}
                      <span className="font-mono text-[11px] uppercase tracking-wide text-stone-500">{platformName(r.platform)}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-stone-500">
                      {r.lastError ? (
                        <span className="text-red-700">Cannot read right now: {r.lastError}</span>
                      ) : r.unknown === r.cells.length ? (
                        'Not read yet'
                      ) : r.lastChange ? (
                        `${VERB[r.lastChange.kind] ?? r.lastChange.kind} ${shortDay(r.lastChange.date)} ${r.lastChange.time} · ${ago(r.lastChange.at)}`
                      ) : (
                        'No change seen yet'
                      )}
                      {!r.lastError && <span className="whitespace-nowrap"> · read {every(r.everySeconds)}</span>}
                    </p>
                  </div>
                  <div className="flex w-full flex-wrap items-center gap-3 pl-8 sm:w-auto sm:pl-0">
                    {r.cells.map((c) => (
                      <span key={c.date} className="flex w-12 flex-col items-center gap-0.5">
                        <span className="font-mono text-[10px] uppercase text-stone-500 sm:hidden">{shortDay(c.date)}</span>
                        {c.times.length > 0 && c.bookingUrl ? (
                          <a
                            href={c.bookingUrl}
                            target="_blank"
                            rel="noreferrer"
                            title={`${dayLabel(c.date)}: ${c.times.join(', ')}`}
                            aria-label={`${r.name}, ${dayLabel(c.date)}: ${c.times.length} free, book`}
                            className="w-10 rounded-full border border-amber-200 bg-amber-50 py-0.5 text-center font-mono text-xs font-medium text-amber-800 hover:border-amber-400"
                          >
                            {c.times.length}
                          </a>
                        ) : c.known ? (
                          <span
                            aria-label={`${dayLabel(c.date)}: fully booked`}
                            className="w-10 rounded-full bg-stone-100 py-0.5 text-center font-mono text-[10px] uppercase text-stone-500"
                          >
                            full
                          </span>
                        ) : (
                          <span aria-label={`${dayLabel(c.date)}: not read yet`} title="Not read yet" className="w-10 py-0.5 text-center font-mono text-xs text-stone-400">
                            ?
                          </span>
                        )}
                      </span>
                    ))}
                    <span className={`ml-auto w-10 text-right font-mono text-sm font-medium sm:ml-0 ${r.free ? 'text-amber-700' : 'text-stone-400'}`}>
                      <span data-testid="free">{r.free}</span>
                      <span className="text-xs font-normal sm:hidden"> free</span>
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
          {rest.length > 0 && (
            <p className="mt-2 text-xs text-stone-500">
              Also watching, with more free tables: {rest.map((r) => `${r.name} (${r.free})`).join(', ')}.
            </p>
          )}
        </section>
      )}

      {stats && <StatsSection stats={stats} />}

      <section aria-labelledby="feed">
        <SectionLabel aside={<span className="text-xs text-stone-500">Prime-time changes only</span>}>
          <span id="feed">Live feed</span>
        </SectionLabel>
        <Card>
          {board.feed.length === 0 ? (
            <p className="px-4 py-6 text-sm text-stone-500">Quiet so far. A table that opens or is taken shows up here the moment the radar sees it.</p>
          ) : (
            <ol className="divide-y divide-stone-100" data-testid="feed">
              {board.feed.map((e) => (
                <li
                  key={e.id}
                  data-testid="feed-row"
                  className={`${e.kind === 'opened' || e.kind === 'reopened' ? 'edge-open' : e.kind === 'error' || e.kind === 'gap' ? 'edge-urgent' : e.kind === 'recovered' ? 'edge-booked' : 'edge-neutral'} ${changed.has(`feed-${e.id}`) ? 'just-changed' : ''} flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm`}
                >
                  <span className="w-11 font-mono text-xs text-stone-500">{clock(e.at)}</span>
                  <Badge tone={KIND[e.kind]?.tone ?? 'stone'}>{KIND[e.kind]?.label ?? e.kind}</Badge>
                  <span className="font-medium text-ink">{e.restaurantName}</span>
                  {e.date && (
                    <span className="text-stone-600">
                      {dayLabel(e.date)} {e.time}
                    </span>
                  )}
                  {e.detail && <span className="text-xs text-red-700">{e.detail}</span>}
                </li>
              ))}
            </ol>
          )}
        </Card>
      </section>
    </div>
  );
}

/** How fast tables go, and what the alerts turned into. Tells the user whether Seated looks often enough. */
function StatsSection({ stats }: { stats: Stats }) {
  const seen = stats.restaurants.filter((r) => r.openings > 0);
  const quiet = stats.restaurants.filter((r) => r.openings === 0);
  return (
    <section aria-labelledby="stats">
      <SectionLabel aside={<span className="text-xs text-stone-500">All your watches · last {stats.days} days</span>}>
        <span id="stats">How fast tables go</span>
      </SectionLabel>
      <Card>
        <p className="border-b border-stone-100 px-4 py-3 text-sm text-stone-600" data-testid="funnel">
          <strong className="font-medium text-ink">{stats.loudAlerts}</strong> {stats.loudAlerts === 1 ? 'table' : 'tables'} buzzed your phone →{' '}
          <strong className="font-medium text-ink">{stats.bookedByYou}</strong> booked by you,{' '}
          <strong className="font-medium text-ink">{stats.bookedBySeated}</strong> by Seated
        </p>
        {seen.length === 0 ? (
          <p className="px-4 py-4 text-sm text-stone-500">No table has opened yet. Each opening is timed here: how long it stayed free before someone took it.</p>
        ) : (
          <ul className="divide-y divide-stone-100" data-testid="stats">
            {seen.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2 text-sm">
                <span className="w-full font-medium text-ink sm:w-auto sm:min-w-0 sm:flex-1">{r.name}</span>
                <span className="text-stone-600">
                  {r.openings} {r.openings === 1 ? 'opening' : 'openings'}
                  {r.medianMinutes !== null && (
                    <> · {r.medianMinutes === 0 ? 'usually gone within a minute' : `usually gone after ${r.medianMinutes} min`}</>
                  )}
                </span>
                <span className="w-full text-xs text-stone-500 sm:w-auto">
                  read {every(r.everySeconds)}
                  {r.tooSlow && <span className="text-amber-800"> · tables go faster than Seated looks</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        {quiet.length > 0 && (
          <p className="border-t border-stone-100 px-4 py-2 text-xs text-stone-500">No openings yet: {quiet.map((r) => r.name).join(', ')}.</p>
        )}
      </Card>
    </section>
  );
}
