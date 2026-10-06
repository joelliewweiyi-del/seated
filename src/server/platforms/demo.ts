import type { BookResult, Platform, Restaurant, Slot } from './types.js';

/**
 * A stand-in for Formitable that never touches the network. Used by `npm run demo`,
 * the end-to-end tests and anyone who wants to work on Seated without sending a
 * single request to a real restaurant. Open tables are set by hand.
 */
export interface DemoPlatform extends Platform {
  open(restaurantId: string, date: string, time: string): void;
  close(restaurantId: string, date: string, time: string): void;
  bookings: Array<{ restaurantId: string; date: string; time: string; partySize: number }>;
}

export function demoPlatform(): DemoPlatform {
  const openSlots = new Map<string, Set<string>>(); // restaurantId -> "date|time"
  const bookings: DemoPlatform['bookings'] = [];

  return {
    id: 'formitable',
    label: 'Formitable (demo)',
    bookings,

    open(restaurantId, date, time) {
      const set = openSlots.get(restaurantId) ?? new Set();
      set.add(`${date}|${time}`);
      openSlots.set(restaurantId, set);
    },

    close(restaurantId, date, time) {
      openSlots.get(restaurantId)?.delete(`${date}|${time}`);
    },

    async getSlots(restaurant: Restaurant, date: string): Promise<Slot[]> {
      const set = openSlots.get(restaurant.id) ?? new Set();
      return [...set]
        .filter((key) => key.startsWith(`${date}|`))
        .map((key) => ({ date, time: key.split('|')[1]!, open: true, autoBookable: true }));
    },

    bookingUrl(restaurant, date, time, partySize) {
      const q = new URLSearchParams({ partysize: String(partySize), date, time });
      return `https://widget.formitable.com/side/en/${restaurant.platformUid}/book?${q}`;
    },

    async book(restaurant, date, time, partySize): Promise<BookResult> {
      if (!openSlots.get(restaurant.id)?.has(`${date}|${time}`)) {
        return { ok: false, error: 'The table was taken before Seated could book it' };
      }
      openSlots.get(restaurant.id)!.delete(`${date}|${time}`);
      bookings.push({ restaurantId: restaurant.id, date, time, partySize });
      return { ok: true, reference: `DEMO${bookings.length}`, paymentUrl: null };
    },
  };
}
