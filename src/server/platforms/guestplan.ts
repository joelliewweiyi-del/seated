import type { Platform, Restaurant, Slot } from './types.js';

// Guestplan: read-only. Reads need only the restaurant's public widget key, which every site using Guestplan
// embeds (`_gstpln.accessKey`). getAvailability is a POST but only reads; Seated never calls the booking endpoints.
// platformUid is "<accessKey>:<accountId>" because one key can cover several restaurants (checked Oct 2026).
const API = 'https://api.guestplan.com/api/v2/getAvailability';
const WIDGET = 'https://widget.guestplan.com/';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const MIN_GAP_MS = 300;

interface GuestplanTime {
  t: string; // "HH:mm", restaurant-local
  o?: boolean; // open for online booking
  a?: boolean; // bookable now for this party size
  w?: boolean; // waitlist only: not a table
}
interface GuestplanDay {
  d: string; // "YYYYMMDD"
  do?: boolean; // day open for online booking
  a?: boolean; // at least one bookable time for this party size
}

const compact = (date: string) => date.replaceAll('-', '');

/** Splits "<accessKey>:<accountId>". */
export function parseGuestplanUid(uid: string): { key: string; accountId: number } {
  const [key, account] = uid.split(':');
  const accountId = Number(account);
  if (!key || !Number.isInteger(accountId)) throw new Error(`Guestplan id must be "<accessKey>:<accountId>", got "${uid}"`);
  return { key, accountId };
}

/** A time is a table only when it is open online and bookable for the party. A waitlist time is not. */
export function toSlots(date: string, times: GuestplanTime[]): Slot[] {
  return times
    .filter((t) => t.o !== undefined || t.a !== undefined || t.w !== undefined) // bare times are outside opening hours
    .map((t) => ({ date, time: t.t, open: t.o === true && t.a === true, autoBookable: false }));
}

export function guestplan({ fetchImpl = fetch, gapMs = MIN_GAP_MS } = {}): Platform {
  let lastRequestAt = 0;

  async function politeGap(): Promise<void> {
    const wait = lastRequestAt + gapMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
  }

  async function read<T>(r: Restaurant, body: Record<string, unknown>): Promise<T> {
    const { key, accountId } = parseGuestplanUid(r.platformUid!);
    await politeGap();
    const res = await fetchImpl(API, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `AccessKey ${key}`,
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify({ accountId, ...body }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Guestplan ${res.status}`);
    return (await res.json()) as T;
  }

  return {
    id: 'guestplan',
    label: 'Guestplan',

    async getSlots(restaurant, date, partySize) {
      const body = await read<{ trs?: GuestplanTime[] }>(restaurant, { date: compact(date), partySize });
      if (!Array.isArray(body.trs)) throw new Error('Guestplan returned an unexpected day shape');
      return toSlots(date, body.trs);
    },

    async openDates(restaurant, dates, partySize) {
      // One request for all the wanted days: only days with a bookable time get a slot read.
      const body = await read<{ drs?: GuestplanDay[] }>(restaurant, { dates: dates.map(compact), partySize });
      if (!Array.isArray(body.drs)) throw new Error('Guestplan returned an unexpected days shape');
      const known = new Map(body.drs.map((d) => [d.d, d]));
      // A day missing from the answer is unknown (e.g. too far ahead): read it rather than call it full.
      return new Set(dates.filter((d) => known.get(compact(d))?.a === true || !known.has(compact(d))));
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
