import type { Platform, Slot } from './types.js';

// Zenchef: read-only, plain GETs (checked Oct 2026). Party size is not a parameter: every shift and slot lists
// the party sizes it can take right now. The widget may send an AWS WAF bot token; reads work without it.
// Seated never obtains or forges that token: if Zenchef starts demanding it, reads fail and the radar says so.
const API = 'https://bookings-middleware.zenchef.com';
const BOOKING = 'https://bookings.zenchef.com/results';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const MIN_GAP_MS = 300;

interface ZenchefSlot {
  name: string; // "19:00", restaurant-local
  closed?: boolean;
  marked_as_full?: boolean;
  possible_guests?: number[]; // party sizes bookable at this slot now
}
interface ZenchefShift {
  name?: string;
  closed?: boolean;
  marked_as_full?: boolean;
  possible_guests?: number[];
  shift_slots?: ZenchefSlot[];
}
interface ZenchefDay {
  date: string;
  isOpen?: boolean | string;
  shifts?: ZenchefShift[];
}

/** A slot is a table for the party only if neither it nor its shift is closed or full, and the party size fits. */
export function toSlots(date: string, shifts: ZenchefShift[], partySize: number): Slot[] {
  const byTime = new Map<string, boolean>();
  for (const shift of shifts) {
    for (const s of shift.shift_slots ?? []) {
      if (!/^\d{2}:\d{2}$/.test(s.name)) continue;
      const open = !shift.closed && !shift.marked_as_full && !s.closed && !s.marked_as_full && (s.possible_guests ?? []).includes(partySize);
      byTime.set(s.name, (byTime.get(s.name) ?? false) || open);
    }
  }
  return [...byTime]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, open]) => ({ date, time, open, autoBookable: false }));
}

export function zenchef({ fetchImpl = fetch, gapMs = MIN_GAP_MS } = {}): Platform {
  let lastRequestAt = 0;

  async function politeGap(): Promise<void> {
    const wait = lastRequestAt + gapMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
  }

  async function get(path: string, params: Record<string, string>): Promise<ZenchefDay[]> {
    await politeGap();
    const res = await fetchImpl(`${API}/${path}?${new URLSearchParams(params)}`, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(15_000),
    });
    // 202 is how a WAF challenge looks: not data. Treat it as a failed read, never as "no tables".
    if (res.status !== 200) throw new Error(`Zenchef ${res.status}`);
    const body = (await res.json()) as unknown;
    if (!Array.isArray(body)) throw new Error('Zenchef returned an unexpected shape');
    return body as ZenchefDay[];
  }

  return {
    id: 'zenchef',
    label: 'Zenchef',

    async getSlots(restaurant, date, partySize) {
      const days = await get('getAvailabilities', { restaurantId: restaurant.platformUid!, date_begin: date, date_end: date });
      // A range answer can include padding days; use only the asked one. A missing day is a closed day.
      const day = days.find((d) => d.date === date);
      return toSlots(date, day?.shifts ?? [], partySize);
    },

    async openDates(restaurant, dates, partySize) {
      // One summary call for the whole span. Only days where some shift fits the party get a slot read.
      const sorted = [...new Set(dates)].sort();
      const days = await get('getAvailabilitiesSummary', {
        restaurantId: restaurant.platformUid!,
        date_begin: sorted[0]!,
        date_end: sorted.at(-1)!,
      });
      const byDate = new Map(days.map((d) => [d.date, d]));
      return new Set(
        sorted.filter((date) => {
          const day = byDate.get(date);
          if (!day) return true; // not in the answer: unknown, so read it rather than call it full
          return (day.shifts ?? []).some((s) => !s.closed && !s.marked_as_full && (s.possible_guests ?? []).includes(partySize));
        }),
      );
    },

    bookingUrl(restaurant, date, _time, partySize) {
      // The widget reads party size and day from the link; it has no time parameter (checked Oct 2026).
      const q = new URLSearchParams({ rid: restaurant.platformUid!, pid: '1001', pax: String(partySize), day: date });
      return `${BOOKING}?${q}`;
    },
  };
}

/** Finds a Zenchef restaurant id in a restaurant website's HTML. */
export function findZenchefId(html: string): string | null {
  const m =
    html.match(/zc-widget-config[^>]*data-restaurant=["'](\d+)["']/i) ??
    html.match(/bookings\.zenchef\.com\/results\?[^"'\s]*\brid=(\d+)/i);
  return m?.[1] ?? null;
}
