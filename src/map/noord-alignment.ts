// Build/test-only independent comparison of the two *rendered* water masks. Never changes either image.
import { existsSync, readFileSync } from 'node:fs';
import { readPNG, type IndexedPNG } from './noord-png';
import { World, type SezManifest } from './world';

const water = (h: string) => {
  const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
  return g > r + 32 && b > g + 8 && g >= 105 && b >= 125;
};
export function tileReader(base: string, level = 0) {
  const cache = new Map<string, IndexedPNG | null>();
  return (x: number, y: number): { alpha: boolean; water: boolean; colour: string } => {
    const cx = Math.floor(x / 1024), cy = Math.floor(y / 1024), path = `${base}/${level}_${cx}_${cy}.png`;
    if (!cache.has(path)) cache.set(path, existsSync(path) ? readPNG(readFileSync(path)) : null);
    const p = cache.get(path);
    if (!p) return { alpha: false, water: false, colour: '' };
    const px = Math.floor(x) - cx * 1024, py = Math.floor(y) - cy * 1024;
    if (px >= p.w || py >= p.h) return { alpha: false, water: false, colour: '' };
    const k = p.pixels[py * p.w + px]!;
    return { alpha: !!p.alpha[k], water: !!p.alpha[k] && water(p.palette[k]!), colour: p.palette[k]! };
  };
}
export function measureAlignment(sez: SezManifest, lat = 52.3833, lng = 4.8953, radius = 220, search = 8) {
  const centre = new World(sez).project(lat, lng);
  const x0 = Math.round(centre.x / 2) - radius, y0 = Math.round(centre.y / 2) - radius, size = radius * 2;
  const ours = tileReader('src/map/public/ours'), theirs = tileReader(`src/map/public/sez/${sez.version}`);
  // A fixed common-alpha domain for every shift. Ignore occlusion near tall buildings by comparing the
  // water masks along their common shore, within 12 pixels of an actual reference water/land boundary.
  const stride = size + search * 2;
  const a = new Int8Array(stride * stride).fill(-1), b = new Int8Array(stride * stride).fill(-1);
  for (let y = -search; y < size + search; y++) for (let x = -search; x < size + search; x++) {
    const i = (y + search) * stride + x + search, p = theirs(x0 + x, y0 + y), q = ours(x0 + x, y0 + y);
    if (p.alpha) a[i] = +p.water;
    if (q.alpha) b[i] = +q.water;
  }
  const domain: number[] = [];
  for (let y = search + 12; y < size + search - 12; y++) for (let x = search + 12; x < size + search - 12; x++) {
    const i = y * stride + x;
    if (a[i]! < 0 || b[i]! < 0) continue;
    let edge = false;
    for (const d of [-12, 12, -12 * stride, 12 * stride]) if (a[i + d]! >= 0 && a[i + d] !== a[i]) edge = true;
    if (edge) domain.push(i);
  }
  let best = { dx: 0, dy: 0, correlation: -Infinity };
  for (let dy = -search; dy <= search; dy++) for (let dx = -search; dx <= search; dx++) {
    let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
    for (const i of domain) {
      const av = a[i]!, bv = b[i + dy * stride + dx]!;
      if (bv < 0) continue;
      n++; sa += av; sb += bv; saa += av * av; sbb += bv * bv; sab += av * bv;
    }
    const score = (n * sab - sa * sb) / Math.sqrt((n * saa - sa * sa) * (n * sbb - sb * sb));
    if (score > best.correlation) best = { dx, dy, correlation: score };
  }
  if (domain.length < 1000 || !Number.isFinite(best.correlation)) throw new Error('Insufficient overlapping water boundary for alignment');
  return { ...best, samples: domain.length, region: { lat, lng, x: x0, y: y0, width: size, height: size }, search };
}
