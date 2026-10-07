import { useState } from 'react';
import { api, type Booking, type State, type Watch } from './api';
import { ago, Badge, Button, Card, dayLabel, duration, SectionLabel, weekdayNames } from './ui';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning.';
  if (h < 18) return 'Good afternoon.';
  return 'Good evening.';
}

function criteria(w: Watch, horizonHint: string): string[] {
  const people = `${w.partySize} ${w.partySize === 1 ? 'person' : 'people'}`;
  const days = w.weekdays ? weekdayNames(w.weekdays) : 'Any day';
  const dates =
    w.dateFrom && w.dateTo
      ? w.dateFrom === w.dateTo
        ? `on ${dayLabel(w.dateFrom)}`
        : `${dayLabel(w.dateFrom)} to ${dayLabel(w.dateTo)}`
      : w.dateTo
        ? `until ${dayLabel(w.dateTo)}`
        : horizonHint;
  return [people, days, `${w.timeFrom}–${w.timeTo}`, dates];
}

export function RadarPage({ state, refresh }: { state: State; refresh: () => Promise<void> }) {
  const { watches, recent, bookings, settings, radar } = state;
  const open = watches
    .filter((w) => w.status === 'watching')
    .flatMap((w) => w.openTables.map((t) => ({ table: t, watch: w })))
    .sort((a, b) => `${a.table.date}${a.table.time}`.localeCompare(`${b.table.date}${b.table.time}`));
  const active = watches.filter((w) => w.status === 'watching').length;
  // Most urgent first: open tables, then watching, then paused, then done.
  const rank = (w: Watch) =>
    w.status === 'watching' && w.openTables.length > 0 ? 0 : w.status === 'watching' ? 1 : w.status === 'paused' ? 2 : 3;
  const sorted = [...watches].sort((a, b) => rank(a) - rank(b) || a.id - b.id);
  // A table you booked is not "gone": leave it out, so it does not look as if someone else took it.
  const yours = new Set(bookings.filter((b) => b.status !== 'failed').map((b) => `${b.watchId} ${b.date} ${b.time}`));
  const history = recent.filter((s) => s.goneAt && !yours.has(`${s.watchId} ${s.date} ${s.time}`));
  const watching = new Set(watches.filter((w) => w.status === 'watching').map((w) => w.id));

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-[28px] font-semibold tracking-tight text-ink">{greeting()}</h1>
        <p className="mt-1 text-pretty text-[15px] text-stone-500" data-testid="summary">
          {watches.length === 0
            ? 'Tell Seated where you want to eat. It checks every few minutes and tells you when a table opens.'
            : `Watching ${active} ${active === 1 ? 'restaurant' : 'restaurants'}. ${
                open.length === 0
                  ? 'No matching tables open right now.'
                  : `${open.length} matching ${open.length === 1 ? 'table is' : 'tables are'} open right now.`
              }`}
        </p>
      </section>

      {!settings.ntfyTopic && !radar.demo && (
        <a href="#/settings" className="edge-open block rounded-xl border border-stone-200 bg-white p-4 hover:bg-stone-50">
          <p className="text-sm font-medium text-ink">Phone alerts are off</p>
          <p className="text-sm text-stone-500">Set them up in Settings, or you will only see open tables on this page. It takes two minutes.</p>
        </a>
      )}

      {open.length > 0 && (
        <section aria-labelledby="open-now">
          <SectionLabel>
            <span id="open-now">Open now · {open.length}</span>
          </SectionLabel>
          <Card className="border-amber-200">
            <ul className="divide-y divide-amber-100 bg-amber-50">
              {open.map(({ table, watch }) => (
                <li
                  key={table.id}
                  className="edge-open flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4"
                  data-testid="open-table"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">{watch.restaurant?.name}</p>
                    <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-sm text-stone-600">
                      <span className="whitespace-nowrap">{dayLabel(table.date)}</span>
                      <span className="font-mono text-lg font-semibold text-ink">{table.time}</span>
                      <span className="whitespace-nowrap">{watch.partySize} people</span>
                    </p>
                    <p className="mt-0.5 text-xs text-stone-500">Spotted {ago(table.firstSeenAt)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <GotIt watchId={watch.id} date={table.date} time={table.time} refresh={refresh} />
                    <a
                      href={table.bookingUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex-1 rounded-lg bg-copper-600 px-4 py-2 text-center text-sm font-medium text-white hover:bg-copper-700 sm:flex-none sm:py-1.5"
                    >
                      Book now →
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          <p className="mt-2 text-xs text-stone-500">
            Book now opens the restaurant's own booking page. Formitable and SevenRooms fill in your date and time; on Tebi and
            Guestplan you pick them yourself. Got the table? Tap <strong className="font-medium">I got it</strong> and Seated stops
            that watch.
          </p>
        </section>
      )}

      <BookingsSection bookings={bookings} refresh={refresh} />

      <section aria-labelledby="watching">
        <SectionLabel
          aside={
            watches.length > 0 && (
              <a href="#/add" className="text-sm font-medium text-copper-700 hover:underline">
                + Add watch
              </a>
            )
          }
        >
          <span id="watching">Your watches</span>
        </SectionLabel>
        {watches.length === 0 ? (
          <Card className="px-6 py-10 text-center">
            <p className="font-medium text-ink">No watches yet</p>
            <p className="mx-auto mt-1 max-w-md text-balance text-sm text-stone-500">
              Search for a restaurant at the top and tap <strong className="font-medium">+ Watch</strong>, or add one by its website.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <a href="#/add" className="inline-block rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50">
                Add your first watch
              </a>
            </div>
          </Card>
        ) : (
          <Card>
            <ul className="divide-y divide-stone-100">
              {sorted.map((w) => (
                <WatchRow key={w.id} watch={w} refresh={refresh} horizonHint={`next ${radar.horizonDays} days`} />
              ))}
            </ul>
          </Card>
        )}
      </section>

      {history.length > 0 && (
        <section aria-labelledby="history">
          <SectionLabel>
            <span id="history">Recently gone</span>
          </SectionLabel>
          <p className="-mt-1 mb-2 text-xs text-stone-500">
            How long tables stayed open before someone took them. Was it you? Tap <strong className="font-medium">I got it</strong>.
          </p>
          <Card>
            <ul className="divide-y divide-stone-100 text-sm">
              {history.slice(0, 12).map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2" data-testid="gone-row">
                  <span className="text-ink">
                    {s.restaurantName} · {dayLabel(s.date)} <span className="font-mono">{s.time}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-stone-500">open for {duration(s.firstSeenAt, s.goneAt!)}</span>
                    {watching.has(s.watchId) && <GotIt watchId={s.watchId} date={s.date} time={s.time} refresh={refresh} />}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </div>
  );
}

function WatchRow({ watch: w, refresh, horizonHint }: { watch: Watch; refresh: () => Promise<void>; horizonHint: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const r = w.restaurant;

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
    }
  };

  const edge =
    w.status === 'booked' ? 'edge-booked' : w.status === 'paused' ? 'edge-neutral' : r?.lastError ? 'edge-urgent' : 'edge-watching';

  return (
    <li className={`${edge} px-4 py-3`} data-testid="watch-row">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-ink">{r?.name ?? 'Unknown restaurant'}</p>
            {w.status === 'watching' && <Badge tone="teal">Watching</Badge>}
            {w.status === 'paused' && <Badge tone="stone">Paused</Badge>}
            {w.status === 'booked' && <Badge tone="green">Booked</Badge>}
            {w.autoBook && <Badge tone="stone">Auto-book</Badge>}
          </div>
          <p className="mt-0.5 flex flex-wrap gap-x-1.5 text-sm text-stone-600">
            {criteria(w, horizonHint).map((part, i) => (
              <span key={i} className="whitespace-nowrap">
                {i > 0 && (
                  <span aria-hidden="true" className="mr-1.5 text-stone-400">
                    ·
                  </span>
                )}
                {part}
              </span>
            ))}
          </p>
          <p className="mt-0.5 text-xs text-stone-500">
            {r?.city}
            {w.status === 'watching' && ` · checked ${ago(r?.lastCheckedAt ?? null)}`}
            {w.status === 'watching' && w.openTables.length > 0 && (
              <span className="whitespace-nowrap text-amber-700"> · {w.openTables.length} open now</span>
            )}
          </p>
          {w.status === 'watching' && r?.lastError && (
            <p className="mt-1 text-xs text-red-700">Last check had trouble: {r.lastError}</p>
          )}
          {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
        </div>
        <div className="-ml-3 flex items-center gap-1 sm:ml-0">
          {confirming ? (
            <>
              <span className="mr-1 text-sm text-stone-600">Remove?</span>
              <Button variant="danger" onClick={() => act(() => api.deleteWatch(w.id))}>
                Yes, remove
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Keep
              </Button>
            </>
          ) : (
            <>
              {w.status === 'watching' && (
                <Button variant="ghost" onClick={() => act(() => api.updateWatch(w.id, { status: 'paused' }))}>
                  Pause
                </Button>
              )}
              {w.status === 'paused' && (
                <Button variant="ghost" onClick={() => act(() => api.updateWatch(w.id, { status: 'watching' }))}>
                  Resume
                </Button>
              )}
              <Button variant="ghost" onClick={() => setConfirming(true)}>
                Remove
              </Button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

/** "I got it": the user booked this table. Asks once, inline, because it stops the watch. */
function GotIt({ watchId, date, time, refresh }: { watchId: number; date: string; time: string; refresh: () => Promise<void> }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!asking) {
    return (
      <Button onClick={() => setAsking(true)} className="whitespace-nowrap">
        I got it
      </Button>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-sm">
      <span className="whitespace-nowrap text-stone-600">Stop this watch?</span>
      <Button
        variant="primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await api.gotIt(watchId, date, time).finally(() => setBusy(false));
          await refresh();
        }}
      >
        Yes
      </Button>
      <Button variant="ghost" onClick={() => setAsking(false)}>
        No
      </Button>
    </span>
  );
}

function BookingsSection({ bookings, refresh }: { bookings: Booking[]; refresh: () => Promise<void> }) {
  const shown = bookings.filter((b) => b.status !== 'failed').slice(0, 10);
  if (shown.length === 0) return null;
  return (
    <section aria-labelledby="bookings">
      <SectionLabel>
        <span id="bookings">Your tables</span>
      </SectionLabel>
      <Card>
        <ul className="divide-y divide-stone-100">
          {shown.map((b) => (
            <li
              key={b.id}
              className={`${b.status === 'booked' ? 'edge-booked' : 'edge-urgent'} flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3`}
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink">{b.restaurantName}</p>
                <p className="text-sm text-stone-600">
                  {dayLabel(b.date)} · <span className="font-mono">{b.time}</span> · <span className="whitespace-nowrap">{b.partySize} people</span>
                </p>
                {b.reference && <p className="font-mono text-xs text-stone-500">Ref {b.reference}</p>}
                {b.status === 'uncertain' && (
                  <p className="mt-1 text-xs text-red-700">
                    The restaurant did not answer clearly. Check your email for a confirmation.
                  </p>
                )}
              </div>
              {b.status === 'booked' && <Badge tone="green">{b.source === 'you' ? 'Booked by you' : 'Booked by Seated'}</Badge>}
              {b.status === 'needs_payment' && b.paymentUrl && (
                <a href={b.paymentUrl} target="_blank" rel="noreferrer" className="rounded-lg bg-red-700 px-3 py-1.5 text-sm font-medium text-white">
                  Pay deposit →
                </a>
              )}
              {b.status === 'uncertain' && (
                <Button
                  onClick={async () => {
                    await api.notBooked(b.id);
                    await refresh();
                  }}
                >
                  No booking was made
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
