import { readFileSync } from 'node:fs';
import type { Restaurant } from './platforms/types.js';
import { findFormitableUid } from './platforms/formitable.js';

const LIST_URL = new URL('../../data/restaurants.json', import.meta.url);

/** The curated list in data/restaurants.json. Edit that file to add or fix a restaurant. */
export function loadCuratedRestaurants(): Restaurant[] {
  return JSON.parse(readFileSync(LIST_URL, 'utf8')) as Restaurant[];
}

export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Works out the Formitable id from what the user pasted: a bare 8-character id,
 * a Formitable widget link, or the restaurant's own website (we fetch it once and
 * look for the embedded widget).
 */
export async function resolveFormitableUid(input: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const text = input.trim();
  if (/^[0-9a-f]{8}$/i.test(text)) return text.toLowerCase();
  const inLink = findFormitableUid(text);
  if (inLink) return inLink;
  if (!/^https?:\/\//i.test(text)) return null;
  const res = await fetchImpl(text, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Seated/0.1; +https://github.com/)' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  return findFormitableUid(await res.text());
}
