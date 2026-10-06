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

export function formitable({ fetchImpl = fetch as Fetch, gapMs = MIN_GAP_MS } = {}): Platform {
  let lastRequestAt = 0;
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

  async function daySlots(r: Restaurant, date: string, partySize: number): Promise<FormitableSlot[]> {
    const data = await getJson<unknown>(r, `/availability/${r.platformUid}/day/${date}/${partySize}/en`);
    if (!Array.isArray(data)) throw new Error('Formitable returned an unexpected availability shape');
    return data as FormitableSlot[];
  }

  return {
    id: 'formitable',
    label: 'Formitable',

    async getSlots(restaurant, date, partySize) {
      const slots = await daySlots(restaurant, date, partySize);
      return slots.map((s) => toSlot(date, s));
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
