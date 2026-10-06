import type { Platform, Restaurant, Slot } from './types.js';

// Tebi (live.tebi.co) shows availability to anyone with plain GET requests; no captcha.
// Only creating a reservation is behind reCAPTCHA, so Seated never books on Tebi:
// it alerts and links to the restaurant's Tebi booking page, where the user books.
const API = 'https://live.tebi.co/api/reservations-guest/ledgers';
const WIDGET_REDIRECT = 'https://live.tebi.co/api/widget';
const BOOKING_PAGE = 'https://live.tebi.co/ecom/reservations';
const VERSION_CODE = '1680400';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const MIN_GAP_MS = 300;

export interface TebiTimeslot {
  time: string; // "HH:mm", restaurant-local
  availabilityType: 'Available' | 'Waitlist' | 'Unavailable' | string;
}

export interface TebiDay {
  date: string; // "YYYY-MM-DD"
  availability: 'Available' | 'Waitlist' | 'Unavailable' | string;
}

export function toSlots(date: string, timeslots: TebiTimeslot[]): Slot[] {
  return timeslots
    .filter((t) => typeof t?.time === 'string' && /^\d{2}:\d{2}$/.test(t.time))
    .map((t) => ({ date, time: t.time, open: t.availabilityType === 'Available', autoBookable: false }));
}

export interface TebiOptions {
  fetchImpl?: typeof fetch;
  gapMs?: number;
  /** Tebi rotates restaurant ids. Called when a fresh id was found, so the caller can save it. */
  onUidChange?: (restaurantId: string, uid: string) => void;
}

export function tebi({ fetchImpl = fetch, gapMs = MIN_GAP_MS, onUidChange }: TebiOptions = {}): Platform {
  let lastRequestAt = 0;
  const current = new Map<string, string>(); // restaurant id -> latest known ledger id

  async function politeGap(): Promise<void> {
    const wait = lastRequestAt + gapMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
  }

  const uidOf = (r: Restaurant) => current.get(r.id) ?? r.platformUid!;

  async function get(r: Restaurant, path: (uid: string) => string): Promise<unknown> {
    const call = async (uid: string) => {
      await politeGap();
      return fetchImpl(`${API}/${uid}${path(uid)}`, {
        headers: {
          Accept: '*/*',
          'Tebi-Version-Code': VERSION_CODE,
          Origin: 'https://live.tebi.co',
          Referer: `${BOOKING_PAGE}/${uid}`,
          'User-Agent': USER_AGENT,
        },
        signal: AbortSignal.timeout(15_000),
      });
    };
    let res = await call(uidOf(r));
    if (res.status === 400) {
      // A stale ledger id answers 400 on every call. The widget link redirects to the current one.
      const fresh = await refreshUid(r);
      if (fresh) res = await call(fresh);
    }
    if (!res.ok) throw new Error(`Tebi ${res.status}`);
    return res.json();
  }

  async function refreshUid(r: Restaurant): Promise<string | null> {
    await politeGap();
    const res = await fetchImpl(`${WIDGET_REDIRECT}/${uidOf(r)}`, {
      redirect: 'manual',
      headers: { 'User-Agent': USER_AGENT, Referer: r.website ?? 'https://live.tebi.co' },
      signal: AbortSignal.timeout(15_000),
    });
    const fresh = res.headers.get('location')?.match(/(\d+_[a-f0-9]{20,})/)?.[1];
    if (!fresh || fresh === uidOf(r)) return null;
    current.set(r.id, fresh);
    onUidChange?.(r.id, fresh);
    return fresh;
  }

  return {
    id: 'tebi',
    label: 'Tebi',

    async getSlots(restaurant, date, partySize) {
      const body = (await get(restaurant, () => `/reservation-dates/${date}?groupSize=${partySize}`)) as {
        timeslots?: TebiTimeslot[];
      };
      if (!Array.isArray(body?.timeslots)) throw new Error('Tebi returned an unexpected availability shape');
      return toSlots(date, body.timeslots);
    },

    async openDates(restaurant, dates, partySize) {
      // One call per month says which days have any table. Only those days need a slot read.
      const months = [...new Set(dates.map((d) => d.slice(0, 7)))];
      const worth = new Set<string>();
      for (const month of months) {
        const days = (await get(restaurant, () => `/reservation-months/${month}?groupSize=${partySize}`)) as TebiDay[];
        if (!Array.isArray(days)) throw new Error('Tebi returned an unexpected month shape');
        const known = new Map(days.map((d) => [d.date.slice(0, 10), d.availability]));
        for (const d of dates.filter((x) => x.startsWith(month))) {
          const a = known.get(d);
          if (a === undefined || a === 'Available') worth.add(d);
        }
      }
      return worth;
    },

    bookingUrl(restaurant) {
      // Tebi's booking page takes no date or party size in the link (checked in its code, Oct 2026).
      return `${BOOKING_PAGE}/${uidOf(restaurant)}`;
    },
  };
}

/** Finds a Tebi ledger id in a restaurant website's HTML. */
export function findTebiUid(html: string): string | null {
  const m =
    html.match(/live\.tebi\.co\/(?:ecom\/reservations|ecom\/widget|api\/widget)\/(\d+_[a-f0-9]{20,})/i) ??
    html.match(/data-widget-token=["'](\d+_[a-f0-9]{20,})["']/i);
  return m?.[1] ?? null;
}
