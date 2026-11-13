// Taste: two questions put a visitor in one of six profiles, and the profile ranks the restaurants for them.
// Everything here is plain arithmetic on what the map already knows about a restaurant (its kind of room, MICHELIN,
// "hard to get", how many guides pick it). The restaurants in a person's own lists pull the profile toward them.
import type { MapRestaurant } from './data';

export type Feature = 'fine' | 'stars' | 'bib' | 'wine' | 'japanese' | 'bistro' | 'cafe' | 'brasserie' | 'pizza' | 'destination' | 'hot' | 'guides';
export type Weights = Partial<Record<Feature, number>>;

export interface Choice {
  id: string;
  label: string;
  sub: string;
  weights: Weights;
}
export interface Question {
  id: 'night' | 'win';
  ask: string;
  choices: Choice[];
}

export const QUESTIONS: Question[] = [
  {
    id: 'night',
    ask: "What's the night?",
    choices: [
      { id: 'date', label: 'Date night', sub: 'Two of you, a good table', weights: { wine: 1.5, japanese: 1.5, bistro: 1, hot: 1, fine: 0.5 } },
      { id: 'friends', label: 'Out with friends', sub: 'Loud, shared, long', weights: { brasserie: 3, pizza: 2, cafe: 1, bistro: 0.5 } },
      { id: 'special', label: 'Something special', sub: 'A birthday, a deal, a reason', weights: { fine: 2.5, stars: 2, destination: 2, hot: 0.5 } },
      { id: 'easy', label: 'Easy and good', sub: 'Tonight, no fuss', weights: { bib: 2, cafe: 1.5, pizza: 1, bistro: 1, hot: -1 } },
    ],
  },
  {
    id: 'win',
    ask: 'What makes it a great dinner?',
    choices: [
      { id: 'chef', label: "The chef's menu", sub: 'Let the kitchen decide', weights: { fine: 2, stars: 2, japanese: 1 } },
      { id: 'wine', label: 'Natural wine, small plates', sub: 'Order a bit of everything', weights: { wine: 3, bistro: 1 } },
      { id: 'buzz', label: 'The table everyone wants', sub: 'The place people talk about', weights: { hot: 2.5, guides: 2 } },
      { id: 'local', label: 'A local spot, no hype', sub: 'Where the neighbours go', weights: { bib: 1.5, bistro: 1.5, cafe: 1, hot: -1.5, guides: -1 } },
    ],
  },
];

export type Answers = Partial<Record<Question['id'], string>>;

export interface Profile {
  id: string;
  name: string;
  line: string;
  /** What this profile is about, as feature weights. A person gets the profile whose axis their taste points along. */
  axis: Weights;
  /** The character a new person of this profile starts with (see avatar.tsx). */
  look: { top: number; extra: number };
}

export const PROFILES: Profile[] = [
  { id: 'tasting-chaser', name: 'Tasting Menu Chaser', line: 'You save up for the long menu, and you remember every course.', axis: { fine: 2, stars: 2, destination: 1 }, look: { top: 0, extra: 3 } },
  { id: 'wine-wanderer', name: 'Natural Wine Wanderer', line: 'A short menu, a skin-contact bottle and a room with candles.', axis: { wine: 3, bistro: 0.5, japanese: 0.5 }, look: { top: 4, extra: 2 } },
  { id: 'hot-hunter', name: 'Hot Table Hunter', line: 'If everyone talks about it, you have already been.', axis: { hot: 3, guides: 2 }, look: { top: 2, extra: 4 } },
  { id: 'date-planner', name: 'Date Night Planner', line: 'Two seats, good light, and a place that makes you look clever.', axis: { wine: 1, japanese: 1.5, bistro: 1, hot: 1, fine: 0.5 }, look: { top: 5, extra: 5 } },
  { id: 'table-host', name: 'Big Table Host', line: 'You book for eight and order for the table.', axis: { brasserie: 2, pizza: 1.5, cafe: 0.5, bistro: 0.5 }, look: { top: 1, extra: 0 } },
  { id: 'local-regular', name: 'Neighbourhood Regular', line: 'The bistro round the corner, where they know your order.', axis: { bib: 2, bistro: 1, cafe: 1, pizza: 1, hot: -1, guides: -0.5 }, look: { top: 3, extra: 1 } },
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

/** A person's taste: their two answers, pulled toward the restaurants in their own lists. */
export function tasteOf(answers: Answers, listed: Fit[] = []): Weights {
  const w: Weights = {};
  for (const q of QUESTIONS) {
    const c = q.choices.find((x) => x.id === answers[q.id]);
    if (c) add(w, c.weights);
  }
  if (listed.length) {
    const mean: Weights = {};
    for (const r of listed) add(mean, features(r), 1 / listed.length);
    // A list says more than two taps: from five restaurants on it outweighs both answers together.
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
