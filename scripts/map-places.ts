// Places every Amsterdam restaurant on the public map. Writes data/map-places.json: { id: { lat, lng, area, kind } }.
//   npx tsx scripts/map-places.ts            only restaurants not placed yet
//   npx tsx scripts/map-places.ts --all      place everything again
// Sources, in order: the address in data/restaurants.json, an address on the restaurant's own website, then
// OpenStreetMap by name. Addresses go to PDOK Locatieserver (the Dutch government geocoder, free, no key).
// One request at a time with a pause between them. It never calls a booking system.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadCuratedRestaurants } from '../src/server/restaurants.js';
import type { Place } from '../src/server/mapData.js';

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
};

/** Addresses read by hand where neither the list nor the website gave one (Nov 2026). */
const MANUAL: Record<string, string> = {
  blauw: 'Amstelveenseweg 158, 1075 XN Amsterdam',
  bolenius: 'George Gershwinlaan 30, 1082 MT Amsterdam',
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
const sorted = Object.fromEntries(Object.entries(places).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(OUT, `${JSON.stringify(sorted, null, 1)}\n`);
console.log(`${Object.keys(sorted).length} places in ${OUT}`);
