// Alerts for your own lists on seated.food (Joel, 15 Nov 2026; Pilot, one user). Every 15 minutes the radar reads the
// lists of the character whose key is SEATED_ME_KEY and gives each listed restaurant a prime-time watch: alerts only,
// never auto-book. The watches then push like any other (quiet hours, scarcity, no repeats: radar.ts).
import type { Restaurant } from './platforms/types.js';
import type { Store } from './db.js';
import { coversPrime, PRIME } from '../shared/prime.js';

export const LIST_SOURCE = 'list';
/** Keeps live reads small (hard rule 2): at most this many restaurants get a watch from lists. */
export const MAX_LIST_WATCHES = 30;

/** Every restaurant on any list of the character with this key. Throws on any failure, so a blip removes nothing. */
export async function fetchMyPlaces(api: { url: string; key: string }, meKey: string, fetchFn: typeof fetch = fetch): Promise<string[]> {
  const res = await fetchFn(`${api.url}/get_me`, {
    method: 'POST',
    headers: { apikey: api.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_key: meKey }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(`get_me answered ${res.status}${body.message ? `: ${body.message}` : ''}`);
  }
  const body = (await res.json()) as { lists?: Array<{ places?: string[] }> };
  if (!Array.isArray(body.lists)) throw new Error('get_me answered without lists');
  return [...new Set(body.lists.flatMap((l) => l.places ?? []))];
}

export interface ListSync {
  added: string[];
  removed: string[];
  /** Not in the radar, on a booking system it cannot read, or over MAX_LIST_WATCHES. */
  skipped: string[];
}

/**
 * Makes the radar's list watches match the lists. Never touches a watch the user made. A list watch the user paused
 * or booked stays as it is: no second watch for that restaurant, and a booked one is kept when it leaves the lists.
 */
export function syncListWatches(store: Store, places: string[], readable: (r: Restaurant) => boolean, now: string): ListSync {
  const wanted = new Set<string>();
  const skipped: string[] = [];
  for (const id of places) {
    const r = store.getRestaurant(id);
    if (!r || !readable(r) || wanted.size >= MAX_LIST_WATCHES) skipped.push(id);
    else wanted.add(id);
  }
  const fromLists = store.watchesFrom(LIST_SOURCE);
  const removed: string[] = [];
  for (const w of fromLists) {
    if (wanted.has(w.restaurantId) || w.status === 'booked') continue;
    store.deleteWatch(w.id);
    removed.push(w.restaurantId);
  }
  const all = store.listWatches();
  const added: string[] = [];
  for (const id of wanted) {
    if (fromLists.some((w) => w.restaurantId === id)) continue;
    if (all.some((w) => w.restaurantId === id && coversPrime(w))) continue; // your own watch already covers it
    store.createWatch({ ...PRIME, restaurantId: id }, now, LIST_SOURCE);
    added.push(id);
  }
  return { added, removed, skipped };
}
