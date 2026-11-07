import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ago, codeOn, dateAt, dayIndex, dayLabel, freeTimes, linkAt, loadData, opensOn, STATUS_COLOUR, STATUS_WORD, statusOf, weekday, type MapData, type MapRestaurant, type Status } from './data';
import { MapView, type Marker } from './render';
import { drawRoom, ROOM_H, ROOM_W } from './room';
import { Marks, metres, michelinWords, useRemembered, walk } from './marks';
import { World } from './world';

const CONTACT = (import.meta.env.VITE_MAP_CONTACT as string | undefined) ?? '';
const REFRESH_MS = 3 * 60_000;
const KIND_WORD: Record<string, string> = {
  bistro: 'Bistro',
  wine: 'Wine bar',
  japanese: 'Japanese',
  fine: 'Fine dining',
  cafe: 'Café',
  pizza: 'Italian',
  greenhouse: 'Greenhouse',
  island: 'Island',
  brasserie: 'Brasserie',
};
const ORDER: Status[] = ['open', 'later', 'full', 'closed', 'unknown'];
/** Booking pages that take no date from a link: the guest picks the day there (Tebi, Guestplan, Frank). */
const NO_DATE_LINK = new Set(['Tebi', 'Guestplan', 'Frank']);
const GROUP_WORD: Record<Status, string> = {
  open: 'Tables free',
  later: 'Not bookable yet',
  full: 'Fully booked',
  closed: 'Closed',
  unknown: 'Book on their site',
};

interface Filters {
  open: boolean;
  stars: boolean;
  bib: boolean;
  hot: boolean;
  fav: boolean;
  /** Sort by walking distance from where you are. */
  near: boolean;
}
const NO_FILTERS: Filters = { open: false, stars: false, bib: false, hot: false, fav: false, near: false };
/** The Dam: where distances start when your own location is unknown or outside Amsterdam. */
const DAM = { lat: 52.3731, lng: 4.8926 };

/** Kinds chosen (stars, Bib, hard to get, saved): a restaurant shows when it is any of them. None chosen: all. */
function inKinds(f: Filters, r: MapRestaurant, favs: Set<string>): boolean {
  if (!f.stars && !f.bib && !f.hot && !f.fav) return true;
  return (
    (f.stars && (r.michelin === '1' || r.michelin === '2' || r.michelin === '3')) ||
    (f.bib && r.michelin === 'bib') ||
    (f.hot && !!r.hot) ||
    (f.fav && favs.has(r.id))
  );
}

interface Placed {
  r: MapRestaurant;
  /** Sign anchor in world pixels: its roof. */
  ax: number;
  ay: number;
  /** False outside the city art: listed, but without a sign. */
  onMap: boolean;
}

function readUrl(): { date: string | null; r: string | null; lens: string | null } {
  const q = new URLSearchParams(location.search);
  return { date: q.get('date'), r: q.get('r'), lens: q.get('lens') };
}

/** A guide's picks only, when a lens is chosen. */
function inLens(lens: string | null, r: MapRestaurant): boolean {
  return !lens || r.g.includes(lens);
}

function badgeFor(r: MapRestaurant, status: Status, date: string): string {
  if (status === 'open') {
    const n = freeTimes(r, date).length;
    return n ? `${n} time${n === 1 ? '' : 's'}` : 'free';
  }
  if (status === 'later') {
    const o = opensOn(r, date);
    return o ? `opens ${dayLabel(o).slice(4)}` : 'soon';
  }
  if (status === 'full') return 'full';
  if (status === 'closed') return 'closed';
  return r.readable ? 'unknown' : 'their site';
}

function stateLine(r: MapRestaurant, status: Status, date: string): string {
  const times = freeTimes(r, date);
  switch (status) {
    case 'open':
      return times?.length ? `Free for two at ${times.join(', ')}.` : 'There is a table for two. The booking page shows the times.';
    case 'full':
      return 'No table for two left that day.';
    case 'closed':
      return 'Closed that day, or not taking bookings online.';
    case 'later': {
      const o = opensOn(r, date);
      return o
        ? `The calendar does not reach this far yet. It opens about ${r.win} days ahead, so around ${dayLabel(o, { long: true })}.`
        : 'The calendar does not reach this far yet.';
    }
    default:
      return r.readable ? 'We could not read this calendar for that day.' : `Books through ${r.platform === 'other' ? 'its own site' : r.platform}, which we cannot read. Their site has the answer.`;
  }
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<MapView | null>(null);
  const [world, setWorld] = useState<World | null>(null);
  const [data, setData] = useState<MapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(readUrl().date);
  const [selected, setSelected] = useState<string | null>(readUrl().r);
  // The guide the map is seen through: from the link, so a lens can be shared. Unknown ids are ignored.
  const [lensId, setLens] = useState<string | null>(readUrl().lens);
  const [filters, setFilters] = useRemembered<Filters>('seated.map.filters', NO_FILTERS);
  const [saved, setSaved] = useRemembered<{ ids: string[] }>('seated.map.saved', { ids: [] });
  const favs = useMemo(() => new Set(saved.ids), [saved]);
  const toggleFav = useCallback((id: string) => setSaved((o) => ({ ids: o.ids.includes(id) ? o.ids.filter((x) => x !== id) : [...o.ids, id] })), [setSaved]);
  const [me, setMe] = useState<{ lat: number; lng: number; note?: string } | null>(null);
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState<'about' | 'restaurants' | null>(null);
  const [collapsed, setCollapsed] = useState(() => matchMedia('(max-width: 900px)').matches);
  const [, tick] = useState(0);

  // Load the world and the data.
  useEffect(() => {
    Promise.all([World.load(), loadData()])
      .then(([w, d]) => {
        setWorld(w);
        setData(d);
      })
      .catch((e: Error) => setError(e.message));
    const timer = setInterval(() => {
      loadData()
        .then(setData)
        .catch(() => {});
      tick((n) => n + 1);
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  // The day: from the link, else today; a day outside the data falls back to today.
  const day = useMemo(() => {
    if (!data) return null;
    const i = date ? dayIndex(data, date) : 0;
    return i >= 0 && i < data.days ? date ?? data.start : data.start;
  }, [data, date]);

  // Where each restaurant stands.
  const placed = useMemo<Placed[]>(() => {
    if (!world || !data) return [];
    return data.restaurants.map((r) => {
      const onMap = world.covers(r.lat, r.lng);
      // Outside his drawing (Noord, the outer districts) the sign stands on the fog, at ground level.
      const a = world.project(r.lat, r.lng, onMap ? r.roof ?? 10 : 0);
      return { r, ax: a.x, ay: a.y, onMap };
    });
  }, [world, data]);

  // Start the map once the world is in.
  useEffect(() => {
    if (!world || !canvasRef.current || viewRef.current) return;
    const view = new MapView(canvasRef.current, world);
    viewRef.current = view;
    // For tests and the curious: the map object, read-only by convention.
    (window as unknown as { seatedMap: MapView }).seatedMap = view;
    tick((n) => n + 1);
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [world]);

  const lens = data?.guides.some((g) => g.id === lensId) ? lensId : null;

  const statusOfR = useCallback((r: MapRestaurant) => (day && data ? statusOf(codeOn(r, data, day)) : 'unknown'), [day, data]);

  // Signs for the day.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !data || !day || !world) return;
    const q = query.trim().toLowerCase();
    const markers: Marker[] = [];
    for (const p of placed) {
      const s = statusOfR(p.r);
      if (!inKinds(filters, p.r, favs)) continue;
      const match = !q || matches(p.r, q);
      const mark = p.r.michelin ? (p.r.michelin === 'bib' ? 'Bib' : '★'.repeat(Number(p.r.michelin))) : '';
      markers.push({
        id: p.r.id,
        name: mark ? `${p.r.name} ${mark}` : p.r.name,
        ax: p.ax,
        ay: p.ay,
        colour: STATUS_COLOUR[s],
        badge: badgeFor(p.r, s, day),
        rank: { open: 300, later: 200, full: 100, closed: 50, unknown: 0 }[s] + (p.r.hot ?? 0) * 20 + (p.r.michelin ? 15 : 0) + (lens && inLens(lens, p.r) ? 400 : 0),
        dim: (filters.open && s !== 'open') || !match || !inLens(lens, p.r),
      });
    }
    view.setMarkers(markers);
    view.keepClear(placed.map((p) => ({ x: p.ax, y: p.ay })));
    view.setYou(me && !me.note && world.covers(me.lat, me.lng) ? world.project(me.lat, me.lng) : null);
  }, [placed, day, data, world, filters, favs, query, statusOfR, me, lens]);

  // Near me: ask once, when the filter is turned on. Outside Amsterdam (or refused), distances start at the Dam.
  useEffect(() => {
    if (!filters.near || me) return;
    if (!('geolocation' in navigator)) {
      setMe({ ...DAM, note: 'Your browser does not share a location: distances are from the Dam.' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (metres(here, DAM) > 15_000) setMe({ ...DAM, note: 'You seem to be outside Amsterdam: distances are from the Dam.' });
        else {
          setMe(here);
          const view = viewRef.current;
          if (view && world?.covers(here.lat, here.lng)) {
            const a = world.project(here.lat, here.lng);
            view.flyTo(a.x, a.y, Math.max(view.cam.z, 1));
          }
        }
      },
      () => setMe({ ...DAM, note: 'Location is off: distances are from the Dam.' }),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }, [filters.near, me, world]);

  // Tell the map which screen areas the panels cover, so no sign hides under them.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const measure = () => {
      const top = document.querySelector('.top')?.getBoundingClientRect();
      const side = document.querySelector('.side > *')?.getBoundingClientRect();
      const foot = document.querySelector('.foot')?.getBoundingClientRect();
      const narrow = innerWidth <= 900;
      const bar = document.querySelector('.top .topbar')?.getBoundingClientRect();
      if (top) document.documentElement.style.setProperty('--top-h', `${Math.ceil(top.bottom)}px`);
      if (bar) document.documentElement.style.setProperty('--bar-h', `${Math.ceil(bar.bottom)}px`);
      view.safe = {
        top: top ? top.bottom : 0,
        right: side && !narrow ? innerWidth - side.left + 6 : 0,
        bottom: narrow && side ? innerHeight - side.top + 6 : foot ? innerHeight - foot.top : 0,
        left: 0,
      };
    };
    measure();
    const ro = new ResizeObserver(measure);
    document.querySelectorAll('.top, .top > *, .side, .foot').forEach((el) => ro.observe(el));
    addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      removeEventListener('resize', measure);
    };
  });

  // Selection: the map tells us, and we tell the map.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.onSelect = (id) => setSelected(id);
    view.selected = selected;
  }, [selected, world, viewRef.current]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the link in step, so a day and a restaurant can be shared.
  useEffect(() => {
    if (!data || !day) return;
    const q = new URLSearchParams();
    if (day !== data.start) q.set('date', day);
    if (selected) q.set('r', selected);
    if (lens) q.set('lens', lens);
    const next = `${location.pathname}${q.toString() ? `?${q}` : ''}`;
    if (next === `${location.pathname}${location.search}`) return;
    try {
      history.replaceState(null, '', next);
    } catch {
      // A sandboxed frame (an embed, a preview) may refuse a URL change. The map works without it.
    }
  }, [day, selected, data, lens]);

  const focus = useCallback(
    (id: string) => {
      const p = placed.find((x) => x.r.id === id);
      const view = viewRef.current;
      setSelected(id);
      if (p && view) {
        // On a phone the card will cover up to 62% of the height once it opens, so plan for that.
        const c = centred(view, p.ax, p.ay, Math.max(view.cam.z, 1), matchMedia('(max-width: 900px)').matches ? innerHeight * 0.62 + 44 : null);
        view.flyTo(c.x, c.y, c.z);
      }
    },
    [placed],
  );

  // The first view: the middle of the restaurants (not the Dam: most sit west and south of it), at a zoom where
  // their names show, centred in the part of the screen the panels leave free. Once, after the panels are measured.
  const homed = useRef(false);
  useEffect(() => {
    const view = viewRef.current;
    if (homed.current || !view || !placed.length || !view.safe.top) return;
    homed.current = true;
    const on = placed.filter((p) => p.onMap);
    const mid = (v: number[]) => v.sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? 0;
    const c = centred(view, mid(on.map((p) => p.ax)), mid(on.map((p) => p.ay)), 0.25, null);
    view.setHome(c.x, c.y, c.z);
  });

  // Open the restaurant from the link once everything is in place.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !selected || !placed.length || !viewRef.current) return;
    opened.current = true;
    focus(selected);
  }, [placed, selected, focus]);

  // Keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT';
      if (e.key === 'Escape') {
        if (dialog) setDialog(null);
        else setSelected(null);
        return;
      }
      if (typing) return;
      const view = viewRef.current;
      if (!view) return;
      const step = 160;
      if (e.key === 'ArrowLeft') view.pan(-step, 0);
      else if (e.key === 'ArrowRight') view.pan(step, 0);
      else if (e.key === 'ArrowUp') view.pan(0, -step);
      else if (e.key === 'ArrowDown') view.pan(0, step);
      else if (e.key === '+' || e.key === '=') view.zoomBy(1);
      else if (e.key === '-') view.zoomBy(-1);
      else if (e.key === '/') {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('.search')?.focus();
      } else return;
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [dialog]);

  if (error) {
    return (
      <div className="loading">
        <div className="px dialog" role="alert">
          <h2>The map did not load</h2>
          <p>{error}. Try again in a minute.</p>
        </div>
      </div>
    );
  }

  const sel = placed.find((p) => p.r.id === selected)?.r ?? null;
  return (
    <div className="app">
      <canvas ref={canvasRef} className="map" aria-label="Pixel map of Amsterdam with a sign over every restaurant" role="img" />
      {!data || !world || !day ? (
        <div className="loading">
          <div className="px" style={{ padding: '12px 16px' }}>
            Drawing Amsterdam…
          </div>
        </div>
      ) : (
        <>
          <TopBar data={data} day={day} onPick={setDate} onAbout={() => setDialog('about')} />

          <aside className={`side${collapsed && !sel ? ' collapsed' : ''}`} aria-label={sel ? sel.name : 'Restaurants'}>
            {sel ? (
              <Card
                r={sel}
                offMap={!placed.find((p) => p.r.id === sel.id)?.onMap}
                data={data}
                day={day}
                status={statusOfR(sel)}
                onLens={(id) => {
                  setLens(id);
                  setSelected(null);
                }}
                saved={favs.has(sel.id)}
                onSave={() => toggleFav(sel.id)}
                onClose={() => setSelected(null)}
                onDay={setDate}
              />
            ) : (
              <List
                data={data}
                day={day}
                placed={placed}
                statusOf={statusOfR}
                filters={filters}
                onFilters={setFilters}
                lens={lens}
                onLens={setLens}
                favs={favs}
                me={filters.near ? me : null}
                query={query}
                collapsed={collapsed}
                onToggle={() => setCollapsed((c) => !c)}
                onQuery={setQuery}
                onPick={focus}
                onDay={setDate}
                nextOpen={nextOpenDay(data, day, (r) => inKinds(filters, r, favs) && inLens(lens, r))}
              />
            )}
          </aside>

          <div className="zoom" role="group" aria-label="Zoom">
            <button className="btn" onClick={() => viewRef.current?.zoomBy(1)} aria-label="Zoom in">
              +
            </button>
            <button className="btn" onClick={() => viewRef.current?.zoomBy(-1)} aria-label="Zoom out">
              −
            </button>
            <button className="btn" onClick={() => viewRef.current?.reset()} aria-label="Back to the whole centre" title="Back to the centre">
              ⌂
            </button>
          </div>
          {Date.now() - Date.parse(data.generatedAt) > 6 * 3600_000 && (
            <div className="px toast" role="status">
              These calendars were read {ago(data.generatedAt)}.
            </div>
          )}

          <footer className="foot">
            Art <a href="https://sezlab.dev/amsterdam">sezlab</a> (<a href="https://github.com/sponsors/sezkus">sponsor</a>) · ©{' '}
            <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>
          </footer>
        </>
      )}
      {dialog && <Dialog kind={dialog} onKind={setDialog} onClose={() => setDialog(null)} />}
    </div>
  );
}

/** The camera that puts world point (x, y) in the middle of the screen the panels leave free. */
function centred(view: MapView, x: number, y: number, z: number, bottom: number | null): { x: number; y: number; z: number } {
  const s = view.safe;
  const cx = (s.left + (innerWidth - s.right)) / 2;
  const cy = (s.top + (innerHeight - (bottom ?? s.bottom))) / 2 + 24;
  return { x: x + (innerWidth / 2 - cx) / z, y: y + (innerHeight / 2 - cy) / z, z };
}

function nextOpenDay(data: MapData, day: string, shown: (r: MapRestaurant) => boolean): string | null {
  for (let i = dayIndex(data, day) + 1; i < data.days; i++) {
    if (data.restaurants.some((r) => shown(r) && r.d[i] === 'o')) return dateAt(data, i);
  }
  return null;
}

/** The first day after `day` with a free table at this restaurant. */
function firstFree(r: MapRestaurant, data: MapData, day: string): string | null {
  const i = r.d.indexOf('o', dayIndex(data, day) + 1);
  return i < 0 ? null : dateAt(data, i);
}

/** Search: name, area, kind of food or MICHELIN distinction. */
function matches(r: MapRestaurant, q: string): boolean {
  const hay = [r.name, r.area, KIND_WORD[r.kind] ?? '', michelinWords(r) ?? ''].join(' ').toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

function Mark() {
  return (
    <svg className="brand-mark" viewBox="0 0 14 14" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="0" y="0" width="14" height="14" fill="#2b2733" />
      <rect x="1" y="1" width="12" height="12" fill="#ffcf4a" />
      <rect x="3" y="5" width="8" height="2" fill="#2b2733" />
      <rect x="4" y="7" width="1" height="4" fill="#2b2733" />
      <rect x="9" y="7" width="1" height="4" fill="#2b2733" />
      <rect x="6" y="3" width="2" height="2" fill="#e0604c" />
      {/* Candle flame: two pixels that take turns. */}
      <rect className="flame a" x="6" y="2" width="1" height="1" fill="#f26b1d" />
      <rect className="flame b" x="7" y="2" width="1" height="1" fill="#f26b1d" />
      {/* Two chairs that slide up to the table once, on load. */}
      <g className="chair l" fill="#2b2733">
        <rect x="1" y="4" width="1" height="7" />
        <rect x="2" y="8" width="1" height="1" />
      </g>
      <g className="chair r" fill="#2b2733">
        <rect x="12" y="4" width="1" height="7" />
        <rect x="11" y="8" width="1" height="1" />
      </g>
    </svg>
  );
}

/** True on a phone-sized screen; follows a resize or a turn of the phone. */
function useNarrow(): boolean {
  const q = '(max-width: 900px)';
  const [narrow, setNarrow] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}

/** The days most people look for: today, the coming Friday and Saturday, and New Year's Eve in range. */
function quickDays(data: MapData): Array<[string, string]> {
  const days = Array.from({ length: data.days }, (_, i) => dateAt(data, i));
  const first = (wd: number) => days.find((d) => weekday(d) === wd) ?? days[0]!;
  const quick: Array<[string, string]> = [
    ['Today', days[0]!],
    ['Fri', first(5)],
    ['Sat', first(6)],
  ];
  const nye = days.find((d) => d.endsWith('-12-31'));
  if (nye) quick.push(['NYE', nye]);
  return quick;
}

function Quick({ data, day, onPick }: { data: MapData; day: string; onPick: (d: string) => void }) {
  return (
    <div className="quick">
      {quickDays(data).map(([label, d]) => (
        <button key={label} className="chip" aria-pressed={d === day} onClick={() => onPick(d)} aria-label={label === 'NYE' ? "New Year's Eve" : undefined}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** One slim bar: the brand, the day with a step either side, and How it works. All days open from the day itself. */
function TopBar({ data, day, onPick, onAbout }: { data: MapData; day: string; onPick: (d: string) => void; onAbout: () => void }) {
  const narrow = useNarrow();
  const [open, setOpen] = useState(false);
  const i = dayIndex(data, day);
  const step = (by: number) => {
    const to = i + by;
    if (to >= 0 && to < data.days) onPick(dateAt(data, to));
  };
  return (
    <header className="top">
      <div className="px topbar">
        <div className="brand">
          <Mark />
          <h1>Seated</h1>
        </div>
        <div className="daynav">
          <button className="step" aria-label="Day before" disabled={i <= 0} onClick={() => step(-1)}>
            ‹
          </button>
          <button className="daypill" aria-expanded={open} aria-controls="days" onClick={() => setOpen((o) => !o)}>
            <span>{dayLabel(day, { long: !narrow })}</span>
            <span className="caret" aria-hidden="true">
              ▾
            </span>
          </button>
          <button className="step" aria-label="Day after" disabled={i >= data.days - 1} onClick={() => step(1)}>
            ›
          </button>
        </div>
        {!narrow && <Quick data={data} day={day} onPick={onPick} />}
        <button className="about" onClick={onAbout}>
          <span className="long">How it works</span>
          <span className="short" aria-hidden="true">
            ?
          </span>
          <span className="sr">How it works</span>
        </button>
      </div>
      {open && (
        <DateStrip
          data={data}
          day={day}
          quick={narrow}
          onPick={(d, how) => {
            onPick(d);
            if (narrow && how === 'click') setOpen(false);
          }}
        />
      )}
    </header>
  );
}

function DateStrip({ data, day, quick, onPick }: { data: MapData; day: string; quick: boolean; onPick: (d: string, how: 'click' | 'key') => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const days = useMemo(() => Array.from({ length: data.days }, (_, i) => dateAt(data, i)), [data]);
  const readable = data.restaurants.filter((r) => r.readable).length || 1;
  const open = useMemo(() => days.map((_, i) => data.restaurants.filter((r) => r.d[i] === 'o').length), [data, days]);
  useEffect(() => {
    ref.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [day]);
  return (
    <nav className="px dates" id="days" aria-label="Day">
      {quick && <Quick data={data} day={day} onPick={(d) => onPick(d, 'click')} />}
      <div className="strip-wrap">
      {/* One tab stop for all days: the chosen one. Arrow keys move the day (and not the map). */}
      <div
        className="strip"
        ref={ref}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          e.stopPropagation();
          const to = days[days.indexOf(day) + (e.key === 'ArrowRight' ? 1 : -1)];
          if (!to) return;
          onPick(to, 'key');
          requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus());
        }}
      >
        {days.map((d, i) => {
          const wd = weekday(d);
          const first = i === 0 || d.endsWith('-01');
          return (
            <button
              key={d}
              className={`day${wd === 0 || wd === 6 || wd === 5 ? ' weekend' : ''}${first ? ' month-start' : ''}`}
              data-month={dayLabel(d).split(' ')[2]}
              aria-pressed={d === day}
              tabIndex={d === day ? 0 : -1}
              aria-label={`${dayLabel(d, { long: true })}: ${open[i]} with a table`}
              title={`${open[i]} restaurants with a table for two`}
              onClick={() => onPick(d, 'click')}
            >
              <div className="wd">{dayLabel(d).slice(0, 3)}</div>
              <div className="dn">{Number(d.slice(8))}</div>
              <span className="bar">
                <i style={{ width: `${Math.min(100, (open[i]! / readable) * 100 * 2)}%` }} />
              </span>
            </button>
          );
        })}
      </div>
      <button className="chip later" aria-label="Later days" onClick={() => ref.current?.scrollBy({ left: ref.current.clientWidth * 0.8 })}>
        ›
      </button>
      </div>
    </nav>
  );
}

interface ListProps {
  data: MapData;
  day: string;
  placed: Placed[];
  statusOf: (r: MapRestaurant) => Status;
  filters: Filters;
  onFilters: (f: Filters) => void;
  /** The guide the list is seen through, or null for every restaurant. */
  lens: string | null;
  onLens: (id: string | null) => void;
  favs: Set<string>;
  /** Where distances start, when "Near me" is on. */
  me: { lat: number; lng: number; note?: string } | null;
  query: string;
  collapsed: boolean;
  onToggle: () => void;
  onQuery: (v: string) => void;
  onPick: (id: string) => void;
  onDay: (d: string) => void;
  /** The next day after this one with any free table among the rows shown. */
  nextOpen: string | null;
}

const CHIPS: Array<[keyof Filters, string]> = [
  ['open', 'Free only'],
  ['near', 'Near me'],
  ['stars', '★ Stars'],
  ['bib', 'Bib Gourmand'],
  ['hot', 'Hard to get'],
  ['fav', 'Saved'],
];

function List(p: ListProps) {
  const q = p.query.trim().toLowerCase();
  const f = p.filters;
  const hasMichelin = p.placed.some((x) => x.r.michelin);
  const rows = p.placed
    .map((x) => ({ r: x.r, s: p.statusOf(x.r), m: p.me ? metres(p.me, x.r) : 0 }))
    .filter(({ r, s }) => inLens(p.lens, r) && inKinds(f, r, p.favs) && (!f.open || s === 'open') && (!q || matches(r, q)))
    .sort((a, b) =>
      p.me
        ? a.m - b.m
        : ORDER.indexOf(a.s) - ORDER.indexOf(b.s) ||
          Number(b.r.michelin === '3') - Number(a.r.michelin === '3') ||
          (b.r.hot ?? 0) - (a.r.hot ?? 0) ||
          a.r.name.localeCompare(b.r.name),
    );
  const guide = p.data.guides.find((g) => g.id === p.lens) ?? null;
  const seen = p.placed.filter((x) => inLens(p.lens, x.r));
  const openCount = seen.filter((x) => p.statusOf(x.r) === 'open').length;
  const hotOpen = seen.filter((x) => x.r.hot && p.statusOf(x.r) === 'open').length;
  const anyKind = f.stars || f.bib || f.hot || f.fav;
  const active = CHIPS.filter(([k]) => f[k]).map(([, label]) => label);
  const [scroller, more, check] = useMore<HTMLUListElement>(`${rows.length}${q}${active}${p.lens}`);
  let last: Status | null = null;
  return (
    <section className="px list">
      <div className="list-head">
        <button className="row head-toggle" onClick={p.onToggle} aria-expanded={!p.collapsed}>
          <span className="stud" style={{ background: STATUS_COLOUR.open }} aria-hidden="true" />
          <h2>{openCount} with a table</h2>
          <p className="sum">
            for two, of {guide ? `${seen.length} ${guide.short} picks` : `${p.placed.length} restaurants`}
            {hotOpen ? `; ${hotOpen} hard to get` : ''}
          </p>
          <span className="sheet-toggle" aria-hidden="true">
            {p.collapsed ? 'List ▴' : 'Map ▾'}
          </span>
        </button>
        {guide && (
          <p className="lens-line">
            <span>{guide.line}</span>{' '}
            <a href={guide.url} target="_blank" rel="noopener noreferrer">
              Their list ↗
            </a>
            <button className="link" onClick={() => p.onLens(null)}>
              Every restaurant
            </button>
          </p>
        )}
        {active.length > 0 && (
          <p className="active">
            Only: {active.join(', ')}
            <button className="link" onClick={() => p.onFilters(NO_FILTERS)}>
              Show all
            </button>
          </p>
        )}
        <div className="filters">
          <input className="search" type="search" placeholder="Name, area or food  /" value={p.query} onChange={(e) => p.onQuery(e.target.value)} aria-label="Find a restaurant" />
          <div className="chips" role="group" aria-label="Show">
            {p.data.guides.length > 0 && (
              <select className="chip lens" data-on={p.lens ? '' : undefined} value={p.lens ?? ''} onChange={(e) => p.onLens(e.target.value || null)} aria-label="Seen through a guide">
                <option value="">Guides</option>
                {p.data.guides.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.short} ({p.placed.filter((x) => x.r.g.includes(g.id)).length})
                  </option>
                ))}
              </select>
            )}
            {CHIPS.filter(([k]) => hasMichelin || (k !== 'stars' && k !== 'bib')).map(([k, label]) => (
              <button key={k} className="chip" aria-pressed={f[k]} onClick={() => p.onFilters({ ...f, [k]: !f[k] })}>
                {label}
                {k === 'fav' && p.favs.size ? ` ${p.favs.size}` : ''}
              </button>
            ))}
          </div>
        </div>
        {p.me?.note && <p className="note">{p.me.note}</p>}
      </div>
      <ul className="rows" ref={scroller} onScroll={check}>
        {rows.length === 0 && (
          <li className="empty">
            {f.open ? `Nothing free on ${dayLabel(p.day)}${anyKind ? ' among these' : ''}.` : q ? 'No restaurant matches that.' : 'None of these yet.'}
            {f.fav && !p.favs.size && <div>Save a restaurant from its card with ♥ and it shows here.</div>}
            {f.open && p.nextOpen && (
              <div>
                <button className="btn small" onClick={() => p.onDay(p.nextOpen!)}>
                  Next day with a table: {dayLabel(p.nextOpen)}
                </button>
              </div>
            )}
          </li>
        )}
        {rows.map(({ r, s, m }) => {
          const head = !p.me && s !== last;
          last = s;
          const next = s !== 'open' && r.readable ? firstFree(r, p.data, p.day) : null;
          return (
            <li key={r.id}>
              {head && <div className="group label">{GROUP_WORD[s]}</div>}
              <button className="row" onClick={() => p.onPick(r.id)}>
                <span className="stud" style={{ background: STATUS_COLOUR[s] }} />
                <span className="who">
                  <span className="nm">
                    {r.name}
                    {p.favs.has(r.id) && <span className="fav-dot" aria-label="saved"> ♥</span>}
                  </span>
                  <Marks r={r} />
                  <span className="ar">
                    {p.me ? `${walk(m)} · ` : ''}
                    {r.area}
                    {next ? ` · free ${dayLabel(next).slice(0, 10)}` : ''}
                  </span>
                </span>
                <span className="badge" style={{ background: STATUS_COLOUR[s] }}>
                  {badgeFor(r, s, p.day)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {more && <MoreBar />}
      <div className="list-foot">
        <span>Calendars read {ago(p.data.generatedAt)}</span>
        <span className="key">
          {ORDER.map((st) => (
            <span key={st}>
              <i className="swatch" style={{ background: STATUS_COLOUR[st] }} /> {STATUS_WORD[st].toLowerCase()}
            </span>
          ))}
          {hasMichelin && (
            <>
              <span>
                <Marks r={{ michelin: '1' } as MapRestaurant} /> MICHELIN Star
              </span>
              <span>
                <Marks r={{ michelin: 'bib' } as MapRestaurant} /> Bib Gourmand
              </span>
            </>
          )}
          <span>
            <Marks r={{ hot: 1 } as MapRestaurant} /> hard to get
          </span>
        </span>
      </div>
    </section>
  );
}

function RoomCanvas({ kind, status, free, seed }: { kind: string; status: Status; free: number; seed: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.getContext('2d')!.putImageData(drawRoom({ kind, status, free, seed }).toImageData(), 0, 0);
  }, [kind, status, free, seed]);
  return <canvas ref={ref} width={ROOM_W} height={ROOM_H} role="img" aria-label={`Inside: ${STATUS_WORD[status].toLowerCase()}`} />;
}

interface CardProps {
  r: MapRestaurant;
  offMap: boolean;
  data: MapData;
  day: string;
  status: Status;
  saved: boolean;
  onSave: () => void;
  onClose: () => void;
  onDay: (d: string) => void;
  /** Show the map through one of the guides that pick this restaurant. */
  onLens: (id: string) => void;
}

/** True while a scrolling box has more below its fold (then a MoreBar shows under it). */
function useMore<T extends HTMLElement>(key: unknown): [RefObject<T | null>, boolean, () => void] {
  const ref = useRef<T>(null);
  const [more, setMore] = useState(false);
  const check = useCallback(() => {
    const e = ref.current;
    if (e) setMore(e.scrollTop + e.clientHeight < e.scrollHeight - 4);
  }, []);
  useEffect(() => {
    const e = ref.current;
    if (!e) return;
    check();
    const ro = new ResizeObserver(check);
    ro.observe(e);
    for (const child of e.children) ro.observe(child);
    return () => ro.disconnect();
  }, [check, key]);
  return [ref, more, check];
}

/** Share the card's link: the phone's share sheet where there is one, else copy it. */
async function share(r: MapRestaurant, day: string): Promise<string> {
  const url = `${location.origin}${location.pathname}?r=${encodeURIComponent(r.id)}&date=${day}`;
  const text = `${r.name}, ${dayLabel(day, { long: true })}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: r.name, text, url });
      return '';
    }
    await navigator.clipboard.writeText(url);
    return 'Link copied';
  } catch {
    return '';
  }
}

function Card({ r, offMap, data, day, status, saved, onSave, onClose, onDay, onLens }: CardProps) {
  const times = freeTimes(r, day);
  const lunch = times.filter((t) => t < '16:00');
  const dinner = times.filter((t) => t >= '16:00');
  const next = status !== 'open' && r.readable ? firstFree(r, data, day) : null;
  const [shared, setShared] = useState('');
  // The time the guest picked; the first free one until they pick. Book and the hint follow it.
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => setPicked(null), [r.id, day]);
  const pick = picked && times.includes(picked) ? picked : times[0] ?? null;
  const words = michelinWords(r);
  const dayLink = r.book[day] ?? r.link;
  const book = status === 'open' && pick && dayLink ? linkAt(dayLink, pick) : dayLink;
  const seed = useMemo(() => [...r.id].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) % 1000, [r.id]);
  // Calendar: weeks from the Monday on or before the first day.
  const lead = (weekday(data.start) + 6) % 7;
  const cells: Array<string | null> = [...Array(lead).fill(null), ...Array.from({ length: data.days }, (_, i) => dateAt(data, i))];
  const [scroller, more, check] = useMore<HTMLDivElement>(r.id);
  return (
    <section className="px card">
      <div className="card-scroll" ref={scroller} onScroll={check}>
        <div className="room">
          <RoomCanvas kind={r.kind} status={status} free={times.length || 3} seed={seed} />
          <button className="btn small close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="card-body">
          <div className="title-row">
            <h2>{r.name}</h2>
            <button className={`btn small save${saved ? ' on' : ''}`} aria-pressed={saved} onClick={onSave} title={saved ? 'Saved on this device' : 'Save on this device'}>
              {saved ? '♥ Saved' : '♡ Save'}
            </button>
          </div>
          <p className="where">
            {KIND_WORD[r.kind] ?? 'Restaurant'} · {r.area}
          </p>
          {(words || r.hot) && (
            <p className="distinction">
              <Marks r={r} />
              <span>{[words, r.hot ? 'hard to get' : null].filter(Boolean).join(' · ')}</span>
            </p>
          )}
          {r.g.length > 0 && (
            <p className="where guides">
              In{' '}
              {data.guides
                .filter((g) => r.g.includes(g.id))
                .map((g, i) => (
                  <span key={g.id}>
                    {i > 0 && ' · '}
                    <button className="link" onClick={() => onLens(g.id)} title={g.line}>
                      {g.short}
                    </button>
                  </span>
                ))}
            </p>
          )}
          {offMap && <p className="where">Outside the drawn city: its sign stands in the fog.</p>}
          <div className="state">
            <span className="stud" style={{ background: STATUS_COLOUR[status] }} />
            <div>
              <b>
                {dayLabel(day, { long: true })}: {STATUS_WORD[status].toLowerCase()}
              </b>
              <span>{stateLine(r, status, day)}</span>
              {r.readable && <span className="seen">Seen {ago(r.readAt)}: tables can go fast.</span>}
            </div>
          </div>
          {status === 'open' &&
            [
              ['Lunch', lunch],
              ['Dinner', dinner],
            ].map(([label, list]) =>
              (list as string[]).length ? (
                <div key={label as string} className="times">
                  {lunch.length > 0 && dinner.length > 0 && <span className="label">{label as string}</span>}
                  {(list as string[]).map((t) => (
                    <button key={t} className="time" aria-pressed={t === pick} onClick={() => setPicked(t)}>
                      {t}
                    </button>
                  ))}
                </div>
              ) : null,
            )}
          {next && (
            <p className="hint">
              <button className="btn small" onClick={() => onDay(next)}>
                First free day: {dayLabel(next, { long: true })}
              </button>
            </p>
          )}
          {book && NO_DATE_LINK.has(r.platform) && (
            <p className="hint">
              {r.platform}'s page opens on its own date: pick <b>{dayLabel(day, { long: true })}</b>
              {status === 'open' && pick ? (
                <>
                  {' '}
                  and <b>{pick}</b>
                </>
              ) : (
                ''
              )}{' '}
              there.
            </p>
          )}
          <div className="actions">
            {book && (
              <a className={`btn${status === 'open' ? ' primary' : ''}`} href={book} target="_blank" rel="noopener">
                {status === 'open' ? `Book${pick ? ` ${pick}` : ''}` : 'Booking page'} on {r.readable ? r.platform : 'their site'}
              </a>
            )}
            {r.site && r.site !== book && (
              <a className="btn" href={r.site} target="_blank" rel="noopener">
                Website
              </a>
            )}
            <a className="btn" href={`https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lng}&travelmode=walking`} target="_blank" rel="noopener">
              Directions
            </a>
            <button className="btn" onClick={() => share(r, day).then(setShared)}>
              {shared || 'Share'}
            </button>
          </div>
          {r.why && <p className="why">{r.why}</p>}
          {r.readable && (
            <div className="cal">
              <div className="label">Next nine weeks, for two</div>
              <div className="cal-grid" role="group" aria-label="Pick a day">
                {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                  <div key={i} className="h">
                    {d}
                  </div>
                ))}
                {cells.map((d, i) => {
                  if (!d) return <span key={`p${i}`} className="pad" />;
                  const s = statusOf(r.d[dayIndex(data, d)] as never);
                  return (
                    <button
                      key={d}
                      style={{ background: STATUS_COLOUR[s] }}
                      aria-pressed={d === day}
                      aria-label={`${dayLabel(d, { long: true })}: ${STATUS_WORD[s]}`}
                      title={`${dayLabel(d)}: ${STATUS_WORD[s]}`}
                      onClick={() => onDay(d)}
                    >
                      {Number(d.slice(8))}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <p className="meta">
            {r.readable ? `Read from ${r.platform} ${ago(r.readAt)}, for two people.` : `We can't read ${r.platform === 'other' ? 'this booking system' : r.platform} yet.`} Another party size: their booking page shows it. You always book with the restaurant itself.
          </p>
          {CONTACT && (
            <p className="meta">
              Something wrong here?{' '}
              <a href={`mailto:${CONTACT}?subject=${encodeURIComponent(`Seated map: ${r.name}`)}`}>Tell us</a>.
            </p>
          )}
        </div>
      </div>
      {more && <MoreBar />}
    </section>
  );
}

/** Says a box scrolls on: its own strip under the box, so it never covers what is in it. */
function MoreBar() {
  return (
    <div className="more-bar" aria-hidden="true">
      Scroll for more ↓
    </div>
  );
}

function Dialog({ kind, onKind, onClose }: { kind: 'about' | 'restaurants'; onKind: (k: 'about' | 'restaurants') => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), [kind]);
  return (
    <div className="scrim" onClick={onClose}>
      <div ref={ref} tabIndex={-1} className="px dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title" onClick={(e) => e.stopPropagation()}>
        {kind === 'about' ? (
          <>
            <h2 id="dlg-title">How this works</h2>
            <p>
              Every sign on this map is a restaurant in Amsterdam, most of them hard to book. Pick a day and the signs show who still
              has a table for two, and at how many times. The green bar under each day shows how many restaurants have a table then.
            </p>
            <h3>Where it comes from</h3>
            <p>
              About every 15 minutes we read each restaurant's own public booking calendar (Tebi, Zenchef, Formitable, SevenRooms,
              Guestplan, Frank): the same calendar any guest sees. A few restaurants are watched more closely, so their signs change sooner.
            </p>
            {CONTACT && (
              <>
                <h3>Missing a place?</h3>
                <p>
                  Tell us at <a href={`mailto:${CONTACT}?subject=${encodeURIComponent('Seated map: a missing restaurant')}`}>{CONTACT}</a>. It
                  helps to name its booking system, if you know it.
                </p>
              </>
            )}
            <h3>The city</h3>
            <p>
              The city is drawn by sezlab: <a href="https://sezlab.dev/amsterdam">sezlab.dev/amsterdam</a>, used with his permission.
              Like his work? <a href="https://github.com/sponsors/sezkus">Sponsor him</a>. His drawing is made from 3DBAG (TU Delft and
              3DGI), the PDOK aerial photo (Beeldmateriaal Nederland) and OpenStreetMap. Noord is drawn by Seated in the same style, from 3DBAG, PDOK and OpenStreetMap. Restaurants outside the drawn city appear in the list and have a sign standing in the fog.
            </p>
            <h3>“Not bookable yet”</h3>
            <p>
              Many places open their calendar a set number of days ahead. When a day is past the end of a calendar, we say so, and
              when the window is clear we guess the day it opens.
            </p>
            <h3>Booking</h3>
            <p>You always book on the restaurant's own page. We never hold, sell or book tables. This page sets no cookies and asks nothing about you; it counts visits without them (Vercel Web Analytics).</p>
            <button className="btn" onClick={() => onKind('restaurants')}>
              For restaurants
            </button>
          </>
        ) : (
          <>
            <h2 id="dlg-title">For restaurants</h2>
            <p>
              This map shows what your public booking calendar already shows: which days have a table for two. Every link goes to
              your own booking page, so a guest who finds you here books with you, on your system.
            </p>
            <p>
              <b>Rather not be on it?</b> Send one line and your restaurant is off the map within a day. No questions, no follow-up.
            </p>
            {CONTACT ? (
              <a className="btn primary" href={`mailto:${CONTACT}?subject=${encodeURIComponent('Please take us off the Seated map')}`}>
                Email {CONTACT}
              </a>
            ) : (
              <p className="meta">The contact address is not set for this build (VITE_MAP_CONTACT).</p>
            )}
          </>
        )}
        <div>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
