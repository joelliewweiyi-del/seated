// Fetches the city art for the public map from sezlab.dev/amsterdam, by Sezer (sezlab), used with his permission
// (Joel, 5 Nov 2026). The map draws these images as its city layer and puts the restaurants on top.
//   npx tsx scripts/map-sez-sync.ts [--night]     downloads only what the local copy lacks
// Writes src/map/public/sez/manifest.json (committed: his version, origin and tile lists) and the images under
// src/map/public/sez/<version>/ (not committed: his art stays his; the build copies it into dist/map).
// One request at a time. When his version changes, run it again: the new version gets its own folder.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const BASE = 'https://sezlab.dev/amsterdam/';
const OUT = 'src/map/public/sez';
const UA = 'Seated-map/0.1 (city art used with permission; one sync)';
const night = process.argv.includes('--night');

async function get(path: string): Promise<Response> {
  const res = await fetch(BASE + path, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return res;
}

/** The JSON value that starts right after `marker` in his page. */
function jsonAfter(src: string, marker: string): unknown {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`no ${marker.trim()} in the page: his map changed shape, read it again`);
  let depth = 0;
  for (let i = at + marker.length; i < src.length; i++) {
    if (src[i] === '{') depth++;
    if (src[i] === '}' && --depth === 0) return JSON.parse(src.slice(at + marker.length, i + 1));
  }
  throw new Error(`unterminated ${marker.trim()}`);
}

interface Level {
  w: number;
  h: number;
  cs: number;
  chunks: Array<[number, number]>;
}

const page = await (await get('')).text();
const pxm = jsonAfter(page, 'const PXM=') as { x: number; y: number; w: number; h: number; v: number; levels: Level[]; hi?: Level };
const dataName = /fetch\('(data\.json[^']*)'\)/.exec(page)?.[1];
if (!dataName) throw new Error('no data.json in the page');
const data = (await (await get(dataName)).json()) as { X0: number; Y0: number; X1: number; Y1: number };
if (pxm.levels.length !== 3 || !pxm.hi) throw new Error('expected three levels and a hi level: his map changed shape');
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
if (![data.X0, data.Y0, data.X1, data.Y1, pxm.x, pxm.y].every(num) || data.X1 <= data.X0 || data.Y1 <= data.Y0) {
  throw new Error('his RD box or origin is missing or empty: his map changed shape');
}
if (![pxm.w, pxm.h, pxm.hi.w].every((v) => num(v) && v > 0)) throw new Error('his art has no size: his map changed shape');

const dir = `${OUT}/${pxm.v}`;
const files = ['2.png'];
pxm.levels.slice(0, 2).forEach((lv, L) => lv.chunks.forEach(([cx, cy]) => files.push(`${L}_${cx}_${cy}.png`)));
pxm.hi.chunks.forEach(([cx, cy]) => files.push(`h_${cx}_${cy}.png`));
if (night) for (const f of [...files]) files.push('n' + f.replace('.png', '.webp'));

mkdirSync(dir, { recursive: true });
let fetched = 0;
let bytes = 0;
for (const f of files) {
  if (existsSync(`${dir}/${f}`)) continue;
  const buf = Buffer.from(await (await get(`pixel/${f}?v=${pxm.v}`)).arrayBuffer());
  writeFileSync(`${dir}/${f}`, buf);
  fetched++;
  bytes += buf.length;
  if (fetched % 20 === 0) console.log(`[sez] ${fetched} files, ${(bytes / 1e6).toFixed(1)} MB`);
}

/** Alpha of an 8-bit palette PNG (his overview image): 0 where there is no art. */
function paletteAlpha(png: Buffer): { w: number; h: number; alpha: Uint8Array } {
  let at = 8;
  let w = 0;
  let h = 0;
  let trns: Buffer = Buffer.alloc(0);
  const idat: Buffer[] = [];
  while (at < png.length) {
    const len = png.readUInt32BE(at);
    const type = png.toString('latin1', at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      w = body.readUInt32BE(0);
      h = body.readUInt32BE(4);
      if (body[8] !== 8 || body[9] !== 3 || body[12] !== 0) throw new Error('2.png is no longer an 8-bit palette image: read his map again');
    } else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') idat.push(body);
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (w + 1)]!;
    for (let x = 0; x < w; x++) {
      const i = y * (w + 1) + 1 + x;
      const a = x ? px[y * w + x - 1]! : 0;
      const b = y ? px[(y - 1) * w + x]! : 0;
      const c = x && y ? px[(y - 1) * w + x - 1]! : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]!;
      px[y * w + x] = (raw[i]! + pred) & 255;
    }
  }
  return { w, h, alpha: px.map((k) => (k < trns.length ? trns[k]! : 255)) };
}

// Where his art is: one bit per MASK x MASK pixels of the overview, set when most of it is drawn. A restaurant
// outside it gets no sign (his art follows the city's outline, not the RD box).
const MASK = 8;
const over = paletteAlpha(readFileSync(`${dir}/2.png`));
const mw = Math.ceil(over.w / MASK);
const mh = Math.ceil(over.h / MASK);
const bits = new Uint8Array(Math.ceil((mw * mh) / 8));
for (let my = 0; my < mh; my++) {
  for (let mx = 0; mx < mw; mx++) {
    let n = 0;
    let drawn = 0;
    for (let y = my * MASK; y < Math.min(over.h, (my + 1) * MASK); y++) {
      for (let x = mx * MASK; x < Math.min(over.w, (mx + 1) * MASK); x++, n++) if (over.alpha[y * over.w + x]) drawn++;
    }
    if (drawn * 2 > n) bits[(my * mw + mx) >> 3]! |= 1 << ((my * mw + mx) & 7);
  }
}

const manifest = {
  source: 'https://sezlab.dev/amsterdam',
  credit: 'City art by sezlab (sezlab.dev/amsterdam), used with permission',
  version: pxm.v,
  night,
  /** RD New origin of his local metres (x east, y north). */
  X0: data.X0,
  Y0: data.Y0,
  /** The RD box his art covers. */
  X1: data.X1,
  Y1: data.Y1,
  /** His screen units: PX = (x + y) * sqrt(1/2), PY = (x - y) * sqrt(1/2) / 2 - h * VZ. The art spans x..x+w, y..y+h. */
  VZ: 0.866,
  x: pxm.x,
  y: pxm.y,
  w: pxm.w,
  h: pxm.h,
  levels: pxm.levels.map(({ w, h, cs, chunks }) => ({ w, h, cs, chunks })),
  hi: { w: pxm.hi.w, h: pxm.hi.h, cs: pxm.hi.cs, chunks: pxm.hi.chunks },
  /** Coverage: mw x mh cells over the whole art, each `cell` world pixels square, as base64 bits (row-major). */
  mask: { mw, mh, cell: (MASK * pxm.hi.w) / over.w, bits: Buffer.from(bits).toString('base64') },
};
const old = existsSync(`${OUT}/manifest.json`) ? readFileSync(`${OUT}/manifest.json`, 'utf8') : '';
writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest) + '\n');
console.log(`[sez] version ${pxm.v}: ${files.length} files, ${fetched} new (${(bytes / 1e6).toFixed(1)} MB)${old && (JSON.parse(old) as { version: unknown }).version !== manifest.version ? ' — NEW VERSION' : ''}`);
