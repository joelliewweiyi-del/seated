import { useCallback, useEffect, useState } from 'react';
import { api, type State } from './api';
import { ago, Button } from './ui';
import { RadarPage } from './RadarPage';
import { AddWatchPage } from './AddWatchPage';
import { SettingsPage } from './SettingsPage';

type Route = 'radar' | 'add' | 'settings';

function routeFromHash(): Route {
  const h = window.location.hash.replace('#/', '');
  return h === 'add' || h === 'settings' ? h : 'radar';
}

export function go(route: Route): void {
  window.location.hash = route === 'radar' ? '/' : `/${route}`;
}

export function App() {
  const [route, setRoute] = useState<Route>(routeFromHash);
  const [state, setState] = useState<State | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [, setClock] = useState(0);

  const refresh = useCallback(async () => {
    try {
      setState(await api.state());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Cannot reach Seated.');
    }
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    void refresh();
    const poll = setInterval(() => void refresh(), 10_000);
    const tick = setInterval(() => setClock((c) => c + 1), 5_000); // keeps "x min ago" fresh
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [refresh]);

  const checkNow = async () => {
    setChecking(true);
    try {
      await api.check();
      await refresh();
    } finally {
      setChecking(false);
    }
  };

  const lastCheck = state?.radar.lastReport?.finishedAt ?? null;

  return (
    <div className="min-h-screen">
      <div className="h-[3px] bg-copper-600" />
      {state?.radar.demo && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-center text-xs text-amber-900">
          Demo mode: fake restaurants, nothing leaves your computer.
        </div>
      )}
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center gap-x-3 px-4 py-3 sm:gap-x-6">
          <a href="#/" className="flex items-center gap-2 text-ink" aria-label="Seated home">
            <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
              <rect width="32" height="32" rx="7" fill="#0f766e" />
              <circle cx="16" cy="16" r="7" fill="none" stroke="white" strokeWidth="2.5" />
              <circle cx="16" cy="16" r="2" fill="white" />
            </svg>
            <span className="hidden text-[17px] font-semibold tracking-tight sm:inline">Seated</span>
          </a>
          <nav className="flex items-center gap-0.5 text-sm sm:gap-1" aria-label="Main">
            {(
              [
                ['radar', 'Radar'],
                ['add', 'Add watch'],
                ['settings', 'Settings'],
              ] as const
            ).map(([r, label]) => (
              <a
                key={r}
                href={r === 'radar' ? '#/' : `#/${r}`}
                aria-current={route === r ? 'page' : undefined}
                className={`whitespace-nowrap rounded-lg px-2 py-1.5 sm:px-2.5 ${route === r ? 'bg-stone-100 font-medium text-ink' : 'text-stone-500 hover:text-ink'}`}
              >
                {label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-xs text-stone-500 sm:inline" data-testid="last-check">
              {checking || state?.radar.running ? 'Checking…' : lastCheck ? `Checked ${ago(lastCheck)}` : 'Not checked yet'}
            </span>
            <Button
              onClick={checkNow}
              disabled={checking || !state || state.watches.length === 0}
              aria-label="Check now"
              className="whitespace-nowrap max-sm:size-9 max-sm:px-0"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={checking ? 'animate-spin' : ''}>
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <path d="M21 3v6h-6" />
              </svg>
              <span className="max-sm:hidden">Check now</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 pt-8 pb-16">
        {loadError && !state && (
          <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Cannot reach the Seated server: {loadError}. Is it running?
          </p>
        )}
        {state && route === 'radar' && <RadarPage state={state} refresh={refresh} />}
        {state && route === 'add' && <AddWatchPage state={state} refresh={refresh} />}
        {state && route === 'settings' && <SettingsPage state={state} refresh={refresh} />}
      </main>
    </div>
  );
}
