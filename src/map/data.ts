// The map's data: what the census and the radar know, per restaurant and day (built by src/server/mapData.ts).
import type { DayCode, MapData, MapRestaurant } from '../server/mapData';

export type { DayCode, MapData, MapRestaurant };

/** The default lens: Joel's curated list (data/map-guides.json, Joel 15 Nov 2026). '?lens=all' shows every restaurant. */
export const CURATED = 'seated';

export type Status = 'open' | 'full' | 'none' | 'closed' | 'later' | 'unknown';

export function statusOf(code: DayCode | undefined): Status {
  switch (code) {
    case 'o':
      return 'open';
    case 'f':
      return 'full';
    case 'n':
      return 'none';
    case 'c':
      return 'closed';
    case 'l':
      return 'later';
    case '?':
    case undefined:
      return 'unknown';
  }
  const exhaustive: never = code;
  return exhaustive;
}

export const STATUS_WORD: Record<Status, string> = {
  open: 'Tables free',
  full: 'Fully booked',
  none: 'No tables online',
  closed: 'Closed',
  later: 'Not bookable yet',
  unknown: 'Unknown',
};

/** Colours of the signs and awnings. Keep in step with styles.css. */
export const STATUS_COLOUR: Record<Status, string> = {
  open: '#3fae5f',
  full: '#e0604c',
  none: '#c27a72',
  closed: '#8f8a99',
  later: '#8c7bd8',
  unknown: '#b9b4c2',
};

/**
 * The look of a status badge or calendar day. Text on badges is dark violet (Joel, 15 Nov 2026: white on green was
 * 2.8:1). "No tables online" is hollow, a cream badge with a rose edge, so it never reads as Fully booked.
 */
export function badgeStyle(s: Status): { background: string; boxShadow?: string } {
  return s === 'none' ? { background: '#fffaf0', boxShadow: `inset 0 0 0 2px ${STATUS_COLOUR.none}` } : { background: STATUS_COLOUR[s] };
}

export function dayIndex(data: MapData, date: string): number {
  return Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${data.start}T12:00:00Z`)) / 86_400_000);
}

export function dateAt(data: MapData, i: number): string {
  return new Date(Date.parse(`${data.start}T12:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
}

export function codeOn(r: MapRestaurant, data: MapData, date: string): DayCode {
  const i = dayIndex(data, date);
  return (r.d[i] as DayCode | undefined) ?? '?';
}

/** "Fri 7 Nov". Dates are restaurant-local "YYYY-MM-DD" strings; this never shifts them by time zone. */
export function dayLabel(date: string, opts: { long?: boolean } = {}): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const W = opts.long ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${W[wd]} ${d} ${M[m - 1]}`;
}

export function weekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * When a day that is "not bookable yet" probably opens: the calendar shows `win` days ahead, so a day opens
 * `win` days before it. Null when the window is unknown.
 */
export function opensOn(r: MapRestaurant, date: string): string | null {
  if (r.win === null || r.win <= 0) return null;
  return new Date(Date.parse(`${date}T12:00:00Z`) - r.win * 86_400_000).toISOString().slice(0, 10);
}

export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never';
  const min = Math.round((now - Date.parse(iso)) / 60_000);
  if (min < 2) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export async function loadData(url = './data.json'): Promise<MapData> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`data.json answered ${res.status}`);
  return (await res.json()) as MapData;
}

/** A number as people say it: "+31203379680" reads "020 337 9680", a mobile "06 1234 5678". */
export function phoneWords(phone: string): string {
  const n = `0${phone.slice(3)}`;
  return n.startsWith('06') ? `06 ${n.slice(2, 6)} ${n.slice(6)}` : `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
}

/**
 * The day's booking link set to another free time. Formitable's link carries the time as `time` (minutes after
 * midnight), SevenRooms' as `start_time` (HH:mm); other links carry no time and stay as they are.
 */
export function linkAt(url: string, time: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === 'widget.formitable.com' && /^\d+$/.test(u.searchParams.get('time') ?? ''))
      u.searchParams.set('time', String(Number(time.slice(0, 2)) * 60 + Number(time.slice(3))));
    else if (u.hostname === 'www.sevenrooms.com' && u.searchParams.has('start_time')) u.searchParams.set('start_time', time);
    else return url;
    return u.toString();
  } catch {
    return url;
  }
}

/** Amsterdam's date and HH:mm now, whatever the viewer's own time zone. */
function amsterdamNow(now: Date): { date: string; time: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** A sign's badge for free times: first to last ("18:00–22:00"), one time alone; a count read as "times booked" (Joel, 20 Nov 2026). */
export function timeSpan(times: string[]): string {
  const sorted = [...times].sort();
  const first = sorted[0], last = sorted[sorted.length - 1];
  return !first ? 'free' : first === last ? first : `${first}–${last}`;
}

/** The free times on a day, without today's times that have already gone by (the data can be 15 minutes old). */
export function freeTimes(r: Pick<MapRestaurant, 't'>, date: string, now = new Date()): string[] {
  const list = r.t[date] ?? [];
  const here = amsterdamNow(now);
  return date === here.date ? list.filter((t) => t > here.time) : list;
}
