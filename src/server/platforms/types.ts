// A platform is one booking system (Formitable, Tebi, ...). Everything that is
// specific to one platform lives in its file under platforms/ and nowhere else.

export interface Restaurant {
  id: string;
  name: string;
  platform: string;
  platformUid: string | null;
  website: string | null;
  city: string | null;
  address: string | null;
}

export interface Slot {
  date: string; // "YYYY-MM-DD", restaurant-local
  time: string; // "HH:mm", restaurant-local
  /** A guest can book this slot right now. */
  open: boolean;
  /** Seated may book this slot for the user. Stricter than `open`. */
  autoBookable: boolean;
}

export interface Guest {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export type BookResult =
  | { ok: true; reference: string; paymentUrl: string | null }
  /** uncertain: the request may have reached the platform; a booking may exist. Never retry. */
  | { ok: false; error: string; uncertain?: boolean };

export interface Platform {
  id: string;
  label: string;
  /** All slots for one restaurant on one local date. Throws on network or API errors. */
  getSlots(restaurant: Restaurant, date: string, partySize: number): Promise<Slot[]>;
  /** A link that opens the platform's booking page, pre-filled where possible. */
  bookingUrl(restaurant: Restaurant, date: string, time: string, partySize: number): string;
  /** Books a slot for the guest. Only platforms that allow it implement this. */
  book?(restaurant: Restaurant, date: string, time: string, partySize: number, guest: Guest): Promise<BookResult>;
}
