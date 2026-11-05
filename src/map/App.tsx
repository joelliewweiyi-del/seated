import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ago, codeOn, dateAt, dayIndex, dayLabel, loadData, opensOn, STATUS_COLOUR, STATUS_WORD, statusOf, weekday, type MapData, type MapRestaurant, type Status } from './data';
import { MapView, type Marker } from './render';
import { drawRoom, ROOM_H, ROOM_W } from './room';
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
/** Booking pages that take no date from a link: the guest picks the day there (Tebi, Guestplan). */
const NO_DATE_LINK = new Set(['Tebi', 'Guestplan']);
const GROUP_WORD: Record<Status, string> = {
  open: 'Tables free',
  later: 'Not bookable yet',
  full: 'Fully booked',
  closed: 'Closed',
  unknown: 'Book on their site',
};

interface Placed {
  r: MapRestaurant;
  /** Sign anchor in world pixels: its roof. */
  ax: number;
  ay: number;
  /** False outside the city art: listed, but without a sign. */
  onMap: boolean;
}

function readUrl(): { date: string | null; r: string | null } {
  const q = new URLSearchParams(location.search);
  return { date: q.get('date'), r: q.get('r') };
}

function badgeFor(r: MapRestaurant, status: Status, date: string): string {
  if (status === 'open') {
    const n = r.t[date]?.length;
    return n ? `${n} free` : 'free';
  }
  if (status === 'later') {
    const o = opensOn(r, date);
    return o ? `opens ${dayLabel(o).slice(4)}` : 'soon';
  }
  if (status === 'full') return 'full';
  if (status === 'closed') return 'closed';
  return '?';
}

function stateLine(r: MapRestaurant, status: Status, date: string): string {
  const times = r.t[date];
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
  const [openOnly, setOpenOnly] = useState(false);
  const [hotOnly, setHotOnly] = useState(false);
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
      const a = world.project(r.lat, r.lng, r.roof ?? 10);
      return { r, ax: a.x, ay: a.y, onMap: world.covers(r.lat, r.lng) };
    });
  }, [world, data]);

  // Start the map once the world is in.
  useEffect(() => {
    if (!world || !canvasRef.current || viewRef.current) return;
    const view = new MapView(canvasRef.current, world);
    if (matchMedia('(max-width: 900px)').matches) view.setHomeZoom(0.25);
    viewRef.current = view;
    // For tests and the curious: the map object, read-only by convention.
    (window as unknown as { seatedMap: MapView }).seatedMap = view;
    tick((n) => n + 1);
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [world]);

  const statusOfR = useCallback((r: MapRestaurant) => (day && data ? statusOf(codeOn(r, data, day)) : 'unknown'), [day, data]);

  // Signs for the day.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !data || !day || !world) return;
    const q = query.trim().toLowerCase();
    const markers: Marker[] = [];
    for (const p of placed) {
      if (!p.onMap) continue;
      const s = statusOfR(p.r);
      if (hotOnly && !p.r.hot) continue;
      const match = !q || p.r.name.toLowerCase().includes(q) || p.r.area.toLowerCase().includes(q);
      markers.push({
        id: p.r.id,
        name: p.r.name,
        ax: p.ax,
        ay: p.ay,
        colour: STATUS_COLOUR[s],
        badge: badgeFor(p.r, s, day),
        rank: { open: 300, later: 200, full: 100, closed: 50, unknown: 0 }[s] + (p.r.hot ?? 0) * 20,
        dim: (openOnly && s !== 'open') || !match,
      });
    }
    view.setMarkers(markers);
  }, [placed, day, data, world, openOnly, hotOnly, query, statusOfR]);

  // Tell the map which screen areas the panels cover, so no sign hides under them.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const measure = () => {
      const top = document.querySelector('.top')?.getBoundingClientRect();
      const side = document.querySelector('.side > *')?.getBoundingClientRect();
      const foot = document.querySelector('.foot')?.getBoundingClientRect();
      const narrow = innerWidth <= 900;
      if (top) document.documentElement.style.setProperty('--top-h', `${Math.ceil(top.bottom)}px`);
      view.safe = {
        top: top ? top.bottom : 0,
        right: side && !narrow ? innerWidth - side.left + 6 : 0,
        bottom: narrow && side ? innerHeight - side.top + 6 : foot ? innerHeight - foot.top : 0,
        left: 0,
      };
    };
    measure();
    const ro = new ResizeObserver(measure);
    document.querySelectorAll('.top, .side, .foot').forEach((el) => ro.observe(el));
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
    const next = `${location.pathname}${q.toString() ? `?${q}` : ''}`;
    if (next === `${location.pathname}${location.search}`) return;
    try {
      history.replaceState(null, '', next);
    } catch {
      // A sandboxed frame (an embed, a preview) may refuse a URL change. The map works without it.
    }
  }, [day, selected, data]);

  const focus = useCallback(
    (id: string) => {
      const p = placed.find((x) => x.r.id === id);
      const view = viewRef.current;
      setSelected(id);
      if (p && view && p.onMap) {
        const narrow = matchMedia('(max-width: 900px)').matches;
        const z = Math.max(view.cam.z, 1);
        // Centre the sign in the part of the screen the panels leave free. On a phone the card will cover
        // up to 62% of the height once it opens, so plan for that.
        const W = innerWidth;
        const H = innerHeight;
        const s = view.safe;
        const bottom = narrow ? H * 0.62 + 44 : s.bottom;
        const cx = (s.left + (W - s.right)) / 2;
        const cy = (s.top + (H - bottom)) / 2 + 24;
        view.flyTo(p.ax + (W / 2 - cx) / z, p.ay + (H / 2 - cy) / z, z);
      }
    },
    [placed],
  );

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
          <header className="top">
            <div className="px brand">
              <Mark />
              <div>
                <h1>Seated</h1>
                <p>Amsterdam · a table for two</p>
              </div>
            </div>
            <DateStrip data={data} day={day} onPick={setDate} />
          </header>

          <aside className={`side${collapsed && !sel ? ' collapsed' : ''}`} aria-label={sel ? sel.name : 'Restaurants'}>
            {sel ? (
              <Card r={sel} offMap={!placed.find((p) => p.r.id === sel.id)?.onMap} data={data} day={day} status={statusOfR(sel)} onClose={() => setSelected(null)} onDay={setDate} />
            ) : (
              <List
                data={data}
                day={day}
                placed={placed}
                statusOf={statusOfR}
                openOnly={openOnly}
                hotOnly={hotOnly}
                query={query}
                collapsed={collapsed}
                onToggle={() => setCollapsed((c) => !c)}
                onOpenOnly={setOpenOnly}
                onHotOnly={setHotOnly}
                onQuery={setQuery}
                onPick={focus}
                onDay={setDate}
                nextOpen={nextOpenDay(data, day, hotOnly)}
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
          <div className="px-flat legend" aria-hidden="true">
            {ORDER.map((s) => (
              <span key={s}>
                <i style={{ background: STATUS_COLOUR[s] }} />
                {STATUS_WORD[s]}
              </span>
            ))}
          </div>

          {Date.now() - Date.parse(data.generatedAt) > 6 * 3600_000 && (
            <div className="px toast" role="status">
              These calendars were read {ago(data.generatedAt)}.
            </div>
          )}

          <footer className="foot">
            <span className="credit">
              <span className="long">Read {ago(data.generatedAt)} · </span>City art <a href="https://sezlab.dev/amsterdam">sezlab</a>
              <span className="long">
                {' '}
                (<a href="https://github.com/sponsors/sezkus">sponsor him</a>)
              </span>{' '}
              · ©{' '}
              <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>
              <span className="long">
                {' '}
                contributors · <a href="https://3dbag.nl/">3DBAG</a> · <a href="https://www.pdok.nl/">PDOK</a>
              </span>
            </span>
            <nav>
              <button onClick={() => setDialog('about')}>How it works</button>
              <button onClick={() => setDialog('restaurants')}>For restaurants</button>
            </nav>
          </footer>
        </>
      )}
      {dialog && <Dialog kind={dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}

function nextOpenDay(data: MapData, day: string, hotOnly: boolean): string | null {
  for (let i = dayIndex(data, day) + 1; i < data.days; i++) {
    if (data.restaurants.some((r) => (!hotOnly || r.hot) && r.d[i] === 'o')) return dateAt(data, i);
  }
  return null;
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

function DateStrip({ data, day, onPick }: { data: MapData; day: string; onPick: (d: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const days = useMemo(() => Array.from({ length: data.days }, (_, i) => dateAt(data, i)), [data]);
  const readable = data.restaurants.filter((r) => r.readable).length || 1;
  const open = useMemo(() => days.map((_, i) => data.restaurants.filter((r) => r.d[i] === 'o').length), [data, days]);
  const next = (wd: number) => days.find((d, i) => i > 0 && weekday(d) === wd) ?? days[0]!;
  const nye = days.find((d) => d.endsWith('-12-31'));
  useEffect(() => {
    ref.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [day]);
  const quick: Array<[string, string]> = [
    ['Today', days[0]!],
    ['Fri', weekday(days[0]!) === 5 ? days[0]! : next(5)],
    ['Sat', weekday(days[0]!) === 6 ? days[0]! : next(6)],
  ];
  if (nye) quick.push(["New Year's Eve", nye]);
  return (
    <nav className="px dates" aria-label="Day">
      <div className="quick">
        {quick.map(([label, d]) => (
          <button key={label} className="chip" aria-pressed={d === day} onClick={() => onPick(d)}>
            {label}
          </button>
        ))}
      </div>
      <div className="strip" ref={ref}>
        {days.map((d, i) => {
          const wd = weekday(d);
          const first = i === 0 || d.endsWith('-01');
          return (
            <button
              key={d}
              className={`day${wd === 0 || wd === 6 || wd === 5 ? ' weekend' : ''}${first ? ' month-start' : ''}`}
              data-month={dayLabel(d).split(' ')[2]}
              aria-pressed={d === day}
              aria-label={`${dayLabel(d, { long: true })}: ${open[i]} with a table`}
              onClick={() => onPick(d)}
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
    </nav>
  );
}

interface ListProps {
  data: MapData;
  day: string;
  placed: Placed[];
  statusOf: (r: MapRestaurant) => Status;
  openOnly: boolean;
  hotOnly: boolean;
  query: string;
  collapsed: boolean;
  onToggle: () => void;
  onOpenOnly: (v: boolean) => void;
  onHotOnly: (v: boolean) => void;
  onQuery: (v: string) => void;
  onPick: (id: string) => void;
  onDay: (d: string) => void;
  /** The next day after this one with any free table among the rows shown. */
  nextOpen: string | null;
}

function List(p: ListProps) {
  const q = p.query.trim().toLowerCase();
  const rows = p.placed
    .map((x) => ({ r: x.r, s: p.statusOf(x.r) }))
    .filter(({ r, s }) => (!p.hotOnly || r.hot) && (!p.openOnly || s === 'open') && (!q || r.name.toLowerCase().includes(q) || r.area.toLowerCase().includes(q)))
    .sort((a, b) => ORDER.indexOf(a.s) - ORDER.indexOf(b.s) || (b.r.hot ?? 0) - (a.r.hot ?? 0) || a.r.name.localeCompare(b.r.name));
  const openCount = p.placed.filter((x) => p.statusOf(x.r) === 'open').length;
  const hotOpen = p.placed.filter((x) => x.r.hot && p.statusOf(x.r) === 'open').length;
  let last: Status | null = null;
  return (
    <section className="px list">
      <div className="list-head">
        <button className="row" style={{ padding: 0, display: 'block', cursor: 'default' }} onClick={p.onToggle} aria-expanded={!p.collapsed}>
          <h2>{dayLabel(p.day, { long: true })}</h2>
          <p className="sum">
            {openCount} of {p.placed.length} have a table for two{hotOpen ? `, ${hotOpen} of them hard to get` : ''}.
          </p>
          <span className="sheet-toggle" aria-hidden="true">
            {p.collapsed ? 'List ▴' : 'Map ▾'}
          </span>
        </button>
        <div className="filters">
          <button className="chip" aria-pressed={p.openOnly} onClick={() => p.onOpenOnly(!p.openOnly)}>
            Free only
          </button>
          <button className="chip" aria-pressed={p.hotOnly} onClick={() => p.onHotOnly(!p.hotOnly)}>
            Hard to get
          </button>
          <input className="search" type="search" placeholder="Name or area  /" value={p.query} onChange={(e) => p.onQuery(e.target.value)} aria-label="Find a restaurant" />
        </div>
      </div>
      <ul className="rows">
        {rows.length === 0 && (
          <li className="empty">
            {p.openOnly ? `Nothing free on ${dayLabel(p.day)}.` : 'No restaurant by that name here.'}
            {p.openOnly && p.nextOpen && (
              <div>
                <button className="btn small" onClick={() => p.onDay(p.nextOpen!)}>
                  Next day with a table: {dayLabel(p.nextOpen)}
                </button>
              </div>
            )}
          </li>
        )}
        {rows.map(({ r, s }) => {
          const head = s !== last;
          last = s;
          return (
            <li key={r.id}>
              {head && <div className="group label">{GROUP_WORD[s]}</div>}
              <button className="row" onClick={() => p.onPick(r.id)}>
                <span className="stud" style={{ background: STATUS_COLOUR[s] }} />
                <span>
                  <span className="nm">{r.name}</span>
                  {r.hot ? <span className="hot">{'★'.repeat(r.hot)}</span> : null}
                  <br />
                  <span className="ar">{r.area}</span>
                </span>
                <span className="badge" style={{ background: STATUS_COLOUR[s] }}>
                  {badgeFor(r, s, p.day)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="list-foot">
        <span>Calendars read {ago(p.data.generatedAt)}</span>
        <span>★ hard to book</span>
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

function Card({ r, offMap, data, day, status, onClose, onDay }: { r: MapRestaurant; offMap: boolean; data: MapData; day: string; status: Status; onClose: () => void; onDay: (d: string) => void }) {
  const times = r.t[day] ?? [];
  const book = r.book[day] ?? r.link;
  const seed = useMemo(() => [...r.id].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) % 1000, [r.id]);
  // Calendar: weeks from the Monday on or before the first day.
  const lead = (weekday(data.start) + 6) % 7;
  const cells: Array<string | null> = [...Array(lead).fill(null), ...Array.from({ length: data.days }, (_, i) => dateAt(data, i))];
  // A shade at the bottom edge while more of the card is below the fold.
  const scroller = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const check = useCallback(() => {
    const e = scroller.current;
    if (e) setMore(e.scrollTop + e.clientHeight < e.scrollHeight - 4);
  }, []);
  useEffect(() => {
    const e = scroller.current;
    if (!e) return;
    check();
    const ro = new ResizeObserver(check);
    ro.observe(e);
    return () => ro.disconnect();
  }, [check, r.id]);
  return (
    <section className={`px card${more ? ' more' : ''}`}>
      <div className="card-scroll" ref={scroller} onScroll={check}>
        <div className="room">
          <RoomCanvas kind={r.kind} status={status} free={times.length || 3} seed={seed} />
          <button className="btn small close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="card-body">
          <h2>{r.name}</h2>
          <p className="where">
            {KIND_WORD[r.kind] ?? 'Restaurant'} · {r.area}
            {r.hot ? <span className="hot">{'★'.repeat(r.hot)} hard to book</span> : null}
          </p>
          {offMap && <p className="where">Outside the city map, so it has no sign there.</p>}
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
          {book && NO_DATE_LINK.has(r.platform) && (
            <p className="hint">
              {r.platform}'s page opens on its own date: pick {dayLabel(day, { long: true })}
              {status === 'open' && times.length ? `, ${times[0]}` : ''} there.
            </p>
          )}
          {status === 'open' && times.length > 0 && (
            <div className="times">
              {times.map((t) => (
                <a key={t} className="time" href={book ?? undefined} target="_blank" rel="noopener">
                  {t}
                </a>
              ))}
            </div>
          )}
          <div className="actions">
            {book && (
              <a className={`btn${status === 'open' ? ' primary' : ''}`} href={book} target="_blank" rel="noopener">
                {status === 'open' ? 'Book' : 'Booking page'} on {r.readable ? r.platform : 'their site'}
              </a>
            )}
            {r.site && r.site !== book && (
              <a className="btn" href={r.site} target="_blank" rel="noopener">
                Website
              </a>
            )}
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
            {r.readable ? `Read from ${r.platform} ${ago(r.readAt)}.` : `We can't read ${r.platform === 'other' ? 'this booking system' : r.platform} yet.`} You always book with the restaurant itself.
          </p>
        </div>
      </div>
    </section>
  );
}

function Dialog({ kind, onClose }: { kind: 'about' | 'restaurants'; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div className="scrim" onClick={onClose}>
      <div ref={ref} tabIndex={-1} className="px dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title" onClick={(e) => e.stopPropagation()}>
        {kind === 'about' ? (
          <>
            <h2 id="dlg-title">How this works</h2>
            <p>
              Every sign on this map is a restaurant in Amsterdam, most of them hard to book. Pick a day and the signs show who still
              has a table for two.
            </p>
            <h3>Where it comes from</h3>
            <p>
              A few times a day we read each restaurant's own public booking calendar (Tebi, Zenchef, Formitable, SevenRooms,
              Guestplan): the same calendar any guest sees. A few restaurants are watched more closely, so their signs change sooner.
            </p>
            <h3>The city</h3>
            <p>
              The city is drawn by sezlab: <a href="https://sezlab.dev/amsterdam">sezlab.dev/amsterdam</a>, used with his permission.
              Like his work? <a href="https://github.com/sponsors/sezkus">Sponsor him</a>. His drawing is made from 3DBAG (TU Delft and
              3DGI), the PDOK aerial photo (Beeldmateriaal Nederland) and OpenStreetMap. Restaurants outside his drawing are in the
              list, without a sign.
            </p>
            <h3>“Not bookable yet”</h3>
            <p>
              Many places open their calendar a set number of days ahead. When a day is past the end of a calendar, we say so, and
              when the window is clear we guess the day it opens.
            </p>
            <h3>Booking</h3>
            <p>You always book on the restaurant's own page. We never hold, sell or book tables. This page sets no cookies and asks nothing about you.</p>
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
