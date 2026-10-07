import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type Activity, type EventKind } from './api';
import { ago, Badge, Card, dayLabel, SectionLabel } from './ui';

const KIND: Record<EventKind, { label: string; tone: 'teal' | 'amber' | 'green' | 'red' | 'stone'; edge: string }> = {
  listed: { label: 'Open at start', tone: 'stone', edge: 'edge-neutral' },
  opened: { label: 'Opened', tone: 'amber', edge: 'edge-open' },
  reopened: { label: 'Back', tone: 'amber', edge: 'edge-open' },
  taken: { label: 'Taken', tone: 'stone', edge: 'edge-neutral' },
  error: { label: 'Error', tone: 'red', edge: 'edge-urgent' },
  recovered: { label: 'Recovered', tone: 'green', edge: 'edge-booked' },
};

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit', second: '2-digit' });

const PLATFORM: Record<string, string> = { tebi: 'Tebi', formitable: 'Formitable', demo: 'Demo' };

export function ActivityPage() {
  const [data, setData] = useState<Activity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [everything, setEverything] = useState(false);
  const [only, setOnly] = useState<string | null>(null);

  const load = useCallback(() => {
    api.activity().then(
      (d) => {
        setData(d);
        setError(null);
      },
      (e: Error) => setError(e.message),
    );
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(load, 10_000);
    return () => clearInterval(poll);
  }, [load]);

  // Per restaurant: how many tables opened and were taken, over the whole log.
  const counts = useMemo(() => {
    const m = new Map<string, { opened: number; taken: number }>();
    for (const e of data?.events ?? []) {
      const c = m.get(e.restaurantId) ?? { opened: 0, taken: 0 };
      if (e.kind === 'opened' || e.kind === 'reopened') c.opened++;
      if (e.kind === 'taken') c.taken++;
      m.set(e.restaurantId, c);
    }
    return m;
  }, [data]);

  if (!data) return <p className="text-sm text-stone-500">{error ? `Cannot load the activity log: ${error}` : 'Loading…'}</p>;

  const checks = [...data.checks].reverse(); // oldest first, for the strip
  const last = data.checks[0];
  const failed = data.checks.reduce((n, c) => n + c.failedRequests, 0);
  const events = data.events.filter((e) => (everything || e.kind !== 'listed') && (!only || e.restaurantId === only));
  const hiddenListed = data.events.filter((e) => e.kind === 'listed' && (!only || e.restaurantId === only)).length;

  return (
    <div className="space-y-8">
      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Cannot reach Seated ({error}). What you see below may be out of date.
        </p>
      )}
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight text-ink">Activity</h1>
        <p className="mt-1 max-w-2xl text-pretty text-[15px] text-stone-500">
          Every change the radar sees: a table opens, is taken, or comes back. Each bar below is one check, so a quiet log
          still shows the radar is looking.
        </p>
      </div>

      <section aria-labelledby="heartbeat">
        <SectionLabel>
          <span id="heartbeat">Checks · {data.checks.length}</span>
        </SectionLabel>
        <Card className="p-4">
          {checks.length === 0 ? (
            <p className="text-sm text-stone-500">No checks yet.</p>
          ) : (
            <>
              <div className="flex h-8 items-end gap-[3px]" role="img" aria-label={`${checks.length} checks, ${failed} failed requests`}>
                {checks.slice(-60).map((c) => (
                  <span
                    key={c.id}
                    title={`${clock(c.finishedAt)} · ${c.requests} requests · ${c.failedRequests} failed · ${c.newTables} new · ${c.tablesTaken} taken`}
                    className={`w-full max-w-2 rounded-sm ${c.failedRequests ? 'h-8 bg-red-500' : c.newTables || c.tablesTaken ? 'h-8 bg-amber-500/70' : 'h-4 bg-copper-600/60'}`}
                  />
                ))}
              </div>
              <p className="mt-3 text-sm text-stone-600" data-testid="heartbeat">
                Last check {ago(last!.finishedAt)} · <span className="whitespace-nowrap">{last!.restaurants} restaurants</span> ·{' '}
                <span className="whitespace-nowrap">{last!.requests} requests</span>{' '}
                <span className={`whitespace-nowrap ${last!.failedRequests ? 'font-medium text-red-700' : ''}`}>· {last!.failedRequests} failed</span>
              </p>
              <p className="mt-1 text-xs text-stone-500">Amber = something changed. Red = a request failed.</p>
            </>
          )}
        </Card>
      </section>

      <section aria-labelledby="watched">
        <SectionLabel aside={only && <button className="text-xs text-copper-700 hover:underline" onClick={() => setOnly(null)}>Show all</button>}>
          <span id="watched">Restaurants · {data.restaurants.length}</span>
        </SectionLabel>
        <Card>
          <ul className="divide-y divide-stone-100">
            {data.restaurants.map((r) => {
              const c = counts.get(r.id) ?? { opened: 0, taken: 0 };
              return (
                <li key={r.id} className={`${r.lastError ? 'edge-urgent' : r.openNow ? 'edge-open' : 'edge-watching'}`}>
                  <button
                    onClick={() => setOnly(only === r.id ? null : r.id)}
                    aria-pressed={only === r.id}
                    className={`flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-left hover:bg-stone-50 ${only === r.id ? 'bg-stone-50' : ''}`}
                  >
                    <span className="min-w-0">
                      <span className="font-medium text-ink">{r.name}</span>{' '}
                      <span className="font-mono text-[11px] uppercase tracking-wide text-stone-400">{PLATFORM[r.platform] ?? r.platform}</span>
                      {r.lastError && <span className="block text-xs text-red-700">{r.lastError}</span>}
                    </span>
                    <span className="flex items-center gap-3 font-mono text-xs text-stone-500">
                      <span className={r.openNow ? 'text-amber-700' : ''}>{r.openNow} open</span>
                      <span>+{c.opened}</span>
                      <span>−{c.taken}</span>
                      <span className="w-20 text-right">{ago(r.lastCheckedAt)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
        <p className="mt-2 text-xs text-stone-500">Open now · + opened · − taken. Tap a restaurant to see only its changes.</p>
      </section>

      <section aria-labelledby="log">
        <SectionLabel
          aside={
            <label className="flex items-center gap-1.5 text-xs text-stone-500">
              <input type="checkbox" checked={everything} onChange={(e) => setEverything(e.target.checked)} className="accent-copper-600" />
              Show tables open at start ({hiddenListed})
            </label>
          }
        >
          <span id="log">Log{only ? ` · ${data.restaurants.find((r) => r.id === only)?.name ?? ''}` : ''}</span>
        </SectionLabel>
        <Card>
          {events.length === 0 ? (
            <p className="px-4 py-6 text-sm text-stone-500">No changes yet. The radar logs a change the moment it sees one.</p>
          ) : (
            <ol className="divide-y divide-stone-100" data-testid="log">
              {events.map((e) => (
                <li key={e.id} className={`${KIND[e.kind].edge} flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm`} data-testid="log-row">
                  <span className="w-16 font-mono text-xs text-stone-500">{clock(e.at)}</span>
                  <Badge tone={KIND[e.kind].tone}>{KIND[e.kind].label}</Badge>
                  <span className="font-medium text-ink">{e.restaurantName}</span>
                  {e.date && (
                    <span className="text-stone-600">
                      {dayLabel(e.date)} {e.time} · {e.partySize} people
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
