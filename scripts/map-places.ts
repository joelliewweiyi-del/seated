// Places every Amsterdam restaurant on the public map. Writes data/map-places.json: { id: { lat, lng, area, kind } }.
//   npx tsx scripts/map-places.ts            only restaurants not placed yet
//   npx tsx scripts/map-places.ts --all      place everything again
// Sources, in order: the address in data/restaurants.json, an address on the restaurant's own website, then
// OpenStreetMap by name. Addresses go to PDOK Locatieserver (the Dutch government geocoder, free, no key).
// One request at a time with a pause between them. It never calls a booking system.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadCuratedRestaurants } from '../src/server/restaurants.js';
import type { Place } from '../src/server/mapData.js';
import { wgsToRd } from '../src/shared/rd.js';

const OUT = 'data/map-places.json';
const UA = 'Seated-map/0.1 (one-off geocoding for a restaurant map)';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const all = process.argv.includes('--all');

/** The room the map draws inside. Set by hand from what each place is; anything else is a bistro. */
const KIND: Record<string, string> = {
  'ken-sushi': 'japanese', 'sushi-oodo': 'japanese', hatsune: 'japanese', 'fuku-ramen': 'japanese', 'restaurant-kyo': 'japanese',
  tsunarie: 'japanese',
  'weinlokal-stern': 'wine', 'kamer-bar': 'wine', 'cafe-wu': 'wine', bottleshop: 'wine', vrr: 'wine', nikotin: 'wine',
  flore: 'fine', 'ciel-bleu': 'fine', vinkeles: 'fine', bolenius: 'fine', cue: 'fine', choux: 'fine', tacite: 'fine', satkara: 'fine',
  'the-white-room': 'fine', sinne: 'fine', 'john-dory': 'fine', senses: 'fine', lastage: 'fine', 'graham-s-kitchen': 'fine',
  occo: 'fine', 'wolf-atelier': 'fine', blik: 'fine', motief: 'fine', marie: 'fine', 'de-silveren-spiegel': 'fine',
  'de-kas': 'greenhouse', 'vuurtoreneiland': 'island',
  nnea: 'pizza', 'euro-pizza': 'pizza', testamatta: 'pizza', 'la-fiorita': 'pizza', domenica: 'pizza', 'cucina-casalinga': 'pizza',
  incanto: 'pizza', 'pianeta-terra': 'pizza', bussia: 'pizza',
  'cafe-beurre': 'cafe', 'cafe-binnenvisser': 'cafe', 'cafe-caron': 'cafe', 'cafe-maurits': 'cafe', 'cafe-parlotte': 'cafe',
  'cafe-restaurant-amsterdam': 'brasserie', 'cafe-de-klepel': 'wine', gartine: 'cafe', 'bar-centraal': 'cafe', cornerstore: 'cafe',
  klaproos: 'cafe', 'mont-blanc': 'cafe', 'wijmpje-beukers': 'cafe', 'fa-pekelhaaring': 'cafe', 'meneer-de-wit-heeft-honger': 'cafe',
  badcuyp: 'brasserie', 'de-plantage': 'brasserie', entrepot: 'brasserie', 'helling-7': 'brasserie', 'de-mark': 'brasserie',
  'het-bosch-waterfront-kitchen': 'brasserie', 'mos-amsterdam': 'brasserie', 'baut-oost': 'brasserie', neni: 'brasserie',
  'hotel-de-goudfazant': 'brasserie', 'ikaria-park': 'brasserie', 'oriental-city': 'brasserie', 'de-belhamel': 'bistro',
  barracuda: 'brasserie', pelusa: 'brasserie', kien: 'brasserie', toet: 'brasserie', 'ja': 'cafe', salmuera: 'brasserie',
  'restaurant-212': 'fine', 'bistro-de-la-mer': 'bistro', bougainville: 'fine', rijks: 'fine', 'ron-gastrobar': 'fine',
  yamazato: 'japanese', zoldering: 'wine', 'a-fusion': 'brasserie', auberge: 'bistro', 'boon-de-koot': 'bistro',
  'fulu-mandarijn': 'brasserie', 'sea-palace': 'brasserie', 'serre-okura': 'brasserie', 'utage-sake-bar': 'japanese',
  'wils-bakery-cafe': 'cafe',
};

/** Addresses read by hand where neither the list nor the website gave one (Nov 2026). */
const MANUAL: Record<string, string> = {
  blauw: 'Amstelveenseweg 158, 1075 XN Amsterdam',
  'ciel-bleu': 'Ferdinand Bolstraat 333, 1072 LH Amsterdam',
  gartine: 'Taksteeg 7, 1012 PB Amsterdam',
  'hotel-de-goudfazant': 'Aambeeldstraat 10, 1021 KB Amsterdam',
  nnea: 'Martelaarsgracht 18, 1012 TR Amsterdam',
  'kamer-bar': 'Westerstraat 1, 1015 LT Amsterdam',
  gitane: 'Jan Pieter Heijestraat 146, 1054 MK Amsterdam',
  'restobar-massalia': 'Beukenplein 21, 1092 BB Amsterdam',
  tacite: 'Cornelis Krusemanstraat 15, 1075 NB Amsterdam',
  roef: 'Middenweg 35, 1098 AB Amsterdam',
  tsunarie: 'Van Woustraat 3, Amsterdam',
  salmuera: 'Rozengracht 106, 1016 NH Amsterdam',
};

/** Vuurtoreneiland is an island in the IJmeer with no street address: the lighthouse itself. */
const FIXED: Record<string, { lat: number; lng: number; area: string }> = {
  vuurtoreneiland: { lat: 52.3806, lng: 5.0189, area: 'IJmeer' }, // middle of the island's outline in OpenStreetMap
  // In the Van Gendt Hallen on Oostenburg; no house number published yet (Nov 2026).
  motief: { lat: 52.3718, lng: 4.9275, area: 'Oostenburg' },
  // Only the postcode is public (1057 SV, Baffinstraat).
  september: { lat: 52.3686, lng: 4.8543, area: 'De Baarsjes' },
};

interface PdokDoc {
  centroide_ll?: string;
  wijknaam?: string;
  buurtnaam?: string;
  woonplaatsnaam?: string;
  weergavenaam?: string;
}

async function pdok(q: string): Promise<{ lat: number; lng: number; area: string; label: string } | null> {
  await sleep(400);
  const url = `https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?${new URLSearchParams({ q, rows: '1', fq: 'type:adres', fl: '*' })}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return null;
  const doc = ((await res.json()) as { response?: { docs?: PdokDoc[] } }).response?.docs?.[0];
  const m = doc?.centroide_ll?.match(/POINT\(([\d.]+) ([\d.]+)\)/);
  if (!doc || !m || doc.woonplaatsnaam !== 'Amsterdam') return null;
  return { lng: Number(m[1]), lat: Number(m[2]), area: tidyArea(doc.wijknaam ?? doc.buurtnaam ?? ''), label: doc.weergavenaam ?? q };
}

/** "Grachtengordel-West" -> "Grachtengordel"; keeps the names people use. */
function tidyArea(name: string): string {
  return name.replace(/-(West|Oost|Zuid|Noord)$/, '').replace(/^Burgwallen-/, 'Burgwallen ').trim() || 'Amsterdam';
}

/** The first "Street 12, 1234 AB" on the restaurant's own website. */
async function addressFromSite(site: string): Promise<string | null> {
  try {
    await sleep(400);
    const res = await fetch(site, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000), redirect: 'follow' });
    if (!res.ok) return null;
    const text = (await res.text()).replace(/<[^>]+>/g, ' ').replace(/&nbsp;|\s+/g, ' ');
    const m = text.match(/([A-Z][\p{L}.' -]{2,40}?\s\d{1,4}[\p{L}-]{0,4})[,\s]+(\d{4}\s?[A-Z]{2})\b/u);
    return m ? `${m[1]}, ${m[2]} Amsterdam` : null;
  } catch {
    return null;
  }
}

/** OpenStreetMap by name, inside Amsterdam. */
async function osmByName(name: string): Promise<{ lat: number; lng: number } | null> {
  await sleep(1200); // Nominatim asks for at most one request a second
  const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q: `${name}, Amsterdam`, format: 'json', limit: '1' })}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return null;
  const hit = ((await res.json()) as Array<{ lat: string; lon: string }>)[0];
  return hit ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null;
}

async function reverseArea(lat: number, lng: number): Promise<string> {
  await sleep(400);
  const url = `https://api.pdok.nl/bzk/locatieserver/search/v3_1/reverse?${new URLSearchParams({ lat: String(lat), lon: String(lng), rows: '1', fl: '*', type: 'adres' })}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!res?.ok) return 'Amsterdam';
  const doc = ((await res.json()) as { response?: { docs?: PdokDoc[] } }).response?.docs?.[0];
  return tidyArea(doc?.wijknaam ?? doc?.buurtnaam ?? '');
}

const places: Record<string, Place & { source?: string }> = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
for (const r of loadCuratedRestaurants().filter((x) => x.city === 'Amsterdam')) {
  if (places[r.id] && !all) continue;
  const kind = KIND[r.id] ?? 'bistro';
  if (FIXED[r.id]) {
    places[r.id] = { ...FIXED[r.id]!, kind, source: 'fixed' };
    continue;
  }
  const tries: Array<[string, string | null]> = [
    ['list', r.address && /\d{4}\s?[A-Z]{2}/.test(r.address) ? r.address : null],
    ['manual', MANUAL[r.id] ?? null],
  ];
  let hit: Awaited<ReturnType<typeof pdok>> = null;
  let source = '';
  for (const [s, q] of tries) {
    if (q && (hit = await pdok(q))) {
      source = s;
      break;
    }
  }
  if (!hit && r.website) {
    const q = await addressFromSite(r.website);
    if (q && (hit = await pdok(q))) source = `site: ${q}`;
  }
  if (!hit) {
    const osm = await osmByName(r.name);
    if (osm) hit = { ...osm, area: await reverseArea(osm.lat, osm.lng), label: 'osm' };
    source = 'osm by name';
  }
  if (!hit) {
    console.log(`?  ${r.name}: not placed`);
    continue;
  }
  places[r.id] = { lat: Number(hit.lat.toFixed(6)), lng: Number(hit.lng.toFixed(6)), area: hit.area, kind, source };
  console.log(`ok ${r.name.padEnd(28)} ${hit.area.padEnd(22)} ${source}`);
}
/** Metres from a point to a polygon's outline, 0 inside it (RD New coordinates). */
function distance(px: number, py: number, rings: number[][][]): number {
  let inside = false;
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[j]!;
      const [bx, by] = ring[i]!;
      if (ay! > py !== by! > py && px < ((ax! - bx!) * (py - by!)) / (ay! - by!) + bx!) inside = !inside;
      const dx = bx! - ax!;
      const dy = by! - ay!;
      const t = Math.max(0, Math.min(1, ((px - ax!) * dx + (py - ay!) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(px - (ax! + t * dx), py - (ay! + t * dy)));
    }
  }
  return inside ? 0 : best;
}

// Roof heights from 3DBAG (TU Delft and 3DGI, CC BY 4.0): the tallest building part within 4 m of the address. The
// box query also returns parts that only touch its corners, so each part's real distance is checked.
for (const [id, p] of Object.entries(places)) {
  if (p.roof !== undefined && !all) continue;
  await sleep(300);
  const { x, y } = wgsToRd(p.lat, p.lng);
  const url =
    'https://data.3dbag.nl/api/BAG3D/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=BAG3D:lod13&outputFormat=application/json' +
    `&propertyName=geom,b3_h_maaiveld,b3_h_max,b3_h_nok&bbox=${x - 4},${y - 4},${x + 4},${y + 4},EPSG:28992`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!res?.ok) {
    console.log(`?  ${id}: no roof height (3DBAG ${res?.status ?? 'no answer'})`);
    continue;
  }
  type Q = { b3_h_maaiveld: number | null; b3_h_max: number | null; b3_h_nok: number | null };
  type Geom = { type: string; coordinates: number[][][] | number[][][][] } | null;
  const feats = ((await res.json()) as { features?: Array<{ properties: Q; geometry: Geom }> }).features ?? [];
  const near = (g: Geom) => {
    if (!g) return false;
    const polys = (g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]) as number[][][][];
    return polys.some((rings) => distance(x, y, rings) <= 4);
  };
  const heights = feats
    .filter((f) => near(f.geometry))
    .map(({ properties: q }) => (q.b3_h_nok ?? q.b3_h_max ?? 0) - (q.b3_h_maaiveld ?? 0))
    .filter((h) => h > 0);
  if (heights.length) p.roof = Math.round(Math.max(...heights) * 2) / 2;
}
const sorted = Object.fromEntries(Object.entries(places).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(OUT, `${JSON.stringify(sorted, null, 1)}\n`);
console.log(`${Object.keys(sorted).length} places in ${OUT}`);
