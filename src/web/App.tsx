import { useCallback, useEffect, useState } from 'react';
import { api, type State } from './api';
import { Button } from './ui';
import { SettingsPage } from './SettingsPage';
import { WatchListPage } from './WatchListPage';
import { RestaurantSearch } from './Search';

// One screen (the watch list) plus Settings. Old links (#/live, #/hot, #/add) land on the watch list.
type Route = 'home' | 'settings';

function routeFromHash(): Route {
  return window.location.hash.replace('#/', '').split('?')[0] === 'settings' ? 'settings' : 'home';
}

export function App() {
  const [route, setRoute] = useState<Route>(routeFromHash);
  const [state, setState] = useState<State | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

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
    return () => {
      clearInterval(poll);
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


  return (
    <div className="min-h-screen">
      <div className="h-[3px] bg-copper-600" />
      {state?.radar.demo && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-center text-xs text-amber-900">
          Demo mode: fake restaurants, nothing leaves your computer.
        </div>
      )}
      <header className="relative z-30 border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap sm:gap-x-5">
          <a href="#/" className="flex items-center gap-2 text-ink" aria-label="Seated, watch list">
            <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
              <rect width="32" height="32" rx="7" fill="#0f766e" />
              <circle cx="16" cy="16" r="7" fill="none" stroke="white" strokeWidth="2.5" />
              <circle cx="16" cy="16" r="2" fill="white" />
            </svg>
            <span className="hidden text-[17px] font-semibold tracking-tight sm:inline">Seated</span>
          </a>
          {state && (
            <div className="order-last w-full sm:order-none sm:ml-auto sm:w-auto">
              <RestaurantSearch state={state} refresh={refresh} />
            </div>
          )}
          <div className="ml-auto flex items-center gap-3 sm:ml-0">
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
            <a
              href="#/settings"
              aria-current={route === 'settings' ? 'page' : undefined}
              className={`rounded-lg px-2 py-1.5 text-sm ${route === 'settings' ? 'bg-stone-100 font-medium text-ink' : 'text-stone-500 hover:text-ink'}`}
            >
              Settings
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 pt-8 pb-16">
        {loadError && !state && (
          <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Cannot reach the Seated server: {loadError}. Is it running?
          </p>
        )}
        {state && route === 'home' && <WatchListPage state={state} />}
        {state && route === 'settings' && <SettingsPage state={state} refresh={refresh} />}
      </main>
    </div>
  );
}
