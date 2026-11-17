import { randomUUID } from 'node:crypto';
import { localDate, localTime } from '../time.js';
import type { DayState, Platform, Restaurant, Slot } from './types.js';

// TableCheck: read-only, plain POSTs on its booking API, no login, cookie or captcha (checked 17 Nov 2026 on Ciel Bleu
// and Serre at Hotel Okura). uid is the shop slug in tablecheck.com/en/{slug}/reserve. Seated never books on TableCheck.
const API = 'https://production-booking.tablecheck.com/v2/booking';
const SITE = 'https://www.tablecheck.com';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const MIN_GAP_MS = 300;

/** Per day the calendar lists tags: "closed" (no service), "cache_unavailable" (nothing free), none (tables free). */
export function dayState(tags: string[]): DayState {
  if (tags.includes('closed')) return 'closed';
  if (tags.includes('cache_unavailable')) return 'full';
  return 'open';
}

/** One day's meals as slots: a time is a table when TableCheck marks it available (`a`). No meals: closed. */
export function toSlots(date: string, meals: Record<string, Array<{ t: string; a: boolean }>>): Slot[] {
  const byTime = new Map<string, boolean>();
  for (const times of Object.values(meals)) {
    for (const { t, a } of times) {
      const at = new Date(t);
      if (Number.isNaN(at.getTime()) || localDate(at) !== date) continue;
      const time = localTime(at);
      byTime.set(time, (byTime.get(time) ?? false) || a === true);
    }
  }
  return [...byTime].sort(([x], [y]) => x.localeCompare(y)).map(([time, open]) => ({ date, time, open, autoBookable: false }));
}

const monthsOf = (dates: string[]) => [...new Set(dates.map((d) => d.slice(0, 7)))].sort();
const lastDay = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

export function tablecheck({ fetchImpl = fetch, gapMs = MIN_GAP_MS } = {}): Platform {
  let lastRequestAt = 0;

  async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const wait = lastRequestAt + gapMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
    const res = await fetchImpl(`${API}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: SITE, Referer: `${SITE}/`, 'User-Agent': USER_AGENT },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    // A waiting room or any page that is not JSON is a failed read, never "no tables".
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) throw new Error(`TableCheck ${path} answered ${res.status}`);
    return (await res.json()) as T;
  }

  async function month(r: Restaurant, m: string, partySize: number): Promise<Record<string, string[]>> {
    const body = await post<{ calendar?: Record<string, string[]> }>('calendar', {
      shop_id: r.platformUid,
      start_date: `${m}-01T00:00:00.000+01:00`,
      end_date: `${lastDay(m)}T00:00:00.000+01:00`,
      pax_adult: partySize,
      unavailable: true,
    });
    if (!body.calendar || typeof body.calendar !== 'object') throw new Error('TableCheck calendar returned an unexpected shape');
    return body.calendar;
  }

  return {
    id: 'tablecheck',
    label: 'TableCheck',

    async getSlots(restaurant, date, partySize) {
      const body = await post<{ meals?: Record<string, Array<{ t: string; a: boolean }>> }>('meals_v2', {
        shop_id: restaurant.platformUid,
        date,
        pax_adult: partySize,
        locale: 'en',
        session_ref: randomUUID(),
      });
      if (!body.meals || typeof body.meals !== 'object') throw new Error('TableCheck meals returned an unexpected shape');
      return toSlots(date, body.meals);
    },

    async openDates(restaurant, dates, partySize) {
      const open = new Set<string>();
      for (const m of monthsOf(dates)) {
        const cal = await month(restaurant, m, partySize);
        for (const d of dates) if (d.startsWith(m) && cal[d] && dayState(cal[d]!) === 'open') open.add(d);
      }
      return open;
    },

    async calendar(restaurant, dates, partySize) {
      const out = new Map<string, DayState>();
      for (const m of monthsOf(dates)) {
        const cal = await month(restaurant, m, partySize);
        for (const d of dates) if (d.startsWith(m) && cal[d]) out.set(d, dayState(cal[d]!));
      }
      return out;
    },

    // TableCheck reads no date or party from the link (checked 17 Nov 2026): the reserve page of the shop.
    bookingUrl: (restaurant) => `${SITE}/en/${restaurant.platformUid}/reserve`,
  };
}
