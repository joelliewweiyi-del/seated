import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useAiSearch, type AiSearch } from './aiSearch';
import { ago, badgeStyle, codeOn, dateAt, dayIndex, dayLabel, freeTimes, linkAt, loadData, opensOn, phoneWords, STATUS_COLOUR, STATUS_WORD, statusOf, timeSpan, weekday, type MapData, type MapRestaurant, type Status } from './data';
import { MapView, ZOOMS, type Marker } from './render';
import { drawRoom, ROOM_H, ROOM_W } from './room';
import { KIND_WORD, Marks, metres, michelinWords, useRemembered, bike } from './marks';
import { Host, Nudge, Picker, type ListChoice } from './picker';
import type { SeatedList } from './api';
import { Avatar, cleanLook, type Look } from './avatar';
import { profileById } from './taste';
import { picksFor, Trouble, Welcome, YouPanel, type WelcomeStep } from './welcome';
import { useYou, type You } from './you';
import { OUR_ART, World } from './world';

const CONTACT = (import.meta.env.VITE_MAP_CONTACT as string | undefined) ?? '';
const REFRESH_MS = 3 * 60_000;
const STATUS_RANK: Record<Status, number> = { open: 300, later: 200, full: 100, none: 100, closed: 50, unknown: 0 };
const ORDER: Status[] = ['open', 'later', 'full', 'none', 'closed', 'unknown'];
/** Booking pages that take no date from a link: the guest picks the day there (Tebi, Guestplan, Frank). */
const NO_DATE_LINK = new Set(['Tebi', 'Guestplan', 'Frank']);
const GROUP_WORD: Record<Status, string> = {
  open: 'Tables free',
  later: 'Not bookable yet',
  full: 'Fully booked',
  none: 'No tables online',
  closed: 'Closed',
  unknown: 'Book on their site',
};

interface Filters {
  open: boolean;
  stars: boolean;
  bib: boolean;
  hot: boolean;
  fav: boolean;
  /** Sort by distance from where you are. */
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
  // A list travels as ?list=<id>; inside the page it is the lens 'l:<id>'.
  const list = q.get('list');
  return { date: q.get('date'), r: q.get('r'), lens: list ? `l:${list}` : q.get('lens') };
}

/** What the map is seen through: a guide's picks, your picks, or a list (yours or someone else's). */
interface Lens {
  /** As in the link: a guide id, 'you', 'mine' (your list on this device), or 'l:<list id>'. */
  id: string;
  kind: 'guide' | 'you' | 'mine' | 'list';
  title: string;
  line: string;
  url: string | null;
  /** The maker of someone else's list. */
  by: SeatedList['by'];
  ids: Set<string>;
  /** Your picks only: best fit first (0), so a Fashion Baddie's wine bars lead her list. */
  rank?: Map<string, number>;
}

/** Only the lens's restaurants, when a lens is chosen. */
function inLens(lens: Lens | null, r: MapRestaurant): boolean {
  return !lens || lens.ids.has(r.id);
}

const NO_RESTAURANTS: MapRestaurant[] = [];

/** A place that takes no bookings at all (Bon Burger West, 20 Nov 2026): no calendar to read, nothing to book. */
const walkIn = (r: MapRestaurant) => r.platform === 'walk-in';

function badgeFor(r: MapRestaurant, status: Status, date: string): string {
  switch (status) {
    case 'open':
      return timeSpan(freeTimes(r, date));
    case 'later': {
      const o = opensOn(r, date);
      return o ? `opens ${dayLabel(o).slice(4)}` : 'soon';
    }
    case 'full':
      return 'full';
    case 'none':
      return 'no tables';
    case 'closed':
      return 'closed';
    case 'unknown':
      return r.readable ? 'unknown' : walkIn(r) ? 'walk in' : 'their site';
  }
  const exhaustive: never = status;
  return exhaustive;
}

function stateLine(r: MapRestaurant, status: Status, date: string): string {
  const times = freeTimes(r, date);
  switch (status) {
    case 'open':
      return times?.length ? `Free for two at ${times.join(', ')}.` : 'There is a table for two. The booking page shows the times.';
    case 'full':
      return 'No table for two left that day.';
    case 'none':
      return 'No tables for two are shown online for that day.';
    case 'closed':
      return 'Closed that day, or not taking bookings online.';
    case 'later': {
      const o = opensOn(r, date);
      return o
        ? `The calendar does not reach this far yet. It opens about ${r.win} days ahead, so around ${dayLabel(o, { long: true })}.`
        : 'The calendar does not reach this far yet.';
    }
    case 'unknown':
      if (walkIn(r)) return 'Walk-in only: no bookings, just go.';
      return r.readable ? 'We could not read this calendar for that day.' : `Books through ${r.platform === 'other' ? 'its own site' : r.platform}, which we cannot read. Their site has the answer.`;
  }
  const exhaustive: never = status;
  return exhaustive;
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
  // No lens in the link: every restaurant (Joel, 25 Nov 2026: "The standard should just be showing everything"; it was the
  // curated list, and a first visitor did not know restaurants were hidden). An old ?lens=all link is the same.
  const [lensId, setLens] = useState<string | null>(readUrl().lens);
  const [filters, setFilters] = useRemembered<Filters>('seated.map.filters', NO_FILTERS);
  const [saved, setSaved] = useRemembered<{ ids: string[] }>('seated.map.saved', { ids: [] });
  const favs = useMemo(() => new Set(saved.ids), [saved]);
  // Your list on this device (mylist.tsx), newest first; the ♥ on a card puts a place on it or takes it off.
  const toggleFav = useCallback((id: string) => setSaved((o) => ({ ids: o.ids.includes(id) ? o.ids.filter((x) => x !== id) : [id, ...o.ids] })), [setSaved]);
  const [me, setMe] = useState<{ lat: number; lng: number; note?: string } | null>(null);
  const [query, setQuery] = useState('');
  const ai = useAiSearch(query);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  // Once per device, a few seconds in, the host points at the lists (and goes again after 20 s).
  const [hello, setHello] = useRemembered<{ seen: boolean }>('seated.map.hello', { seen: false });
  const [nudge, setNudge] = useState(false);
  const [welcomeAt, setWelcomeAt] = useState<WelcomeStep>('scene');
  const openWelcome = (step: WelcomeStep) => {
    setWelcomeAt(step);
    setDialog('welcome');
  };
  const you = useYou(data?.restaurants ?? NO_RESTAURANTS);
  const narrow = useNarrow();
  const [collapsed, setCollapsed] = useState(() => matchMedia('(max-width: 900px)').matches);
  // The search answers are open under the box: on a wide screen the list, which would repeat them, steps aside
  // (Joel, 27 Nov 2026: yes to hiding it).
  const [answers, setAnswers] = useState(false);
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

  const statusOfR = useCallback((r: MapRestaurant) => (day && data ? statusOf(codeOn(r, data, day)) : 'unknown'), [day, data]);

  // Your picks: the restaurants that fit your taste best.
  const picks = useMemo(() => (data && you.profile ? picksFor(you, data.restaurants, statusOfR, 12) : []), [data, you.profile, you.taste, statusOfR]); // eslint-disable-line react-hooks/exhaustive-deps
  // A list from a link that is not yours: fetch it once.
  const listId = lensId?.startsWith('l:') ? lensId.slice(2) : null;
  useEffect(() => {
    if (listId) void you.open(listId);
  }, [listId, you.lists.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // The lens from its id. An id the map does not know (yet) shows every restaurant.
  const lens = useMemo<Lens | null>(() => {
    if (!data || !lensId || lensId === 'all') return null;
    const g = data.guides.find((x) => x.id === lensId);
    if (g) return { id: g.id, kind: 'guide', title: g.short, line: g.line, url: g.url, by: null, ids: new Set(data.restaurants.filter((r) => r.g.includes(g.id)).map((r) => r.id)) };
    if (lensId === 'you')
      return you.profile ? { id: 'you', kind: 'you', title: you.profile.name, line: `Your picks as a ${you.profile.name}.`, url: null, by: null, ids: new Set(picks.map((r) => r.id)), rank: new Map(picks.map((r, i) => [r.id, i])) } : null;
    // Your list on this device; empty, the map shows every restaurant.
    if (lensId === 'mine') return favs.size ? { id: 'mine', kind: 'mine', title: 'My list', line: '', url: null, by: null, ids: favs, rank: new Map(saved.ids.map((id, i) => [id, i])) } : null;
    if (listId) {
      const own = you.lists.find((l) => l.id === listId);
      const l = own ?? you.community?.find((x) => x.id === listId) ?? you.opened[listId];
      if (!l) return null;
      return { id: lensId, kind: 'list', title: l.title, line: l.note, url: null, by: own ? null : l.by, ids: new Set(l.places) };
    }
    return null;
  }, [data, lensId, listId, you.profile, you.lists, you.community, you.opened, picks, favs, saved]);

  // Signs for the day.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !data || !day || !world) return;
    const q = query.trim().toLowerCase();
    const markers: Marker[] = [];
    for (const p of placed) {
      const s = statusOfR(p.r);
      if (!inKinds(filters, p.r, favs)) continue;
      const match = !q || matches(p.r, q) || !!ai?.ids?.has(p.r.id);
      markers.push({
        id: p.r.id,
        name: p.r.name,
        michelin: p.r.michelin,
        ax: p.ax,
        ay: p.ay,
        colour: STATUS_COLOUR[s],
        badge: badgeFor(p.r, s, day),
        hollow: s === 'none',
        rank: STATUS_RANK[s] + (p.r.hot ?? 0) * 20 + (p.r.michelin ? 15 : 0) + (lens && inLens(lens, p.r) ? 400 : 0),
        // A search looks at every restaurant, whatever list is on (Joel, 25 Nov 2026: "she wanted everything to be searched").
        dim: (filters.open && s !== 'open') || !match || (!q && !inLens(lens, p.r)),
        pin: !q && !inLens(lens, p.r),
      });
    }
    view.setMarkers(markers);
    view.keepClear(placed.map((p) => ({ x: p.ax, y: p.ay })));
    view.setYou(me && !me.note ? world.project(me.lat, me.lng) : null, you.account ? cleanLook(you.account.avatar) : null);
  }, [placed, day, data, world, filters, favs, query, statusOfR, me, lens, you.account, ai]);

  // Where you are. Found on every load, the map flies there (Joel, 20 Nov 2026: "When I load the page I want to be
  // immediately transported to my location"); the browser asks first if it has to. On load (`quiet`) a refusal or a
  // place outside Amsterdam changes nothing; with "Near me" distances then start at the Dam. The location stays in
  // this page: it is never sent anywhere.
  const locate = useCallback(
    (show: boolean, quiet = false) => {
      if (!('geolocation' in navigator)) {
        if (quiet) return;
        setMe({ ...DAM, note: 'Your browser does not share a location: distances are from the Dam.' });
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          if (metres(here, DAM) > 15_000) {
            if (quiet) return;
            setMe({ ...DAM, note: 'You seem to be outside Amsterdam: distances are from the Dam.' });
            return;
          }
          setMe(here);
          const view = viewRef.current;
          if (view && world) {
            const a = world.project(here.lat, here.lng);
            // Centred in the part of the map the list leaves free, so the places near you are not under it, and at
            // the closest zoom step that still shows the three nearest signs (round 2 of verify-map: Café Caron,
            // a minute away, stood off screen at zoom 1).
            const nearest = placed
              .map((p) => ({ x: p.ax, y: p.ay }))
              .sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y))
              .slice(0, 3);
            // On a phone Show me opens the list half-height (NEAR_SHEET): centre in the map above it, not above the closed bar.
            const sheet = show && innerWidth <= 900 ? Math.round(innerHeight * NEAR_SHEET) + 36 : null;
            const c = centred(view, a.x, a.y, fitZoom(view, a, nearest, Math.max(view.cam.z, 1), sheet), sheet);
            view.flyTo(c.x, c.y, c.z);
          }
          if (show) {
            setFilters((f) => ({ ...f, near: true }));
            setCollapsed(false);
          }
        },
        () => {
          if (!quiet) setMe({ ...DAM, note: 'Location is off: distances are from the Dam.' });
        },
        { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
      );
    },
    [world, placed, setFilters],
  );
  // Near me turned on: find you again and fly there, centred above the half-height list on a phone.
  useEffect(() => {
    if (filters.near) locate(true);
  }, [filters.near]); // eslint-disable-line react-hooks/exhaustive-deps
  // On load, once the map is placed; a link to a restaurant keeps its place.
  const placedOnce = placed.length > 0;
  useEffect(() => {
    if (!world || !placedOnce || me || readUrl().r) return;
    locate(false, true);
  }, [world, placedOnce]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tell the map which screen areas the panels cover, so no sign hides under them.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const measure = () => {
      const top = document.querySelector('.top')?.getBoundingClientRect();
      // A list put away while the search answers show (display: none) measures 0 x 0 at the left edge: that is no panel,
      // not one across the whole screen (27 Nov 2026: every sign went missing during a search).
      const sideBox = document.querySelector('.side > *')?.getBoundingClientRect();
      const side = sideBox?.width ? sideBox : undefined;
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
      const zoom = document.querySelector('.zoom')?.getBoundingClientRect();
      view.controls = zoom && zoom.width ? [{ x: zoom.left, y: zoom.top, w: zoom.width, h: zoom.height }] : [];
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
    if (!OUR_ART) q.set('art', 'sez'); // a reload or a shared link keeps sezlab's art when it was chosen
    if (day !== data.start) q.set('date', day);
    if (selected) q.set('r', selected);
    if (lens) q.set(lens.kind === 'list' ? 'list' : 'lens', lens.kind === 'list' ? lens.id.slice(2) : lens.id);
    const next = `${location.pathname}${q.toString() ? `?${q}` : ''}`;
    if (next === `${location.pathname}${location.search}`) return;
    try {
      history.replaceState(null, '', next);
    } catch {
      // A sandboxed frame (an embed, a preview) may refuse a URL change. The map works without it.
    }
  }, [day, selected, data, lens, lensId]);

  const focus = useCallback(
    (id: string) => {
      const p = placed.find((x) => x.r.id === id);
      const view = viewRef.current;
      setSelected(id);
      if (p && view) {
        // On a phone the small card covers about a fifth of the height (MINI_SHEET), so plan for that; More opens it to half.
        const c = centred(view, p.ax, p.ay, Math.max(view.cam.z, 1), matchMedia('(max-width: 900px)').matches ? innerHeight * MINI_SHEET + 44 : null);
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

  // A character picked in the welcome shows its places (Joel, 24 Nov 2026: "show all the Fashion Baddie places"): on a
  // phone as a half-height list of rows, and the map above it centred on the most of them; only the lens keeps its names.
  const frameLens = useRef(false);
  // On a phone the picks open as a half-height list of rows (as with Near me) until the list is toggled or the lens changes.
  const [rowsFor, setRowsFor] = useState<string | null>(null);
  useEffect(() => {
    const view = viewRef.current;
    if (!frameLens.current || !view || !lens) return;
    frameLens.current = false;
    const pts = placed.filter((p) => p.onMap && lens.ids.has(p.r.id)).map((p) => ({ x: p.ax, y: p.ay }));
    if (!pts.length) return;
    // Centred on the biggest group of its places that shows with names (zoom 0.25), in the map above the list.
    const sheet = innerWidth <= 900 ? Math.round(innerHeight * NEAR_SHEET) + 36 : null;
    const s = view.safe;
    const wx = (innerWidth - s.left - s.right) / 2 / 0.25 - 256;
    const wy = (innerHeight - s.top - (sheet ?? s.bottom)) / 2 / 0.25 - 128;
    const near = (a: { x: number; y: number }) => pts.filter((p) => Math.abs(p.x - a.x) <= wx && Math.abs(p.y - a.y) <= wy);
    const group = pts.map(near).sort((a, b) => b.length - a.length)[0]!;
    const mean = (v: number[]) => v.reduce((t, x) => t + x, 0) / v.length;
    const c = centred(view, mean(group.map((p) => p.x)), mean(group.map((p) => p.y)), 0.25, sheet);
    view.flyTo(c.x, c.y, c.z);
  }, [lens, placed]);

  // Open the restaurant from the link once everything is in place.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !selected || !placed.length || !viewRef.current) return;
    opened.current = true;
    focus(selected);
  }, [placed, selected, focus]);

  // The welcome opens by itself once, on a first visit that did not come from a link to a restaurant or list.
  // The link as it arrived: the page rewrites it (an unknown lens drops out) before the data is in.
  const arrived = useRef(readUrl());
  const greeted = useRef(false);
  useEffect(() => {
    if (greeted.current || !data || !day) return;
    greeted.current = true;
    const u = arrived.current;
    if (!you.welcomed && !you.key && !u.r && !u.lens) openWelcome('scene');
  }, [data, day]); // eslint-disable-line react-hooks/exhaustive-deps
  // Community lists load when the picker opens.
  useEffect(() => {
    if (dialog === 'lists' && you.community === null) void you.loadCommunity();
  }, [dialog]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (hello.seen || you.welcomed || !data) return;
    const t = setTimeout(() => {
      setNudge(true);
      setHello({ seen: true });
    }, 6000);
    return () => clearTimeout(t);
  }, [hello.seen, you.welcomed, data, setHello]);
  useEffect(() => {
    if (!nudge) return;
    const t = setTimeout(() => setNudge(false), 20_000);
    return () => clearTimeout(t);
  }, [nudge]);

  // Keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT';
      if (e.key === 'Escape') {
        if (dialog === 'welcome') you.setWelcomed();
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
  // The answers under the search box: every restaurant that matches, whatever list, filter or card is on; free first.
  const asked = query.trim().toLowerCase();
  const hits = asked
    ? placed
        .map((p) => ({ r: p.r, s: statusOfR(p.r) }))
        .filter(({ r }) => matches(r, asked) || !!ai?.ids?.has(r.id))
        .sort((a, b) => STATUS_RANK[b.s] - STATUS_RANK[a.s] || a.r.name.localeCompare(b.r.name))
    : null;
  const freeOf = (rs: Placed[]) => rs.filter((p) => statusOfR(p.r) === 'open').length;
  const lists: ListChoice[] = data
    ? [
        { id: 'all', name: 'All places', by: 'All of Seated', line: '', picks: placed.length, free: freeOf(placed) },
        ...data.guides.map((g) => {
          const mine = placed.filter((p) => p.r.g.includes(g.id));
          return { id: g.id, name: g.short, by: g.by, line: g.line, picks: mine.length, free: freeOf(mine) };
        }),
      ]
    : [];
  const count = (ids: Iterable<string>) => {
    const set = new Set(ids);
    const rs = placed.filter((p) => set.has(p.r.id));
    return { picks: rs.length, free: freeOf(rs) };
  };
  const forYou: ListChoice | null = you.profile ? { id: 'you', name: 'For you', by: you.profile.name, line: '', ...count(picks.map((r) => r.id)) } : null;
  const mine = you.account
    ? you.lists.map((l) => ({ id: `l:${l.id}`, name: l.title, by: l.note || 'Your list', line: l.note, badge: l.public ? 'In Community' : 'Only you', list: l, ...count(l.places) }))
    : null;
  const pickSet = new Set(picks.map((r) => r.id));
  const community: ListChoice[] | null =
    you.community === null
      ? null
      : you.community
          .filter((l) => !you.lists.some((m) => m.id === l.id))
          .map((l) => ({ l, k: l.places.filter((id) => pickSet.has(id)).length }))
          .sort((a, b) => b.k - a.k)
          .map(({ l }) => ({
            id: `l:${l.id}`,
            name: l.title,
            by: [l.by?.name, profileById(l.by?.profile)?.name].filter(Boolean).join(' · '),
            line: l.note,
            look: l.by ? cleanLook(l.by.avatar) : null,
            ...count(l.places),
          }));
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
          <TopBar
            data={data}
            day={day}
            onPick={setDate}
            onAbout={() => setDialog('about')}
            you={you}
            onYou={() => (you.account || you.answered ? setDialog('you') : openWelcome('scene'))}
          >
            <Find
              query={query}
              onQuery={setQuery}
              hits={hits}
              onShown={setAnswers}
              busy={!!ai?.busy}
              data={data}
              day={day}
              favs={favs}
              onPick={focus}
              lens={lens}
              look={you.account ? cleanLook(you.account.avatar) : (you.profile?.look ?? null)}
              onLists={() => setDialog('lists')}
              onAll={() => setLens(null)}
              onCharacter={() => openWelcome('scene')}
              onMine={() => openWelcome('list')}
            />
          </TopBar>

          <aside className={`side${collapsed && !sel ? ' collapsed' : ''}${filters.near && !sel ? ' near' : ''}${rowsFor !== null && rowsFor === lensId && !filters.near && !sel ? ' near rows' : ''}${sel ? ' has-card' : ''}${answers && !sel && !narrow ? ' answering' : ''}`} aria-label={sel ? sel.name : 'Restaurants'}>
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
                you={you}
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
                favs={favs}
                me={filters.near ? me : null}
                query={query}
                ai={ai}
                collapsed={collapsed}
                onToggle={() => {
                  setRowsFor(null);
                  setCollapsed((c) => !c);
                }}
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
            {OUR_ART ? (
              <>
                Art Seated, from <a href="https://3dbag.nl">3DBAG</a> and{' '}
                <a href="https://api.data.amsterdam.nl/panorama/">panoramas</a> (CC BY 4.0) · ©{' '}
              </>
            ) : (
              <>
                Art <a href="https://sezlab.dev/amsterdam">sezlab</a> (<a href="https://github.com/sponsors/sezkus">sponsor</a>) · ©{' '}
              </>
            )}
            <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>
          </footer>
        </>
      )}
      {nudge && data && !dialog && !sel && (!narrow || collapsed) && (
        <Nudge
          onOpen={() => {
            setNudge(false);
            openWelcome('scene');
          }}
          onClose={() => setNudge(false)}
        />
      )}
      {dialog === 'lists' && data && day ? (
        <Picker
          lists={lists}
          forYou={forYou}
          own={{ id: 'mine', name: 'My list', by: 'On this device', line: '', ...count(saved.ids) }}
          mine={mine}
          community={community}
          current={lens?.id ?? 'all'}
          dayText={dayLabel(day)}
          contact={CONTACT}
          problem={you.problem ? <Trouble you={you} /> : null}
          busy={you.busy}
          onCharacter={() => openWelcome('character')}
          onSaveList={you.saveList}
          onDeleteList={async (id) => {
            const ok = await you.deleteList(id);
            if (ok && lensId === `l:${id}`) setLens(null);
            return ok;
          }}
          onReport={you.report}
          onPick={(id) => {
            // An empty list opens to be filled; the map has nothing to show through it yet.
            if (id === 'mine' && !favs.size) return openWelcome('list');
            setLens(id);
            setSelected(null);
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      ) : (
        (dialog === 'about' || dialog === 'restaurants') && <Dialog kind={dialog} onKind={setDialog} onClose={() => setDialog(null)} />
      )}
      {dialog === 'welcome' && data && day && (
        <Welcome
          key={welcomeAt}
          you={you}
          start={welcomeAt}
          list={{ restaurants: data.restaurants, picks, ids: saved.ids, statusOf: statusOfR, onIds: (ids) => setSaved({ ids }) }}
          onLens={(id) => {
            frameLens.current = true;
            setRowsFor(id);
            setCollapsed(false);
            setLens(id);
            setSelected(null);
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'you' && (
        <YouPanel
          you={you}
          onWelcome={openWelcome}
          onLens={(id) => {
            setLens(id);
            setSelected(null);
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

/** The camera that puts world point (x, y) in the middle of the screen the panels leave free. */
/** Near me on a phone: the list opens to this share of the screen, so the map and your character stay in sight
 *  (Joel, 19 Nov 2026: the full list hid both). Keep in step with `.side.near` in styles.css. */
const NEAR_SHEET = 0.46;
/** A card on a phone: half the screen (`.side.has-card`), so the place stays in sight above it (Joel, 19 Nov 2026). */
/** The small phone card's share of the screen (Joel, 25 Nov 2026: "40% ... too much"); e2e keeps it under 25%. */
const MINI_SHEET = 0.22;

function centred(view: MapView, x: number, y: number, z: number, bottom: number | null): { x: number; y: number; z: number } {
  const s = view.safe;
  const cx = (s.left + (innerWidth - s.right)) / 2;
  const cy = (s.top + (innerHeight - (bottom ?? s.bottom))) / 2 + 24;
  return { x: x + (innerWidth / 2 - cx) / z, y: y + (innerHeight / 2 - cy) / z, z };
}

/** The largest zoom step up to `max` at which every point fits round (x, y) when `centred` puts it in the middle,
 *  with room for a sign (half its width beside, its board above). Never further out than names show (0.25). */
function fitZoom(view: MapView, at: { x: number; y: number }, pts: Array<{ x: number; y: number }>, max: number, bottom: number | null = null): number {
  const s = { ...view.safe, bottom: bottom ?? view.safe.bottom };
  const cy = (s.top + (innerHeight - s.bottom)) / 2 + 24;
  const side = (innerWidth - s.right - s.left) / 2 - 100;
  const up = cy - s.top - 40;
  const down = innerHeight - s.bottom - cy - 10;
  const fits = (z: number) =>
    pts.every((p) => Math.abs(p.x - at.x) * z <= side && (p.y - at.y) * z >= -up && (p.y - at.y) * z <= down);
  return [...ZOOMS].reverse().find((z) => z <= max && z >= 0.25 && fits(z)) ?? 0.25;
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
function TopBar({ data, day, onPick, onAbout, you, onYou, children }: { data: MapData; day: string; onPick: (d: string) => void; onAbout: () => void; you: You; onYou: () => void; children?: React.ReactNode }) {
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
        <button className="you-btn" onClick={onYou} aria-label={you.account ? `You: ${you.account.name}` : 'You'} title={you.account ? you.account.name : 'You'}>
          <Avatar look={you.account ? cleanLook(you.account.avatar) : (you.profile?.look ?? null)} size={28} />
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
      {children}
    </header>
  );
}

/**
 * The search and what the map shows, under the top bar on every screen (Joel, 25 Nov 2026, from a first visitor: "she
 * didn't even know which version of the map she was looking at", "she wanted everything to be searched", "the profile
 * needs to be easily changed"). The search looks at every restaurant: names at once, and Jev's AI answer half a second
 * after the typing stops, with no status line under it (Joel, 27 Nov 2026: "remove all subtext"). "Showing" names the list or character the map is seen through, with Change and ✕ All.
 *
 * The answers open under the box (Joel, 27 Nov 2026: with a card open a search showed nothing, and without one the
 * answers were in the list at the other side of the screen: "It should be more intuitive below the search box, no?").
 * A pick opens the card and closes them; so does a click elsewhere or Escape. The words stay, and the box opens them again.
 */
function Find(p: {
  query: string;
  onQuery: (v: string) => void;
  /** The restaurants that answer the search, or null without one. */
  hits: Array<{ r: MapRestaurant; s: Status }> | null;
  /** Told when the answers open or close: a wide screen hides the list meanwhile. */
  onShown: (shown: boolean) => void;
  /** The AI answer is still on its way. */
  busy: boolean;
  data: MapData;
  day: string;
  favs: Set<string>;
  onPick: (id: string) => void;
  lens: Lens | null;
  look: Look | null;
  onLists: () => void;
  onAll: () => void;
  onCharacter: () => void;
  /** Open your list, to add or take off places. */
  onMine: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const narrow = useNarrow();
  const shown = open && p.hits !== null;
  const { onShown } = p;
  useEffect(() => onShown(shown), [shown, onShown]);
  useEffect(() => {
    if (!shown) return;
    const away = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    addEventListener('pointerdown', away, true);
    return () => removeEventListener('pointerdown', away, true);
  }, [shown]);
  const pick = (id: string) => {
    setOpen(false);
    wrap.current?.querySelector<HTMLInputElement>('.search')?.blur(); // a phone puts its keyboard away
    p.onPick(id);
  };
  return (
    <div className="find-wrap" ref={wrap}>
      <div className="px find">
        <div className="find-row">
          <input
            className="search"
            type="search"
            enterKeyHint="search"
            // On a phone a list's chips leave the box about nine letters: the long hint was cut off ("Search: b").
            placeholder={narrow && p.lens ? 'Search…' : 'Search: brunch, natural wine…'}
            value={p.query}
            onChange={(e) => {
              p.onQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (!shown) return;
              if (e.key === 'Escape') {
                e.stopPropagation(); // the answers close; the card behind them stays
                setOpen(false);
              } else if (e.key === 'Enter' && p.hits?.[0]) pick(p.hits[0].r.id);
            }}
            aria-label="Find a restaurant"
            aria-expanded={shown}
            aria-controls="hits"
          />
          <span className="showing-label">Showing</span>
          <button className="chip lens" data-on={p.lens ? '' : undefined} aria-haspopup="dialog" onClick={p.onLists} title="What the map shows: pick a list or every restaurant">
            {(p.lens?.kind === 'you' || p.lens?.kind === 'mine') && <Avatar look={p.look} size={18} />}
            {p.lens ? p.lens.title : 'All places'}
          </button>
          {p.lens?.kind === 'mine' && (
            <button className="chip change" onClick={p.onMine}>
              Edit
            </button>
          )}
          {p.lens?.kind === 'you' && (
            <button className="chip change" onClick={p.onCharacter}>
              Change
            </button>
          )}
          {p.lens && (
            <button className="chip all" onClick={p.onAll} aria-label="Show every restaurant" title="Show every restaurant">
              ✕
            </button>
          )}
        </div>
      </div>
      {shown && (
        <ul className="px pop hits" id="hits" aria-label="Search results">
          {p.hits!.length === 0 && !p.busy && <li className="empty">No restaurant matches that.</li>}
          {p.hits!.map(({ r, s }) => (
            <li key={r.id}>
              <PlaceRow r={r} s={s} data={p.data} day={p.day} fav={p.favs.has(r.id)} onPick={pick} />
            </li>
          ))}
          {/* The wait for the AI answer, under any names found so far (Joel, 27 Nov 2026: "Show an interesting loading
              UI component, no?"): the host walks to a table. No words: the walk says it. */}
          {p.busy && (
            <li className="seeking" role="status" aria-label="Searching">
              <span className="walk">
                <Host size={22} />
              </span>
              <Mark />
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/** One restaurant as a row, in the list and under the search: status, name, marks, area and the day's badge. */
function PlaceRow({ r, s, data, day, fav, lead = '', onPick }: { r: MapRestaurant; s: Status; data: MapData; day: string; fav: boolean; lead?: string; onPick: (id: string) => void }) {
  const next = s !== 'open' && r.readable ? firstFree(r, data, day) : null;
  return (
    <button className="row" onClick={() => onPick(r.id)}>
      <span className="stud" style={{ background: STATUS_COLOUR[s] }} />
      <span className="who">
        <span className="nm">
          {r.name}
          {fav && <span className="fav-dot" aria-label="saved"> ♥</span>}
        </span>
        <Marks r={r} />
        <span className="ar">
          {lead}
          {KIND_WORD[r.kind] ? `${KIND_WORD[r.kind]} · ` : ''}
          {r.area}
          {next ? ` · free ${dayLabel(next).slice(0, 10)}` : ''}
        </span>
      </span>
      <span className="badge" style={badgeStyle(s)}>
        {badgeFor(r, s, day)}
      </span>
    </button>
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
  /** The lens the list is seen through, or null for every restaurant. */
  lens: Lens | null;
  /** Opens the list picker. */
  favs: Set<string>;
  /** Where distances start, when "Near me" is on. */
  me: { lat: number; lng: number; note?: string } | null;
  query: string;
  /** The AI's answer to the search, beside the name search. */
  ai: AiSearch | null;
  collapsed: boolean;
  onToggle: () => void;
  onPick: (id: string) => void;
  onDay: (d: string) => void;
  /** The next day after this one with any free table among the rows shown. */
  nextOpen: string | null;
}

const CHIPS: Array<[keyof Filters, string]> = [
  ['open', 'Free only'],
  ['near', 'Near me'],
];
/** Under More: one row fewer in the panel (Joel, 23 Nov 2026: "that whole side panel ui/ux needs a serious pass"). */
const MORE_CHIPS: Array<[keyof Filters, string]> = [
  ['stars', '★ Stars'],
  ['bib', 'Bib Gourmand'],
  ['hot', 'Hard to get'],
  ['fav', 'My list'],
];

function List(p: ListProps) {
  const q = p.query.trim().toLowerCase();
  const f = p.filters;
  const hasMichelin = p.placed.some((x) => x.r.michelin);
  const rows = p.placed
    .map((x) => ({ r: x.r, s: p.statusOf(x.r), m: p.me ? metres(p.me, x.r) : 0 }))
    // A search looks at every restaurant (the list on or not); without one, the list on decides.
    .filter(({ r, s }) => (q ? matches(r, q) || !!p.ai?.ids?.has(r.id) : inLens(p.lens, r)) && inKinds(f, r, p.favs) && (!f.open || s === 'open'))
    .sort((a, b) =>
      p.me
        ? a.m - b.m
        : STATUS_RANK[b.s] - STATUS_RANK[a.s] ||
          (p.lens?.rank ? (p.lens.rank.get(a.r.id) ?? 99) - (p.lens.rank.get(b.r.id) ?? 99) : 0) ||
          Number(b.r.michelin === '3') - Number(a.r.michelin === '3') ||
          (b.r.hot ?? 0) - (a.r.hot ?? 0) ||
          a.r.name.localeCompare(b.r.name),
    );
  const guide = p.lens;
  const seen = p.placed.filter((x) => (q ? matches(x.r, q) || !!p.ai?.ids?.has(x.r.id) : inLens(p.lens, x.r)));
  const openCount = seen.filter((x) => p.statusOf(x.r) === 'open').length;
  const hotOpen = seen.filter((x) => x.r.hot && p.statusOf(x.r) === 'open').length;
  const anyKind = f.stars || f.bib || f.hot || f.fav;
  const active = [...CHIPS, ...MORE_CHIPS].filter(([k]) => f[k]).map(([, label]) => label);
  const moreOn = MORE_CHIPS.filter(([k]) => f[k]).length;
  const [moreOpen, setMoreOpen] = useState(false);
  // Places we cannot read sort last ("Book on their site"): folded into one line unless a search or Near me is on.
  const rest = rows.filter((x) => x.s === 'unknown').length;
  const [restOpen, setRestOpen] = useState(false);
  const fold = rest > 0 && !p.me && !q && !restOpen;
  const shown = fold ? rows.filter((x) => x.s !== 'unknown') : rows;
  // On a phone the whole list scrolls as one (search and chips go with the rows); elsewhere only the rows do.
  const narrow = useNarrow();
  const [scroller, more, check] = useMore<HTMLElement>(`${shown.length}${q}${active}${p.lens?.id}${narrow}${p.collapsed}${moreOpen}`);
  let last: Status | null = null;
  return (
    <section className="px list" ref={narrow ? scroller : undefined} onScroll={narrow ? check : undefined}>
      <div className="list-head">
        <div className="list-top">
          <button className="row head-toggle" onClick={p.onToggle} aria-expanded={!p.collapsed}>
            <span className="stud" style={{ background: STATUS_COLOUR.open }} aria-hidden="true" />
            <h2>{openCount} free</h2>
            <span className="sheet-toggle" aria-hidden="true">
              {p.collapsed ? 'List ▴' : 'Show map'}
            </span>
          </button>
        </div>
        <p className="sum">
          {q
            ? `${seen.length} of all ${p.placed.length} restaurants match, for two`
            : `for two, of ${guide ? (guide.kind === 'guide' ? `${seen.length} ${guide.title} picks` : `${seen.length} in “${guide.title}”`) : `${p.placed.length} restaurants`}`}
          {hotOpen ? `; ${hotOpen} hard to get` : ''}
          {p.me && !p.me.note ? ', nearest first' : ''} · read {ago(p.data.generatedAt)}
          {guide && !q && (guide.by || guide.url || (guide.kind !== 'guide' && guide.line)) && (
            <span className="lens-line">
              {' · '}
              {guide.kind !== 'guide' && guide.line && <span>{guide.line} </span>}
              {guide.by && (
                <span className="maker">
                  <Avatar look={cleanLook(guide.by.avatar)} size={18} /> {guide.by.name}
                </span>
              )}
              {guide.url && (
                <a href={guide.url} target="_blank" rel="noopener noreferrer">
                  Their list ↗
                </a>
              )}
            </span>
          )}
        </p>
        {active.length > 0 && (
          <p className="active">
            Only: {active.join(', ')}
            <button className="link" onClick={() => p.onFilters(NO_FILTERS)}>
              Show all
            </button>
          </p>
        )}
        <div className="filters">
          <div className="chips" role="group" aria-label="Show">
            {CHIPS.map(([k, label]) => (
              <button key={k} className="chip" aria-pressed={f[k]} onClick={() => p.onFilters({ ...f, [k]: !f[k] })}>
                {label}
              </button>
            ))}
            <button className="chip more" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)}>
              More{moreOn ? ` · ${moreOn}` : ''} {moreOpen ? '▴' : '▾'}
            </button>
          </div>
          {moreOpen && (
            <div className="chips" role="group" aria-label="More filters">
              {MORE_CHIPS.filter(([k]) => hasMichelin || (k !== 'stars' && k !== 'bib')).map(([k, label]) => (
                <button key={k} className="chip" aria-pressed={f[k]} onClick={() => p.onFilters({ ...f, [k]: !f[k] })}>
                  {label}
                  {k === 'fav' && p.favs.size ? ` ${p.favs.size}` : ''}
                </button>
              ))}
            </div>
          )}
        </div>
        {p.me?.note && <p className="note">{p.me.note}</p>}
      </div>
      <ul className="rows" ref={narrow ? undefined : (scroller as RefObject<HTMLUListElement | null>)} onScroll={narrow ? undefined : check}>
        {rows.length === 0 && !(q && p.ai?.busy) && (
          <li className="empty">
            {f.open ? `Nothing free on ${dayLabel(p.day)}${anyKind ? ' among these' : ''}.` : q ? 'No restaurant matches that.' : 'None of these yet.'}
            {f.fav && !p.favs.size && <div>Add a restaurant from its card with ♥ and it shows here.</div>}
            {f.open && p.nextOpen && (
              <div>
                <button className="btn small" onClick={() => p.onDay(p.nextOpen!)}>
                  Next day with a table: {dayLabel(p.nextOpen)}
                </button>
              </div>
            )}
          </li>
        )}
        {shown.map(({ r, s, m }) => {
          const head = !p.me && s !== last;
          last = s;
          return (
            <li key={r.id}>
              {head && (s === 'unknown' && !q ? <RestFold n={rest} open onToggle={() => setRestOpen(false)} /> : <div className="group label">{GROUP_WORD[s]}</div>)}
              <PlaceRow r={r} s={s} data={p.data} day={p.day} fav={p.lens?.kind !== 'mine' && p.favs.has(r.id)} lead={p.me ? `${bike(m)} · ` : ''} onPick={p.onPick} />
            </li>
          );
        })}
        {fold && (
          <li>
            <RestFold n={rest} open={false} onToggle={() => setRestOpen(true)} />
          </li>
        )}
      </ul>
      {more && <div className="more-fade" aria-hidden="true" />}
    </section>
  );
}

/** The folded group of places we cannot read, and its header once open. */
function RestFold({ n, open, onToggle }: { n: number; open: boolean; onToggle: () => void }) {
  return (
    <button className="fold label" aria-expanded={open} onClick={onToggle}>
      {open ? '▾' : '▸'} {GROUP_WORD.unknown} ({n})
    </button>
  );
}

/** What the colours and marks mean: in How this works, out of the list (Joel, 23 Nov 2026). */
function Key() {
  return (
    <span className="key">
      {ORDER.map((st) => (
        <span key={st}>
          <i className="swatch" style={badgeStyle(st)} /> {STATUS_WORD[st].toLowerCase()}
        </span>
      ))}
      <span>
        <Marks r={{ michelin: '1' } as MapRestaurant} /> MICHELIN Star
      </span>
      <span>
        <Marks r={{ michelin: 'bib' } as MapRestaurant} /> Bib Gourmand
      </span>
      <span>
        <Marks r={{ hot: 1 } as MapRestaurant} /> hard to get
      </span>
    </span>
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
  you: You;
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
  const url = `${location.origin}${location.pathname}?r=${encodeURIComponent(r.id)}&date=${day}${OUR_ART ? '' : '&art=sez'}`;
  const text = `${r.name}, ${dayLabel(day, { long: true })}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: r.name, text, url });
      return '';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return ''; // closed the share sheet: nothing to say
      // Any other refusal (no share target, not allowed): copy instead (runtime walk, 19 Nov 2026).
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'Link copied';
  } catch {
    // The runtime walk (19 Nov 2026): a refused clipboard left Share doing nothing at all.
    return 'Copy the address bar';
  }
}

/** "+ List", for a character (named lists that can be shared): put this restaurant in one, or start one with it. */
function AddToList({ r, you }: { r: MapRestaurant; you: You }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  return (
    <div className="addlist">
      <button className="btn small" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        + List
      </button>
      {open && (
        <div className="px pop" role="group" aria-label="Add to a list">
          <h4>Add to a list</h4>
          {you.lists.map((l) => (
            <label className="check" key={l.id}>
              <input
                type="checkbox"
                checked={l.places.includes(r.id)}
                disabled={you.busy}
                onChange={(e) => void you.saveList({ ...l, places: e.target.checked ? [...l.places, r.id] : l.places.filter((x) => x !== r.id) })}
              />{' '}
              {l.title}
            </label>
          ))}
          <form
            className="newlist"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await you.saveList({ title, places: [r.id], public: false })) setTitle('');
            }}
          >
            <input aria-label="New list name" placeholder="New list" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} />
            <button className="btn small" type="submit" disabled={!title.trim() || you.busy}>
              Add
            </button>
          </form>
          <Trouble you={you} />
        </div>
      )}
    </div>
  );
}

/** Their Instagram as a tilted sticker: the handle their own site links, opened on Instagram. */
function IgSticker({ ig }: { ig: string }) {
  return (
    <a className="sticker ig" href={`https://www.instagram.com/${ig}/`} target="_blank" rel="noopener noreferrer" title={`@${ig} on Instagram`}>
      <span className="ig-dot" aria-hidden="true" />@{ig}
    </a>
  );
}

function Card({ r, offMap, data, day, status, saved, onSave, onClose, onDay, onLens, you }: CardProps) {
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
  const [noPhoto, setNoPhoto] = useState(false);
  useEffect(() => setNoPhoto(false), [r.id]);
  // On a phone the card opens small: who, the free times, Book and one line of links (Joel, 25 Nov 2026: "just
  // literally show these bubbles ... and book, and that's it"). More opens the whole card.
  const narrow = useNarrow();
  const [full, setFull] = useState(false);
  useEffect(() => setFull(false), [r.id]);
  const route = `https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lng}&travelmode=bicycling`;
  if (narrow && !full)
    return (
      <section className="px card mini">
        <div className="mini-head">
          <div className="mini-thumb" aria-hidden="true">
            {r.photo && !noPhoto ? (
              <img src={r.photo} alt="" referrerPolicy="no-referrer" onError={() => setNoPhoto(true)} />
            ) : (
              <RoomCanvas kind={r.kind} status={status} free={times.length || 3} seed={seed} />
            )}
          </div>
          <div className="mini-name">
            <h2>{r.name}</h2>
            <p className="where">
              {KIND_WORD[r.kind] ?? 'Restaurant'} · {r.area}
            </p>
          </div>
          <button className="btn small more" onClick={() => setFull(true)} aria-label="More: site, route, share, save, calendar">
            ···
          </button>
          <button className="btn small close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {status === 'open' && times.length > 0 ? (
          <div className="times strip" role="group" aria-label={`Free times, ${dayLabel(day, { long: true })}`}>
            {times.map((t) => (
              <button key={t} className="time" aria-pressed={t === pick} onClick={() => setPicked(t)}>
                {t}
              </button>
            ))}
          </div>
        ) : (
          <p className="mini-state">
            <span className="stud" style={{ background: STATUS_COLOUR[status] }} />
            {dayLabel(day)}: {walkIn(r) ? 'walk in' : STATUS_WORD[status].toLowerCase()}
            {next && (
              <button className="link" onClick={() => onDay(next)}>
                first free {dayLabel(next)}
              </button>
            )}
          </p>
        )}
        {/* Call sits next to Book (Canberk through Joel, 27 Nov 2026: "add a call option next to reserve, they might not
            see the request so close"): a table booked online an hour ahead may go unseen. */}
        {((book && !walkIn(r)) || r.phone) && (
          <div className="mini-actions">
            {book && !walkIn(r) && (
              <a className={`btn book${status === 'open' ? ' primary' : ''}`} href={book} target="_blank" rel="noopener">
                <span>
                  {status === 'open' ? `Book${pick ? ` ${pick}` : ''}` : 'Booking page'} on {r.readable ? r.platform : 'their site'}
                </span>
                {/* Their page can't be told the date: say which one to pick, inside the button, so it costs no line. */}
                {status === 'open' && NO_DATE_LINK.has(r.platform) && <small>pick {dayLabel(day)} there</small>}
              </a>
            )}
            {r.phone && (
              <a className="btn call" href={`tel:${r.phone}`} aria-label={`Call ${r.name}: ${phoneWords(r.phone)}`}>
                Call
              </a>
            )}
          </div>
        )}
      </section>
    );
  return (
    <section className="px card">
      <div className="card-scroll" ref={scroller} onScroll={check}>
        {/* Their own photo with stickers on it (Joel, 24 Nov 2026: "add the link to the Instagram and photos. Very Gen Z"):
            the Instagram handle and our pixel room. A photo that fails to load falls back to the room alone. */}
        {r.photo && !noPhoto ? (
          <div className="room snap">
            <img className="shot" src={r.photo} alt={`${r.name}, from their own site`} referrerPolicy="no-referrer" onError={() => setNoPhoto(true)} />
            <a className="sticker credit" href={r.site ?? r.photo} target="_blank" rel="noopener noreferrer">
              pic: their site ↗
            </a>
            <div className="sticker mini-room" aria-hidden="true">
              <RoomCanvas kind={r.kind} status={status} free={times.length || 3} seed={seed} />
            </div>
            {r.ig && <IgSticker ig={r.ig} />}
            <button className="btn small close" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        ) : (
          <div className="room">
            <RoomCanvas kind={r.kind} status={status} free={times.length || 3} seed={seed} />
            {r.ig && <IgSticker ig={r.ig} />}
            <button className="btn small close" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        )}
        <div className="card-body">
          <div className="title-row">
            <h2>{r.name}</h2>
            <div className="title-actions">
              <button className={`btn small save${saved ? ' on' : ''}`} aria-pressed={saved} onClick={onSave} title={saved ? 'On your list, on this device' : 'Add to your list, on this device'}>
                {saved ? '♥ My list' : '♡ My list'}
              </button>
              {you.account && <AddToList r={r} you={you} />}
            </div>
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
                    <span className="pair">
                      <button className="link" onClick={() => onLens(g.id)} title={g.line}>
                        {g.short}
                      </button>
                      {g.notes?.[r.id] && (
                        <>
                          {' '}
                          <a className="note" href={g.notes[r.id]!.url} target="_blank" rel="noopener noreferrer" title={`The review in ${g.by}, ${g.notes[r.id]!.year}`}>
                            {g.notes[r.id]!.score} ({g.notes[r.id]!.year}) ↗
                          </a>
                        </>
                      )}
                    </span>
                  </span>
                ))}
            </p>
          )}
          {offMap && <p className="where">Outside the drawn city: its sign stands in the fog.</p>}
          <div className="state">
            <span className="stud" style={{ background: STATUS_COLOUR[status] }} />
            <div>
              <b>
                {dayLabel(day, { long: true })}: {walkIn(r) ? 'walk in' : STATUS_WORD[status].toLowerCase()}
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
          <div className={`actions${r.phone ? ' has-call' : ''}`}>
            {book && !walkIn(r) && (
              <a className={`btn${status === 'open' ? ' primary' : ''}`} href={book} target="_blank" rel="noopener">
                {status === 'open' ? `Book${pick ? ` ${pick}` : ''}` : 'Booking page'} on {r.readable ? r.platform : 'their site'}
              </a>
            )}
            {/* The number is written out: on a computer you read it and dial on your phone. */}
            {r.phone && (
              <a className="btn call" href={`tel:${r.phone}`}>
                <span>Call</span>
                <small>{phoneWords(r.phone)}</small>
              </a>
            )}
            {r.site && (walkIn(r) || r.site !== book) && (
              <a className="btn" href={r.site} target="_blank" rel="noopener">
                Website
              </a>
            )}
            <a className="btn" href={route} target="_blank" rel="noopener">
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
                      style={badgeStyle(s)}
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
            {walkIn(r)
              ? 'It takes no bookings: you walk in.'
              : `${r.readable ? `Read from ${r.platform} ${ago(r.readAt)}, for two people.` : `We can't read ${r.platform === 'other' ? 'this booking system' : r.platform} yet.`} Another party size: their booking page shows it. You always book with the restaurant itself.`}
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

type DialogKind = 'about' | 'restaurants' | 'lists' | 'welcome' | 'you';

function Dialog({ kind, onKind, onClose }: { kind: 'about' | 'restaurants'; onKind: (k: DialogKind) => void; onClose: () => void }) {
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
              has a table for two, from the first free time to the last. The green bar under each day shows how many restaurants have a table then.
            </p>
            <h3>Colours and marks</h3>
            <p>
              <Key />
            </p>
            <h3>Where it comes from</h3>
            <p>
              About every 15 minutes we read each restaurant's own public booking calendar (Tebi, Zenchef, Formitable, SevenRooms, TableCheck,
              Guestplan, Frank): the same calendar any guest sees. A few restaurants are watched more closely, so their signs change sooner.
            </p>
            {CONTACT && (
              <>
                <h3>Missing a place?</h3>
                <p>
                  Tell us which one, and we add it when its booking calendar is public.{' '}
                  <button className="link" onClick={() => onKind('lists')}>
                    Suggest a restaurant
                  </button>
                </p>
              </>
            )}
            <h3>The city</h3>
            {OUR_ART ? (
              <p>
                The city is Seated's own drawing, north up: buildings from the 3DBAG 3D models (TU Delft and 3DGI, CC BY 4.0), façade
                colours from Gemeente Amsterdam street panoramas (CC BY 4.0), roofs from the PDOK aerial photo (CC BY 4.0), streets
                and water from OpenStreetMap. For the hand-tuned drawing by sezlab (north-west up), open{' '}
                <a href="?art=sez">the map in his art</a>.
              </p>
            ) : (
              <p>
                The city is drawn by sezlab: <a href="https://sezlab.dev/amsterdam">sezlab.dev/amsterdam</a>, used with his permission.
                Like his work? <a href="https://github.com/sponsors/sezkus">Sponsor him</a>. His drawing is made from 3DBAG (TU Delft and
                3DGI), the PDOK aerial photo (Beeldmateriaal Nederland) and OpenStreetMap. Noord is drawn by Seated in the same style, from 3DBAG, PDOK and OpenStreetMap. Restaurants outside the drawn city appear in the list and have a sign standing in the fog.{' '}
                <a href="?">Seated's own drawing</a> is north up.
              </p>
            )}
            <h3>“Not bookable yet”</h3>
            <p>
              Many places open their calendar a set number of days ahead. When a day is past the end of a calendar, we say so, and
              when the window is clear we guess the day it opens.
            </p>
            <h3>Booking</h3>
            <p>You always book on the restaurant's own page. We never hold, sell or book tables. This page sets no cookies; it counts visits without them (Vercel Web Analytics).</p>
            <h3>Your character</h3>
            <p>
              The character you choose stays on this device. If you make a character with a name, we keep its name, its look, your choice and
              your lists, tied to a key only you hold: no email, no password, no tracking. Lists you share in Community show your character's
              name. Delete your character any time under You (top right); its lists go with it.
            </p>
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
