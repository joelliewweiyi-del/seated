// Builds the map's world: Amsterdam as a grid of 4 m cells, from open data.
//   npx tsx scripts/map-world.ts [--cache <dir>]   (default .cache/map; fetches only what the cache lacks)
// Sources, each credited on the map:
//   OpenStreetMap (© OpenStreetMap contributors, ODbL): water, parks, streets, rails, tram lines, ferries, trees.
//   3DBAG (TU Delft 3D geoinformation group and 3DGI, CC BY 4.0, from BAG and AHN): every building part's
//     footprint, height, ridge height, roof type and year built.
//   PDOK aerial photo (Beeldmateriaal Nederland, CC BY 4.0): each building's roof colour.
// Writes src/map/public/world.bin (gzip of four planes of cols x rows bytes) and world.json (grid, projection,
// roof palette). Run it again only to refresh the map; the result is committed. It never calls a booking system.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { rdToWgs, wgsToRd } from './rd.js';

export const BBOX = { south: 52.33, west: 4.835, north: 52.41, east: 5.045 };
const CELL_M = 4;
const LAT0 = (BBOX.south + BBOX.north) / 2;
const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LNG = 111_320 * Math.cos((LAT0 * Math.PI) / 180);
const COLS = Math.ceil(((BBOX.east - BBOX.west) * M_PER_DEG_LNG) / CELL_M);
const ROWS = Math.ceil(((BBOX.north - BBOX.south) * M_PER_DEG_LAT) / CELL_M);
const N = COLS * ROWS;
const UA = 'Seated-map/0.2 (one-off map build)';
const CACHE = process.argv.includes('--cache') ? process.argv[process.argv.indexOf('--cache') + 1]! : '.cache/map';

// Terrain codes and flags. Keep in step with src/map/world.ts.
const T = { land: 0, water: 1, park: 2, road: 3, street: 4, square: 5, rail: 6, wood: 7, field: 8, industry: 9, sand: 10, pavement: 11, garden: 12 } as const;
const F = { bridge: 1, tram: 2, ferry: 4, railLine: 8 } as const;

/**
 * Roof colours: the aerial photo's colour of each roof, made a little bolder, then snapped to this palette so the
 * map stays pixel art. Tile reds, browns, slate, zinc, flat greys, sedum greens, white and glass.
 */
const ROOF_PALETTE = [
  '#7a3524', '#8f3b26', '#a04a2e', '#b8603a', '#c9744a', '#d08860',
  '#5a4032', '#6b4a3a', '#84604a', '#9c7a5e', '#b39b6e', '#8a6f4c',
  '#2f3640', '#3e4854', '#4b5663', '#56616d', '#66717d', '#36405a', '#3f4d66', '#4b5872', '#56637a', '#78818e', '#3d4450', '#4a5260', '#576070', '#66707d',
  '#4d6b7e', '#6f8ea0', '#8aa3b2',
  '#474a4e', '#5f6266', '#77818c', '#8c8f8f', '#a3a39c', '#b9b6ad', '#cfc9bd', '#e0d9cb', '#ebe6da', '#a8a296', '#bdb4a2', '#cfc4b0', '#d9cfba', '#e0d6c3', '#9d978b', '#b0a898', '#bfb5a2', '#cbc1ad', '#d6ccb8',
  '#6f8a4c', '#8aa05c', '#a6b77a',
  '#f2efe6', '#c8d6dc', '#9fb7c2', '#d1b27a', '#d6c8ad',
];

// ── grid helpers ──────────────────────────────────────────────────────────

const idx = (x: number, y: number) => y * COLS + x;
const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < COLS && y < ROWS;
interface Pt {
  lat: number;
  lon: number;
}
const toXY = (p: Pt): [number, number] => [((p.lon - BBOX.west) * M_PER_DEG_LNG) / CELL_M, ((BBOX.north - p.lat) * M_PER_DEG_LAT) / CELL_M];
const rdToXY = (x: number, y: number): [number, number] => {
  const { lat, lng } = rdToWgs(x, y);
  return toXY({ lat, lon: lng });
};

/** Even-odd fill of a set of rings at cell centres. */
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

/** Draws a polyline `width` cells wide. */
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

// ── OpenStreetMap ─────────────────────────────────────────────────────────

const OSM_QUERY = `[out:json][timeout:300][bbox:${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}];
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
const TREE_QUERY = `[out:json][timeout:120][bbox:${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}];node[natural=tree];out skel qt;`;

interface El {
  type: 'way' | 'relation' | 'node';
  tags?: Record<string, string>;
  geometry?: Pt[];
  members?: Array<{ role: string; geometry?: Pt[] }>;
  lat?: number;
  lon?: number;
}

async function overpass(file: string, query: string): Promise<El[]> {
  const path = join(CACHE, file);
  if (!existsSync(path)) {
    console.log(`[world] asking Overpass for ${file} (one request)...`);
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(360_000),
    });
    if (!res.ok) throw new Error(`Overpass ${res.status}: ${(await res.text()).slice(0, 200)}`);
    writeFileSync(path, await res.text());
  }
  return (JSON.parse(readFileSync(path, 'utf8')) as { elements: El[] }).elements;
}

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

// ── 3DBAG ─────────────────────────────────────────────────────────────────

/** The grid's box in RD New, rounded outward (its corners are 117359-131715 by 482506-491496). */
const RD_BOX = { x0: 117350, y0: 482500, x1: 131720, y1: 491500 };

interface Part {
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] };
  properties: {
    identificatie: string;
    oorspronkelijkbouwjaar: number | null;
    b3_h_maaiveld: number | null;
    b3_h_50p: number | null;
    b3_h_70p: number | null;
    b3_h_max: number | null;
    b3_h_nok: number | null;
    b3_dak_type: string | null;
    b3_bouwlagen: number | null;
  };
}

async function loadParts(): Promise<Part[]> {
  const dir = join(CACHE, '3dbag');
  mkdirSync(dir, { recursive: true });
  const base =
    'https://data.3dbag.nl/api/BAG3D/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=BAG3D:lod13&outputFormat=application/json&sortBy=fid' +
    '&propertyName=geom,b3_h_maaiveld,b3_h_50p,b3_h_70p,b3_h_max,b3_h_nok,b3_dak_type,oorspronkelijkbouwjaar,identificatie,b3_bouwlagen' +
    `&bbox=${RD_BOX.x0},${RD_BOX.y0},${RD_BOX.x1},${RD_BOX.y1},EPSG:28992`;
  const parts: Part[] = [];
  for (let page = 0; ; page++) {
    const path = join(dir, `page-${page}.json`);
    if (!existsSync(path)) {
      console.log(`[world] 3DBAG page ${page}...`);
      const res = await fetch(`${base}&count=10000&startIndex=${page * 10000}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(300_000) });
      if (!res.ok) throw new Error(`3DBAG ${res.status}`);
      writeFileSync(path, await res.text());
      await new Promise((r) => setTimeout(r, 2000));
    }
    const got = (JSON.parse(readFileSync(path, 'utf8')) as { features: Part[] }).features;
    parts.push(...got);
    if (got.length < 10000) break;
  }
  return parts;
}

// ── aerial photo ──────────────────────────────────────────────────────────

const TILE = 2000; // metres and pixels: 1 m per pixel
const AX = Math.ceil((RD_BOX.x1 - RD_BOX.x0) / TILE);
const AY = Math.ceil((RD_BOX.y1 - RD_BOX.y0) / TILE);

/** One aerial tile as RGB bytes, top row first. Fetched as JPEG, decoded by macOS `sips` to BMP. */
async function aerialTile(ix: number, iy: number): Promise<Uint8Array> {
  const dir = join(CACHE, 'aerial');
  mkdirSync(dir, { recursive: true });
  const bmp = join(dir, `t-${ix}-${iy}.bmp`);
  if (!existsSync(bmp)) {
    const x0 = RD_BOX.x0 + ix * TILE;
    const y0 = RD_BOX.y0 + iy * TILE;
    const url =
      'https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0?service=WMS&version=1.3.0&request=GetMap&layers=Actueel_ortho25&styles=' +
      `&crs=EPSG:28992&bbox=${x0},${y0},${x0 + TILE},${y0 + TILE}&width=${TILE}&height=${TILE}&format=image/jpeg`;
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`PDOK ${res.status}`);
    const jpg = `${bmp}.jpg`;
    writeFileSync(jpg, Buffer.from(await res.arrayBuffer()));
    execFileSync('sips', ['-s', 'format', 'bmp', jpg, '--out', bmp], { stdio: 'ignore' });
    unlinkSync(jpg);
    await new Promise((r) => setTimeout(r, 1000));
  }
  const b = readFileSync(bmp);
  const off = b.readUInt32LE(10);
  const w = b.readInt32LE(18);
  const h = b.readInt32LE(22);
  const bpp = b.readUInt16LE(28) / 8;
  const stride = Math.ceil((w * bpp) / 4) * 4;
  const out = new Uint8Array(w * Math.abs(h) * 3);
  for (let row = 0; row < Math.abs(h); row++) {
    const src = off + (h > 0 ? Math.abs(h) - 1 - row : row) * stride;
    for (let x = 0; x < w; x++) {
      out[(row * w + x) * 3] = b[src + x * bpp + 2]!;
      out[(row * w + x) * 3 + 1] = b[src + x * bpp + 1]!;
      out[(row * w + x) * 3 + 2] = b[src + x * bpp]!;
    }
  }
  return out;
}

// ── build ─────────────────────────────────────────────────────────────────

mkdirSync(CACHE, { recursive: true });
const terrain = new Uint8Array(N); // low 4 bits terrain, high 4 bits flags
const height = new Uint8Array(N); // half metres above the ground, 0 = no building
const roof = new Uint8Array(N); // ROOF_PALETTE index
const meta = new Uint8Array(N); // building: age (bits 0-2), slanted (bit 3), seed (bits 4-7). Ground: tree (bit 0).
const T_ = (i: number) => terrain[i]! & 15;
const setT = (code: number, unless: number[] = []) => (i: number) => {
  if (!unless.includes(T_(i))) terrain[i] = (terrain[i]! & 0xf0) | code;
};
const flag = (i: number, f: number) => (terrain[i]! |= f << 4);

const elements = await overpass('osm.json', OSM_QUERY);
console.log(`[world] ${elements.length} OSM elements, grid ${COLS} x ${ROWS} cells of ${CELL_M} m`);
const has = (el: El, key: string, re: RegExp) => re.test(el.tags?.[key] ?? '');

// 1. Land use first, water last among areas, so water always wins.
for (const el of elements) if (has(el, 'landuse', /^(farmland|meadow|orchard|allotments)$/)) fill(shapes(el), setT(T.field));
for (const el of elements) if (has(el, 'landuse', /^(industrial|railway|port|construction)$/)) fill(shapes(el), setT(T.industry));
for (const el of elements) {
  if (has(el, 'landuse', /^(grass|recreation_ground|cemetery|village_green)$/) || has(el, 'leisure', /^(park|garden|pitch|golf_course|nature_reserve|playground)$/) || has(el, 'natural', /^(scrub|grassland|wetland)$/))
    fill(shapes(el), setT(T.park));
}
for (const el of elements) {
  if (has(el, 'landuse', /^forest$/) || has(el, 'natural', /^wood$/)) fill(shapes(el), setT(T.wood));
  if (has(el, 'natural', /^(sand|beach)$/)) fill(shapes(el), setT(T.sand));
}
for (const el of elements) {
  if (has(el, 'natural', /^water$/) || has(el, 'landuse', /^(basin|reservoir|harbour)$/) || has(el, 'waterway', /^(dock|riverbank)$/)) fill(shapes(el), setT(T.water));
}
for (const el of elements) if (el.type === 'way' && has(el, 'waterway', /^(canal|river)$/) && el.geometry) line(el.geometry.map(toXY), 2, setT(T.water));

// 2. Squares, roads and rails. Over water a road is a bridge. Widths in cells of 4 m.
for (const el of elements) {
  if (has(el, 'place', /^square$/) || (has(el, 'highway', /^pedestrian$/) && el.tags?.area === 'yes')) fill(shapes(el), setT(T.square, [T.water]));
}
const ROAD_WIDTH: Record<string, number> = { motorway: 6, trunk: 5, primary: 4, secondary: 4, tertiary: 3, residential: 3, unclassified: 3, living_street: 2, pedestrian: 2, cycleway: 2 };
for (const el of elements) {
  const hw = el.tags?.highway;
  if (el.type !== 'way' || !hw || !ROAD_WIDTH[hw] || !el.geometry || el.tags?.area === 'yes') continue;
  if (el.tags?.tunnel && el.tags.tunnel !== 'no') continue;
  if (hw === 'cycleway' && !el.tags?.bridge) continue; // cycle paths only where they cross water
  const major = /^(motorway|trunk|primary|secondary)$/.test(hw);
  line(el.geometry.map(toXY), ROAD_WIDTH[hw]!, (i) => {
    if (T_(i) === T.water) {
      if (el.tags?.bridge && el.tags.bridge !== 'no') flag(i, F.bridge);
      return;
    }
    if (T_(i) === T.road) return;
    setT(major ? T.road : T.street)(i);
  });
}
for (const el of elements) {
  const rw = el.tags?.railway;
  if (el.type !== 'way' || !rw || !el.geometry) continue;
  if (el.tags?.tunnel && el.tags.tunnel !== 'no') continue;
  if (rw === 'tram') line(el.geometry.map(toXY), 1, (i) => flag(i, F.tram));
  else
    line(el.geometry.map(toXY), 2, (i) => {
      flag(i, F.railLine);
      if (![T.water, T.road, T.street].includes(T_(i) as 1 | 3 | 4)) setT(T.rail)(i);
    });
}
for (const el of elements) {
  if (el.type === 'way' && el.tags?.route === 'ferry' && el.geometry)
    line(el.geometry.map(toXY), 1, (i) => {
      if (T_(i) === T.water) flag(i, F.ferry);
    });
}

// 3. Buildings from 3DBAG: one part per cell (the tallest where parts overlap).
const parts = await loadParts();
console.log(`[world] ${parts.length} 3DBAG building parts`);
const partOf = new Int32Array(N).fill(-1);
const flatH = new Float32Array(parts.length); // metres above the ground: the roof's typical height
const ridgeH = new Float32Array(parts.length);
const slanted = new Uint8Array(parts.length);
const age = new Uint8Array(parts.length);
const seed = new Uint8Array(parts.length);
/** The building (BAG pand) of each part: a building gets one roof colour, however many parts it has. */
const pandOf = new Int32Array(parts.length);
{
  const ids = new Map<string, number>();
  parts.forEach((p, k) => {
    const id = p.properties.identificatie;
    if (!ids.has(id)) ids.set(id, ids.size);
    pandOf[k] = ids.get(id)!;
  });
}
const hashStr = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
parts.forEach((p, k) => {
  const q = p.properties;
  const ground = q.b3_h_maaiveld ?? 0;
  const floors = q.b3_bouwlagen ?? 3;
  const h70 = q.b3_h_70p != null ? q.b3_h_70p - ground : floors * 3.2;
  const top = (q.b3_h_nok ?? q.b3_h_max) != null ? (q.b3_h_nok ?? q.b3_h_max)! - ground : h70;
  flatH[k] = Math.max(2.5, h70);
  ridgeH[k] = Math.max(flatH[k]!, top);
  slanted[k] = q.b3_dak_type === 'slanted' && ridgeH[k]! - flatH[k]! > 0.8 ? 1 : 0;
  const y = q.oorspronkelijkbouwjaar ?? 0;
  age[k] = !y || y > 2030 ? 7 : y < 1800 ? 1 : y < 1900 ? 2 : y < 1945 ? 3 : y < 1980 ? 4 : y < 2000 ? 5 : 6;
  seed[k] = hashStr(q.identificatie) & 15;
  const polys = (p.geometry.type === 'Polygon' ? [p.geometry.coordinates] : p.geometry.coordinates) as number[][][][];
  for (const poly of polys) {
    const rs = poly.map((ring) => ring.map(([x, yy]) => rdToXY(x!, yy!)));
    fill(rs, (i) => {
      const cur = partOf[i]!;
      if (cur < 0 || ridgeH[cur]! < ridgeH[k]!) partOf[i] = k;
    });
  }
});

// Slanted roofs: height rises from the eaves with the distance to the part's edge, up to the ridge.
const dist = new Uint8Array(N);
{
  const queue: number[] = [];
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      const i = idx(x, y);
      const k = partOf[i]!;
      if (k < 0 || !slanted[k]) continue;
      const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !inside(x + dx!, y + dy!) || partOf[idx(x + dx!, y + dy!)] !== k);
      if (edge) {
        dist[i] = 1;
        queue.push(i);
      }
    }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]!;
    const x = i % COLS;
    const y = (i - x) / COLS;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (!inside(x + dx, y + dy)) continue;
      const j = idx(x + dx, y + dy);
      if (partOf[j] !== partOf[i] || dist[j]) continue;
      dist[j] = Math.min(250, dist[i]! + 1);
      queue.push(j);
    }
  }
}
const PITCH = 0.9; // rise per metre run, about 42 degrees
for (let i = 0; i < N; i++) {
  const k = partOf[i]!;
  if (k < 0) continue;
  let h = flatH[k]!;
  if (slanted[k]) {
    const eave = Math.max(3, 2 * flatH[k]! - ridgeH[k]!);
    h = Math.min(ridgeH[k]!, eave + (dist[i]! - 0.5) * CELL_M * PITCH);
  }
  height[i] = Math.max(1, Math.min(255, Math.round(h * 2)));
  meta[i] = age[k]! | (slanted[k]! << 3) | (seed[k]! << 4);
}

// 4. Roof colours from the aerial photo: the mean of each part's roof pixels (shadows and glare left out), made a
// little bolder and snapped to the palette.
const sums = new Float64Array(parts.length * 4);
{
  const byTile = new Map<number, number[]>();
  for (let i = 0; i < N; i++) {
    if (partOf[i]! < 0) continue;
    const x = i % COLS;
    const y = (i - x) / COLS;
    const lat = BBOX.north - ((y + 0.5) * CELL_M) / M_PER_DEG_LAT;
    const lng = BBOX.west + ((x + 0.5) * CELL_M) / M_PER_DEG_LNG;
    const rd = wgsToRd(lat, lng);
    const ax = Math.floor((rd.x - RD_BOX.x0) / TILE);
    const ay = Math.floor((rd.y - RD_BOX.y0) / TILE);
    if (ax < 0 || ay < 0 || ax >= AX || ay >= AY) continue;
    const key = ay * AX + ax;
    if (!byTile.has(key)) byTile.set(key, []);
    byTile.get(key)!.push(i, rd.x, rd.y);
  }
  for (const [key, list] of byTile) {
    const ax = key % AX;
    const ay = (key - ax) / AX;
    const img = await aerialTile(ax, ay);
    const x0 = RD_BOX.x0 + ax * TILE;
    const yTop = RD_BOX.y0 + (ay + 1) * TILE;
    for (let n = 0; n < list.length; n += 3) {
      const k = pandOf[partOf[list[n]!]!]!;
      for (const [ox, oy] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        const px = Math.floor(list[n + 1]! - x0 + ox);
        const py = Math.floor(yTop - list[n + 2]! + oy);
        if (px < 0 || py < 0 || px >= TILE || py >= TILE) continue;
        const o = (py * TILE + px) * 3;
        const r = img[o]!;
        const g = img[o + 1]!;
        const b = img[o + 2]!;
        const luma = 0.3 * r + 0.59 * g + 0.11 * b;
        if (luma < 38 || luma > 238) continue;
        sums[k * 4] += r;
        sums[k * 4 + 1] += g;
        sums[k * 4 + 2] += b;
        sums[k * 4 + 3] += 1;
      }
    }
    process.stdout.write('.');
  }
  process.stdout.write('\n');
}
/**
 * Aerial colours are dull: shade, haze and gravel pull every roof to grey. Like a painter, judge each roof against
 * the rest of the city and pick a clear colour: pitched roofs that are warmer than average are tile red (a third of
 * the 1900-1945 roofs, the Amsterdam School), cooler ones zinc, the rest slate; flat roofs are light stone, or
 * sedum green. Lightness picks the shade, so the city keeps its pattern.
 */
function roofColour(r: number, g: number, b: number, light: number, pitched: boolean, hall: boolean, jitter: number): string {
  const warm = r - b;
  // jitter (-1, 0 or 1 per building) sets neighbours apart, so a row of canal houses reads as houses, not one mass.
  const pick = (list: string[]) => list[Math.max(0, Math.min(list.length - 1, Math.floor((light - 0.3) / 0.07) + jitter))]!;
  if (pitched && hall) return pick(['#4a5260', '#576070', '#66707d', '#78818e']);
  if (pitched) {
    // Pitched roofs city-wide (Nov 2026): warmth median -1, quartiles -6 and +6, 90th percentile +15.
    if (warm > 9) return pick(['#8f3b26', '#a04a2e', '#b8603a', '#c9744a']);
    if (warm > 3) return pick(['#7a3524', '#8f3b26', '#a04a2e', '#b8603a']);
    if (warm < -8) return pick(['#3f4d66', '#4d6b7e', '#6f8ea0', '#8aa3b2']);
    return pick(['#3d4450', '#4a5260', '#576070', '#66707d', '#78818e']);
  }
  if (g - (r + b) / 2 > 6) return pick(['#6f8a4c', '#8aa05c', '#a6b77a']);
  if (warm > 10) return pick(['#b39b6e', '#d6c8ad', '#e0d9cb']);
  return pick(['#9d978b', '#b0a898', '#bfb5a2', '#cbc1ad', '#d6ccb8']);
}

// The photo has a cool green cast (Vondelpark lawn 95/110/101, the IJ 50/76/69). Take the city-wide mean tint off
// every roof first, so a roof is warm or cool compared with the rest of the city.
const cast = [0, 0, 0];
{
  let n = 0;
  for (let k = 0; k < parts.length; k++) {
    const c = sums[k * 4 + 3]!; // per building: indexes past the last building are empty
    if (!c) continue;
    const [r, g, b] = [sums[k * 4]! / c, sums[k * 4 + 1]! / c, sums[k * 4 + 2]! / c];
    const grey = (r + g + b) / 3;
    cast[0] += r - grey;
    cast[1] += g - grey;
    cast[2] += b - grey;
    n++;
  }
  for (let j = 0; j < 3; j++) cast[j] /= Math.max(1, n);
}
// Cells per building. A pitched building over 2400 m2 is a hall (Westpoort, Noord) or a big old complex
// (Amstelhof): grey sheet or slate, never a field of tile red.
const pandCells = new Int32Array(parts.length);
for (let i = 0; i < N; i++) if (partOf[i]! >= 0) pandCells[pandOf[partOf[i]!]!]!++;
const partRoof = new Uint8Array(parts.length);
for (let k = 0; k < parts.length; k++) {
  const b4 = pandOf[k]! * 4;
  const n = sums[b4 + 3]!;
  // No usable pixels: a grey flat roof.
  const raw = n ? [sums[b4]! / n, sums[b4 + 1]! / n, sums[b4 + 2]! / n] : [140, 140, 140];
  const light = (Math.max(...raw) + Math.min(...raw)) / 2 / 255;
  const hex = roofColour(raw[0]! - cast[0]!, raw[1]! - cast[1]!, raw[2]! - cast[2]!, light, slanted[k] === 1, pandCells[pandOf[k]!]! * CELL_M * CELL_M > 2400, (hashStr(parts[k]!.properties.identificatie) % 3) - 1);
  const best = ROOF_PALETTE.indexOf(hex);
  if (best < 0) throw new Error(`roof colour ${hex} is not in the palette`);
  partRoof[k] = best;
}
for (let i = 0; i < N; i++) if (partOf[i]! >= 0) roof[i] = partRoof[partOf[i]!]!;

// 5. Ground that is neither street nor building: pavement near streets and water, gardens inside blocks.
{
  const near = new Uint8Array(N).fill(255);
  const queue: number[] = [];
  for (let i = 0; i < N; i++) {
    const t = T_(i);
    if (!height[i] && (t === T.street || t === T.road || t === T.square || t === T.water)) {
      near[i] = 0;
      queue.push(i);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]!;
    if (near[i]! >= 3) continue;
    const x = i % COLS;
    const y = (i - x) / COLS;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (!inside(x + dx, y + dy)) continue;
      const j = idx(x + dx, y + dy);
      if (height[j] || T_(j) !== T.land || near[j] !== 255) continue;
      near[j] = near[i]! + 1;
      queue.push(j);
    }
  }
  for (let i = 0; i < N; i++) if (T_(i) === T.land && !height[i]) setT(near[i]! <= 2 ? T.pavement : T.garden)(i);
}

// 6. Trees from OpenStreetMap, on ground cells.
const trees = await overpass('trees.json', TREE_QUERY);
let treeCount = 0;
for (const t of trees) {
  if (t.lat == null || t.lon == null) continue;
  const [x, y] = toXY({ lat: t.lat, lon: t.lon });
  const i = idx(Math.floor(x), Math.floor(y));
  if (!inside(Math.floor(x), Math.floor(y)) || height[i] || T_(i) === T.water) continue;
  meta[i] = meta[i]! | 1;
  treeCount++;
}

// ── write ─────────────────────────────────────────────────────────────────

const planes = new Uint8Array(N * 4);
planes.set(terrain, 0);
planes.set(height, N);
planes.set(roof, N * 2);
planes.set(meta, N * 3);
const gz = gzipSync(planes, { level: 9 });
mkdirSync('src/map/public', { recursive: true });
writeFileSync('src/map/public/world.bin', gz);
writeFileSync(
  'src/map/public/world.json',
  `${JSON.stringify(
    {
      cols: COLS,
      rows: ROWS,
      cellMeters: CELL_M,
      bbox: BBOX,
      mPerDegLat: M_PER_DEG_LAT,
      mPerDegLng: M_PER_DEG_LNG,
      roofPalette: ROOF_PALETTE,
      attribution: '© OpenStreetMap contributors (ODbL); 3DBAG by TU Delft and 3DGI (CC BY 4.0); aerial photo Beeldmateriaal Nederland (CC BY 4.0)',
    },
    null,
    1,
  )}\n`,
);
const built = height.reduce((a, h) => a + (h ? 1 : 0), 0);
console.log(`[world] ${built} building cells, ${treeCount} trees, wrote world.bin: ${(gz.length / 1e6).toFixed(2)} MB gzip (${(planes.length / 1e6).toFixed(1)} MB raw)`);
