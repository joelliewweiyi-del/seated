import type { DayState, Platform, Restaurant, Slot } from './types.js';

// Guestplan: read-only. Reads need only the restaurant's public widget key, which every site using Guestplan
// embeds (`_gstpln.accessKey`). Seated reads what the widget itself reads: etender-connect.com, Guestplan's own
// widget API (since 15 Nov 2026: api.guestplan.com/api/v2/getAvailability answered 403 to every read from 10 Nov,
// and the map kept showing five-day-old days). Seated never calls the booking endpoints.
// platformUid is "<accessKey>:<accountId>" because one key can cover several restaurants (checked Oct 2026).
const API = 'https://etender-connect.com/v1/restaurants';
const WIDGET = 'https://widget.guestplan.com/';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const MIN_GAP_MS = 300;

/** One quarter hour of a day. */
interface GuestplanTime {
  localTime: string; // "HH:mm", restaurant-local
  isOpen: boolean; // inside opening hours, online
  isAvailable: boolean; // bookable now
  isAvailableWithWaitlist?: boolean; // waitlist only when not isAvailable: not a table
  availablePartySizes?: number[];
}
/** One day of the range answer (from the date asked, about a year ahead). */
interface GuestplanDay {
  localDate: string; // "YYYY-MM-DD"
  isOpen: boolean;
  isAvailable: boolean;
  isAvailableWithWaitlist?: boolean;
}

/** Splits "<accessKey>:<accountId>". */
export function parseGuestplanUid(uid: string): { key: string; accountId: number } {
  const [key, account] = uid.split(':');
  const accountId = Number(account);
  if (!key || !Number.isInteger(accountId)) throw new Error(`Guestplan id must be "<accessKey>:<accountId>", got "${uid}"`);
  return { key, accountId };
}

/** A time is a table only when it is open and bookable for the party. A waitlist time is not; a closed hour is no slot. */
export function toSlots(date: string, times: GuestplanTime[], partySize: number): Slot[] {
  return times
    .filter((t) => t.isOpen)
    .map((t) => ({
      date,
      time: t.localTime,
      open: t.isAvailable && (!t.availablePartySizes?.length || t.availablePartySizes.includes(partySize)),
      autoBookable: false,
    }));
}

export function guestplan({ fetchImpl = fetch, gapMs = MIN_GAP_MS } = {}): Platform {
  let lastRequestAt = 0;

  async function politeGap(): Promise<void> {
    const wait = lastRequestAt + gapMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
  }

  async function read<T>(r: Restaurant, path: string, query: Record<string, string>): Promise<T> {
    const { key, accountId } = parseGuestplanUid(r.platformUid!);
    await politeGap();
    const res = await fetchImpl(`${API}/${accountId}/${path}?${new URLSearchParams(query)}`, {
      headers: { Accept: 'application/json', Authorization: `AccessKey ${key}`, 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Guestplan ${res.status}`);
    return (await res.json()) as T;
  }

  /** Every wanted day in one request: the answer runs from the first wanted day about a year ahead. */
  async function days(r: Restaurant, dates: string[], partySize: number): Promise<Map<string, GuestplanDay>> {
    const first = [...dates].sort()[0]!;
    const body = await read<GuestplanDay[]>(r, 'availability', { date: first, partySize: String(partySize) });
    if (!Array.isArray(body)) throw new Error('Guestplan returned an unexpected days shape');
    return new Map(body.map((d) => [d.localDate, d]));
  }

  return {
    id: 'guestplan',
    label: 'Guestplan',

    async getSlots(restaurant, date, partySize) {
      const [y, m, d] = date.split('-');
      const body = await read<GuestplanTime[]>(restaurant, `availability/${y}/${m}/${d}`, { partySize: String(partySize) });
      if (!Array.isArray(body)) throw new Error('Guestplan returned an unexpected day shape');
      return toSlots(date, body, partySize);
    },

    async openDates(restaurant, dates, partySize) {
      // Only days with a bookable time get a slot read; a day missing from the answer is read rather than called full.
      const known = await days(restaurant, dates, partySize);
      return new Set(dates.filter((d) => known.get(d)?.isAvailable === true || !known.has(d)));
    },

    async calendar(restaurant, dates, partySize) {
      const known = await days(restaurant, dates, partySize);
      const out = new Map<string, DayState>();
      for (const date of dates) {
        const day = known.get(date);
        if (day) out.set(date, !day.isOpen ? 'closed' : day.isAvailable ? 'open' : 'full');
      }
      return out;
    },

    bookingUrl(restaurant) {
      // Guestplan pre-fills date and party only with a Reserve with Google token. Faking one would tell the
      // restaurant the booking came from Google, so the link opens the plain widget; the push names the time.
      const { key, accountId } = parseGuestplanUid(restaurant.platformUid!);
      return `${WIDGET}?${new URLSearchParams({ i: key, account: String(accountId), locale: 'en' })}`;
    },
  };
}

/** Finds the public Guestplan widget key in a restaurant website's HTML (some sites URL-encode the snippet). */
export function findGuestplanKey(html: string): string | null {
  let text = html;
  try {
    text = decodeURIComponent(html);
  } catch {
    // not URL-encoded as a whole: search the raw HTML
  }
  return text.match(/_gstpln\.accessKey\s*=\s*["']([0-9a-f]{40})["']/i)?.[1]?.toLowerCase() ?? null;
}
