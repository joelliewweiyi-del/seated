import type { DayState, Platform, Slot } from './types.js';

// Frank (meetfrank.app): read-only. The booking widget's own public API, plain GETs with the restaurant's widget id
// (the uuid in widget.workspace.meetfrank.app/{id}/open). Seated never calls its booking endpoints.
// Checked 5 Nov 2026 at Sinne, Bolenius and Sea Palace:
//   GET {id}/time-slots/month?month&year&number_of_people  -> { data: [{ date_time, status }] }, whole weeks
//   GET {id}/time-slots/day?date&number_of_people          -> { data: [{ date_time: "...T19:00:00+01:00", status }] }
// Day status: available, waitlist (full: the widget shows "All tables are booked"), unavailable (no table: closed,
// or not bookable online that day; Sea Palace showed it on a Saturday).
// Slot status: available is a table; waitlist is not. The API refuses a request without Accept-Language.
const API = 'https://api.workspace.meetfrank.app/widget-api';
const WIDGET = 'https://widget.workspace.meetfrank.app';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const MIN_GAP_MS = 300;
const DAY_STATE = new Map<string, DayState>([['available', 'open'], ['waitlist', 'full'], ['unavailable', 'none']]);

interface FrankEntry {
  date_time: string;
  status: string;
}

/** The restaurant-local date and time of a Frank timestamp: it carries the restaurant's own offset. */
const local = (dateTime: string) => ({ date: dateTime.slice(0, 10), time: dateTime.slice(11, 16) });

export function frank({ fetchImpl = fetch, gapMs = MIN_GAP_MS } = {}): Platform {
  let lastRequestAt = 0;

  async function read(uid: string | null, path: string, query: Record<string, string>): Promise<FrankEntry[]> {
    if (!uid) throw new Error('Frank needs the widget id');
    const wait = lastRequestAt + gapMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
    const res = await fetchImpl(`${API}/${encodeURIComponent(uid)}/${path}?${new URLSearchParams(query)}`, {
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'en',
        'User-Agent': USER_AGENT,
        Origin: WIDGET,
        Referer: `${WIDGET}/`,
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Frank ${res.status}`);
    const body = (await res.json()) as { data?: unknown };
    if (!Array.isArray(body.data)) throw new Error('Frank returned an unexpected shape');
    return body.data as FrankEntry[];
  }

  async function months(uid: string | null, dates: string[], partySize: number): Promise<Map<string, string>> {
    const status = new Map<string, string>();
    for (const month of [...new Set(dates.map((d) => d.slice(0, 7)))]) {
      const [year, m] = month.split('-');
      const days = await read(uid, 'time-slots/month', { month: String(Number(m)), number_of_people: String(partySize), year: year! });
      for (const d of days) status.set(local(d.date_time).date, d.status);
    }
    return status;
  }

  return {
    id: 'frank',
    label: 'Frank',

    async getSlots(restaurant, date, partySize) {
      const times = await read(restaurant.platformUid, 'time-slots/day', { date, number_of_people: String(partySize) });
      return times
        .map((t) => ({ ...local(t.date_time), status: t.status }))
        .filter((t) => t.date === date)
        .map((t): Slot => ({ date, time: t.time, open: t.status === 'available', autoBookable: false }));
    },

    async openDates(restaurant, dates, partySize) {
      const status = await months(restaurant.platformUid, dates, partySize);
      // A day the month call left out is unknown: read it rather than call it full.
      return new Set(dates.filter((d) => !status.has(d) || status.get(d) === 'available'));
    },

    async calendar(restaurant, dates, partySize) {
      const status = await months(restaurant.platformUid, dates, partySize);
      const out = new Map<string, DayState>();
      for (const d of dates) {
        const state = DAY_STATE.get(status.get(d) ?? '');
        if (state) out.set(d, state);
      }
      return out;
    },

    bookingUrl(restaurant) {
      // The widget takes no date, time or party from the link (checked 5 Nov 2026): the push names the time.
      return `${WIDGET}/${restaurant.platformUid}/open?lang=en`;
    },
  };
}
