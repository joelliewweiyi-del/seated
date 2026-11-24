// Taste: a visitor picks a character (a scene, then a profile in it), and the profile ranks the restaurants for them.
// Everything here is plain arithmetic on what the map already knows about a restaurant (its kind of room, MICHELIN,
// "hard to get", how many guides pick it). The restaurants in a person's own lists pull the profile toward them.
import type { Look } from './avatar';
import type { MapRestaurant } from './data';

export type Feature = 'fine' | 'stars' | 'bib' | 'wine' | 'japanese' | 'bistro' | 'cafe' | 'brasserie' | 'pizza' | 'destination' | 'hot' | 'guides';
export type Weights = Partial<Record<Feature, number>>;

/** A scene: where you spend your days. Each holds a few characters (Joel, 24 Nov 2026: "choose your character, Fashion, Fashion Baddie"). */
export interface Scene {
  id: string;
  name: string;
  sub: string;
}
export const SCENES: Scene[] = [
  { id: 'fashion', name: 'Fashion', sub: 'Showrooms, shoots, after-parties' },
  { id: 'creative', name: 'Creative', sub: 'Studios, galleries, Noord' },
  { id: 'money', name: 'Money', sub: 'Zuidas, deals, a card on the table' },
  { id: 'food', name: 'Food', sub: 'You plan your week around dinner' },
];

/** What you picked: the id of your character (a profile). */
export interface Answers {
  type?: string;
}

export interface Profile {
  id: string;
  scene: Scene['id'];
  name: string;
  line: string;
  /** What this character eats, as feature weights: it ranks the restaurants. */
  axis: Weights;
  /** How the character looks (see avatar.tsx); a new person of this profile starts with it. */
  look: Look;
  /** Where this character really goes, picked by hand (restaurant ids, best first). Replaces the ranking by axis. */
  picks?: string[];
}

export const PROFILES: Profile[] = [
  { id: 'fashion-baddie', scene: 'fashion', name: 'Fashion Baddie', line: 'Natural wine, a tiny room, an outfit worth the walk.', axis: { wine: 3, bistro: 1.5, japanese: 1, hot: 0.5, fine: -1, brasserie: -1.5, pizza: -1, destination: -2 }, look: { skin: 4, hair: 1, hairColour: 0, top: 5, extra: 4 },
    // Joel, 24 Nov 2026: "She goes to Twee Prinsen or Kamer"; the rest from press on the in-crowd (Sheerluxe, Your Little Black Book, Star Wine List).
    picks: ['kamer-bar', 'twee-prinsen', 'europa', 'calisto', 'cafe-binnenvisser', 'gitane', 'bar-centraal', 'dame-aan-de-kade', 'roux', 'bottleshop', 'weinlokal-stern'] },
  { id: 'vintage-hunter', scene: 'fashion', name: 'Vintage Hunter', line: 'A second-hand coat and first names with the waiter.', axis: { cafe: 2, bistro: 1.5, bib: 1, hot: -1, guides: -0.5 }, look: { skin: 1, hair: 3, hairColour: 4, top: 2, extra: 2 } },
  { id: 'noord-creative', scene: 'creative', name: 'Noord Creative', line: 'Studio in a shipping container, dinner where it is loud.', axis: { pizza: 2, cafe: 1.5, brasserie: 1.5, wine: 1, fine: -1 }, look: { skin: 4, hair: 3, hairColour: 0, top: 7, extra: 9 } },
  { id: 'gallery-hopper', scene: 'creative', name: 'Gallery Hopper', line: 'Opening at six, dinner at nine, opinions all night.', axis: { japanese: 2, wine: 1.5, bistro: 1, guides: 1 }, look: { skin: 0, hair: 2, hairColour: 5, top: 4, extra: 11 } },
  { id: 'founder', scene: 'money', name: 'Startup Founder', line: 'Raised last week. Books the place everyone talks about.', axis: { hot: 3, guides: 2 }, look: { skin: 2, hair: 0, hairColour: 1, top: 0, extra: 1 } },
  { id: 'zuidas-suit', scene: 'money', name: 'Zuidas Suit', line: 'Lunch is a meeting. Dinner is the long menu.', axis: { brasserie: 2.5, fine: 1.5, stars: 1, hot: 0.5 }, look: { skin: 1, hair: 0, hairColour: 1, top: 7, extra: 14 } },
  { id: 'tasting-chaser', scene: 'food', name: 'Tasting Menu Chaser', line: 'You save up for the long menu and remember every course.', axis: { fine: 2, stars: 2, destination: 1 }, look: { skin: 3, hair: 2, hairColour: 0, top: 1, extra: 3 } },
  { id: 'local-regular', scene: 'food', name: 'Neighbourhood Regular', line: 'The bistro round the corner, where they know your order.', axis: { bib: 2, bistro: 1, cafe: 1, pizza: 1, hot: -1, guides: -0.5 }, look: { skin: 2, hair: 4, hairColour: 0, top: 3, extra: 13 } },
];

export const profileById = (id: string | null | undefined) => PROFILES.find((p) => p.id === id) ?? null;

type Fit = Pick<MapRestaurant, 'kind' | 'michelin' | 'hot' | 'g'>;

/** What the map knows about a restaurant, as numbers from 0 to 1. */
export function features(r: Fit): Record<Feature, number> {
  const stars = r.michelin && r.michelin !== 'bib' ? Number(r.michelin) : 0;
  return {
    fine: r.kind === 'fine' || stars ? 1 : 0,
    stars: stars / 3,
    bib: r.michelin === 'bib' ? 1 : 0,
    wine: r.kind === 'wine' ? 1 : 0,
    japanese: r.kind === 'japanese' ? 1 : 0,
    bistro: r.kind === 'bistro' ? 1 : 0,
    cafe: r.kind === 'cafe' ? 1 : 0,
    brasserie: r.kind === 'brasserie' ? 1 : 0,
    pizza: r.kind === 'pizza' ? 1 : 0,
    destination: r.kind === 'greenhouse' || r.kind === 'island' ? 1 : 0,
    hot: (r.hot ?? 0) / 3,
    guides: Math.min(r.g.length, 3) / 3,
  };
}

function add(into: Weights, w: Weights, k = 1): Weights {
  for (const [f, v] of Object.entries(w) as Array<[Feature, number]>) into[f] = (into[f] ?? 0) + v * k;
  return into;
}

/** A person's taste: their character, pulled toward the restaurants in their own lists. */
export function tasteOf(answers: Answers, listed: Fit[] = []): Weights {
  const w: Weights = add({}, profileById(answers.type)?.axis ?? {});
  if (listed.length) {
    const mean: Weights = {};
    for (const r of listed) add(mean, features(r), 1 / listed.length);
    // A list says more than two taps: from five restaurants on it outweighs the character.
    add(w, mean, (8 * Math.min(listed.length, 5)) / 5);
  }
  return w;
}

function dot(a: Weights, b: Weights): number {
  let s = 0;
  for (const [f, v] of Object.entries(a) as Array<[Feature, number]>) s += v * (b[f] ?? 0);
  return s;
}
const norm = (a: Weights) => Math.sqrt(dot(a, a)) || 1;

/** The profile whose axis the taste points along most. */
export function profileFor(taste: Weights): Profile {
  let best = PROFILES[0]!;
  let score = -Infinity;
  for (const p of PROFILES) {
    const s = dot(taste, p.axis) / norm(p.axis);
    if (s > score) [best, score] = [p, s];
  }
  return best;
}

/** How well a restaurant fits a taste. */
export const fit = (taste: Weights, r: Fit) => dot(taste, features(r) as Weights);

/** The best fits for a taste, best first. A free table today breaks ties, then the name. */
export function suggest<T extends Fit & { id: string; name: string }>(taste: Weights, rs: T[], free: (r: T) => boolean, n = 6): T[] {
  return rs
    .map((r) => ({ r, s: fit(taste, r) }))
    .sort((a, b) => b.s - a.s || Number(free(b.r)) - Number(free(a.r)) || a.r.name.localeCompare(b.r.name))
    .slice(0, n)
    .map((x) => x.r);
}

/** The lists (guides, community) that share most of a person's top fits, best first; at least two in common. */
export function listsFor<L extends { places: string[] }>(top: string[], lists: L[], n = 3): L[] {
  const mine = new Set(top);
  return lists
    .map((l) => ({ l, k: l.places.filter((id) => mine.has(id)).length }))
    .filter((x) => x.k >= 2)
    .sort((a, b) => b.k - a.k)
    .slice(0, n)
    .map((x) => x.l);
}
