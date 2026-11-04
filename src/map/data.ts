// The map's data: what the census and the radar know, per restaurant and day (built by src/server/mapData.ts).
import type { DayCode, MapData, MapRestaurant } from '../server/mapData';

export type { DayCode, MapData, MapRestaurant };

export type Status = 'open' | 'full' | 'closed' | 'later' | 'unknown';

export function statusOf(code: DayCode | undefined): Status {
  switch (code) {
    case 'o':
      return 'open';
    case 'f':
    case 'n':
      return 'full';
    case 'c':
      return 'closed';
    case 'l':
      return 'later';
    default:
      return 'unknown';
  }
}

export const STATUS_WORD: Record<Status, string> = {
  open: 'Tables free',
  full: 'Fully booked',
  closed: 'Closed',
  later: 'Not bookable yet',
  unknown: 'Unknown',
};

/** Colours of the signs and awnings. Keep in step with styles.css. */
export const STATUS_COLOUR: Record<Status, string> = {
  open: '#3fae5f',
  full: '#e0604c',
  closed: '#8f8a99',
  later: '#8c7bd8',
  unknown: '#b9b4c2',
};

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
