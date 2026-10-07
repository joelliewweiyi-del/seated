import type { Platform, Restaurant, Slot } from './types.js';

// SevenRooms: read-only. The public widget endpoint needs no login or captcha (checked Oct 2026).
// One call covers up to 3 days and the whole day around `time_slot`. Seated never books on SevenRooms.
const API = 'https://www.sevenrooms.com/api-yoa/availability/ng/widget/range';
const SITE = 'https://www.sevenrooms.com';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const MIN_GAP_MS = 300;
/** The widget refuses num_days=7; 3 is known to work. */
const MAX_DAYS = 3;
/** 16:00 plus or minus 32 steps of 15 minutes: 08:00 to midnight, lunch and dinner in one call. */
const CENTER = '16:00';
const HALO = 32;
/** Slots read by the calendar call are reused by the day reads of the same check. */
const CACHE_MS = 45_000;

interface SevenRoomsTime {
  type: string; // "book" = a table; "request" = ask the restaurant, no table
  time: string; // venue-local "HH:mm"
}
interface SevenRoomsShift {
  is_closed?: boolean;
  is_forced_empty_availability?: boolean;
  times?: SevenRoomsTime[];
}
interface SevenRoomsRange {
  data?: { availability?: Record<string, SevenRoomsShift[]> };
}

/** "2026-10-09" -> "10-09-2026", the date format the widget API wants. */
const usDate = (date: string) => {
  const [y, m, d] = date.split('-');
  return `${m}-${d}-${y}`;
};

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Turns one day's shifts into slots. A time is open only as "book" in a shift that is not closed.
 * "request" times are not tables. A venue can list the same time once per seating area: one slot per time.
 */
export function toSlots(date: string, shifts: SevenRoomsShift[]): Slot[] {
  const byTime = new Map<string, boolean>();
  for (const shift of shifts) {
    const closed = Boolean(shift.is_closed || shift.is_forced_empty_availability);
    for (const t of shift.times ?? []) {
      if (!/^\d{2}:\d{2}$/.test(t.time)) continue;
      const open = !closed && t.type === 'book';
      byTime.set(t.time, (byTime.get(t.time) ?? false) || open);
    }
  }
  return [...byTime]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, open]) => ({ date, time, open, autoBookable: false }));
}

export function sevenrooms({ fetchImpl = fetch, gapMs = MIN_GAP_MS, now = () => Date.now() } = {}): Platform {
  let lastRequestAt = 0;
  const cache = new Map<string, { at: number; slots: Slot[] }>();

  async function politeGap(): Promise<void> {
    const wait = lastRequestAt + gapMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
  }

  /** Reads `days` days from `start`, caches each day, and returns them. Throws on any error. */
  async function readRange(r: Restaurant, start: string, days: number, partySize: number): Promise<Map<string, Slot[]>> {
    const q = new URLSearchParams({
      venue: r.platformUid!,
      time_slot: CENTER,
      party_size: String(partySize),
      halo_size_interval: String(HALO),
      start_date: usDate(start),
      num_days: String(days),
      channel: 'SEVENROOMS_WIDGET',
      exclude_pdr: 'true',
    });
    await politeGap();
    const res = await fetchImpl(`${API}?${q}`, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`SevenRooms ${res.status}`);
    const body = (await res.json()) as SevenRoomsRange;
    const availability = body.data?.availability;
    if (!availability || typeof availability !== 'object') throw new Error('SevenRooms returned an unexpected shape');
    const out = new Map<string, Slot[]>();
    for (let i = 0; i < days; i++) {
      const date = addDays(start, i);
      const slots = toSlots(date, availability[date] ?? []); // a missing day is a closed day
      out.set(date, slots);
      cache.set(`${r.platformUid}|${partySize}|${date}`, { at: now(), slots });
    }
    return out;
  }

  return {
    id: 'sevenrooms',
    label: 'SevenRooms',

    async getSlots(restaurant, date, partySize) {
      const hit = cache.get(`${restaurant.platformUid}|${partySize}|${date}`);
      if (hit && now() - hit.at < CACHE_MS) return hit.slots;
      return (await readRange(restaurant, date, 1, partySize)).get(date)!;
    },

    async openDates(restaurant, dates, partySize) {
      // Windows of up to three days: a Friday-and-Saturday watch costs one call per weekend.
      const sorted = [...new Set(dates)].sort();
      const worth = new Set<string>();
      for (let i = 0; i < sorted.length; ) {
        const start = sorted[i]!;
        const last = addDays(start, MAX_DAYS - 1);
        const window = sorted.filter((d) => d >= start && d <= last);
        const span = Math.round((Date.parse(window.at(-1)!) - Date.parse(start)) / 86_400_000) + 1;
        const days = await readRange(restaurant, start, span, partySize);
        for (const d of window) if (days.get(d)?.some((s) => s.open)) worth.add(d);
        i += window.length;
      }
      return worth;
    },

    bookingUrl(restaurant, date, time, partySize) {
      // The widget reads date, party size and start time from this link (checked in its code, Oct 2026).
      const q = new URLSearchParams({ date, party_size: String(partySize), start_time: time });
      return `${SITE}/explore/${restaurant.platformUid}/reservations/create/search/?${q}`;
    },
  };
}

/** Finds a SevenRooms venue slug in a restaurant website's HTML. */
export function findSevenroomsSlug(html: string): string | null {
  const m =
    html.match(/sevenrooms\.com\/(?:reservations|explore)\/([a-z0-9_-]+)/i) ??
    html.match(/venueId["']?\s*[:=]\s*["']([a-z0-9_-]+)["']/i);
  return m?.[1]?.toLowerCase() ?? null;
}
