// Measures real colours of the canal belt from the build's cached PDOK aerial photo (SEATED_ART=canal npx tsx
// scripts/map-noord.ts first): median RGB under OSM canal centre lines, tree points and street centre lines.
// Used to pick src/map/canal-style.ts; never reads sezlab's images. Run: npx tsx scripts/canal-colours.ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { wgsToRd } from '../src/shared/rd';

const BOX = { x0: 120300, y0: 486300 }, TILE = 2000;
const dir = join('.cache/canal', readdirSync('.cache/canal')[0]!);
const tiles = new Map<string, { w: number; h: number; off: number; bpp: number; stride: number; b: Buffer }>();
function px(rx: number, ry: number): [number, number, number] | undefined {
  const ix = Math.floor((rx - BOX.x0) / TILE), iy = Math.floor((ry - BOX.y0) / TILE), key = `${ix}-${iy}`;
  if (!tiles.has(key)) {
    try {
      const b = readFileSync(join(dir, 'aerial', `t-${key}.bmp`));
      const w = b.readInt32LE(18), h = b.readInt32LE(22), bpp = b.readUInt16LE(28) / 8;
      tiles.set(key, { w, h, off: b.readUInt32LE(10), bpp, stride: Math.ceil((w * bpp) / 4) * 4, b });
    } catch { return undefined; }
  }
  const t = tiles.get(key)!;
  const x = Math.floor(rx - BOX.x0 - ix * TILE), yTop = Math.floor(BOX.y0 + (iy + 1) * TILE - ry);
  if (x < 0 || yTop < 0 || x >= t.w || yTop >= Math.abs(t.h)) return undefined;
  const o = t.off + (t.h > 0 ? Math.abs(t.h) - 1 - yTop : yTop) * t.stride + x * t.bpp;
  return [t.b[o + 2]!, t.b[o + 1]!, t.b[o]!];
}
type El = { type: string; tags?: Record<string, string>; geometry?: Array<{ lat: number; lon: number }>; lat?: number; lon?: number };
const osm = (JSON.parse(readFileSync(join(dir, 'osm.json'), 'utf8')) as { elements: El[] }).elements;
const trees = (JSON.parse(readFileSync(join(dir, 'trees.json'), 'utf8')) as { elements: El[] }).elements;
const median = (samples: Array<[number, number, number]>) => [0, 1, 2].map((c) => samples.map((s) => s[c]!).sort((a, b) => a - b)[samples.length >> 1]!);
const hex = (c: number[]) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
function along(filter: (e: El) => boolean): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (const e of osm) if (e.type === 'way' && filter(e) && e.geometry) for (let i = 1; i < e.geometry.length; i++) {
    const a = wgsToRd(e.geometry[i - 1]!.lat, e.geometry[i - 1]!.lon), b = wgsToRd(e.geometry[i]!.lat, e.geometry[i]!.lon);
    const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 3);
    for (let k = 0; k < n; k++) { const p = px(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n); if (p) out.push(p); }
  }
  return out;
}
const sets: Record<string, Array<[number, number, number]>> = {
  'canal water (canal centre lines)': along((e) => e.tags?.waterway === 'canal'),
  'tree crowns (OSM trees)': trees.flatMap((t) => (t.lat == null ? [] : [px(wgsToRd(t.lat, t.lon!).x, wgsToRd(t.lat, t.lon!).y)].filter((p): p is [number, number, number] => !!p))),
  'streets (residential and living streets)': along((e) => /^(residential|living_street)$/.test(e.tags?.highway ?? '')),
  'main roads (primary to tertiary)': along((e) => /^(primary|secondary|tertiary)$/.test(e.tags?.highway ?? '')),
};
for (const [name, s] of Object.entries(sets)) {
  const m = median(s);
  const luma = s.map((p) => 0.3 * p[0] + 0.59 * p[1] + 0.11 * p[2]).sort((a, b) => a - b);
  console.log(`${name}: median ${hex(m)} from ${s.length} pixels; luma quartiles ${[0.25, 0.5, 0.75].map((q) => Math.round(luma[Math.floor(q * luma.length)]!)).join('/')}`);
}
