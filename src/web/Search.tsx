import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type Restaurant, type State } from './api';
import { Badge, inputClass } from './ui';
import { coversPrime, PRIME } from '../shared/prime';
import { platformName } from '../shared/platforms';

const fold = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** The one way to add a restaurant: type a name, watch Thursday to Saturday dinners in one tap. */
export function RestaurantSearch({ state, refresh }: { state: State; refresh: () => Promise<void> }) {
  const [restaurants, setRestaurants] = useState<Restaurant[] | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const load = () => {
    if (restaurants === null) api.restaurants().then(setRestaurants, (e: Error) => setError(e.message));
  };

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  const results = useMemo(() => {
    const q = fold(query.trim());
    if (!q) return [];
    return (restaurants ?? [])
      .filter((r) => fold(r.name).includes(q))
      .sort((a, b) => Number(b.supported) - Number(a.supported) || (b.hot ?? 0) - (a.hot ?? 0) || a.name.localeCompare(b.name))
      .slice(0, 8);
  }, [restaurants, query]);

  const watched = (id: string) => state.watches.some((w) => w.restaurantId === id && w.status === 'watching' && coversPrime(w));

  const watch = async (r: Restaurant) => {
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
    <div ref={box} className="relative w-full sm:w-80" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
      <input
        type="search"
        value={query}
        onFocus={() => {
          load();
          setOpen(true);
        }}
        onChange={(e) => {
          load();
          setQuery(e.target.value);
          setOpen(true);
        }}
        placeholder="Search restaurants"
        aria-label="Find a restaurant"
        className={`${inputClass} w-full`}
      />
      {open && query.trim() && (
        <div
          role="region"
          aria-label="Search results"
          className="absolute right-0 left-0 z-20 mt-1 overflow-hidden rounded-xl border border-stone-200 bg-white"
        >
          {restaurants === null ? (
            <p className="px-3 py-3 text-sm text-stone-500">Loading…</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-3 text-sm text-stone-600">
              Nothing called “{query.trim()}” in the list yet.
            </p>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-stone-100 overflow-y-auto">
              {results.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5" data-testid="search-result">
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="flex items-center gap-2 text-sm font-medium text-ink">
                      <span className="truncate">{r.name}</span>
                    </p>
                    <p className="truncate text-xs text-stone-500">
                      <span className="font-mono text-[10px] uppercase tracking-wide">{platformName(r.platform)}</span>
                      {r.city && <> · {r.city}</>}
                    </p>
                  </div>
                  {!r.supported ? (
                    <span className="ml-auto shrink-0 text-xs text-stone-400">Cannot read yet</span>
                  ) : watched(r.id) ? (
                    <span className="ml-auto">
                      <Badge tone="teal">Watching</Badge>
                    </span>
                  ) : (
                    <div className="ml-auto flex shrink-0 items-center gap-2">
                      <button
                        disabled={busy !== null}
                        onClick={() => watch(r)}
                        aria-label={`Watch Thursday to Saturday dinners at ${r.name}`}
                        className="whitespace-nowrap rounded-lg border border-stone-300 bg-white px-2.5 py-1 text-xs font-medium text-stone-700 hover:border-copper-600 hover:text-copper-800 disabled:cursor-not-allowed disabled:text-stone-400"
                      >
                        {busy === r.id ? 'Starting…' : '+ Watch'}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {error && (
            <p role="alert" className="border-t border-stone-100 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          )}
          {results.some((r) => r.supported && !watched(r.id)) && (
            <p className="border-t border-stone-100 px-3 py-1.5 text-[11px] text-stone-500">
              + Watch: Thursday, Friday and Saturday, 18:30–21:30, 2 people
            </p>
          )}
        </div>
      )}
    </div>
  );
}
