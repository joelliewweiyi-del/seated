import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Board, type EventKind, type State } from './api';
import { ago, Badge, Card, dayLabel, SectionLabel } from './ui';
import { PRIME } from '../shared/prime';
import { platformName } from '../shared/platforms';

/** No finished check for this long means the radar has probably stopped. */
const STALE_MS = 6 * 60_000;
const KIND: Partial<Record<EventKind, { label: string; tone: 'amber' | 'stone' | 'red' | 'green' }>> = {
  opened: { label: 'Opened', tone: 'amber' },
  reopened: { label: 'Back', tone: 'amber' },
  taken: { label: 'Taken', tone: 'stone' },
  error: { label: 'Error', tone: 'red' },
  recovered: { label: 'Recovered', tone: 'green' },
  gap: { label: 'Not checking', tone: 'red' },
};

/** "every minute", "every 5 min", "every 90 s". */
const every = (seconds: number) => (seconds === 60 ? 'every minute' : seconds % 60 === 0 ? `every ${seconds / 60} min` : `every ${seconds} s`);
const VERB: Partial<Record<EventKind, string>> = { opened: 'Opened', reopened: 'Back', taken: 'Taken' };

const shortDay = (date: string) => dayLabel(date).split(' ').slice(0, 2).join(' '); // "Fri 9"
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit' });

/** The one screen: your restaurants and their free tables on the coming Thursday, Friday and Saturday. Updates live. */
export function WatchListPage({ state }: { state: State }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const [, setClock] = useState(0);
  const seen = useRef<{ rows: Map<string, string>; feedMax: number } | null>(null);
  const requests = useRef({ sent: 0, applied: 0 });

  const load = useCallback(() => {
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

  // A watch added from the search box: reload, so its row shows before its first check finishes.
  const watchCount = state.watches.length;
  useEffect(() => load(), [watchCount, load]);

  if (!board) return <p className="text-sm text-stone-500">{error ? `Cannot load the watch list: ${error}` : 'Loading…'}</p>;

  const rows = board.rows;
  // Only a list with restaurants can be stale: an empty list has nothing to check.
  const stale = rows.length > 0 && !board.running && (!board.lastCheckAt || Date.now() - Date.parse(board.lastCheckAt) > STALE_MS);

  return (
    <div className="space-y-8">
      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Cannot reach Seated ({error}). What you see below may be out of date.
        </p>
      )}

      {!state.settings.ntfyTopic && !state.radar.demo && (
        <a href="#/settings" className="edge-open block rounded-xl border border-stone-200 bg-white p-4 hover:bg-stone-50">
          <p className="text-sm font-medium text-ink">Phone alerts are off</p>
          <p className="text-sm text-stone-500">Set them up in Settings, or you will only see open tables on this page.</p>
        </a>
      )}

      <div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h1 className="text-[28px] leading-tight font-semibold tracking-tight text-ink">Watch list</h1>
          <p className="flex items-center gap-2 text-xs text-stone-500" data-testid="live-status">
            <span className="relative flex size-2">
              {connected && <span className="absolute inline-flex size-full animate-ping rounded-full bg-copper-600 opacity-60 motion-reduce:hidden" />}
              <span className={`relative inline-flex size-2 rounded-full ${connected ? 'bg-copper-600' : 'bg-stone-400'}`} />
            </span>
            <span className="font-mono uppercase tracking-wide">{connected ? 'Live' : 'Reconnecting'}</span>
            <span className={stale ? 'font-medium text-red-700' : ''}>
              · {board.running ? 'checking now…' : board.lastCheckAt ? `checked ${ago(board.lastCheckAt)}` : 'not checked yet'}
              {stale && '. Is Seated still running?'}
            </span>
          </p>
        </div>
        <p className="mt-1 max-w-2xl text-pretty text-[15px] text-stone-500">
          Thursday, Friday and Saturday, <span className="whitespace-nowrap">{PRIME.timeFrom}–{PRIME.timeTo}</span>, for{' '}
          {PRIME.partySize}. Fewest free tables first.
        </p>
      </div>

      {rows.length === 0 ? (
        <Card className="p-6 text-center">
          <p className="font-medium text-ink">No restaurants yet</p>
          <p className="mt-1 text-sm text-stone-500">
            Search for a restaurant at the top and tap <strong className="font-medium">+ Watch</strong>.
          </p>
        </Card>
      ) : (
        <section aria-labelledby="board">
          <SectionLabel aside={<span className="text-xs text-stone-500">Free tables per evening · tap a number to book</span>}>
            <span id="board">This week</span>
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
              <span className="w-16" />
            </div>
            <ol className="divide-y divide-stone-100" data-testid="board">
              {rows.map((r, i) => (
                <li
                  key={r.id}
                  data-testid="board-row"
                  className={`${r.lastError ? 'edge-urgent' : r.free ? 'edge-open' : 'edge-watching'} ${changed.has(r.id) ? 'just-changed' : ''} flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3`}
                >
                  <span className="w-5 font-mono text-sm text-stone-500">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-medium text-ink">{r.name}</span>
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
                    <span className={`w-10 text-right font-mono text-sm font-medium ${r.free ? 'text-amber-700' : 'text-stone-400'}`}>
                      <span data-testid="free">{r.free}</span>
                      <span className="text-xs font-normal sm:hidden"> free</span>
                    </span>
                    <span className="ml-auto flex w-16 justify-end sm:ml-0">
                      <Remove name={r.name} watchIds={r.watchIds} done={load} />
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </section>
      )}

      <section aria-labelledby="feed">
        <SectionLabel aside={<span className="text-xs text-stone-500">These three evenings only</span>}>
          <span id="feed">Recent changes</span>
        </SectionLabel>
        <Card>
          {board.feed.length === 0 ? (
            <p className="px-4 py-6 text-sm text-stone-500">Quiet so far. A table that opens or is taken shows up here the moment Seated sees it.</p>
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

/** Stops watching a restaurant. Asks once, inline. */
function Remove({ name, watchIds, done }: { name: string; watchIds: number[]; done: () => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!asking) {
    return (
      <button onClick={() => setAsking(true)} aria-label={`Remove ${name}`} className="text-xs text-stone-400 hover:text-red-700">
        Remove
      </button>
    );
  }
  return (
    <span className="flex items-center gap-2 text-xs">
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await Promise.all(watchIds.map((id) => api.deleteWatch(id))).finally(() => setBusy(false));
          done();
        }}
        className="font-medium text-red-700 hover:underline"
      >
        Yes, remove
      </button>
      <button onClick={() => setAsking(false)} className="text-stone-500 hover:text-ink">
        No
      </button>
    </span>
  );
}
