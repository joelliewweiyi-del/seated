import { useEffect, useMemo, useState } from 'react';
import { api, type Restaurant, type State } from './api';
import { go } from './App';
import { Button, Card, Field, inputClass, SectionLabel } from './ui';
import { NO_AUTOBOOK_WHY } from '../shared/platforms';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** Lowercase without accents, so "cafe" finds "Café". */
const fold = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

const TIMES = Array.from({ length: (23 - 11) * 4 + 1 }, (_, i) => {
  const m = 11 * 60 + i * 15;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
});

export function AddWatchPage({ state, refresh }: { state: State; refresh: () => Promise<void> }) {
  const [restaurants, setRestaurants] = useState<Restaurant[] | null>(null);
  const [query, setQuery] = useState('');
  const [city, setCity] = useState('Amsterdam');
  const [picked, setPicked] = useState<Restaurant | null>(null);

  const [partySize, setPartySize] = useState(2);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
  const [dateMode, setDateMode] = useState<'soon' | 'range'>('soon');
  const [dateFrom, setDateFrom] = useState(state.radar.today);
  const [dateTo, setDateTo] = useState(state.radar.today);
  const [timeFrom, setTimeFrom] = useState('18:30');
  const [timeTo, setTimeTo] = useState('21:00');
  const [autoBook, setAutoBook] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.restaurants().then(setRestaurants, (e: Error) => setError(e.message));
  }, []);

  const cities = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of restaurants ?? []) if (r.city) counts.set(r.city, (counts.get(r.city) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c]) => c);
  }, [restaurants]);

  const list = useMemo(() => {
    const q = fold(query.trim());
    return (restaurants ?? [])
      .filter((r) => (q ? fold(r.name).includes(q) : city === 'all' || r.city === city))
      .sort((a, b) => Number(b.supported) - Number(a.supported) || a.name.localeCompare(b.name));
  }, [restaurants, query, city]);

  const guestReady =
    state.settings.guestFirstName && state.settings.guestLastName && state.settings.guestEmail && state.settings.guestPhone;

  const canAuto = Boolean(picked?.canAutoBook && state.radar.autoBookEnabled && guestReady);

  const toggleDay = (d: number) =>
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()));

  const submit = async () => {
    if (!picked) return;
    setSaving(true);
    setError(null);
    try {
      await api.createWatch({
        restaurantId: picked.id,
        partySize,
        weekdays: days.length === 7 ? null : days,
        dateFrom: dateMode === 'range' ? dateFrom : null,
        dateTo: dateMode === 'range' ? dateTo : null,
        timeFrom,
        timeTo,
        autoBook: autoBook && canAuto,
      });
      await api.check().catch(() => undefined); // look straight away, so the user sees a first result
      await refresh();
      go('radar');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the watch.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight text-ink">Add a watch</h1>
        <p className="mt-1 text-[15px] text-stone-500">Seated looks for tables that fit and tells you the moment one opens.</p>
      </div>

      <section aria-labelledby="pick">
        <SectionLabel>
          <span id="pick">1 · Restaurant</span>
        </SectionLabel>
        {picked ? (
          <Card className="edge-watching flex items-center justify-between px-4 py-3">
            <div>
              <p className="font-medium text-ink" data-testid="picked">
                {picked.name}
              </p>
              <p className="text-sm text-stone-500">{picked.address ?? picked.city}</p>
            </div>
            <Button variant="ghost" onClick={() => setPicked(null)}>
              Change
            </Button>
          </Card>
        ) : (
          <Card>
            <div className="space-y-3 border-b border-stone-100 p-3">
              <input
                className={inputClass}
                placeholder="Search restaurants"
                aria-label="Search restaurants"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
              {!query && (
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="City">
                  {[...cities, 'all'].map((c) => (
                    <button
                      key={c}
                      onClick={() => setCity(c)}
                      aria-pressed={city === c}
                      className={`rounded-full border px-2.5 py-0.5 text-xs ${
                        city === c ? 'border-copper-600 bg-copper-50 text-copper-800' : 'border-stone-200 text-stone-600 hover:bg-stone-50'
                      }`}
                    >
                      {c === 'all' ? 'All cities' : c}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <ul className="max-h-80 divide-y divide-stone-100 overflow-y-auto" aria-label="Restaurants">
              {restaurants === null && <li className="px-4 py-3 text-sm text-stone-500">Loading…</li>}
              {restaurants !== null && list.length === 0 && (
                <li className="px-4 py-3 text-sm text-stone-500">No restaurant matches. Add it below.</li>
              )}
              {list.map((r) => (
                <li key={r.id}>
                  <button
                    disabled={!r.supported}
                    onClick={() => setPicked(r)}
                    className="flex w-full items-center justify-between gap-4 px-4 py-2.5 text-left hover:bg-stone-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  >
                    <span className={r.supported ? 'text-ink' : 'text-stone-400'}>
                      <span className="text-sm font-medium">{r.name}</span>
                      <span className="ml-2 text-xs text-stone-500">{r.city}</span>
                    </span>
                    {!r.supported && <span className="font-mono text-[11px] uppercase text-stone-400">{r.platform} · not yet</span>}
                  </button>
                </li>
              ))}
            </ul>
            {restaurants !== null && list.length > 0 && (
              <p className="border-t border-stone-100 px-4 py-2 text-xs text-stone-500">
                {list.length} {list.length === 1 ? 'restaurant' : 'restaurants'}
                {list.length > 7 && ' · scroll for more'}
              </p>
            )}
          </Card>
        )}
        {!picked && <CustomRestaurant onAdded={(r) => setPicked(r)} />}
      </section>

      {picked && (
        <section aria-labelledby="when" className="space-y-6">
          <SectionLabel>
            <span id="when">2 · When</span>
          </SectionLabel>
          <Card className="space-y-6 p-5">
            <div>
              <span className="mb-1 block text-sm font-medium text-stone-700">Party size</span>
              <div className="inline-flex items-center rounded-lg border border-stone-200">
                <button className="px-3 py-1.5 text-stone-600 hover:bg-stone-50" aria-label="Fewer people" onClick={() => setPartySize((n) => Math.max(1, n - 1))}>
                  −
                </button>
                <span className="w-24 text-center text-sm font-medium" data-testid="party-size">
                  {partySize} {partySize === 1 ? 'person' : 'people'}
                </span>
                <button className="px-3 py-1.5 text-stone-600 hover:bg-stone-50" aria-label="More people" onClick={() => setPartySize((n) => Math.min(12, n + 1))}>
                  +
                </button>
              </div>
            </div>

            <div>
              <span className="mb-1 block text-sm font-medium text-stone-700">Days</span>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days of the week">
                {DAYS.map((label, i) => (
                  <button
                    key={label}
                    onClick={() => toggleDay(i + 1)}
                    aria-pressed={days.includes(i + 1)}
                    className={`w-12 rounded-lg border py-1.5 text-sm ${
                      days.includes(i + 1) ? 'border-copper-600 bg-copper-600 font-medium text-white' : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="mb-1 block text-sm font-medium text-stone-700">Dates</span>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" name="dates" checked={dateMode === 'soon'} onChange={() => setDateMode('soon')} className="accent-copper-600" />
                  Any date in the next {state.radar.horizonDays} days
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="dates" checked={dateMode === 'range'} onChange={() => setDateMode('range')} className="accent-copper-600" />
                  Specific dates
                </label>
              </div>
              {dateMode === 'range' && (
                <div className="mt-3 grid max-w-sm grid-cols-2 gap-3">
                  <Field label="From">
                    <input type="date" className={inputClass} value={dateFrom} min={state.radar.today} onChange={(e) => setDateFrom(e.target.value)} />
                  </Field>
                  <Field label="To">
                    <input type="date" className={inputClass} value={dateTo} min={dateFrom} onChange={(e) => setDateTo(e.target.value)} />
                  </Field>
                </div>
              )}
            </div>

            <div className="grid max-w-sm grid-cols-2 gap-3">
              <Field label="Earliest time">
                <select className={inputClass} value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)}>
                  {TIMES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field label="Latest time">
                <select className={inputClass} value={timeTo} onChange={(e) => setTimeTo(e.target.value)}>
                  {TIMES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="border-t border-stone-100 pt-5">
              <label className={`flex items-start gap-3 ${canAuto ? '' : 'opacity-60'}`}>
                <input
                  type="checkbox"
                  className="mt-1 accent-copper-600"
                  checked={autoBook}
                  disabled={!canAuto}
                  onChange={(e) => setAutoBook(e.target.checked)}
                />
                <span>
                  <span className="block text-sm font-medium text-ink">Book it for me</span>
                  <span className="block text-sm text-stone-500">
                    Seated books the first table that fits, in your name, then stops this watch. You get the confirmation by email.
                    Only use this when you will really go.
                  </span>
                  {!picked.canAutoBook && (
                    <span className="mt-1 block text-xs text-stone-500">
                      {NO_AUTOBOOK_WHY[picked.platform] ?? 'Seated cannot book on this booking system.'}
                    </span>
                  )}
                  {picked.canAutoBook && !state.radar.autoBookEnabled && (
                    <span className="mt-1 block text-xs text-stone-500">Auto-book is switched off on this server (AUTOBOOK=true in .env).</span>
                  )}
                  {picked.canAutoBook && state.radar.autoBookEnabled && !guestReady && (
                    <span className="mt-1 block text-xs text-stone-500">
                      Add your name, email and phone in <a className="underline" href="#/settings">Settings</a> first.
                    </span>
                  )}
                </span>
              </label>
            </div>
          </Card>

          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="primary" onClick={submit} disabled={saving || days.length === 0}>
              {saving ? 'Saving…' : 'Start watching'}
            </Button>
            <Button variant="ghost" onClick={() => go('radar')}>
              Cancel
            </Button>
          </div>
        </section>
      )}
      {!picked && error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}

function CustomRestaurant({ onAdded }: { onAdded: (r: Restaurant) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button className="mt-2 text-sm text-copper-700 hover:underline" onClick={() => setOpen(true)}>
        Restaurant not on the list?
      </button>
    );
  }

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.addRestaurant({ name, link });
      onAdded({ ...r, supported: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add it.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mt-3 space-y-3 p-4">
      <p className="text-sm text-stone-600">
        Seated can watch any restaurant that takes bookings through Formitable. Paste its website and Seated will find the booking widget.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Restaurant name" />
        </Field>
        <Field label="Website or Formitable link">
          <input className={inputClass} value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" />
        </Field>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <Button variant="primary" onClick={add} disabled={busy || !name || !link}>
          {busy ? 'Looking…' : 'Add restaurant'}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
