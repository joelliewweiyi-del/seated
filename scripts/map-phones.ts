// Each map restaurant's phone number, for the Call button next to Book (Canberk through Joel, 27 Nov 2026: "add a call
// option next to reserve, they might not see the request so close"). Read once from the restaurant's own site (its
// tel: links and its schema.org telephone; the homepage, then /contact), one request a second. Second source:
// OpenStreetMap's phone tag of the restaurant within 80 m with a matching name (one Overpass request, kept in .cache/).
// Writes data/map-phones.json: { restaurants: { id: { phone, from, osm } } }; phone is +31 and nine digits; osm is
// "same", "differs: <their number>", or null when OpenStreetMap has none. An entry with "fixed": true (set by hand) is
// never changed; its note says why (a site that asks not to be called for a table gets phone null). A new number goes
// on the map only after a second read agrees with it: a wrong number calls a stranger.
//   npx tsx scripts/map-phones.ts          only restaurants without an entry
//   npx tsx scripts/map-phones.ts --all    read every site again
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadCuratedRestaurants } from '../src/server/restaurants.js';

const OUT = 'data/map-phones.json';
const OSM_CACHE = '.cache/osm-phones.json';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const all = process.argv.includes('--all');

export interface Phone { phone: string | null; from: string | null; osm: string | null; fixed?: boolean; note?: string }

/** A Dutch number as +31 and nine digits, or null: "020 - 337 96 80", "+31 (0)20 3379680" and "0031203379680" are one number. */
export function dutch(raw: string): string | null {
  let d = decodeURIComponent(raw).replace(/\(0\)/g, '').replace(/[^\d+]/g, '');
  if (d.startsWith('0031')) d = `+31${d.slice(4)}`;
  else if (d.startsWith('31') && d.length === 11) d = `+${d}`;
  else if (d.startsWith('0')) d = `+31${d.slice(1)}`;
  if (d.startsWith('+310')) d = `+31${d.slice(4)}`;
  return /^\+31[1-9]\d{8}$/.test(d) ? d : null;
}

/** The number a page gives most often: its tel: links and its schema.org "telephone"; without those, a number written
 * in its text ("020 - 337 96 80"). */
export function readPhone(html: string): string | null {
  const most = (found: string[]) => {
    const count = new Map<string, number>();
    for (const p of found.map(dutch)) if (p) count.set(p, (count.get(p) ?? 0) + 1);
    return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  const linked = most([
    ...[...html.matchAll(/href=["']tel:([^"']+)["']/gi)].map((m) => m[1]!),
    ...[...html.matchAll(/"telephone"\s*:\s*"([^"]+)"/gi)].map((m) => m[1]!),
  ]);
  if (linked) return linked;
  const text = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ');
  // Starts with +31, 0031 or 0, then nine digits with spaces, dots, dashes or brackets between; no digit on either side.
  return most([...text.matchAll(/(?<![\d+])(?:\+31|0031|0)(?:[ .()\-]{0,3}\d){9}(?!\d)/g)].map((m) => m[0]));
}

const plain = (s: string) => s.normalize('NFD').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
/** The same restaurant by name: one name inside the other, without "restaurant", "café" and marks. */
export function sameName(a: string, b: string): boolean {
  const [x, y] = [a, b].map((s) => plain(s.replace(/\b(restaurant|cafe|café|bar|bistro|amsterdam)\b/gi, '')));
  return !!x && !!y && (x.includes(y!) || y!.includes(x!));
}

interface OsmPlace { name: string; lat: number; lng: number; phone: string }

async function osmPhones(): Promise<OsmPlace[]> {
  if (existsSync(OSM_CACHE)) return JSON.parse(readFileSync(OSM_CACHE, 'utf8')) as OsmPlace[];
  const q = `[out:json][timeout:60];(nwr["amenity"~"restaurant|cafe|bar|pub|fast_food"]["phone"](52.28,4.72,52.44,5.08);nwr["amenity"~"restaurant|cafe|bar|pub|fast_food"]["contact:phone"](52.28,4.72,52.44,5.08););out center tags;`;
  const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: `data=${encodeURIComponent(q)}`, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'seated-map-phones/1' } });
  if (!res.ok) throw new Error(`Overpass answered HTTP ${res.status}: run again in a few minutes`);
  const { elements } = (await res.json()) as { elements: Array<{ lat?: number; lon?: number; center?: { lat: number; lon: number }; tags: Record<string, string> }> };
  const out = elements.flatMap((e) => {
    const phone = dutch((e.tags.phone ?? e.tags['contact:phone'] ?? '').split(';')[0]!);
    const lat = e.lat ?? e.center?.lat;
    const lng = e.lon ?? e.center?.lon;
    return phone && e.tags.name && lat && lng ? [{ name: e.tags.name, lat, lng, phone }] : [];
  });
  mkdirSync('.cache', { recursive: true });
  writeFileSync(OSM_CACHE, JSON.stringify(out));
  return out;
}

const metres = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  Math.hypot((a.lat - b.lat) * 111_320, (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180));

async function page(url: string): Promise<{ html: string; url: string }> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { html: await res.text(), url: res.url };
}

async function main() {
  const file: { how: string; restaurants: Record<string, Phone> } = existsSync(OUT)
    ? JSON.parse(readFileSync(OUT, 'utf8'))
    : { how: 'scripts/map-phones.ts: the number on the restaurant\'s own site (tel: links, schema.org telephone); osm = what OpenStreetMap\'s phone tag says of it.', restaurants: {} };
  const out = file.restaurants;
  const places = JSON.parse(readFileSync('data/map-places.json', 'utf8')) as Record<string, { lat: number; lng: number }>;
  const optOut = new Set((JSON.parse(readFileSync('data/map-optout.json', 'utf8')) as Array<{ id: string }>).map((o) => o.id));
  const list = loadCuratedRestaurants().filter((r) => places[r.id] && !optOut.has(r.id));
  const osm = await osmPhones();
  let read = 0;
  for (const r of list) {
    if (out[r.id]?.fixed || (out[r.id] && !all)) continue;
    const near = osm.filter((o) => metres(o, places[r.id]!) < 80 && sameName(o.name, r.name))[0]?.phone ?? null;
    let phone: string | null = null;
    let from: string | null = null;
    if (r.website) {
      try {
        const home = await page(r.website);
        phone = readPhone(home.html);
        from = home.url;
        if (!phone) {
          await sleep(1000);
          for (const path of ['contact', 'en/contact']) {
            try {
              const contact = await page(new URL(path, home.url).href);
              phone = readPhone(contact.html);
              if (phone) {
                from = contact.url;
                break;
              }
            } catch {
              // no such page: the next one
            }
            await sleep(1000);
          }
        }
      } catch (err) {
        console.log(`${r.id}: could not read ${r.website} (${err instanceof Error ? err.message : err})`);
      }
      read++;
      await sleep(1000);
    }
    // No number on their site: OpenStreetMap's is the only source, and says so.
    out[r.id] = phone ? { phone, from, osm: near ? (near === phone ? 'same' : `differs: ${near}`) : null } : { phone: near, from: near ? 'openstreetmap' : null, osm: near ? 'only' : null };
    console.log(`${r.id}: ${out[r.id]!.phone ?? '-'} ${out[r.id]!.osm ?? ''}`);
    writeFileSync(OUT, JSON.stringify({ how: file.how, restaurants: Object.fromEntries(Object.entries(out).sort()) }, null, 2) + '\n');
  }
  const v = Object.values(out);
  console.log(`${read} sites read; ${v.filter((p) => p.phone).length} of ${v.length} with a number; ${v.filter((p) => p.osm === 'same').length} the same in OpenStreetMap, ${v.filter((p) => p.osm?.startsWith('differs')).length} differ, ${v.filter((p) => p.osm === 'only').length} from OpenStreetMap only`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
