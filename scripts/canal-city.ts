/**
 * Seated's own art for the whole city (Joel, 18 Nov 2026: the Amsterdam panoramas over all of Amsterdam).
 * One canvas for the map's whole box would be about 40,000 x 20,000 pixels, so the box is built in tiles with
 * scripts/map-noord.ts (SEATED_ART=canal, CANAL_BOX, CANAL_OUT), one after another, then merged into
 * src/map/public/canal/: farther tiles first (north-west), so a nearer tile's buildings draw over the ground behind.
 *
 *   npx tsx scripts/canal-city.ts            # builds missing tiles (a finished tile is kept), then merges
 *   npx tsx scripts/canal-city.ts --merge    # merges the tiles built so far
 *   npx tsx scripts/canal-city.ts --list     # counts the tiles
 *
 * Downloads are sequential and cached in .cache/ (panoramas in .cache/canal/pano, shared by all tiles); a stopped
 * run resumes where it stopped. About 45 minutes and 1,500 panoramas per tile (De Pijp, 18 Nov 2026).
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { adaptivePNG } from './canal-skin';

// In frame metres (map-noord.ts turns the canal grid 45 degrees so north is up, Joel 19 Nov 2026). The first 16 tiles
// cover every restaurant on the map (frame x 118466-124865, y 483853-489854) with about 1.2 km round it; the same grid
// runs on over the whole municipality (Joel, 19 Nov 2026: all of Amsterdam): a tile is built when it touches the
// municipality (PDOK Gemeentegebied, cached in .cache/canal/amsterdam.json).
const CITY = { x0: 117250, y0: 482650, x1: 126250, y1: 491050 };
const NX = 4, NY = 4, TW = (CITY.x1 - CITY.x0) / NX, TH = (CITY.y1 - CITY.y0) / NY;
const TILES_DIR = '.cache/canal/tiles-north';
const OUT = 'src/map/public/canal';
const PIVOT = { x: 121500, y: 487400 }, C = Math.SQRT1_2; // TURN and PIVOT in map-noord.ts
const toFrame = (x: number, y: number): [number, number] => [PIVOT.x + (x - PIVOT.x) * C - (y - PIVOT.y) * C, PIVOT.y + (x - PIVOT.x) * C + (y - PIVOT.y) * C];
const fromFrame = (x: number, y: number): [number, number] => [PIVOT.x + (x - PIVOT.x) * C + (y - PIVOT.y) * C, PIVOT.y - (x - PIVOT.x) * C + (y - PIVOT.y) * C];

const boundaryFile = '.cache/canal/amsterdam.json';
if (!existsSync(boundaryFile)) {
  const filter = '<Filter><PropertyIsEqualTo><PropertyName>naam</PropertyName><Literal>Amsterdam</Literal></PropertyIsEqualTo></Filter>';
  const url = 'https://service.pdok.nl/kadaster/bestuurlijkegebieden/wfs/v1_0?service=WFS&version=2.0.0&request=GetFeature&typeNames=bestuurlijkegebieden:Gemeentegebied' +
    `&outputFormat=application/json&srsName=EPSG:28992&filter=${encodeURIComponent(filter)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`PDOK municipality boundary ${res.status}: try again later, or save the GeoJSON by hand to ${boundaryFile}`);
  mkdirSync('.cache/canal', { recursive: true });
  writeFileSync(boundaryFile, await res.text());
}
const rings = (JSON.parse(readFileSync(boundaryFile, 'utf8')) as { features: Array<{ geometry: { type: string; coordinates: number[][][][] } }> })
  .features[0]!.geometry.coordinates.flatMap((poly) => poly) as number[][][];
const inCity = (x: number, y: number) => {
  let inside = false;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if (yi! > y !== yj! > y && x < ((xj! - xi!) * (y - yi!)) / (yj! - yi!) + xi!) inside = !inside;
  }
  return inside;
};
const framed = rings.flat().map(([x, y]) => toFrame(x!, y!));
const ix0 = Math.floor((Math.min(...framed.map((p) => p[0])) - CITY.x0) / TW), ix1 = Math.floor((Math.max(...framed.map((p) => p[0])) - CITY.x0) / TW);
const iy0 = Math.floor((Math.min(...framed.map((p) => p[1])) - CITY.y0) / TH), iy1 = Math.floor((Math.max(...framed.map((p) => p[1])) - CITY.y0) / TH);

interface Tile { name: string; box: { x0: number; y0: number; x1: number; y1: number }; edges: string; ix: number; iy: number }
const tiles: Tile[] = [];
for (let iy = iy0; iy <= iy1; iy++) for (let ix = ix0; ix <= ix1; ix++) {
  const x0 = Math.round(CITY.x0 + TW * ix), x1 = Math.round(CITY.x0 + TW * (ix + 1));
  const y0 = Math.round(CITY.y0 + TH * iy), y1 = Math.round(CITY.y0 + TH * (iy + 1));
  const first = ix >= 0 && ix < NX && iy >= 0 && iy < NY;
  // A 9 x 9 grid of points in the tile: built when any lies in the municipality (the first 16 always).
  let touches = first;
  for (let a = 0; a <= 8 && !touches; a++) for (let b = 0; b <= 8 && !touches; b++) touches = inCity(...fromFrame(x0 + ((x1 - x0) * a) / 8, y0 + ((y1 - y0) * b) / 8));
  if (touches) tiles.push({ name: first ? `t${ix}${iy}` : `t${ix}_${iy}`, box: { x0, y0, x1, y1 }, edges: '', ix, iy });
}
// The city's outer sides get map-noord's edge (CANAL_EDGES): a side with no built tile next to it. Shared sides get
// none, so tiles meet without seams.
const placed = new Set(tiles.map((t) => `${t.ix},${t.iy}`));
for (const t of tiles) t.edges = ([['n', 0, 1], ['e', 1, 0], ['s', 0, -1], ['w', -1, 0]] as const).filter(([, dx, dy]) => !placed.has(`${t.ix + dx},${t.iy + dy}`)).map(([k]) => k).join('');
console.log(`[city] ${tiles.length} tiles (${tiles.filter((t) => t.name.includes('_')).length} beyond the first 16)`);
if (process.argv.includes('--list')) process.exit(0);
// Depth on screen grows with the frame's east and south (map-noord: gx + gy), so draw its west and north first.
const depth = (t: Tile) => (t.box.x0 + t.box.x1) / 2 - (t.box.y0 + t.box.y1) / 2;
tiles.sort((a, b) => depth(a) - depth(b));

if (!process.argv.includes('--merge')) {
  // Nearest the centre first, so a run stopped part way has added the most useful area.
  const centre = (t: Tile) => Math.hypot((t.box.x0 + t.box.x1) / 2 - PIVOT.x, (t.box.y0 + t.box.y1) / 2 - PIVOT.y);
  for (const t of [...tiles].sort((a, b) => centre(a) - centre(b))) {
    const dir = join(TILES_DIR, t.name);
    if (existsSync(join(dir, 'manifest.json'))) continue;
    mkdirSync(dir, { recursive: true });
    const started = Date.now();
    console.log(`[city] tile ${t.name} ${JSON.stringify(t.box)}`);
    // Overpass answers 502 or 504 when it is busy (19 Nov 2026, twice in one run): a failed tile waits 10 minutes and
    // tries again, twice; the downloads it finished are cached.
    let r = { status: 1 as number | null };
    for (let attempt = 1; attempt <= 3 && r.status !== 0; attempt++) {
      if (attempt > 1) { console.log(`[city] tile ${t.name} failed; try ${attempt} in 10 minutes`); spawnSync('sleep', ['600']); }
      r = spawnSync('npx', ['tsx', 'scripts/map-noord.ts'], {
        stdio: 'inherit',
        env: { ...process.env, SEATED_ART: 'canal', CANAL_BOX: `${t.box.x0},${t.box.y0},${t.box.x1},${t.box.y1}`, CANAL_OUT: dir, CANAL_EDGES: t.edges, CANAL_MAX_PANOS: '20000' },
      });
    }
    if (r.status !== 0) {
      rmSync(join(dir, 'manifest.json'), { force: true });
      throw new Error(`tile ${t.name} failed (exit ${r.status}): read the output above, fix, and run again; finished tiles are kept`);
    }
    console.log(`[city] tile ${t.name} done in ${Math.round((Date.now() - started) / 60000)} min`);
  }
}

// ── merge ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Reads an indexed PNG as written by writePNG (no interlace): packed colours, 0 where the index is 0 (transparent). */
function readPNG(path: string): { w: number; h: number; data: Uint32Array } {
  const b = readFileSync(path);
  let o = 8, w = 0, h = 0, depthBits = 8;
  const idat: Buffer[] = [];
  let pal: number[] = [];
  while (o < b.length) {
    const len = b.readUInt32BE(o), type = b.toString('ascii', o + 4, o + 8), body = b.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      w = body.readUInt32BE(0); h = body.readUInt32BE(4); depthBits = body[8]!;
      if (body[9] !== 3 || body[12] !== 0) throw new Error(`${path}: only indexed, non-interlaced PNGs from writePNG can be merged`);
    } else if (type === 'PLTE') {
      pal = [];
      for (let i = 0; i < len; i += 3) pal.push((body[i]! | (body[i + 1]! << 8) | (body[i + 2]! << 16) | (0xff << 24)) >>> 0);
    } else if (type === 'IDAT') idat.push(body);
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = Math.ceil((w * depthBits) / 8), bpp = 1;
  const rows = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!, src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = rows.subarray(y * stride, (y + 1) * stride), prev = y ? rows.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp]! : 0, up = prev[i]!, c = i >= bpp ? prev[i - bpp]! : 0;
      const pr = () => { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? up : c; };
      cur[i] = (src[i]! + (f === 0 ? 0 : f === 1 ? a : f === 2 ? up : f === 3 ? (a + up) >> 1 : pr())) & 255;
    }
  }
  const data = new Uint32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const idx = depthBits === 8 ? rows[y * stride + x]! : (rows[y * stride + (x >> 1)]! >> (x & 1 ? 0 : 4)) & 15;
    data[y * w + x] = idx ? pal[idx]! : 0;
  }
  return { w, h, data };
}

const built = tiles.filter((t) => existsSync(join(TILES_DIR, t.name, 'manifest.json')));
if (!built.length) throw new Error('no tile built yet: run npx tsx scripts/canal-city.ts first');
type Level = { k: number; cs: number; chunks: Array<[number, number]>; x: number; y: number; w: number; h: number };
const manifests = built.map((t) => ({ t, m: JSON.parse(readFileSync(join(TILES_DIR, t.name, 'manifest.json'), 'utf8')) as { levels: Level[]; [k: string]: unknown } }));
const stage = join(TILES_DIR, '_merged');
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
const files: Array<{ name: string; bytes: number }> = [];
const save = (name: string, bytes: Buffer) => (writeFileSync(join(stage, name), bytes), files.push({ name, bytes: bytes.length }));
const LAST = manifests[0]!.m.levels.length - 1;
const levels: Level[] = [];
// Level 0: each 1024 chunk copied when one tile has it, composited in depth order when several do.
const owners = new Map<string, string[]>();
for (const { t } of manifests) for (const f of readdirSync(join(TILES_DIR, t.name))) if (/^0_-?\d+_-?\d+\.png$/.test(f)) owners.set(f, [...(owners.get(f) ?? []), join(TILES_DIR, t.name, f)]);
for (const [name, paths] of owners) {
  if (paths.length === 1) { copyFileSync(paths[0]!, join(stage, name)); files.push({ name, bytes: readFileSync(paths[0]!).length }); continue; }
  const acc = new Uint32Array(1024 * 1024);
  for (const p of paths) { const { data } = readPNG(p); for (let i = 0; i < acc.length; i++) if (data[i]) acc[i] = data[i]!; }
  save(name, adaptivePNG(acc, 1024, 1024));
}
/** Half size, the modal pixel of each 2 x 2 block (as map-noord.ts): no blended colours; any opaque pixel keeps coverage. */
function halve(src: Uint32Array, w: number, h: number, dst: Uint32Array, dw: number, ox: number, oy: number) {
  for (let yy = 0; yy < h / 2; yy++) for (let xx = 0; xx < w / 2; xx++) {
    const i = yy * 2 * w + xx * 2, block = [src[i]!, src[i + 1]!, src[i + w]!, src[i + w + 1]!];
    let best = 0, count = 0;
    for (const c of block) { if (!c) continue; const n = block.reduce((n, v) => n + +(v === c), 0); if (n > count) { best = c; count = n; } }
    dst[(oy + yy) * dw + ox + xx] = best;
  }
}
const chunkList = (L: number) => [...new Set(readdirSync(stage).filter((f) => f.startsWith(`${L}_`)))].map((f) => f.slice(0, -4).split('_').slice(1).map(Number) as [number, number]);
const levelOf = (L: number, chunks: Array<[number, number]>): Level => {
  const xs = chunks.map(([x]) => x), ys = chunks.map(([, y]) => y);
  const x = Math.min(...xs) * 1024, y = Math.min(...ys) * 1024;
  return { k: manifests[0]!.m.levels[L]!.k, cs: 1024, chunks, x, y, w: (Math.max(...xs) + 1) * 1024 - x, h: (Math.max(...ys) + 1) * 1024 - y };
};
levels.push(levelOf(0, chunkList(0)));
// Levels 1 and 2 from the merged level below, on one whole-chunk grid: the viewer asks only for whole chunk numbers
// (world.ts oursLevel), so a tile's half-chunk names (2_1.5_0.5) were never drawn.
for (let L = 1; L < LAST; L++) {
  const parents = new Map<string, [number, number]>();
  for (const [cx, cy] of chunkList(L - 1)) parents.set(`${Math.floor(cx / 2)}_${Math.floor(cy / 2)}`, [Math.floor(cx / 2), Math.floor(cy / 2)]);
  for (const [px, py] of parents.values()) {
    const tile = new Uint32Array(1024 * 1024);
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      const child = join(stage, `${L - 1}_${px * 2 + dx}_${py * 2 + dy}.png`);
      if (existsSync(child)) halve(readPNG(child).data, 1024, 1024, tile, 1024, dx * 512, dy * 512);
    }
    if (tile.some((v) => v !== 0)) save(`${L}_${px}_${py}.png`, adaptivePNG(tile, 1024, 1024));
  }
  levels.push(levelOf(L, chunkList(L)));
}
// The overview: half of level LAST - 1, one image.
const below = levels[LAST - 1]!;
const ox = below.x / 2, oy = below.y / 2, ow = below.w / 2, oh = below.h / 2;
const over = new Uint32Array(ow * oh);
for (const [cx, cy] of below.chunks) halve(readPNG(join(stage, `${LAST - 1}_${cx}_${cy}.png`)).data, 1024, 1024, over, ow, cx * 512 - ox, cy * 512 - oy);
save(`${LAST}.png`, adaptivePNG(over, ow, oh));
levels.push({ k: manifests[0]!.m.levels[LAST]!.k, cs: ow, chunks: [[0, 0]], x: ox, y: oy, w: ow, h: oh });
const runs: number[][] = [];
for (let yy = 0; yy < oh; yy++) {
  const row: number[] = [];
  for (let xx = 0; xx < ow;) { if (!over[yy * ow + xx]) { xx++; continue; } const s = xx; while (xx < ow && over[yy * ow + xx]) xx++; row.push(s, xx); }
  runs.push(row);
}
const first = manifests[0]!.m;
const rd = { x0: Math.min(...built.map((t) => t.box.x0)), y0: Math.min(...built.map((t) => t.box.y0)), x1: Math.max(...built.map((t) => t.box.x1)), y1: Math.max(...built.map((t) => t.box.y1)) };
const manifest = { ...first, rd, credit: 'Amsterdam drawn by Seated from 3DBAG TU Delft/3DGI (CC BY 4.0), Gemeente Amsterdam panoramas (CC BY 4.0), PDOK aerial photo (CC BY 4.0); © OpenStreetMap contributors (ODbL)', levels, coverage: { x: ox, y: oy, w: ow, h: oh, runs }, files, tiles: built.map((t) => t.name) };
save('manifest.json', Buffer.from(JSON.stringify(manifest) + '\n'));
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(stage)) copyFileSync(join(stage, f), join(OUT, f));
console.log(`[city] merged ${built.length} of ${tiles.length} tiles: ${files.length} files, ${(files.reduce((n, f) => n + f.bytes, 0) / 1e6).toFixed(1)} MB in ${OUT}`);
