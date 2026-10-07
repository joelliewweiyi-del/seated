import { useEffect, useMemo, useState } from 'react';
import { api, type Restaurant, type State } from './api';
import { Badge, Card, SectionLabel } from './ui';
import { coversPrime, PRIME } from '../shared/prime';

const LEVEL = ['', 'Hard to book', 'Very hard to book', 'Nearly impossible'];
const PLATFORM_NAME: Record<string, string> = {
  formitable: 'Formitable',
  tebi: 'Tebi',
  zenchef: 'Zenchef',
  sevenrooms: 'SevenRooms',
  guestplan: 'Guestplan',
  tablecheck: 'TableCheck',
  thefork: 'TheFork',
  other: 'Unknown system',
};

function Difficulty({ level }: { level: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={LEVEL[level]} title={LEVEL[level]}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={`h-1.5 w-2.5 rounded-sm ${i <= level ? 'bg-copper-600' : 'bg-stone-300'}`} />
      ))}
    </span>
  );
}

export function HotPage({ state, refresh }: { state: State; refresh: () => Promise<void> }) {
  const [restaurants, setRestaurants] = useState<Restaurant[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.restaurants().then(setRestaurants, (e: Error) => setError(e.message));
  }, []);

  const byDifficulty = (a: Restaurant, b: Restaurant) => b.hot! - a.hot! || a.name.localeCompare(b.name);
  const hot = useMemo(() => (restaurants ?? []).filter((r) => r.hot), [restaurants]);
  const watchable = useMemo(() => hot.filter((r) => r.supported).sort(byDifficulty), [hot]);
  const notYet = useMemo(() => hot.filter((r) => !r.supported).sort(byDifficulty), [hot]);

  const watchesBy = useMemo(() => {
    const m = new Map<string, State['watches']>();
    for (const w of state.watches) m.set(w.restaurantId, [...(m.get(w.restaurantId) ?? []), w]);
    return m;
  }, [state.watches]);

  const watchPrime = async (r: Restaurant) => {
    setBusy(r.id);
    setError(null);
    try {
      await api.createWatch({ restaurantId: r.id, ...PRIME });
      await api.check().catch(() => undefined);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the watch.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight text-ink">Hard to book</h1>
        <p className="mt-1 max-w-2xl text-pretty text-[15px] text-stone-500">
          Amsterdam's most wanted tables, from food guides and reviews (October 2026). The hard part is almost always Friday and
          Saturday evening. <strong className="whitespace-nowrap font-medium text-stone-700">+ Watch</strong> watches exactly
          that: 2 people, <span className="whitespace-nowrap">18:30–21:30</span>, Fridays and Saturdays, the next{' '}
          {state.radar.horizonDays} days.
        </p>
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
          {[3, 2, 1].map((l) => (
            <span key={l} className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <Difficulty level={l} /> {LEVEL[l]}
            </span>
          ))}
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {restaurants === null && <p className="text-sm text-stone-500">Loading…</p>}

      {watchable.length > 0 && (
        <section aria-labelledby="can-watch">
          <SectionLabel>
            <span id="can-watch">Seated can watch · {watchable.length}</span>
          </SectionLabel>
          <Card>
            <ul className="divide-y divide-stone-100">
              {watchable.map((r) => {
                const active = (watchesBy.get(r.id) ?? []).filter((w) => w.status === 'watching');
                const open = active.reduce((n, w) => n + w.openTables.length, 0);
                const edge = open > 0 ? 'edge-open' : active.length ? 'edge-watching' : '';
                return (
                  <li key={r.id} className={`${edge} px-4 py-3`} data-testid="hot-row">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                          <p className="font-medium text-ink">{r.name}</p>
                          <Difficulty level={r.hot!} />
                        </div>
                        <p className="mt-0.5 text-sm text-stone-500">
                          <span className="font-mono text-[11px] uppercase tracking-wide text-stone-400">{PLATFORM_NAME[r.platform]}</span>
                          {r.hotWhy && <> · {r.hotWhy}</>}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 pt-0.5">
                        {active.some(coversPrime) ? (
                          <>
                            {open > 0 && <span className="whitespace-nowrap text-sm text-amber-700">{open} open</span>}
                            <Badge tone="teal">Watching</Badge>
                          </>
                        ) : (
                          <button
                            disabled={busy !== null}
                            onClick={() => watchPrime(r)}
                            aria-label={`Watch Friday and Saturday dinners at ${r.name}`}
                            className="whitespace-nowrap rounded-lg border border-stone-300 bg-white px-2.5 py-1 text-xs font-medium text-stone-700 hover:border-copper-600 hover:text-copper-800 disabled:cursor-not-allowed disabled:text-stone-400"
                          >
                            {busy === r.id ? 'Starting…' : '+ Watch'}
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        </section>
      )}

      {notYet.length > 0 && (
        <section aria-labelledby="not-yet">
          <SectionLabel>
            <span id="not-yet">Not supported yet · {notYet.length}</span>
          </SectionLabel>
          <p className="-mt-1 mb-2 text-xs text-stone-500">
            These take bookings through systems Seated cannot read yet.
          </p>
          <Card>
            <ul className="divide-y divide-stone-100">
              {notYet.map((r) => (
                <li key={r.id} className="edge-neutral px-4 py-2.5" data-testid="hot-row">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <p className="font-medium text-stone-600">{r.name}</p>
                    <Difficulty level={r.hot!} />
                  </div>
                  <p className="mt-0.5 text-sm text-stone-500">
                    <span className="font-mono text-[11px] uppercase tracking-wide text-stone-500">{PLATFORM_NAME[r.platform] ?? r.platform}</span>
                    {r.hotWhy && <> · {r.hotWhy}</>}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </div>
  );
}
