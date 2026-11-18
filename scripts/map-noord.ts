// Noord builder, adapted from scripts/map-world.ts at a49cefd^. Shapes only from open data.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Pix, darken, lighten, mix, rgb } from '../src/map/pix';
import { addGables, loadBag3d, outline, rasterize } from './canal-mesh';
import { World as Grid, TW, TH, T, PX_PER_M, gapMask, useFine } from '../src/map/noord-grid';
import { cleanSlivers, parkOrStoneTerrain } from '../src/map/noord-tags';
import { paintGround, paintBuilding, paintProps, finishBridges, finishQuays, useStyle } from '../src/map/noord-paint';
import { TEXEL, TUNE, adaptivePNG, buildFacades, designColour, designWall, listPanos, loadAerial, loadDsm, type Design, type Facade, type Wall } from './canal-skin';
import { ROOF_FLAT, ROOF_PITCHED, nearestMaterial, CANAL_FAR, CANAL_GLASS, CANAL_PAL, CANAL_PLINTH, CANAL_WALLS, ROOF_COLOURS, canalPalette, medianCut, photoColour, worldGrade } from '../src/map/canal-style';
import { readPNG, writePNG } from '../src/map/noord-png';
import { imageReader, measureAlignment } from '../src/map/noord-alignment';
import { measurePalette, quantizer, MATERIAL_COLOURS, FAR_PALETTE } from '../src/map/noord-palette';
import { rdToWgs, wgsToRd } from '../src/shared/rd';
import { World as City } from '../src/map/world';

// One cell projects to exactly 4 x 2 level-0 pixels; half the old grid spacing for finer silhouettes. Grid x=east, y=south.
const sez = JSON.parse(readFileSync('src/map/public/sez/manifest.json', 'utf8'));
// The canal sample is drawn at his sharpest level (FINE 2: 0.94 m cells); Noord at his 1/2 level.
const FINE = process.env.SEATED_ART === 'canal' ? 2 : 1;
useFine(FINE);
const SCALE = (sez.hi.w / sez.w / 2) * FINE;
const CELL_M = (TW / 2) / (Math.SQRT1_2 * SCALE);
// y0 484200 (was 486800, before that 487600): his art leaves gaps in Oost, the Indische Buurt and Watergraafsmeer
// that ours must fill (Joel, 8 Nov 2026). Only those gaps are kept (gapMask), so the box can be large.
const RD_BOX = { x0: 118000, y0: 484200, x1: 127500, y1: 492500 };
// SEATED_ART=canal: a sample of the canal belt (Westermarkt to the Amstel, Brouwersgracht to the Leidsegracht) in our own
// palette (src/map/canal-style.ts), not cut to his gaps, into src/map/public/canal/ (gitignored). Only the local map
// shows it, with ?art=ours (Joel, 17 Nov 2026: a first look at the city without his art).
const CANAL = process.env.SEATED_ART === 'canal';
if (CANAL) Object.assign(RD_BOX, { x0: 120300, y0: 486300, x1: 122200, y1: 488450 });
// CANAL_BOX=x0,y0,x1,y1: one tile of the whole-city build (scripts/canal-city.ts, Joel, 18 Nov 2026), written to CANAL_OUT.
if (CANAL && process.env.CANAL_BOX) {
  const [x0, y0, x1, y1] = process.env.CANAL_BOX.split(',').map(Number);
  if (![x0, y0, x1, y1].every(Number.isFinite) || x1! <= x0! || y1! <= y0!) throw new Error(`CANAL_BOX must be x0,y0,x1,y1 in RD metres, got "${process.env.CANAL_BOX}"`);
  Object.assign(RD_BOX, { x0, y0, x1, y1 });
}
if (CANAL) useStyle({ pal: CANAL_PAL, walls: CANAL_WALLS, glass: CANAL_GLASS, plinth: CANAL_PLINTH });
/** How far our layer reaches over his edge, in his overview pixels (8 world pixels each): his art fades out in a dither about 128 world pixels deep, which ours covers (8 Nov 2026). */
const UNDER_HIS_EDGE = 16;
const places = JSON.parse(readFileSync('data/map-places.json', 'utf8'));
const required = ['bacalar', 'barracuda', 'cornerstore', 'euro-pizza', 'europa', 'helling-7', 'hotel-de-goudfazant', 'klaproos', 'nikotin', 'pelusa'];
for (const [id, p] of Object.entries(places) as Array<[string, { lat: number; lng: number; area: string }]>) {
  if (CANAL) break;
  if (!required.includes(id) && !/Noord|Buiksloter|Nieuwendam|Tuindorp/.test(p.area)) continue;
  const rd = wgsToRd(p.lat, p.lng);
  RD_BOX.x0 = Math.min(RD_BOX.x0, Math.floor(rd.x - 100)); RD_BOX.x1 = Math.max(RD_BOX.x1, Math.ceil(rd.x + 100));
  RD_BOX.y0 = Math.min(RD_BOX.y0, Math.floor(rd.y - 100)); RD_BOX.y1 = Math.max(RD_BOX.y1, Math.ceil(rd.y + 100));
}
// Neighbourhoods on fog (Joel, 15 Nov 2026). A restaurant outside his art gets a disc of DISTRICT_M drawn round it, as
// Noord is drawn. Fog gaps narrower than 2 x CLOSE_M between a disc and the art, the Noord box or another disc are drawn too, and only
// within REACH_M of a restaurant. The box grows to hold the discs; its west and south edges move by whole cells, so every
// old cell keeps its place (the painter's origin then moves by whole pixels, so Noord's geometry is unchanged).
// 800 m since 15 Nov 2026 (Joel: "widen"): at 450 m a card's view of Showw, Het Bosch or the Jollof Club was a third to
// three quarters fog within 900 m.
const DISTRICT_M = 800;
// 350 m: a disc and a straight edge of art leave a crescent of fog about 550 to 600 m wide (Het Bosch to the Noord box);
// 300 m left its shoulders open.
const CLOSE_M = 350;
const REACH_M = 600;
const OLD_BOX = { ...RD_BOX };
const optOut = new Set((JSON.parse(readFileSync('data/map-optout.json', 'utf8')) as Array<{ id: string }>).map((x) => x.id));
const onArt = new City(sez);
// Fog = outside his art and outside the Noord box (inside the box every gap is drawn already, so those restaurants stand on drawn city).
const fogPlaces = (Object.entries(places) as Array<[string, { lat: number; lng: number }]>)
  .filter(([id, p]) => !CANAL && !optOut.has(id) && !onArt.covers(p.lat, p.lng))
  .map(([id, p]) => ({ id, rd: wgsToRd(p.lat, p.lng) }))
  .filter(({ rd }) => !(rd.x >= OLD_BOX.x0 && rd.x <= OLD_BOX.x1 && rd.y >= OLD_BOX.y0 && rd.y <= OLD_BOX.y1));
if (fogPlaces.length) {
  // A disc, the closing and spare. Fixed by DISTRICT_M, so the box and its cache stay the same when REACH_M changes.
  const grow = DISTRICT_M + 520;
  const xs = fogPlaces.map((p) => p.rd.x), ys = fogPlaces.map((p) => p.rd.y);
  if (Math.min(...xs) - grow < RD_BOX.x0) RD_BOX.x0 -= Math.ceil((RD_BOX.x0 - (Math.min(...xs) - grow)) / CELL_M) * CELL_M;
  RD_BOX.x1 = Math.max(RD_BOX.x1, Math.ceil(Math.max(...xs) + grow));
  RD_BOX.y0 = Math.min(RD_BOX.y0, Math.floor(Math.min(...ys) - grow));
  if (Math.max(...ys) + grow > RD_BOX.y1) throw new Error('a neighbourhood reaches north of the box: move RD_BOX.y1 by whole cells');
}
console.log(`[noord] ${fogPlaces.length} restaurants on fog get a neighbourhood: ${fogPlaces.map((p) => p.id).join(', ')}`);
// North up for our own art (Joel, 19 Nov 2026: "north is not facing north"). His projection puts north-west at the top,
// so the canal build draws its grid in a frame turned 45 degrees about PIVOT: real north lands on the frame's north-west,
// straight up on screen. GRID is the box in frame metres (CANAL_BOX is read as frame metres); RD_BOX becomes the real
// box round it, for the downloads. Noord keeps his angle (TURN 0: GRID = RD_BOX). world.ts turns signs the same way.
const TURN = CANAL ? Math.PI / 4 : 0, PIVOT = { x: 121500, y: 487400 }, cT = Math.cos(TURN), sT = Math.sin(TURN);
const toFrame = (x: number, y: number): [number, number] => !TURN ? [x, y] : [PIVOT.x + (x - PIVOT.x) * cT - (y - PIVOT.y) * sT, PIVOT.y + (x - PIVOT.x) * sT + (y - PIVOT.y) * cT];
const fromFrame = (x: number, y: number): [number, number] => !TURN ? [x, y] : [PIVOT.x + (x - PIVOT.x) * cT + (y - PIVOT.y) * sT, PIVOT.y - (x - PIVOT.x) * sT + (y - PIVOT.y) * cT];
/** A direction drawn in the frame (screen-fixed, like the light and the viewer) in real RD axes. */
const unturn = (v: number[]): [number, number, number] => [cT * v[0]! + sT * v[1]!, -sT * v[0]! + cT * v[1]!, v[2]!];
const GRID = { ...RD_BOX };
if (TURN) {
  const cs = [[GRID.x0, GRID.y0], [GRID.x0, GRID.y1], [GRID.x1, GRID.y0], [GRID.x1, GRID.y1]].map(([x, y]) => fromFrame(x!, y!));
  Object.assign(RD_BOX, { x0: Math.floor(Math.min(...cs.map((c) => c[0]))), y0: Math.floor(Math.min(...cs.map((c) => c[1]))), x1: Math.ceil(Math.max(...cs.map((c) => c[0]))), y1: Math.ceil(Math.max(...cs.map((c) => c[1]))) });
}
/** Grid cell coordinates (fractional) of a real RD point, and back. */
const rdToGrid = (x: number, y: number): [number, number] => { const [fx, fy] = toFrame(x, y); return [(fx - GRID.x0) / CELL_M, (GRID.y1 - fy) / CELL_M]; };
const gridToRd = (gx: number, gy: number): [number, number] => fromFrame(GRID.x0 + gx * CELL_M, GRID.y1 - gy * CELL_M);
/** RD metres -> level-0 pixels of his projection (world pixels; the overview is 4 of them per pixel). */
const projectRD = (x: number, y: number) => ({
  x: ((x - sez.X0 + y - sez.Y0) * Math.SQRT1_2 - sez.x) * SCALE,
  y: ((x - sez.X0 - (y - sez.Y0)) * Math.SQRT1_2 / 2 - sez.y) * SCALE,
});
const corners = [rdToWgs(RD_BOX.x0, RD_BOX.y0), rdToWgs(RD_BOX.x0, RD_BOX.y1), rdToWgs(RD_BOX.x1, RD_BOX.y0), rdToWgs(RD_BOX.x1, RD_BOX.y1)];
const BBOX = { south: Math.min(...corners.map(p => p.lat)), north: Math.max(...corners.map(p => p.lat)), west: Math.min(...corners.map(p => p.lng)), east: Math.max(...corners.map(p => p.lng)) };
const COLS = Math.ceil((GRID.x1 - GRID.x0) / CELL_M);
const ROWS = Math.ceil((GRID.y1 - GRID.y0) / CELL_M);
const N = COLS * ROWS;
const UA = 'Seated-map/0.3 (one-off Noord open-data build; seated.food)';
const CACHE = `.cache/${CANAL ? 'canal' : 'noord'}/` + createHash('sha256').update(JSON.stringify(RD_BOX)).digest('hex').slice(0, 12);
let requests = 0;
async function download(url: string, init: RequestInit = {}): Promise<Response> {
  requests++;
  console.log(`[noord] request ${requests}: ${new URL(url).host}`);
  const response = await fetch(url, { ...init, headers: { ...init.headers, 'User-Agent': UA } });
  await new Promise(r => setTimeout(r, 1000));
  return response;
}
const measured = CANAL ? undefined : measurePalette(sez);
// Canal: filled once the roofs are read from the aerial photo (step 4).
const OUTPUT_PALETTE = measured ? measured.palette.filter(c => MATERIAL_COLOURS.has(c)) : [];
// Terrain codes come from the painter's grid model.
const F = { bridge: 1, tram: 2, ferry: 4, railLine: 8 } as const;

/**
 * Roof colours: the aerial photo's colour of each roof, made a little bolder, then snapped to this palette so the
 * map stays pixel art. Tile reds, browns, slate, zinc, flat greys, sedum greens, white and glass.
 */
const ROOF_WEIGHT = (cells: number) => (process.env.W === 'one' ? 1 : process.env.W === 'sqrt' ? Math.sqrt(cells) : cells);
const ROOF_PALETTE: string[] = CANAL ? [] : [
  '#7a3524', '#8f3b26', '#a04a2e', '#b8603a', '#c9744a', '#d08860',
  '#5a4032', '#6b4a3a', '#84604a', '#9c7a5e', '#b39b6e', '#8a6f4c',
  '#2f3640', '#3e4854', '#4b5663', '#56616d', '#66717d', '#36405a', '#3f4d66', '#4b5872', '#56637a', '#78818e', '#3d4450', '#4a5260', '#576070', '#66707d',
  '#4d6b7e', '#6f8ea0', '#8aa3b2',
  '#474a4e', '#5f6266', '#77818c', '#8c8f8f', '#a3a39c', '#b9b6ad', '#cfc9bd', '#e0d9cb', '#ebe6da', '#a8a296', '#bdb4a2', '#cfc4b0', '#d9cfba', '#e0d6c3', '#9d978b', '#b0a898', '#bfb5a2', '#cbc1ad', '#d6ccb8',
  '#6f8a4c', '#8aa05c', '#a6b77a',
  '#f2efe6', '#c8d6dc', '#9fb7c2', '#d1b27a', '#d6c8ad',
  '#585657', '#686665', '#797368', '#8b8984', '#989388',
];

// ── grid helpers ──────────────────────────────────────────────────────────

const idx = (x: number, y: number) => y * COLS + x;
const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < COLS && y < ROWS;
interface Pt {
  lat: number;
  lon: number;
}
const rdToXY = rdToGrid;
const toXY = (p: Pt): [number, number] => { const rd = wgsToRd(p.lat, p.lon); return rdToXY(rd.x, rd.y); };

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
  const r = (width * 4 / CELL_M - 1) / 2;
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
    // Overpass answers 502 or 504 when its queue is full: wait longer each time, up to four tries.
    let res: Response | undefined;
    for (let attempt = 0; ; attempt++) {
      res = await download('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(360_000),
      });
      if (res.ok || ![429, 502, 503, 504].includes(res.status) || attempt === 3) break;
      const wait = 60_000 * 2 ** attempt;
      console.log(`[world] Overpass ${res.status}; waiting ${wait / 1000} s, then try ${attempt + 2}`);
      await new Promise((r) => setTimeout(r, wait));
    }
    if (!res!.ok) throw new Error(`Overpass ${res!.status}: ${(await res!.text()).slice(0, 200)}`);
    writeFileSync(path, await res!.text());
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
      const res = await download(`${base}&count=10000&startIndex=${page * 10000}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(300_000) });
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
    const res = await download(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120_000) });
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

/** Distance to the nearest cell of `set`, in half cells (a step across a cell: 2, a diagonal step: 3). Two-pass chamfer. */
function halfCells(set: Uint8Array): Uint16Array {
  const INF = 60000;
  const d = Uint16Array.from(set, (v) => (v ? 0 : INF));
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const i = idx(x, y);
    let v = d[i]!;
    if (x > 0) v = Math.min(v, d[i - 1]! + 2);
    if (y > 0) {
      v = Math.min(v, d[i - COLS]! + 2);
      if (x > 0) v = Math.min(v, d[i - COLS - 1]! + 3);
      if (x < COLS - 1) v = Math.min(v, d[i - COLS + 1]! + 3);
    }
    d[i] = v;
  }
  for (let y = ROWS - 1; y >= 0; y--) for (let x = COLS - 1; x >= 0; x--) {
    const i = idx(x, y);
    let v = d[i]!;
    if (x < COLS - 1) v = Math.min(v, d[i + 1]! + 2);
    if (y < ROWS - 1) {
      v = Math.min(v, d[i + COLS]! + 2);
      if (x < COLS - 1) v = Math.min(v, d[i + COLS + 1]! + 3);
      if (x > 0) v = Math.min(v, d[i + COLS - 1]! + 3);
    }
    d[i] = v;
  }
  return d;
}

// Cells to paint: the old box (unchanged), and each fog restaurant's disc, joined to the art, the box or another disc across
// gaps narrower than 2 x CLOSE_M (a closing), and kept within REACH_M of a disc. Nothing else is painted.
const K = new Uint8Array(N);
{
  const artHi = readPNG(readFileSync(`src/map/public/sez/${sez.version}/2.png`));
  const disc = new Uint8Array(N), art = new Uint8Array(N), old = new Uint8Array(N);
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const i = idx(x, y);
    const [rdx, rdy] = gridToRd(x + 0.5, y + 0.5), rd = { x: rdx, y: rdy };
    const p = projectRD(rd.x, rd.y);
    const ox = Math.floor(p.x / 4), oy = Math.floor(p.y / 4);
    art[i] = ox >= 0 && oy >= 0 && ox < artHi.w && oy < artHi.h && artHi.alpha[oy * artHi.w + ox]! > 0 ? 1 : 0;
    const [fx, fy] = toFrame(rd.x, rd.y); // OLD_BOX is in frame metres (the canal box is given turned)
    old[i] = fx >= OLD_BOX.x0 && fx <= OLD_BOX.x1 && fy >= OLD_BOX.y0 && fy <= OLD_BOX.y1 ? 1 : 0;
  }
  const r = DISTRICT_M / CELL_M;
  for (const p of fogPlaces) {
    const [px, py] = rdToXY(p.rd.x, p.rd.y);
    for (let y = Math.floor(py - r); y <= Math.ceil(py + r); y++) for (let x = Math.floor(px - r); x <= Math.ceil(px + r); x++) {
      if (inside(x, y) && Math.hypot(x + 0.5 - px, y + 0.5 - py) <= r) disc[idx(x, y)] = 1;
    }
  }
  // Closing: grow the discs and the art by CLOSE_M, then shrink what is left by CLOSE_M. Only near a disc.
  const c2 = (2 * CLOSE_M) / CELL_M, reach2 = (2 * REACH_M) / CELL_M;
  const near = halfCells(Uint8Array.from(disc, (v, i) => v | art[i]! | old[i]!));
  const dGap = halfCells(Uint8Array.from(near, (d) => +(d > c2)));
  const dDisc = halfCells(disc);
  let closed = 0;
  for (let i = 0; i < N; i++) {
    const joined = dGap[i]! > c2 && dDisc[i]! <= reach2;
    K[i] = old[i] || disc[i] || joined ? 1 : 0;
    if (joined && !disc[i] && !old[i]) closed++;
  }
  let oldCount = 0, discCount = 0;
  for (let i = 0; i < N; i++) { oldCount += old[i]!; discCount += disc[i]!; }
  console.log(`[noord] painting ${K.reduce((n, v) => n + v, 0)} cells: ${oldCount} old box, ${discCount} neighbourhood discs, ${closed} joined cells (fog and art)`);
}

const elements = await overpass('osm.json', OSM_QUERY);
console.log(`[world] ${elements.length} OSM elements, grid ${COLS} x ${ROWS} cells of ${CELL_M} m`);
const has = (el: El, key: string, re: RegExp) => re.test(el.tags?.[key] ?? '');

// 1. Land use first, water last among areas, so water always wins.
for (const el of elements) if (has(el, 'landuse', /^(farmland|meadow|orchard|allotments)$/)) fill(shapes(el), setT(T.field));
for (const el of elements) if (has(el, 'landuse', /^(industrial|railway|port|construction)$/)) fill(shapes(el), setT(T.industry));
for (const el of elements) {
  const ground = parkOrStoneTerrain(el.tags);
  if (ground !== undefined) fill(shapes(el), setT(ground));
}
for (const el of elements) {
  if (has(el, 'landuse', /^forest$/) || has(el, 'natural', /^wood$/)) fill(shapes(el), setT(T.wood));
  if (has(el, 'natural', /^(sand|beach)$/)) fill(shapes(el), setT(T.sand));
}
for (const el of elements) {
  if (has(el, 'natural', /^water$/) || has(el, 'landuse', /^(basin|reservoir|harbour)$/) || has(el, 'waterway', /^(dock|riverbank)$/)) fill(shapes(el), setT(T.water));
}
for (const el of elements) if (el.type === 'way' && has(el, 'waterway', /^(canal|river)$/) && el.geometry) line(el.geometry.map(toXY), 2, setT(T.water));
// A park or field outline that pokes past the water's outline leaves green slivers on open water (Stenen Hoofd).
console.log(`[world] ${cleanSlivers(terrain, COLS, ROWS)} vegetation sliver cells turned to water`);

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
const groundH = new Float32Array(parts.length); // NAP metres
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
  groundH[k] = ground;
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
// Canal: the real roof shape from the AHN surface model. Per cell the 75th percentile of its 0.5 m heights (keeps
// ridges and gable tops, drops a stray low pixel), above the building's own ground, at most 2 m over its 3DBAG top
// (an elm over a roof edge).
if (CANAL) {
  const dsm = await loadDsm(CACHE, RD_BOX, download);
  let set = 0;
  for (let i = 0; i < N; i++) {
    const k = partOf[i]!;
    if (k < 0) continue;
    const x = i % COLS, y = (i - x) / COLS, hs: number[] = [];
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
      const v = dsm(...gridToRd(x + (a + 0.5) / 4, y + (b + 0.5) / 4));
      if (Number.isFinite(v)) hs.push(v - groundH[k]!);
    }
    if (hs.length < 4) continue;
    hs.sort((p, q) => p - q);
    const h = Math.max(2, Math.min(ridgeH[k]! + 2, hs[Math.floor(hs.length * 0.75)]!));
    height[i] = Math.max(1, Math.min(255, Math.round(h * 2)));
    set++;
  }
  // Roof models (judged climb, 17 Nov 2026: raw laser cells read as crumpled paper, and a least-squares gable through
  // the centre rarely fits a canal house with its low back extension). Per 3DBAG part, from 3DBAG's own laser-derived
  // heights: a pitched part gets its ridge (b3_h_nok) along its long axis and its eaves along the long sides, so both
  // short ends stand as gable walls, the canal-house front; a flat part gets the median of its laser heights.
  const cellsOf = new Map<number, number[]>();
  for (let i = 0; i < N; i++) { const k = partOf[i]!; if (k >= 0) { let l = cellsOf.get(k); if (!l) cellsOf.set(k, (l = [])); l.push(i); } }
  const modelled = new Uint8Array(parts.length);
  let gables = 0, flats = 0;
  for (const [k, cells] of cellsOf) {
    if (cells.length < 4) continue;
    const n = cells.length;
    // A gable only on a house-sized part: a big complex modelled as one pitched slab reads as a melted mesh.
    if (slanted[k] && n * CELL_M * CELL_M < (TUNE.gableMaxM2 ?? 600)) {
      let mx = 0, my = 0;
      for (const i of cells) { mx += i % COLS; my += Math.floor(i / COLS); }
      mx /= n; my /= n;
      let sxx = 0, syy = 0, sxy = 0;
      for (const i of cells) { const dx = (i % COLS) - mx, dy = Math.floor(i / COLS) - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
      const axis = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(axis), uy = Math.sin(axis);
      const dp = cells.map((i) => (-((i % COLS) - mx) * uy + (Math.floor(i / COLS) - my) * ux) * CELL_M);
      // The ridge sits midway between the long sides, which need not pass through the centre of mass.
      const lo = Math.min(...dp), hi = Math.max(...dp), mid = (lo + hi) / 2, half = (hi - lo) / 2 + CELL_M / 2;
      const ridge = ridgeH[k]!, eave = Math.max(3, Math.min(ridge - 1, 2 * flatH[k]! - ridge));
      cells.forEach((i, j) => {
        const h = eave + (half - Math.abs(dp[j]! - mid)) * ((ridge - eave) / half);
        height[i] = Math.max(1, Math.min(255, Math.round(Math.min(ridge, h) * 2)));
        meta[i] = meta[i]! | 8;
      });
      gables++;
    } else {
      const med = cells.map((i) => height[i]!).sort((p, q) => p - q)[n >> 1]!;
      for (const i of cells) { height[i] = med; meta[i] = meta[i]! & ~8; }
      flats++;
    }
    modelled[k] = 1;
  }
  console.log(`[canal] roof models: ${gables} pitched (gable fronts), ${flats} flat, ${cellsOf.size - gables - flats} tiny parts keep laser heights`);
  // 5 x 5 median (4.7 m) within the same part, for parts no model fits: a laser height per 0.94 m cell is noisy.
  const raw = height.slice();
  for (let i = 0; i < N; i++) {
    const k = partOf[i]!;
    if (k < 0 || modelled[k]) continue;
    const x = i % COLS, y = (i - x) / COLS, hs: number[] = [];
    const R = TUNE.roofMedian ?? 2;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (inside(x + dx, y + dy) && partOf[idx(x + dx, y + dy)] === k) hs.push(raw[idx(x + dx, y + dy)]!);
    height[i] = hs.sort((p, q) => p - q)[hs.length >> 1]!;
  }
  console.log(`[canal] ${set} building cells shaped from AHN`);
}

// 4. Roof colours from the aerial photo: the mean of each part's roof pixels (shadows and glare left out), made a
// little bolder and snapped to the palette.
const sums = new Float64Array(parts.length * 4);
const photoLuma = new Uint8Array(N);
/** Canal: every usable roof pixel per building, packed RGB, for its median colour. */
const roofPixels = new Map<number, number[]>();
/** Canal: every painted cell by aerial tile, for the roofs check image. */
const byTileForCheck = new Map<number, number[]>();
{
  const byTile = new Map<number, number[]>();
  for (let i = 0; i < N; i++) {
    if (CANAL && K[i]) {
      const [rx, ry] = gridToRd((i % COLS) + 0.5, Math.floor(i / COLS) + 0.5);
      const key = Math.floor((ry - RD_BOX.y0) / TILE) * AX + Math.floor((rx - RD_BOX.x0) / TILE);
      if (!byTileForCheck.has(key)) byTileForCheck.set(key, []);
      byTileForCheck.get(key)!.push(i);
    }
    if (partOf[i]! < 0 || !K[i]) continue; // only tiles that paint (a neighbourhood's tiles are fetched only if it needs them)
    const x = i % COLS;
    const y = (i - x) / COLS;
    const [rdx, rdy] = gridToRd(x + 0.5, y + 0.5), rd = { x: rdx, y: rdy };
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
        if (ox === 0 && oy === 0) photoLuma[list[n]!] = Math.round(luma);
        if (luma < 38 || luma > 238) continue;
        sums[k * 4] += r;
        sums[k * 4 + 1] += g;
        sums[k * 4 + 2] += b;
        sums[k * 4 + 3] += 1;
        if (CANAL) { let list = roofPixels.get(k); if (!list) roofPixels.set(k, (list = [])); list.push(r | (g << 8) | (b << 16)); }
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
  if (warm > 10 && light > 0.6) return pick(['#b39b6e', '#d6c8ad', '#e0d9cb']);
  return pick(['#585657', '#686665', '#797368', '#8b8984', '#989388']);
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
/** Canal: each building's own roof colour from the photo (median, tint off, haze lifted), by BAG pand. */
const own = new Map<number, [number, number, number]>();
if (CANAL) {
  // Each building's own roof colour: the median of its photo pixels (robust to an overhanging elm or a shadow strip).
  for (const [pand, list] of roofPixels) {
    if (list.length < 3) continue;
    const med = (s: number) => list.map((v) => (v >>> s) & 255).sort((a, b) => a - b)[list.length >> 1]!;
    own.set(pand, photoColour(med(0) - cast[0]!, med(8) - cast[1]!, med(16) - cast[2]!, TUNE.roofSat));
  }
  const fallback: [number, number, number] = [112, 112, 112];
  const cut = medianCut([...own].map(([pand, rgb]) => ({ rgb, weight: ROOF_WEIGHT(pandCells[pand]!) })), ROOF_COLOURS);
  ROOF_PALETTE.push(...cut.palette);
  for (let k = 0; k < parts.length; k++) partRoof[k] = cut.nearest(own.get(pandOf[k]!) ?? fallback);
  // How far each building's palette colour is from its own photo colour (RGB distance), so a palette change is measured.
  const errors = [...own.values()].map((c) => { const h = cut.palette[cut.nearest(c)]!; return Math.hypot(...c.map((v, j) => v - parseInt(h.slice(1 + j * 2, 3 + j * 2), 16))); }).sort((a, b) => a - b);
  if (!errors.length) throw new Error('no building got a roof colour from the aerial photo: check the paint mask K and the aerial tiles for this box');
  console.log(`[canal] roof colour error per building: median ${errors[errors.length >> 1]!.toFixed(1)}, 95th percentile ${errors[Math.floor(errors.length * 0.95)]!.toFixed(1)}, max ${errors.at(-1)!.toFixed(1)}`);
  OUTPUT_PALETTE.push(...canalPalette(ROOF_PALETTE));
  // Check image (top down, one pixel per cell): the aerial photo left, each building in its assigned roof colour right.
  {
    const img = Buffer.alloc(COLS * 2 * ROWS * 3);
    for (const [key, list] of byTileForCheck) {
      const ax = key % AX, ay = (key - ax) / AX, photo = await aerialTile(ax, ay);
      for (const i of list) {
        const x = i % COLS, y = (i - x) / COLS;
        const [rdx, rdy] = gridToRd(x + 0.5, y + 0.5), rx = Math.floor(rdx - RD_BOX.x0 - ax * TILE), ry = Math.floor(RD_BOX.y0 + (ay + 1) * TILE - rdy);
        if (rx < 0 || ry < 0 || rx >= TILE || ry >= TILE) continue;
        const o = (ry * TILE + rx) * 3, left = (y * COLS * 2 + x) * 3, right = left + COLS * 3;
        for (let c = 0; c < 3; c++) img[left + c] = photo[o + c]!;
        const k = partOf[i]!;
        const hex = k >= 0 ? ROOF_PALETTE[partRoof[k]!]! : null;
        for (let c = 0; c < 3; c++) img[right + c] = hex ? parseInt(hex.slice(1 + c * 2, 3 + c * 2), 16) : Math.round(photo[o + c]! * 0.35 + 166);
      }
    }
    const ppm = join(CACHE, 'roofs-check.ppm');
    writeFileSync(ppm, Buffer.concat([Buffer.from(`P6 ${COLS * 2} ${ROWS} 255\n`), img]));
    execFileSync('sips', ['-s', 'format', 'png', ppm, '--out', join(CACHE, 'roofs-check.png')], { stdio: 'ignore' });
    unlinkSync(ppm);
  }
  console.log(`[canal] ${own.size} buildings coloured from the aerial photo, ${ROOF_PALETTE.length} roof colours, ${OUTPUT_PALETTE.length} in the palette`);
}
for (let k = 0; k < parts.length && !CANAL; k++) {
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
// Keep broad, real contrasts on large flat roofs from the photo (plant, skylights and shadow),
// quantized to three shades. No synthetic roof fixtures and no reference-image geometry.
const shadeIndex = new Map<string, number>();
const roofShade = (base: number, step: number) => {
  const key = `${base}:${step}`;
  if (shadeIndex.has(key)) return shadeIndex.get(key)!;
  const h = ROOF_PALETTE[base]!;
  const target = [1, 3, 5].map(i => Math.max(0, Math.min(255, parseInt(h.slice(i, i + 2), 16) + step * 20)));
  let best = base, distance = Infinity;
  ROOF_PALETTE.forEach((colour, i) => {
    const d = [1, 3, 5].reduce((n, offset, channel) => n + (parseInt(colour.slice(offset, offset + 2), 16) - target[channel]!) ** 2, 0);
    if (d < distance) { best = i; distance = d; }
  });
  shadeIndex.set(key, best); return best;
};
for (let i = 0; i < N; i++) {
  const k = partOf[i]!;
  if (k < 0) continue;
  const base = partRoof[k]!;
  roof[i] = base;
  const pand = pandOf[k]!, n = sums[pand * 4 + 3]!;
  if (slanted[k] || !n || !photoLuma[i] || pandCells[pand]! * CELL_M * CELL_M < 400) continue;
  const mean = (sums[pand * 4]! * 0.3 + sums[pand * 4 + 1]! * 0.59 + sums[pand * 4 + 2]! * 0.11) / n;
  const contrast = photoLuma[i]! - mean;
  roof[i] = roofShade(base, contrast > 20 ? 1 : contrast < -20 ? -1 : 0);
}

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
    if (near[i]! >= Math.ceil(12 / CELL_M)) continue;
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
  for (let i = 0; i < N; i++) if (T_(i) === T.land && !height[i]) setT(near[i]! <= Math.ceil(8 / CELL_M) ? T.pavement : T.garden)(i);
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

// Ground and buildings use the pre-sez painter, with a single fractional origin rounded once.
// Cell increments are exactly integer pixels, so no local drift and no seam between output chunks.
const planes = new Uint8Array(N * 4);
planes.set(terrain); planes.set(height, N); planes.set(roof, N * 2); planes.set(meta, N * 3);
// Distance to real OSM shore (cells), for water texture; a bounded multi-source flood, not per-pixel scans.
const shore = new Uint8Array(N).fill(255), building = new Uint32Array(N), industrial = new Uint8Array(N), facade = new Uint8Array(N);
const edgeCache = new Map<number, Array<[number, number, number, number]>>();
const shoreQueue = new Int32Array(N);
let shoreTail = 0;
for (let i = 0; i < N; i++) {
  if (T_(i) !== T.water || height[i] || (terrain[i]! >> 4) & F.bridge) { shore[i] = 0; shoreQueue[shoreTail++] = i; }
  const k = partOf[i]!;
  if (k >= 0) {
    building[i] = hashStr(parts[k]!.properties.identificatie);
    industrial[i] = +(T_(i) === T.industry && pandCells[pandOf[k]!]! * CELL_M * CELL_M > 350 && flatH[k]! < 22);
    const x = i % COLS, y = Math.floor(i / COLS);
    if ([[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => !inside(x+dx!,y+dy!) || partOf[idx(x+dx!,y+dy!)] !== k)) {
      let edges = edgeCache.get(k);
      if (!edges) {
        edges = [];
        const part = parts[k]!;
        const polygons = (part.geometry.type === 'Polygon' ? [part.geometry.coordinates] : part.geometry.coordinates) as number[][][][];
        for (const polygon of polygons) for (const ring of polygon) for (let j = 1; j < ring.length; j++) {
          const a=rdToXY(ring[j-1]![0]!,ring[j-1]![1]!), b=rdToXY(ring[j]![0]!,ring[j]![1]!);
          edges.push([a[0],a[1],b[0],b[1]]);
        }
        edgeCache.set(k, edges);
      }
      let closest = Infinity, nx = 0, ny = 0;
      for (const [ax,ay,bx,by] of edges) {
        const dx=bx-ax, dy=by-ay, len=dx*dx+dy*dy;
        const t=len ? Math.max(0,Math.min(1,((x+0.5-ax)*dx+(y+0.5-ay)*dy)/len)) : 0;
        const vx=ax+t*dx-x-0.5, vy=ay+t*dy-y-0.5, distance=vx*vx+vy*vy;
        if(distance<closest) {closest=distance; nx=vx; ny=vy;}
      }
      const light = Math.max(0,Math.min(1,0.5+(nx-ny)/Math.max(0.001,Math.abs(nx)+Math.abs(ny))*0.5));
      facade[i] = 1 + Math.round(light * 6);
    }
  }
}
for (let q = 0; q < shoreTail; q++) {
  const i = shoreQueue[q]!, x = i % COLS, y = Math.floor(i / COLS), d = shore[i]!;
  if (d >= 30) continue;
  for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    if (!inside(x + dx!, y + dy!)) continue;
    const j = idx(x + dx!, y + dy!);
    if (shore[j]! <= d + 1) continue;
    shore[j] = d + 1; shoreQueue[shoreTail++] = j;
  }
}
/** Canal meshes: a wall's colour at an RD point (set by canalSkin). */
let meshWall: ((rx: number, ry: number, nx: number, ny: number, z: number, pand: number) => number) | undefined;
const skin = CANAL ? await canalSkin() : undefined;
const world = new Grid({ cols: COLS, rows: ROWS, cellMeters: CELL_M, roofPalette: ROOF_PALETTE, attribution: '' }, planes, 0, 0, COLS, ROWS, { shore, building, industrial, facade, skin });

/** Canal: roofs from the 0.5 m aerial photo, street façades from the city's panoramas (scripts/canal-skin.ts). */
async function canalSkin(): Promise<import('../src/map/noord-grid').Skin> {
  const aerial = await loadAerial(CACHE, RD_BOX, download);
  const cellAt = (rx: number, ry: number) => {
    const [gx, gy] = rdToGrid(rx, ry), x = Math.floor(gx), y = Math.floor(gy);
    return inside(x, y) ? idx(x, y) : -1;
  };
  // Façades from panoramas over the whole canal box (Joel, 17 Nov 2026: option 2, about 6,600 panoramas, 1.5 GB).
  // FACADE_DX / FACADE_DY narrow it round the comparison camera (Herengracht near the Huidenstraat) for a quick trial.
  const ROOF_DETAIL = TUNE.roofDetail ?? 1000; // RGB distance from the building's colour that makes a roof cell keep its own
  const FACADE_WINDOW = { x: 121037, y: 487152, dx: Number(process.env.FACADE_DX ?? 1300), dy: Number(process.env.FACADE_DY ?? 1300) };
  // Every outer-ring edge of a 3DBAG part that faces the viewer (the frame's south or east; its north-west is up). A free wall (no
  // building right in front) near the comparison camera is looked up in the panoramas; an edge with a building in front
  // is a party wall, drawn blank where it shows above its neighbour.
  type Edge = Wall & { free: boolean; photo: boolean };
  const edges: Edge[] = [];
  parts.forEach((part, k) => {
    const polys = (part.geometry.type === 'Polygon' ? [part.geometry.coordinates] : part.geometry.coordinates) as number[][][][];
    for (const poly of polys) {
      const ring = poly[0]!;
      let area = 0;
      for (let j = 1; j < ring.length; j++) area += ring[j - 1]![0]! * ring[j]![1]! - ring[j]![0]! * ring[j - 1]![1]!;
      const ccw = area > 0;
      for (let j = 1; j < ring.length; j++) {
        const [ax, ay] = ring[j - 1] as [number, number], [bx, by] = ring[j] as [number, number];
        const L = Math.hypot(bx - ax, by - ay);
        if (L < 0.5) continue;
        const dx = (bx - ax) / L, dy = (by - ay) / L, nx = ccw ? dy : -dy, ny = ccw ? -dx : dx;
        if (!(nx * cT - ny * sT > 0.2 || nx * sT + ny * cT < -0.2)) continue; // facing the frame's south or east
        const front = cellAt(ax + dx * L / 2 + nx * 1.2, ay + dy * L / 2 + ny * 1.2);
        const free = front >= 0 && partOf[front]! < 0;
        const photo = free && L >= 2.5 && ridgeH[k]! >= 4 && Math.abs(ax - FACADE_WINDOW.x) <= FACADE_WINDOW.dx && Math.abs(ay - FACADE_WINDOW.y) <= FACADE_WINDOW.dy;
        // A photographed wall is cut out 2.5 m above its ridge, so a gable or parapet above the roof line shows.
        edges.push({ part: k, ax, ay, dx, dy, L, nx, ny, H: ridgeH[k]! + (photo ? 2.5 : 0), g: groundH[k]!, free, photo });
      }
    }
  });
  const walls: Wall[] = edges.filter((e) => e.photo);
  const panos = await listPanos(CACHE, RD_BOX, [['2024-12-01', '2025-03-31'], ['2023-01-01', '2023-04-30'], ['2025-04-01', '2026-12-31']], download);
  const topAt = (rx: number, ry: number, part: number) => {
    const c = cellAt(rx, ry);
    if (c < 0) return -Infinity;
    const k = partOf[c]!;
    return k < 0 || pandOf[k] === pandOf[part] ? -Infinity : groundH[k]! + height[c]! / 2;
  };
  const { facades, used } = await buildFacades(CACHE, walls, panos, download, topAt);
  // Sky over a wall's top (the cut reaches 2.5 m over the ridge): bright, grey or blue texels in its top half.
  for (const f of facades) for (let j = 0; j < f.h * 0.5; j++) for (let i = 0; i < f.w; i++) {
    const t = j * f.w + i, r = f.rgb[t * 3]!, g = f.rgb[t * 3 + 1]!, b = f.rgb[t * 3 + 2]!;
    if (r + g + b > 600 || (b > r + 12 && b > 150)) f.ok[t] = 0;
  }
  const photoOf = new Map<Wall, Facade>(facades.map((f) => [f.wall, f]));
  // Designs. A building's photo walls give its wall colour to its other walls; a building no panorama saw gets a brick
  // of its period from the canal palette.
  const designs: Design[] = [];
  const wallOf = new Map<number, number>();
  for (const e of edges) {
    const f = photoOf.get(e);
    if (!f) continue;
    const d = designWall(e.L, e.H, f, 0, false);
    if (d.fromPhoto && !wallOf.has(pandOf[e.part]!)) wallOf.set(pandOf[e.part]!, d.wall);
  }
  const bySide = new Map<number, number>();
  let fromPhoto = 0;
  for (const e of edges) {
    const pand = pandOf[e.part]!, list = CANAL_WALLS[age[e.part]!] ?? CANAL_WALLS[7]!;
    const fallback = wallOf.get(pand) ?? rgb(list[hashStr(parts[e.part]!.properties.identificatie) % list.length]!);
    const d = designWall(e.L, e.H, photoOf.get(e), fallback, !e.free);
    if (d.fromPhoto) fromPhoto++;
    const di = designs.push(d) - 1;
    for (let u = 0.2; u < e.L; u += 0.4) {
      const c = cellAt(e.ax + e.dx * u - e.nx * 0.3, e.ay + e.dy * u - e.ny * 0.3);
      if (c < 0 || partOf[c] !== e.part) continue;
      // A free wall wins over a party wall on the same cell side.
      for (const key of [e.ny < -0.2 ? c * 2 : -1, e.nx > 0.2 ? c * 2 + 1 : -1]) if (key >= 0 && (!bySide.has(key) || (designs[bySide.get(key)!]!.blank && !d.blank))) bySide.set(key, di);
    }
  }
  const edgeOf = edges;
  // For the LoD 2.2 meshes: a wall point's design (the footprint edge under it), else its building's plain wall.
  const pandWall = new Map<number, Design>();
  const plainWall = (pand: number) => { const list = CANAL_WALLS[1]!; return designWall(1900, 20, undefined, rgb(list[pand % list.length]!), false); };
  for (const [key, di] of bySide) { const p = pandOf[partOf[key >> 1]!]!; if (!pandWall.has(p) || (pandWall.get(p)!.blank && !designs[di]!.blank)) pandWall.set(p, designs[di]!); }
  meshWall = (rx, ry, nx, ny, z, pand) => {
    const c = cellAt(rx - nx * 0.45, ry - ny * 0.45);
    const di = c < 0 ? undefined : bySide.get(c * 2 + (ny < -Math.abs(nx) ? 0 : 1)) ?? bySide.get(c * 2 + (ny < -Math.abs(nx) ? 1 : 0));
    if (di !== undefined) { const e = edgeOf[di]!; return designColour(designs[di]!, e.L, (rx - e.ax) * e.dx + (ry - e.ay) * e.dy, z, 99); }
    // No footprint edge under it (a wall between two roof heights, a dormer): its building's wall, with windows.
    const k = c < 0 ? -1 : partOf[c]!, d = (k < 0 ? undefined : pandWall.get(pandOf[k]!)) ?? pandWall.get(pand) ?? plainWall(pand);
    return designColour({ ...d, blank: false, bays: 1000 }, 1900, Math.abs(rx * -ny + ry * nx), z, 99);
  };
  console.log(`[canal] ${edges.length} walls: ${fromPhoto} designed from photos (${used} panoramas), ${edges.filter((e) => !e.free).length} party walls`);
  function pack(r: number, g: number, b: number): number { return (Math.round(r) | (Math.round(g) << 8) | (Math.round(b) << 16) | (0xff << 24)) >>> 0; }
  const toRd = (gx: number, gy: number) => gridToRd(gx, gy) as readonly [number, number];
  // Roof cells: the building's own photo colour, unless the cell's own 4 x 4 photo samples differ clearly from it (a
  // dormer, skylight, roof garden or terrace): then the cell's colour. Clean planes, real roof furniture.
  const roofCell = new Uint32Array(N);
  let ownCells = 0, detailCells = 0;
  for (let i = 0; i < N; i++) {
    const k = partOf[i]!;
    if (k < 0) continue;
    const x = i % COLS, y = (i - x) / COLS, rs: number[] = [], gs: number[] = [], bs: number[] = [];
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
      const c = aerial(...toRd(x + (a + 0.5) / 4, y + (b + 0.5) / 4));
      if (c !== undefined) { rs.push(c & 255); gs.push((c >>> 8) & 255); bs.push((c >>> 16) & 255); }
    }
    const base = own.get(pandOf[k]!);
    if (!rs.length) { if (base) roofCell[i] = pack(...base); continue; }
    const med = (v: number[]) => v.sort((p, q) => p - q)[v.length >> 1]!;
    const cell = photoColour(med(rs) - cast[0]!, med(gs) - cast[1]!, med(bs) - cast[2]!, TUNE.roofSat);
    const far = !base || Math.hypot(cell[0] - base[0], cell[1] - base[1], cell[2] - base[2]) > ROOF_DETAIL;
    roofCell[i] = pack(...(far ? cell : base!));
    if (far) detailCells++; else ownCells++;
  }
  console.log(`[canal] roof cells: ${ownCells} in their building's colour, ${detailCells} with their own (detail)`);
  // One colour per building (judged climb: per-cell photo colour read as streaks), the nearest roof material to its
  // photo colour; the painter's slope shading gives each plane its own tone. ROOF_DETAIL cells (a roof garden, a big
  // skylight) keep theirs, also as a material.
  for (let i = 0; i < N; i++) {
    if (!roofCell[i]) continue;
    const c = roofCell[i]!, h = nearestMaterial([c & 255, (c >>> 8) & 255, (c >>> 16) & 255], slanted[partOf[i]!] ? ROOF_PITCHED : ROOF_FLAT);
    roofCell[i] = (rgb(h) & 0xffffff | (0xff << 24)) >>> 0;
  }
  return {
    shade: { roofLit: TUNE.roofLit ?? 0.08, roofDark: TUNE.roofDark ?? 0.14, wall: TUNE.wallShade ?? 0.12, seam: TUNE.seamDark ?? 0.35, seamWidth: TUNE.seamWidth ?? 0.2 },
    roof(x, y) {
      const c = roofCell[idx(x, y)]!;
      return c || undefined;
    },
    crest(x, y, side, t) {
      const di = bySide.get(idx(x, y) * 2 + (side === 'left' ? 0 : 1));
      const d = di === undefined ? undefined : designs[di]!;
      if (!d?.crest) return undefined;
      const e = edgeOf[di!]!, [rx, ry] = side === 'left' ? toRd(x + t, y + 1) : toRd(x + 1, y + 1 - t);
      const i = Math.floor(((rx - e.ax) * e.dx + (ry - e.ay) * e.dy) / TEXEL), v = d.crest[i];
      return v !== undefined && Number.isFinite(v) ? Math.min(v, ridgeH[e.part]! + 2) : undefined;
    },
    wall(x, y, side, t, h, top) {
      const di = bySide.get(idx(x, y) * 2 + (side === 'left' ? 0 : 1));
      if (di === undefined) return undefined;
      const e = edgeOf[di]!, [rx, ry] = side === 'left' ? toRd(x + t, y + 1) : toRd(x + 1, y + 1 - t);
      const u = (rx - e.ax) * e.dx + (ry - e.ay) * e.dy;
      return designColour(designs[di]!, e.L, u, h, top);
    },
  };
}
const origin = projectRD(GRID.x0, GRID.y1); // the grid's corner, in frame metres
// Registration of the old ground/quay painter to the reference water boundary.
// Measured before correction at Westerdok (-1,-3), Centraal (-2,-2), and the IJ east (-1,-3).
// This moves only our open-data drawing; it never traces or resamples his art.
const registration = { x: 1 * FINE, y: 3 * FINE };
const ox = Math.round(origin.x) + registration.x, oy = Math.round(origin.y) + registration.y;
const x0 = Math.floor((ox - ROWS * (TW / 2) - 16) / 2048) * 2048;
const y0 = Math.floor((oy - 180 * FINE) / 2048) * 2048;
const width = Math.ceil((ox + COLS * (TW / 2) + 16 - x0) / 2048) * 2048;
const imgHeight = Math.ceil((oy + (COLS + ROWS) * (TH / 2) + 8 + (CANAL ? 16 : 0) - y0) / 2048) * 2048; // canal: room for the edge's cut face
console.log(`[noord] painting ${COLS} x ${ROWS} RD cells into ${width} x ${imgHeight} level-0 pixels`);
const canvas = new Pix(width, imgHeight);
// Paint the whole ground first: foreground ground must not erase a taller building behind it.
for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
  if (!K[idx(x, y)]) continue;
  paintGround(canvas, world, x, y, ox + (x - y) * (TW / 2) - x0, oy + (x + y) * (TH / 2) - y0, x0, y0);
}
finishQuays(canvas);
finishBridges(canvas);
// Canal: cast shadows on the ground (judged climb: flat light). Per cell, a walk toward the sun (west-south-west) over the
// building heights; the sun stands lower than the light on the planes so the shadows read, then every ground pixel
// over a shaded cell darkens.
if (CANAL && (TUNE.shadows ?? 1)) {
  const shadow = new Uint8Array(N), rise = (TUNE.sunTan ?? 1.3) * CELL_M, sx = -0.857, sy = 0.514; // grid x east, y south
  let dark = 0;
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const i = idx(x, y);
    if (height[i]) continue;
    for (let k = 1; k < 60; k++) {
      const cx = Math.round(x + sx * k), cy = Math.round(y + sy * k);
      if (!inside(cx, cy)) break;
      const hm = height[idx(cx, cy)]! / 2;
      if (hm > k * rise) { shadow[i] = 1; dark++; break; }
      if (k * rise > 40) break;
    }
  }
  const t = TUNE.shadowDark ?? 0.42;
  for (let Y = 0; Y < imgHeight; Y++) for (let X = 0; X < width; X++) {
    const j = Y * width + X, c = canvas.data[j]!;
    if (!c) continue;
    const a = (X + x0 - ox + 0.5) / (TW / 2), b = (Y + y0 - oy + 0.5) / (TH / 2); // gx - gy, gx + gy at the ground
    const gx = Math.floor((a + b) / 2), gy = Math.floor((b - a) / 2);
    if (inside(gx, gy) && shadow[idx(gx, gy)]) canvas.data[j] = darken(c, t);
  }
  console.log(`[canal] ${dark} ground cells in a building's shadow`);
}
// Canal: buildings from 3DBAG's LoD 2.2 models where it has one (canal-mesh.ts); cells paint the rest.
const MESH = CANAL && (TUNE.mesh ?? 1) === 1;
const meshed = new Uint8Array(MESH ? parts.length : 0);
let zbuf: Float32Array | undefined;
if (MESH) {
  const pandIndex = new Map<string, number>();
  parts.forEach((p, k) => pandIndex.set(p.properties.identificatie, pandOf[k]!));
  const all = await loadBag3d(CACHE, RD_BOX, (u) => download(u));
  const buildings = all.filter((b) => {
    const pand = pandIndex.get(b.id), p = b.faces[0]!.rings[0]![0]!;
    const [gx, gy] = rdToGrid(p[0]!, p[1]!), x = Math.floor(gx), y = Math.floor(gy);
    return pand !== undefined && inside(x, y) && K[idx(x, y)];
  });
  const pands = buildings.map((b) => pandIndex.get(b.id)!), hasMesh = new Set(pands);
  let gableCount = 0;
  if (TUNE.meshGables ?? 1) for (const b of buildings) gableCount += addGables(b, (f) => [0, 1, 3][hashStr(b.id + f) % 3]!);
  parts.forEach((_, k) => { if (hasMesh.has(pandOf[k]!)) meshed[k] = 1; });
  const project = (rx: number, ry: number, z: number): [number, number, number] => {
    const [gx, gy] = rdToGrid(rx, ry);
    return [ox - x0 + (gx - gy) * (TW / 2), oy - y0 + (gx + gy) * (TH / 2) - z * PX_PER_M, gx + gy];
  };
  const SUN = rgb('#fff0d2'), L = unturn([-0.75, -0.45, 0.9]), Ln = Math.hypot(L[0]!, L[1]!, L[2]!), Lh = Math.hypot(L[0]!, L[1]!);
  const k = skin!.shade!, flatDot = L[2]! / Ln;
  // A building's roof colour: its most common cell colour (the first cell found could be a skylight or a terrace). A roof
  // point takes its own cell's colour (a roof garden, a skylight) only well inside its own building (judged climb: cells
  // on a roof's edge, half street or given to the neighbour by the 0.94 m grid, made big flat roofs ragged at the edges,
  // with loose shards in the neighbour's colour).
  const roofOf = new Map<number, number>(), tally = new Map<number, Map<number, number>>();
  for (let i = 0; i < N; i++) {
    const kk = partOf[i]!;
    if (kk < 0) continue;
    const c = skin!.roof(i % COLS, Math.floor(i / COLS), 0, 0);
    if (!c) continue;
    const t = tally.get(pandOf[kk]!) ?? new Map<number, number>();
    t.set(c, (t.get(c) ?? 0) + 1);
    tally.set(pandOf[kk]!, t);
  }
  for (const [p, t] of tally) roofOf.set(p, [...t].reduce((a, b) => (b[1] > a[1] ? b : a))[0]);
  // Neighbours with the same roof colour take different tone steps (judged climb: the blocks round the Dam and the
  // Kalverstraat read as one flat grey slab, the houses lost). Greedy over buildings that touch on the grid: the first of
  // 0, +1, -1, +2 that no same-coloured neighbour already has; a step is TUNE.roofStep lighter or darker.
  const touching = new Map<number, Set<number>>();
  for (let i = 0; i < N; i++) {
    const kk = partOf[i]!;
    if (kk < 0) continue;
    const p = pandOf[kk]!, x = i % COLS;
    for (const j of [x + 1 < COLS ? i + 1 : -1, i + COLS < N ? i + COLS : -1]) {
      const kj = j < 0 ? -1 : partOf[j]!, q = kj < 0 ? -1 : pandOf[kj]!;
      if (q < 0 || q === p || roofOf.get(p) === undefined || roofOf.get(p) !== roofOf.get(q)) continue;
      (touching.get(p) ?? touching.set(p, new Set()).get(p)!).add(q);
      (touching.get(q) ?? touching.set(q, new Set()).get(q)!).add(p);
    }
  }
  const roofStep = new Map<number, number>();
  for (const [p, near] of touching) {
    const taken = new Set([...near].map((q) => roofStep.get(q)));
    roofStep.set(p, [0, 1, -1, 2].find((s) => !taken.has(s)) ?? 0);
  }
  const stepTone = TUNE.roofStep ?? 0.09;
  const toned = (c: number, s: number) => (s > 0 ? lighten(c, s * stepTone) : s < 0 ? darken(c, -s * stepTone) : c);
  console.log(`[canal] roof tone steps: ${[...roofStep.values()].filter((s) => s !== 0).length} of ${touching.size} same-coloured neighbours shifted`);
  // Houseboats (judged climb: boats in the IJ drawn as brick boxes in open water). A low, small building (ridge at most
  // 6 m, at most 200 m2) with 60% or more of its footprint on OSM water gets a boat's sides, not brick: a dark hull, a
  // light gunwale and a painted cabin with a row of windows, the paint picked by the building.
  const wet = new Map<number, { water: number; cells: number; top: number }>();
  for (let i = 0; i < N; i++) {
    const kk = partOf[i]!;
    if (kk < 0) continue;
    const w = wet.get(pandOf[kk]!) ?? wet.set(pandOf[kk]!, { water: 0, cells: 0, top: 0 }).get(pandOf[kk]!)!;
    w.water += T_(i) === T.water ? 1 : 0; w.cells++; w.top = Math.max(w.top, ridgeH[kk]!);
  }
  const boats = new Set([...wet].filter(([, w]) => w.water >= 0.6 * w.cells && w.cells * CELL_M * CELL_M <= 200 && w.top <= 6).map(([p]) => p));
  const BOAT_PAINT = ['#3d5a45', '#2f4a63', '#e8e2d4', '#7a2e2a', '#4a6b7a', '#2f2b2a'].map(rgb), HULL = rgb('#36323d'), BOAT_GLASS = rgb(CANAL_GLASS[0]!);
  const boatWall = (pand: number, u: number, z: number) => {
    const paint = BOAT_PAINT[pand % BOAT_PAINT.length]!;
    return z < 0.9 ? HULL : z < 1.2 ? lighten(paint, 0.35) : z >= 1.5 && z < 2.3 && u % 2.2 >= 0.6 && u % 2.2 < 1.6 ? BOAT_GLASS : paint;
  };
  console.log(`[canal] ${boats.size} houseboats on the water`);
  const ownCell = (x: number, y: number, pand: number) => inside(x, y) && partOf[idx(x, y)]! >= 0 && pandOf[partOf[idx(x, y)]!] === pand;
  const r = rasterize(buildings, width, imgHeight, project, (bi, face, n, rx, ry, z) => {
    if (face.roof) {
      const [gcx, gcy] = rdToGrid(rx, ry), cx = Math.floor(gcx), cy = Math.floor(gcy), pand = pands[bi]!;
      const inner = ownCell(cx, cy, pand) && ownCell(cx - 1, cy, pand) && ownCell(cx + 1, cy, pand) && ownCell(cx, cy - 1, pand) && ownCell(cx, cy + 1, pand);
      const base = toned((inner && skin!.roof(cx, cy, 0, 0)) || roofOf.get(pand) || rgb('#626569'), roofStep.get(pand) ?? 0);
      const d = (n[0] * L[0]! + n[1] * L[1]! + n[2] * L[2]!) / Ln - flatDot;
      return d > 0.08 ? mix(base, SUN, k.roofLit) : d < -0.3 ? darken(base, k.roofDark * (TUNE.meshAway ?? 0.85)) : d < -0.08 ? darken(base, k.roofDark * (TUNE.meshShade ?? 0.6)) : base;
    }
    const c = boats.has(pands[bi]!) ? boatWall(pands[bi]!, Math.abs(rx * -n[1] + ry * n[0]), z) : meshWall!(rx, ry, n[0], n[1], z, pands[bi]!);
    const s = (n[0] * L[0]! + n[1] * L[1]!) / Lh / Math.max(1e-6, Math.hypot(n[0], n[1]));
    return s > 0 ? mix(c, SUN, k.wall * (TUNE.wallSun ?? 0.7) * s) : darken(c, k.wall * -s);
  }, unturn([CELL_M, -CELL_M, TH / PX_PER_M]));
  outline(r, (c) => lighten(c, TUNE.meshTrim ?? 0.45), (c) => darken(c, TUNE.meshSeam ?? 0.55));
  // Cell buildings without a model first (painter's order), then the meshes over them.
  for (let d = 0; d < COLS + ROWS - 1; d++) for (let y = Math.max(0, d - COLS + 1); y <= Math.min(ROWS - 1, d); y++) {
    const x = d - y, i = idx(x, y);
    if (K[i] && partOf[i]! >= 0 && !meshed[partOf[i]!]) paintBuilding(canvas, world, x, y, ox + (x - y) * (TW / 2) - x0, oy + (x + y) * (TH / 2) - y0);
  }
  for (let i = 0; i < r.colour.length; i++) if (r.owner[i]! >= 0) canvas.data[i] = r.colour[i]!;
  zbuf = r.depth;
  console.log(`[canal] ${buildings.length} buildings from 3DBAG LoD 2.2 (${all.length} in its tiles), ${parts.length - meshed.reduce((t, v) => t + v, 0)} parts painted as cells, ${gableCount} canal gables`);
}
// Props (trees, boats) behind a mesh building stay hidden: a prop pixel draws only where nothing nearer is.
let gate = Infinity;
const set = canvas.set.bind(canvas);
if (zbuf) canvas.set = (X: number, Y: number, c: number) => { const i = (Y | 0) * width + (X | 0); if (!(zbuf![i]! > gate)) set(X, Y, c); };
for (let d = 0; d < COLS + ROWS - 1; d++) for (let y = Math.max(0, d - COLS + 1); y <= Math.min(ROWS - 1, d); y++) {
  const x = d - y, sx = ox + (x - y) * (TW / 2) - x0, sy = oy + (x + y) * (TH / 2) - y0;
  if (!K[idx(x, y)]) continue;
  if (!MESH) paintBuilding(canvas, world, x, y, sx, sy);
  gate = x + y + 1.5;
  paintProps(canvas, world, x, y, sx, sy);
}
canvas.set = set;
// Canal: the map's edge reads as the edge of a board (judged climb: the box ended in blank along straight diagonals, like a
// render that failed to load). Under the front edges (frame south and east) a cut face of the ground 3 m deep, the south
// face lit and the east face in shade as the walls are, a darker lip under the ground and a dark violet line under the
// face; along the back edges (north and west) a dark violet line on the empty side. Only on the map's border sides
// (CANAL_EDGES, letters n e s w, default all four): canal-city.ts names the city's outer sides, so its tiles meet without seams.
if (CANAL) {
  const sides = process.env.CANAL_EDGES ?? 'nesw', line = rgb('#2b2733'), soil = rgb('#8a7560'), depth = Math.round(3 * PX_PER_M);
  const at = (X: number, Y: number) => (X >= 0 && Y >= 0 && X < width && Y < imgHeight ? Y * width + X : -1);
  for (let X = 0; X < width; X++) {
    const a = (X + x0 - ox + 0.5) / (TW / 2); // gx - gy along this column
    if (a < -ROWS || a > COLS) continue;
    // Front: the column's lowest ground point, on the south edge (gy = ROWS) or the east edge (gx = COLS).
    const south = 2 * ROWS + a < 2 * COLS - a, low = oy - y0 + Math.min(2 * COLS - a, 2 * ROWS + a) * (TH / 2);
    if (sides.includes(south ? 's' : 'e')) {
      let top = -1;
      for (let Y = Math.floor(low) + 2; Y >= Math.floor(low) - 4; Y--) { const j = at(X, Y); if (j >= 0 && canvas.data[j]) { top = Y; break; } }
      const face = south ? soil : darken(soil, 0.35), lip = darken(face, 0.3);
      if (top >= 0) for (let Y = top + 1; Y <= top + depth + 1; Y++) {
        const j = at(X, Y);
        if (j >= 0 && !canvas.data[j]) canvas.data[j] = Y > top + depth ? line : Y === top + 1 ? lip : face;
      }
    }
    // Back: the column's highest ground point, on the west edge (gx = 0) or the north edge (gy = 0). A building standing
    // on the edge covers it and keeps its own outline.
    const high = oy - y0 + Math.abs(a) * (TH / 2);
    if (sides.includes(a < 0 ? 'w' : 'n')) for (let Y = Math.floor(high) - 2; Y <= Math.floor(high) + 4; Y++) {
      const j = at(X, Y);
      if (j < 0 || !canvas.data[j]) continue;
      const k = at(X, Y - 1);
      if (k >= 0 && !canvas.data[k]) canvas.data[k] = line;
      break;
    }
  }
}
// Canal: the photo colours stay as they are; each tile gets its own palette (adaptivePNG).
let pixels: Uint8Array | Uint32Array = CANAL ? Uint32Array.from(canvas.data) : new Uint8Array(canvas.data.length);
if (CANAL && (TUNE.grade ?? 1)) {
  const graded = new Map<number, number>(), opts = { sat: TUNE.gradeSat, contrast: TUNE.gradeContrast, slate: TUNE.gradeSlate, green: TUNE.gradeGreen };
  for (let i = 0; i < pixels.length; i++) { const c = pixels[i]!; let v = graded.get(c); if (v === undefined) graded.set(c, (v = worldGrade(c, opts))); pixels[i] = v; }
}
if (!CANAL) { const snap = quantizer(OUTPUT_PALETTE); for (let i = 0; i < pixels.length; i++) pixels[i] = snap(canvas.data[i]!); }
// Alignment with his art, measured on the whole painting before it is cut to his gaps (the cut leaves little shore).
const alignment = CANAL ? { dx: 0, dy: 0, correlation: 0, samples: 0 } : measureAlignment(sez, undefined, undefined, 220, 8, imageReader(pixels as Uint8Array, width, imgHeight, x0, y0, OUTPUT_PALETTE));
if (!CANAL) console.log(`[noord] alignment at the IJ south shore: ${alignment.dx}, ${alignment.dy} px (correlation ${alignment.correlation.toFixed(2)})`);
// Keep ours only where his drawing has no pixels (plus a strip over his edge): elsewhere his art is complete.
if (!CANAL) {
  const his = readPNG(readFileSync(`src/map/public/sez/${sez.version}/2.png`));
  const alpha = Uint8Array.from(his.pixels, (p) => +(his.alpha[p]! > 0));
  const keep = gapMask(alpha, his.w, his.h, UNDER_HIS_EDGE);
  // One overview pixel is 8 world pixels, 4 of our level-0 pixels.
  let cut = 0;
  for (let cy = 0; cy < imgHeight; cy++) {
    const oy = Math.floor((y0 + cy) / 4);
    for (let cx = 0; cx < width; cx++) {
      const ox = Math.floor((x0 + cx) / 4);
      if (ox < 0 || oy < 0 || ox >= his.w || oy >= his.h || keep[oy * his.w + ox]) continue;
      const i = cy * width + cx;
      if (pixels[i]) { pixels[i] = 0; cut++; }
    }
  }
  console.log(`[noord] ${cut} pixels under his art left out`);
}
// Stage tiles in the cache: a failed build must not replace the checked-in layer.
const outputDir = CANAL ? (process.env.CANAL_OUT ?? 'src/map/public/canal') : 'src/map/public/ours';
const out = join(CACHE, 'paint');
mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) if (/^(?:[012]_-?[\d.]+_-?[\d.]+|[23])\.png$/.test(f)) unlinkSync(`${out}/${f}`);
const levels: Array<{ k: number; cs: number; chunks: Array<[number, number]>; x: number; y: number; w: number; h: number }> = [];
let w = width, h = imgHeight, px0 = x0, py0 = y0;
const outputs: Array<{ name: string; bytes: number; sha256: string }> = [];
function save(name: string, bytes: Buffer) {
  writeFileSync(`${out}/${name}`, bytes);
  outputs.push({ name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const FAR = CANAL ? CANAL_FAR : FAR_PALETTE;
const farSnap = quantizer(FAR);
const farIndices = OUTPUT_PALETTE.map((h, i) => i ? farSnap(rgb(h)) : 0);
const LEVELS = CANAL ? 4 : 3, LAST = LEVELS - 1;
for (let L = 0; L < LEVELS; L++) {
  const palette = L ? FAR : OUTPUT_PALETTE;
  const encoded = CANAL ? pixels : L ? pixels.map(i => farIndices[i]!) : pixels;
  const png = (data: Uint8Array | Uint32Array, tw: number, th: number) => (CANAL ? adaptivePNG(data as Uint32Array, tw, th) : writePNG(tw, th, data as Uint8Array, palette));
  const chunks: Array<[number, number]> = [];
  if (L === LAST) { save(`${LAST}.png`, png(encoded, w, h)); chunks.push([0, 0]); }
  else for (let cy = 0; cy < h / 1024; cy++) for (let cx = 0; cx < w / 1024; cx++) {
    const tile = CANAL ? new Uint32Array(1024 * 1024) : new Uint8Array(1024 * 1024);
    for (let yy = 0; yy < 1024; yy++) tile.set(encoded.subarray((cy * 1024 + yy) * w + cx * 1024, (cy * 1024 + yy) * w + cx * 1024 + 1024), yy * 1024);
    if (!tile.some(v => v !== 0)) continue;
    const tx = cx + px0 / 1024, ty = cy + py0 / 1024;
    chunks.push([tx, ty]); save(`${L}_${tx}_${ty}.png`, png(tile, 1024, 1024));
  }
  levels.push({ k: (0.5 * FINE) / 2 ** L, cs: L === LAST ? w : 1024, chunks, x: px0, y: py0, w, h });
  if (L < LAST) {
    const next = CANAL ? new Uint32Array(w * h / 4) : new Uint8Array(w * h / 4);
    for (let yy = 0; yy < h / 2; yy++) for (let xx = 0; xx < w / 2; xx++) {
      const i = yy * 2 * w + xx * 2;
      const block = [pixels[i]!, pixels[i + 1]!, pixels[i + w]!, pixels[i + w + 1]!];
      // Modal pixel-art reduction suppresses aliasing of subpixel window/leaf details without blending colours.
      // Ties use the top-left sample. Any opaque pixel keeps coverage at the edge.
      let best = 0, count = 0;
      for (const c of block) {
        if (!c) continue;
        const n = block.reduce((n, v) => n + +(v === c), 0);
        if (n > count) { best = c; count = n; }
      }
      next[yy * (w / 2) + xx] = best;
    }
    pixels = next; w /= 2; h /= 2; px0 /= 2; py0 /= 2;
  }
}
// Compact exact overview alpha runs, in overview coordinates (including negative offsets).
const runs: number[][] = [];
for (let yy = 0; yy < h; yy++) {
  const row: number[] = [];
  for (let xx = 0; xx < w;) {
    if (!pixels[yy * w + xx]) { xx++; continue; }
    const start = xx; while (xx < w && pixels[yy * w + xx]) xx++;
    row.push(start, xx);
  }
  runs.push(row);
}
const manifest = {
  version: 1, sezVersion: sez.version, projection: { X0: sez.X0, Y0: sez.Y0, x: sez.x, y: sez.y, scale: SCALE, VZ: sez.VZ },
  rd: RD_BOX, grid: GRID, turn: TURN, pivot: PIVOT, cellMeters: CELL_M, heightScale: SCALE * sez.VZ, origin: { exact: origin, pixel: { x: ox, y: oy }, registration },
  credit: (CANAL ? 'Canal belt sample' : 'Noord') + ' drawn by Seated; © OpenStreetMap contributors (ODbL); 3DBAG TU Delft/3DGI (CC BY 4.0); PDOK aerial photo Beeldmateriaal Nederland (CC BY 4.0)',
  alignment: { dx: alignment.dx, dy: alignment.dy, correlation: alignment.correlation, samples: alignment.samples },
  palette: OUTPUT_PALETTE, measurements: measured?.table, levels, coverage: { x: px0, y: py0, w, h, runs }, files: outputs,
  neighbourhoods: { districtM: DISTRICT_M, closeM: CLOSE_M, reachM: REACH_M, oldBox: OLD_BOX, places: fogPlaces.map((p) => p.id) },
};
save('manifest.json', Buffer.from(JSON.stringify(manifest) + '\n'));
const total = outputs.reduce((n, f) => n + f.bytes, 0);
if (total > 17_000_000) throw new Error(`ours exceeds 17 MB: ${total}. Fix: shrink DISTRICT_M or REACH_M, or raise this limit and the one in test/mapNoord.test.ts on purpose.`);
mkdirSync(outputDir, { recursive: true });
const names = new Set(outputs.map(f => f.name));
for (const f of readdirSync(outputDir)) if (/^(?:[012]_-?[\d.]+_-?[\d.]+|[23])\.png$/.test(f) && !names.has(f)) unlinkSync(`${outputDir}/${f}`);
for (const f of outputs) writeFileSync(`${outputDir}/${f.name}`, readFileSync(`${out}/${f.name}`));
console.log(`[noord] ${outputs.length} files, ${total} bytes; ${requests} network requests`);
