// Each map restaurant's Instagram and one photo, read once from its own homepage (Joel, 24 Nov 2026: "add the link to
// the Instagram and photos"). The Instagram handle is the link the site itself shows; the photo is the site's own share
// image (og:image, what a link preview shows), linked from their site, never copied. Instagram is never read: Meta
// forbids scraping. Writes data/map-social.json: { id: { ig, photo, from } }; an entry with "fixed": true (set by hand)
// is never changed, and "photo": null with "fixed" keeps a logo off the card.
//   npx tsx scripts/map-social.ts          only restaurants without an entry
//   npx tsx scripts/map-social.ts --all    read every site again (one request a second)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadCuratedRestaurants } from '../src/server/restaurants.js';

const OUT = 'data/map-social.json';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const all = process.argv.includes('--all');
/** Paths on instagram.com that are not an account. */
const NOT_HANDLE = new Set(['p', 'reel', 'reels', 'explore', 'stories', 'accounts', 'tv', 'about', 'legal', 'developer', 'sharer', 'share']);

export interface Social { ig: string | null; photo: string | null; from: string | null; fixed?: boolean }

export function readSocial(html: string, base: string): Omit<Social, 'fixed'> {
  const handles = [...html.matchAll(/instagram\.com\/([A-Za-z0-9._]{2,30})\/?["'?#\s<]/g)]
    .map((m) => m[1]!.replace(/\.$/, ''))
    .filter((h) => !NOT_HANDLE.has(h.toLowerCase()));
  // The handle the page links most often (a footer and a header beat one embedded post).
  const count = new Map<string, number>();
  for (const h of handles) count.set(h.toLowerCase(), (count.get(h.toLowerCase()) ?? 0) + 1);
  const ig = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const meta = (prop: string) =>
    html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`, 'i'))?.[1] ??
    html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, 'i'))?.[1];
  const raw = meta('og:image') ?? meta('og:image:url') ?? meta('twitter:image');
  let photo: string | null = null;
  try {
    photo = raw ? new URL(raw.replace(/&amp;/g, '&'), base).href : null;
  } catch {
    photo = null;
  }
  if (photo && !/^https:/.test(photo)) photo = null; // an http image would be blocked on the https map
  return { ig, photo, from: base };
}

async function main() {
  const out: Record<string, Social> = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
  const places = JSON.parse(readFileSync('data/map-places.json', 'utf8')) as Record<string, unknown>;
  const optOut = new Set((JSON.parse(readFileSync('data/map-optout.json', 'utf8')) as Array<{ id: string }>).map((o) => o.id));
  const list = loadCuratedRestaurants().filter((r) => places[r.id] && !optOut.has(r.id) && r.website);
  let read = 0;
  for (const r of list) {
    if (out[r.id]?.fixed || (out[r.id] && !all)) continue;
    try {
      const res = await fetch(r.website!, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      out[r.id] = readSocial(await res.text(), res.url);
      console.log(`${r.id}: ${out[r.id]!.ig ?? '-'} ${out[r.id]!.photo ? 'photo' : '-'}`);
    } catch (err) {
      console.log(`${r.id}: could not read ${r.website} (${err instanceof Error ? err.message : err}); left out, run again later`);
    }
    read++;
    writeFileSync(OUT, JSON.stringify(Object.fromEntries(Object.entries(out).sort()), null, 2) + '\n');
    await sleep(1000);
  }
  console.log(`${read} sites read, ${Object.values(out).filter((s) => s.ig).length} with Instagram, ${Object.values(out).filter((s) => s.photo).length} with a photo`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
