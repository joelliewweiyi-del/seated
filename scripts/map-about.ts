// What each map restaurant says about itself, read once from its own homepage, so the map's AI search (Jev,
// deploy/map/api/classify.mjs) can tell brunch from dinner and natural wine from cocktails (Joel, 25 Nov 2026: "she
// wanted something, for example, on Sunday brunch ... and then she couldn't search for it"). Kept: the page title, its
// own description (meta and og:description), its headings, the food words it uses and the euro prices it shows. Never
// shown on the map, only given to the classifier. Writes data/map-about.json: { id: { text, from } }.
//   npx tsx scripts/map-about.ts          only restaurants without an entry
//   npx tsx scripts/map-about.ts --all    read every site again (one request a second)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadCuratedRestaurants } from '../src/server/restaurants.js';

const OUT = 'data/map-about.json';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const all = process.argv.includes('--all');
/** The most a site's text may add to the classifier's state (characters). */
export const ABOUT_MAX = 600;
/** Words people search by, in English and Dutch: noted when a site uses them. */
const WORDS = [
  'brunch', 'breakfast', 'ontbijt', 'lunch', 'dinner', 'diner', 'natural wine', 'natuurwijn', 'wine bar', 'wijnbar', 'cocktail', 'small plates',
  'sharing', 'delen', 'tasting menu', 'chef', 'vegetarian', 'vegetarisch', 'vegan', 'seafood', 'fish', 'vis', 'pizza', 'pasta', 'ramen', 'sushi',
  'terrace', 'terras', 'garden', 'tuin', 'waterfront', 'aan het water', 'walk-in', 'groups', 'groepen', 'private dining', 'kids', 'kinderen',
  'sunday', 'zondag', 'late', 'bakery', 'bakkerij', 'coffee', 'koffie', 'seasonal', 'seizoen', 'organic', 'biologisch',
];

const clean = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&euro;|&#8364;/g, '€')
    .replace(/&#?\w+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** A short factual note from a homepage: title, description, headings, the search words it uses, the prices it shows. */
export function readAbout(html: string): string {
  const meta = (prop: string) =>
    html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, 'i'))?.[1] ??
    html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, 'i'))?.[1];
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, ' ');
  const title = clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  const desc = [meta('description'), meta('og:description')].map((x) => clean(x ?? '')).filter(Boolean);
  const heads = [...body.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((m) => clean(m[1]!.replace(/<[^>]+>/g, ' '))).filter((h) => h.length > 2 && h.length < 80);
  const text = [title, ...desc, clean(body.replace(/<[^>]+>/g, ' '))].join(' ').toLowerCase();
  const words = WORDS.filter((w) => new RegExp(`\\b${w}\\b`).test(text));
  const prices = [...new Set([...text.matchAll(/€\s?(\d{1,3})(?:[,.]\d{2}|,-)?/g)].map((m) => Number(m[1])).filter((n) => n >= 3 && n <= 400))].sort((a, b) => a - b);
  const parts = [
    title && `Title: ${title}.`,
    [...new Set(desc)].length && `Says: ${[...new Set(desc)].join(' ')}`,
    heads.length && `Headings: ${[...new Set(heads)].slice(0, 8).join(' | ')}.`,
    words.length && `Mentions: ${words.join(', ')}.`,
    prices.length && `Prices on the homepage: €${prices.slice(0, 12).join(', €')}.`,
  ].filter(Boolean) as string[];
  return parts.join(' ').slice(0, ABOUT_MAX);
}

async function main() {
  const out: Record<string, { text: string; from: string }> = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
  const places = JSON.parse(readFileSync('data/map-places.json', 'utf8')) as Record<string, unknown>;
  const optOut = new Set((JSON.parse(readFileSync('data/map-optout.json', 'utf8')) as Array<{ id: string }>).map((o) => o.id));
  const list = loadCuratedRestaurants().filter((r) => places[r.id] && !optOut.has(r.id) && r.website);
  for (const r of list) {
    if (out[r.id] && !all) continue;
    try {
      const res = await fetch(r.website!, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      out[r.id] = { text: readAbout(await res.text()), from: res.url };
      console.log(`${r.id}: ${out[r.id]!.text.length} chars`);
    } catch (err) {
      console.log(`${r.id}: could not read ${r.website} (${err instanceof Error ? err.message : err}); left out, run again later`);
    }
    writeFileSync(OUT, JSON.stringify(Object.fromEntries(Object.entries(out).sort()), null, 2) + '\n');
    await sleep(1000);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
