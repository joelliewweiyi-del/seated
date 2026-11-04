// Builds the map's world: Amsterdam as a grid of 16 m tiles, from OpenStreetMap (© OpenStreetMap contributors, ODbL).
//   npx tsx scripts/map-world.ts [--osm cached.json]
// One Overpass request for water, parks, roads, rails, tram lines, ferries and land use. Writes:
//   src/map/public/world.bin   two bytes per tile: terrain | style << 4, then flags
//   src/map/public/world.json  grid size and projection
// Run it again only to refresh the map; the result is committed. It never calls a booking system.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export const BBOX = { south: 52.33, west: 4.835, north: 52.41, east: 5.045 };
const TILE_M = 16;
const LAT0 = (BBOX.south + BBOX.north) / 2;
const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LNG = 111_320 * Math.cos((LAT0 * Math.PI) / 180);
const COLS = Math.ceil(((BBOX.east - BBOX.west) * M_PER_DEG_LNG) / TILE_M);
const ROWS = Math.ceil(((BBOX.north - BBOX.south) * M_PER_DEG_LAT) / TILE_M);
/** The Dam: the old centre, for building styles. */
const DAM = { lat: 52.3731, lng: 4.8926 };

// Terrain codes. Keep in step with src/map/world.ts.
const T = { land: 0, water: 1, park: 2, road: 3, street: 4, square: 5, rail: 6, wood: 7, field: 8, industry: 9, sand: 10 } as const;
// Flags.
const F = { bridge: 1, tram: 2, ferry: 4, railLine: 8, quay: 16 } as const;
// Building styles: 0 canal houses, 1 brick rows (19th-century belt), 2 modern blocks, 3 warehouses.

const UA = 'Seated-map/0.1 (one-off map build)';
const QUERY = `[out:json][timeout:300][bbox:${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}];
(
  way[natural=water]; relation[natural=water];
  way[waterway~"^(canal|river|dock)$"];
  way[landuse~"^(basin|reservoir|harbour)$"];
  way[leisure~"^(park|garden|pitch|golf_course|nature_reserve|playground)$"]; relation[leisure~"^(park|nature_reserve)$"];
  way[landuse~"^(grass|forest|meadow|recreation_ground|cemetery|allotments|village_green|farmland|orchard|industrial|railway|port|construction)$"];
  relation[landuse~"^(forest|grass|meadow|industrial|port)$"];
  way[natural~"^(wood|scrub|grassland|wetland|sand|beach)$"];
  way[highway~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|pedestrian|cycleway)$"];
  way[railway~"^(rail|tram|light_rail)$"];
  way[route=ferry];
  way[place=square];
);
out geom;`;

interface Pt {
  lat: number;
  lon: number;
}
interface El {
  type: 'way' | 'relation';
  tags?: Record<string, string>;
  geometry?: Pt[];
  members?: Array<{ role: string; geometry?: Pt[] }>;
}

const toXY = (p: Pt): [number, number] => [((p.lon - BBOX.west) * M_PER_DEG_LNG) / TILE_M, ((BBOX.north - p.lat) * M_PER_DEG_LAT) / TILE_M];

const terrain = new Uint8Array(COLS * ROWS); // 0 = land
const style = new Uint8Array(COLS * ROWS);
const flags = new Uint8Array(COLS * ROWS);
const idx = (x: number, y: number) => y * COLS + x;
const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < COLS && y < ROWS;

/** Even-odd fill of a set of rings at tile centres. */
function fill(rings: Array<Array<[number, number]>>, set: (i: number) => void): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const ring of rings) for (const [, y] of ring) [minY, maxY] = [Math.min(minY, y), Math.max(maxY, y)];
  for (let row = Math.max(0, Math.floor(minY)); row <= Math.min(ROWS - 1, Math.ceil(maxY)); row++) {
    const cy = row + 0.5;
    const xs: number[] = [];
    for (const ring of rings) {
      for (let i = 0; i < ring.length - 1; i++) {
        const [x1, y1] = ring[i]!;
        const [x2, y2] = ring[i + 1]!;
        if (y1 <= cy !== y2 <= cy) xs.push(x1 + ((cy - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let col = Math.max(0, Math.ceil(xs[k]! - 0.5)); col <= Math.min(COLS - 1, Math.floor(xs[k + 1]! - 0.5)); col++) set(idx(col, row));
    }
  }
}

/** Draws a polyline `width` tiles wide. */
function line(pts: Array<[number, number]>, width: number, set: (i: number) => void): void {
  const r = (width - 1) / 2;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i]!;
    const [x2, y2] = pts[i + 1]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2));
    for (let s = 0; s <= steps; s++) {
      const x = x1 + ((x2 - x1) * s) / steps;
      const y = y1 + ((y2 - y1) * s) / steps;
      for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
        for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
          if (Math.hypot(dx, dy) > r + 0.01) continue;
          const tx = Math.floor(x + dx);
          const ty = Math.floor(y + dy);
          if (inside(tx, ty)) set(idx(tx, ty));
        }
      }
    }
  }
}

/** Joins a relation's member ways into closed rings. */
function rings(members: Array<{ role: string; geometry?: Pt[] }>): Array<Array<[number, number]>> {
  const parts = members.filter((m) => m.geometry && m.geometry.length > 1).map((m) => m.geometry!.map(toXY));
  const out: Array<Array<[number, number]>> = [];
  const same = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
  while (parts.length) {
    let ring = parts.shift()!;
    let grew = true;
    while (!same(ring[0]!, ring.at(-1)!) && grew) {
      grew = false;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i]!;
        if (same(ring.at(-1)!, p[0]!)) ring = ring.concat(p.slice(1));
        else if (same(ring.at(-1)!, p.at(-1)!)) ring = ring.concat([...p].reverse().slice(1));
        else continue;
        parts.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (ring.length > 3) out.push(same(ring[0]!, ring.at(-1)!) ? ring : [...ring, ring[0]!]);
  }
  return out;
}

function shapes(el: El): Array<Array<[number, number]>> {
  if (el.type === 'relation') return rings(el.members ?? []);
  const g = el.geometry?.map(toXY) ?? [];
  return g.length > 3 && g[0]![0] === g.at(-1)![0] && g[0]![1] === g.at(-1)![1] ? [g] : [];
}

async function loadOsm(): Promise<El[]> {
  const cached = process.argv.includes('--osm') ? process.argv[process.argv.indexOf('--osm') + 1] : null;
  if (cached && existsSync(cached)) return (JSON.parse(readFileSync(cached, 'utf8')) as { elements: El[] }).elements;
  console.log('[world] asking Overpass (one request, may take a minute)...');
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: QUERY }),
    signal: AbortSignal.timeout(360_000),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  if (cached) writeFileSync(cached, text);
  return (JSON.parse(text) as { elements: El[] }).elements;
}

const elements = await loadOsm();
console.log(`[world] ${elements.length} OSM elements, grid ${COLS} x ${ROWS} tiles of ${TILE_M} m`);

const has = (el: El, key: string, re: RegExp) => re.test(el.tags?.[key] ?? '');
const setT = (code: number, unless: number[] = []) => (i: number) => {
  if (!unless.includes(terrain[i]!)) terrain[i] = code;
};

// 1. Land use first, water last among areas, so water always wins.
for (const el of elements) {
  if (has(el, 'landuse', /^(farmland|meadow|orchard|allotments)$/)) for (const r of [shapes(el)]) fill(r, setT(T.field));
}
for (const el of elements) {
  if (has(el, 'landuse', /^(industrial|railway|port|construction)$/)) fill(shapes(el), setT(T.industry));
}
for (const el of elements) {
  if (has(el, 'landuse', /^(grass|recreation_ground|cemetery|village_green)$/) || has(el, 'leisure', /^(park|garden|pitch|golf_course|nature_reserve|playground)$/) || has(el, 'natural', /^(scrub|grassland|wetland)$/))
    fill(shapes(el), setT(T.park));
}
for (const el of elements) {
  if (has(el, 'landuse', /^forest$/) || has(el, 'natural', /^wood$/)) fill(shapes(el), setT(T.wood));
  if (has(el, 'natural', /^(sand|beach)$/)) fill(shapes(el), setT(T.sand));
}
for (const el of elements) {
  if (has(el, 'natural', /^water$/) || has(el, 'landuse', /^(basin|reservoir|harbour)$/) || has(el, 'waterway', /^(dock|riverbank)$/))
    fill(shapes(el), setT(T.water));
}
// Canals and rivers drawn as lines too, so narrow ones stay connected.
for (const el of elements) {
  if (el.type === 'way' && has(el, 'waterway', /^(canal|river)$/) && el.geometry) line(el.geometry.map(toXY), 1, setT(T.water));
}

// 2. Squares, roads and rails. Over water a road is a bridge.
for (const el of elements) {
  if (has(el, 'place', /^square$/) || (has(el, 'highway', /^pedestrian$/) && el.tags?.area === 'yes')) fill(shapes(el), setT(T.square, [T.water]));
}
const ROAD_WIDTH: Record<string, number> = { motorway: 3, trunk: 2, primary: 2, secondary: 2, tertiary: 1, residential: 1, unclassified: 1, living_street: 1, pedestrian: 1, cycleway: 1 };
for (const el of elements) {
  const hw = el.tags?.highway;
  if (el.type !== 'way' || !hw || !ROAD_WIDTH[hw] || !el.geometry || el.tags?.area === 'yes') continue;
  if (el.tags?.tunnel && el.tags.tunnel !== 'no') continue;
  if (hw === 'cycleway' && !el.tags?.bridge) continue; // cycle paths only where they cross water
  const major = /^(motorway|trunk|primary|secondary)$/.test(hw);
  line(el.geometry.map(toXY), ROAD_WIDTH[hw]!, (i) => {
    if (terrain[i] === T.water) {
      if (el.tags?.bridge && el.tags.bridge !== 'no') flags[i]! |= F.bridge;
      return;
    }
    if (terrain[i] === T.road) return;
    terrain[i] = major ? T.road : T.street;
  });
}
for (const el of elements) {
  const rw = el.tags?.railway;
  if (el.type !== 'way' || !rw || !el.geometry) continue;
  if (el.tags?.tunnel && el.tags.tunnel !== 'no') continue;
  if (rw === 'tram') line(el.geometry.map(toXY), 1, (i) => (flags[i]! |= F.tram));
  else
    line(el.geometry.map(toXY), 1, (i) => {
      flags[i]! |= F.railLine;
      if (terrain[i] !== T.water && terrain[i] !== T.road && terrain[i] !== T.street) terrain[i] = T.rail;
    });
}
for (const el of elements) {
  if (el.type === 'way' && el.tags?.route === 'ferry' && el.geometry)
    line(el.geometry.map(toXY), 1, (i) => {
      if (terrain[i] === T.water) flags[i]! |= F.ferry;
    });
}

// 3. Quays: land next to water. Building styles by area.
const centre = toXY({ lat: DAM.lat, lon: DAM.lng });
for (let y = 0; y < ROWS; y++) {
  for (let x = 0; x < COLS; x++) {
    const i = idx(x, y);
    if (terrain[i] !== T.water) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (inside(x + dx, y + dy) && terrain[idx(x + dx, y + dy)] === T.water) flags[i]! |= F.quay;
      }
    }
    const d = (Math.hypot(x - centre[0], y - centre[1]) * TILE_M) / 1000; // km from the Dam
    style[i] = terrain[i] === T.industry ? 3 : d < 1.6 ? 0 : d < 3.2 ? 1 : 2;
  }
}
// Noord (north of the IJ) is mostly newer: no canal houses there even close to the centre.
const ijLine = toXY({ lat: 52.3815, lon: 4.9 })[1];
for (let y = 0; y < Math.floor(ijLine); y++) for (let x = 0; x < COLS; x++) if (style[idx(x, y)] === 0) style[idx(x, y)] = 2;

const out = new Uint8Array(COLS * ROWS * 2);
for (let i = 0; i < COLS * ROWS; i++) {
  out[i * 2] = terrain[i]! | (style[i]! << 4);
  out[i * 2 + 1] = flags[i]!;
}
mkdirSync('src/map/public', { recursive: true });
writeFileSync('src/map/public/world.bin', out);
writeFileSync(
  'src/map/public/world.json',
  `${JSON.stringify({ cols: COLS, rows: ROWS, tileMeters: TILE_M, bbox: BBOX, mPerDegLat: M_PER_DEG_LAT, mPerDegLng: M_PER_DEG_LNG, attribution: '© OpenStreetMap contributors (ODbL)' }, null, 1)}\n`,
);
const counts = new Map<number, number>();
for (const t of terrain) counts.set(t, (counts.get(t) ?? 0) + 1);
console.log('[world] terrain', Object.fromEntries([...counts].map(([k, v]) => [Object.keys(T).find((n) => T[n as keyof typeof T] === k), v])));
console.log(`[world] wrote src/map/public/world.bin (${out.length} bytes)`);
