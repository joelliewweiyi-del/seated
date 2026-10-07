import type { BookResult, Guest, Platform, Restaurant, Slot } from './types.js';
import { localDate, toMinutes } from '../time.js';

// Formitable (now owned by Zenchef) exposes the JSON API its own booking widget uses.
// Reads need no captcha. Endpoints were read from the widget bundle at
// https://widget.formitable.com/build/js/all.side.min.js.
const API = 'https://widget-api.formitable.com/api';
const WIDGET = 'https://widget.formitable.com';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
// Minimum gap between two requests to Formitable. Be a polite guest.
const MIN_GAP_MS = 300;
// Month-calendar day codes that never had an open table when checked against day reads
// (119 days at 31 Amsterdam restaurants, Oct 2026): 1 none, 2 past, 3 and 6 closed or full,
// 5 today when nothing is left. Code 0 means "has tables". Unknown codes get a day read.
const EMPTY_DAY_CODES = new Set([1, 2, 3, 5, 6]);

export interface FormitableSlot {
  timeString: string; // "19:30", restaurant-local
  time: string; // UTC instant of the slot
  status: 'AVAILABLE' | 'SHORT' | 'WAITLIST' | 'SOLD_OUT' | string;
  minutes: number; // minutes since local midnight
  duration?: number;
  maxDuration?: number;
  spotsOpen?: number;
}

interface FormitableProduct {
  uid: string;
  title: string;
  // Money involved in booking this product (seen on the product search, Oct 2026).
  deposit?: boolean;
  price?: number;
  fullPrice?: number;
  noShowFee?: number | null;
}

/** Why Seated will not book this product by itself, or null. Seated only auto-books tables that cost nothing to hold. */
export function moneyInvolved(p: FormitableProduct): string | null {
  if (p.deposit) return 'it needs a deposit';
  if ((p.price ?? 0) > 0 || (p.fullPrice ?? 0) > 0) return 'it must be paid in advance';
  if ((p.noShowFee ?? 0) > 0) return `it has a no-show fee of €${p.noShowFee}`;
  return null;
}

type Fetch = typeof fetch;


function headers(restaurant: Restaurant): Record<string, string> {
  return {
    Accept: 'application/json, text/plain, */*',
    'User-Agent': USER_AGENT,
    Referer: `${WIDGET}/`,
    'ft-returnurl': restaurant.website ?? WIDGET,
  };
}

/** SHORT is a shorter sitting; a guest can book it, but we never auto-book it. */
export function toSlot(date: string, s: FormitableSlot): Slot {
  return {
    date,
    time: s.timeString,
    open: s.status === 'AVAILABLE' || s.status === 'SHORT',
    autoBookable: s.status === 'AVAILABLE',
  };
}

/** How long a "has it moved to Zenchef?" answer is trusted. One status request per restaurant per day. */
const MOVED_CHECK_MS = 24 * 60 * 60_000;

export function formitable({ fetchImpl = fetch as Fetch, gapMs = MIN_GAP_MS, now = () => Date.now() } = {}): Platform {
  let lastRequestAt = 0;
  const moved = new Map<string, { at: number; zenchefId: string | null }>();
  async function politeGap(): Promise<void> {
    const wait = lastRequestAt + gapMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
  }

  async function getJson<T>(restaurant: Restaurant, path: string): Promise<T> {
    await politeGap();
    const res = await fetchImpl(`${API}${path}`, {
      headers: headers(restaurant),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Formitable ${res.status} on ${path}`);
    return (await res.json()) as T;
  }

  /**
   * Formitable belongs to Zenchef now. A restaurant that moved shows a `zenchefId` on its status, and its Formitable
   * calendar stops getting bookings: in Oct 2026 De Kas looked nearly empty on Formitable while Zenchef had it full.
   * So a moved restaurant is an error ("read it on Zenchef"), never a source of false open tables.
   * If the status call itself fails, the last known answer stands; with no answer yet, the reads go ahead:
   * one flaky call must not hide a real restaurant.
   */
  async function assertNotMoved(r: Restaurant): Promise<void> {
    const uid = r.platformUid!;
    let known = moved.get(uid);
    if (!known || now() - known.at > MOVED_CHECK_MS) {
      try {
        const status = await getJson<{ zenchefId?: string | number | null }>(r, `/restaurant/${uid}/status`);
        known = { at: now(), zenchefId: status?.zenchefId ? String(status.zenchefId) : null };
        moved.set(uid, known);
      } catch {
        if (!known) return;
      }
    }
    if (known.zenchefId) {
      throw new Error(
        `Has a Zenchef account (id ${known.zenchefId}), so its Formitable calendar may be frozen. ` +
          'scripts/migrate-zenchef.ts moves it if Zenchef shows open days; otherwise check where it takes bookings.',
      );
    }
  }

  async function daySlots(r: Restaurant, date: string, partySize: number): Promise<FormitableSlot[]> {
    const data = await getJson<unknown>(r, `/availability/${r.platformUid}/day/${date}/${partySize}/en`);
    if (!Array.isArray(data)) throw new Error('Formitable returned an unexpected availability shape');
    return data as FormitableSlot[];
  }

  return {
    id: 'formitable',
    label: 'Formitable',

    async getSlots(restaurant, date, partySize) {
      await assertNotMoved(restaurant);
      const slots = await daySlots(restaurant, date, partySize);
      return slots.map((s) => toSlot(date, s));
    },

    async openDates(restaurant, dates, partySize) {
      await assertNotMoved(restaurant);
      const months = [...new Set(dates.map((d) => d.slice(0, 7)))];
      const worth = new Set<string>();
      for (const month of months) {
        const [y, m] = month.split('-');
        const days = await getJson<Array<{ dayString: string; status: number }>>(
          restaurant,
          `/availability/${restaurant.platformUid}/monthWeeks/${Number(m)}/${y}/${partySize}/en`,
        );
        if (!Array.isArray(days)) throw new Error('Formitable returned an unexpected month shape');
        const code = new Map(days.map((d) => [d.dayString, d.status]));
        for (const d of dates.filter((x) => x.startsWith(month))) {
          const c = code.get(d);
          if (c === undefined || !EMPTY_DAY_CODES.has(c)) worth.add(d);
        }
      }
      return worth;
    },

    bookingUrl(restaurant, date, time, partySize) {
      // The widget's own route: /side/:culture/:uid/book?partysize&date&time,
      // where time is minutes since local midnight.
      const q = new URLSearchParams({ partysize: String(partySize), date, time: String(toMinutes(time)) });
      return `${WIDGET}/side/en/${restaurant.platformUid}/book?${q}`;
    },

    async book(restaurant, date, time, partySize, guest): Promise<BookResult> {
      const uid = restaurant.platformUid;
      try {
        await assertNotMoved(restaurant); // never book on a calendar the restaurant no longer uses
        // Re-read the day: the slot must still be AVAILABLE right now.
        const slots = await daySlots(restaurant, date, partySize);
        const slot = slots.find((s) => s.timeString === time);
        if (!slot || slot.status !== 'AVAILABLE') {
          return { ok: false, error: 'The table was taken before Seated could book it' };
        }
        if (localDate(new Date(slot.time)) !== date) {
          return { ok: false, error: `Date mismatch: slot ${slot.time} is not on ${date}` };
        }

        const products = await getJson<FormitableProduct[]>(
          restaurant,
          `/product/${uid}/search/${slot.time}/${partySize}/en`,
        );
        const product = Array.isArray(products) ? products[0] : undefined;
        if (!product) return { ok: false, error: 'The restaurant offers no bookable product for this slot' };
        const money = moneyInvolved(product);
        if (money) return { ok: false, error: `Seated did not book it because ${money}. Book it yourself if you want it.` };

        // The payload mirrors what the widget sends. It booked real tables in June 2026.
        const payload = {
          booking: {
            title: 'MALE',
            source: 'Widget',
            culture: 'en',
            sendFeedbackMail: true,
            newsletter: false,
            comments: '',
            company: false,
            companyName: '',
            walkIn: false,
            bookingDuration: slot.duration ?? slot.maxDuration,
            short: false,
            numberOfPeople: partySize,
            bookingDate: date,
            bookingTime: time,
            firstName: guest.firstName,
            lastName: guest.lastName,
            email: guest.email,
            telephone: guest.phone,
            tags: [],
          },
          ticketUid: product.uid,
          source: 'Website',
          returnUrl: restaurant.website ?? WIDGET,
        };

        // From here on a failure is ambiguous: Formitable may have stored the booking.
        await politeGap();
        let res: Response;
        try {
          res = await fetchImpl(`${API}/booking/${uid}`, {
            method: 'POST',
            headers: { ...headers(restaurant), 'Content-Type': 'application/json;charset=UTF-8' },
            signal: AbortSignal.timeout(20_000),
            body: JSON.stringify(payload),
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { ok: false, uncertain: true, error: `No answer from Formitable while booking: ${msg}` };
        }
        if (!res.ok) {
          const text = (await res.text().catch(() => '')).slice(0, 200);
          // A 5xx can come after the booking was stored, so it is not a clean refusal.
          return { ok: false, uncertain: res.status >= 500, error: `Formitable answered ${res.status}: ${text}` };
        }
        const body = (await res.json().catch(() => ({}))) as { bookingUid?: string; paymentUrl?: string };
        if (!body.bookingUid) {
          return { ok: false, uncertain: true, error: 'Formitable accepted the request but sent no booking reference' };
        }
        return { ok: true, reference: body.bookingUid, paymentUrl: body.paymentUrl || null };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

/** Finds a Formitable restaurant id in a restaurant website's HTML. */
export function findFormitableUid(html: string): string | null {
  const patterns = [
    /data-restaurant=["']([0-9a-f]{8})["']/i,
    /formitable\.com\/side\/[a-z-]+\/([0-9a-f]{8})/i,
    /formitable\.com\/[^"'\s]*[?&]restaurant=([0-9a-f]{8})/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) return m[1].toLowerCase();
  }
  return null;
}
