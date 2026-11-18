// Canal-belt sample (Joel, 17 Nov 2026: "not just colours but actual facade and roof and building design"): every
// building's roof shape, roof surface and street façades from open data, for scripts/map-noord.ts with SEATED_ART=canal.
// - Roof shape: AHN digital surface model, 0.5 m (PDOK WCS dsm_05m, Rijkswaterstaat/AHN, CC0).
// - Roof surface: PDOK aerial photo at 0.5 m (Beeldmateriaal Nederland, CC BY 4.0).
// - Façades: Gemeente Amsterdam street panoramas (api.data.amsterdam.nl/panorama, CC BY 4.0), winter recordings first
//   so the elms are bare. Each street-facing 3DBAG wall is cut out of up to three panoramas, straightened onto the wall
//   plane, and the views are combined per texel (median), so a car or a cyclist in one view drops out.
// Downloads are sequential, polite and cached under the build's cache directory; a warm build makes no requests.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { rdToWgs, wgsToRd } from '../src/shared/rd';
import { WALL_MATERIALS, medianCut, nearestMaterial } from '../src/map/canal-style';
import { writePNG } from '../src/map/noord-png';

type Box = { x0: number; y0: number; x1: number; y1: number };
type Download = (url: string, init?: RequestInit) => Promise<Response>;

// ── GeoTIFF (float32, deflate, floating-point predictor), enough for the AHN WCS answer ────────────────────────

export function readFloatTiff(buf: Buffer): { w: number; h: number; data: Float32Array } {
  if (buf.toString('latin1', 0, 2) !== 'II') throw new Error('AHN tiff: expected little-endian');
  const ifd = buf.readUInt32LE(4), n = buf.readUInt16LE(ifd);
  const tags = new Map<number, number[]>();
  const size: Record<number, number> = { 3: 2, 4: 4, 12: 8, 16: 8 };
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12, tag = buf.readUInt16LE(e), type = buf.readUInt16LE(e + 2), count = buf.readUInt32LE(e + 4);
    const bytes = (size[type] ?? 1) * count, at = bytes <= 4 ? e + 8 : buf.readUInt32LE(e + 8);
    const vals: number[] = [];
    for (let k = 0; k < Math.min(count, 100000); k++) vals.push(type === 3 ? buf.readUInt16LE(at + k * 2) : type === 4 ? buf.readUInt32LE(at + k * 4) : type === 12 ? buf.readDoubleLE(at + k * 8) : buf[at + k]!);
    tags.set(tag, vals);
  }
  const w = tags.get(256)![0]!, h = tags.get(257)![0]!, comp = tags.get(259)![0]!, pred = tags.get(317)?.[0] ?? 1;
  if (tags.get(258)![0] !== 32 || tags.get(339)?.[0] !== 3) throw new Error('AHN tiff: expected float32');
  if (comp !== 8 && comp !== 32946 && comp !== 1) throw new Error(`AHN tiff: compression ${comp} not supported`);
  const offsets = tags.get(273)!, counts = tags.get(279)!, rps = tags.get(278)?.[0] ?? h;
  const data = new Float32Array(w * h), row = Buffer.alloc(w * 4);
  for (let s = 0; s < offsets.length; s++) {
    const raw = buf.subarray(offsets[s]!, offsets[s]! + counts[s]!), strip = comp === 1 ? raw : inflateSync(raw);
    for (let r = 0; r < rps && s * rps + r < h; r++) {
      const src = strip.subarray(r * w * 4, (r + 1) * w * 4), y = s * rps + r;
      if (pred === 3) {
        const b = Buffer.from(src);
        for (let i = 1; i < b.length; i++) b[i] = (b[i]! + b[i - 1]!) & 255;
        // Byte planes, most significant first: pixel i is b[i], b[i+w], b[i+2w], b[i+3w].
        for (let i = 0; i < w; i++) { row[i * 4 + 3] = b[i]!; row[i * 4 + 2] = b[i + w]!; row[i * 4 + 1] = b[i + 2 * w]!; row[i * 4] = b[i + 3 * w]!; }
        for (let i = 0; i < w; i++) data[y * w + i] = row.readFloatLE(i * 4);
      } else for (let i = 0; i < w; i++) data[y * w + i] = src.readFloatLE(i * 4);
    }
  }
  return { w, h, data };
}

/** AHN surface heights (metres NAP) over the box, 0.5 m; NaN where AHN has none (water, gaps). */
export async function loadDsm(cache: string, box: Box, download: Download): Promise<(rx: number, ry: number) => number> {
  const dir = join(cache, '..', 'ahn'), T = 500, R = 0.5, N = T / R; // shared by every box: named by real position
  mkdirSync(dir, { recursive: true });
  const x0 = Math.floor(box.x0 / T) * T, y0 = Math.floor(box.y0 / T) * T;
  const nx = Math.ceil((box.x1 - x0) / T), ny = Math.ceil((box.y1 - y0) / T);
  const tiles: Float32Array[] = [];
  for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
    const tx = x0 + ix * T, ty = y0 + iy * T, path = join(dir, `dsm-${tx}-${ty}.tif`);
    if (!existsSync(path)) {
      const url = 'https://service.pdok.nl/rws/ahn/wcs/v1_0?SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&COVERAGEID=dsm_05m&FORMAT=image/tiff' +
        `&SUBSET=x(${tx},${tx + T})&SUBSET=y(${ty},${ty + T})`;
      const res = await download(url, { signal: AbortSignal.timeout(180_000) });
      if (!res.ok) throw new Error(`AHN WCS ${res.status}: ${(await res.text()).slice(0, 200)}`);
      writeFileSync(path, Buffer.from(await res.arrayBuffer()));
    }
    const t = readFloatTiff(readFileSync(path));
    if (t.w !== N || t.h !== N) throw new Error(`AHN tile ${path} is ${t.w}x${t.h}, expected ${N}: remove it and rebuild`);
    tiles.push(t.data.map((v) => (v > 1e30 || v < -100 ? NaN : v)));
  }
  return (rx, ry) => {
    const ix = Math.floor((rx - x0) / T), iy = Math.floor((ry - y0) / T);
    if (ix < 0 || iy < 0 || ix >= nx || iy >= ny) return NaN;
    const px = Math.floor((rx - x0 - ix * T) / R), py = Math.floor((ty(iy) - ry) / R);
    return tiles[iy * nx + ix]![Math.min(N - 1, py) * N + Math.min(N - 1, px)]!;
    function ty(i: number) { return y0 + (i + 1) * T; }
  };
}

// ── images: JPEG -> RGB through macOS sips (as the Noord build does) ──────────────────────────────────────────

export function decodeJpeg(jpg: string): { w: number; h: number; rgb: Uint8Array } {
  const bmp = `${jpg}.bmp`;
  execFileSync('sips', ['-s', 'format', 'bmp', jpg, '--out', bmp], { stdio: 'ignore' });
  const b = readFileSync(bmp);
  unlinkSync(bmp);
  const off = b.readUInt32LE(10), w = b.readInt32LE(18), h = b.readInt32LE(22), bpp = b.readUInt16LE(28) / 8;
  const stride = Math.ceil((w * bpp) / 4) * 4, H = Math.abs(h), rgb = new Uint8Array(w * H * 3);
  for (let row = 0; row < H; row++) {
    const src = off + (h > 0 ? H - 1 - row : row) * stride;
    for (let x = 0; x < w; x++) { const o = (row * w + x) * 3; rgb[o] = b[src + x * bpp + 2]!; rgb[o + 1] = b[src + x * bpp + 1]!; rgb[o + 2] = b[src + x * bpp]!; }
  }
  return { w, h: H, rgb };
}

/** PDOK aerial photo at 0.5 m over the box: packed colour (r | g<<8 | b<<16) at an RD point, or undefined outside. */
export async function loadAerial(cache: string, box: Box, download: Download): Promise<(rx: number, ry: number) => number | undefined> {
  // Shared by every box, on a fixed 1 km grid, so neighbouring tiles of the city build reuse each other's photos.
  const dir = join(cache, '..', 'aerial50'), T = 1000, P = 2000;
  mkdirSync(dir, { recursive: true });
  box = { ...box, x0: Math.floor(box.x0 / T) * T, y0: Math.floor(box.y0 / T) * T };
  const nx = Math.ceil((box.x1 - box.x0) / T), ny = Math.ceil((box.y1 - box.y0) / T);
  const tiles: Array<{ w: number; h: number; rgb: Uint8Array }> = [];
  for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
    const tx = box.x0 + ix * T, ty = box.y0 + iy * T, jpg = join(dir, `a-${tx}-${ty}.jpg`);
    if (!existsSync(jpg)) {
      const url = 'https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0?service=WMS&version=1.3.0&request=GetMap&layers=Actueel_ortho25&styles=' +
        `&crs=EPSG:28992&bbox=${tx},${ty},${tx + T},${ty + T}&width=${P}&height=${P}&format=image/jpeg`;
      const res = await download(url, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`PDOK ${res.status}`);
      writeFileSync(jpg, Buffer.from(await res.arrayBuffer()));
    }
    tiles.push(decodeJpeg(jpg));
  }
  return (rx, ry) => {
    const ix = Math.floor((rx - box.x0) / T), iy = Math.floor((ry - box.y0) / T);
    if (ix < 0 || iy < 0 || ix >= nx || iy >= ny) return undefined;
    const t = tiles[iy * nx + ix]!, px = Math.floor(((rx - box.x0 - ix * T) / T) * P), py = Math.floor(((box.y0 + (iy + 1) * T - ry) / T) * P);
    if (px < 0 || py < 0 || px >= t.w || py >= t.h) return undefined;
    const o = (py * t.w + px) * 3;
    return t.rgb[o]! | (t.rgb[o + 1]! << 8) | (t.rgb[o + 2]! << 16);
  };
}

// ── panoramas ───────────────────────────────────────────────────────────────────────────────────────────────

export interface Pano { id: string; x: number; y: number; heading: number; t: string; url: string }

/** Every panorama in the box from the given recording windows (newest window first), from the city's API. */
export async function listPanos(cache: string, box: Box, windows: Array<[string, string]>, download: Download): Promise<Pano[]> {
  const path = join(cache, 'panoramas.json');
  if (!existsSync(path)) {
    const all: Pano[] = [];
    for (const [after, before] of windows) {
      let url: string | null = 'https://api.data.amsterdam.nl/panorama/panoramas/?srid=28992' +
        `&bbox=${box.x0},${box.y0},${box.x1},${box.y1}&timestamp_after=${after}&timestamp_before=${before}&page_size=1000`;
      while (url) {
        const res = await download(url, { signal: AbortSignal.timeout(120_000) });
        if (!res.ok) throw new Error(`panorama API ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const page = (await res.json()) as { _links: { next?: { href: string | null } }; _embedded: { panoramas: Array<{ pano_id: string; timestamp: string; heading: number; geometry: { coordinates: number[] }; _links: { equirectangular_small: { href: string } } }> } };
        for (const p of page._embedded.panoramas) {
          const rd = wgsToRd(p.geometry.coordinates[1]!, p.geometry.coordinates[0]!);
          all.push({ id: p.pano_id, x: rd.x, y: rd.y, heading: p.heading ?? 0, t: p.timestamp, url: p._links.equirectangular_small.href });
        }
        url = page._links.next?.href ?? null;
      }
      console.log(`[canal] panoramas ${after} to ${before}: ${all.length} so far`);
    }
    writeFileSync(path, JSON.stringify(all));
  }
  return JSON.parse(readFileSync(path, 'utf8')) as Pano[];
}

/** A street-facing wall: from A along unit d for L metres, outward normal n, H metres high, ground at g (NAP). */
export interface Wall { part: number; ax: number; ay: number; dx: number; dy: number; L: number; nx: number; ny: number; H: number; g: number }
export interface Facade { wall: Wall; w: number; h: number; rgb: Uint8Array; ok: Uint8Array }
export const TEXEL = 0.3; // metres

/** Joel chose panoramas for the whole canal belt, about 6,600 (17 Nov 2026), then for the whole city (18 Nov 2026):
 *  scripts/canal-city.ts raises the cap per tile with CANAL_MAX_PANOS. A build that needs more stops first. */
const MAX_NEW_PANOS = Number(process.env.CANAL_MAX_PANOS ?? 7500);
/** Panoramas are kept 1000 px wide (the API's small is 2000): about 20 cm per pixel at 35 m, finer than a 30 cm texel. */
const PANO_W = 1000;
const THIN = 12; // metres
const VIEWS = 2; // panoramas per wall
const CAMERA_M = 2.6;
/** Look knobs for the canal sample: the judged climb's best in scripts/canal-tune.json; CANAL_TUNE='{...}' replaces it for a trial. */
export const TUNE: Record<string, number> = JSON.parse(process.env.CANAL_TUNE ?? readFileSync(new URL('canal-tune.json', import.meta.url), 'utf8'));
const knob = (k: string, d: number) => TUNE[k] ?? d; // camera above the street; the API gives no height (0) for the recordings used

/**
 * Picks up to three panoramas per wall (in front of it, 5 to 35 m away, the most frontal first, at least 4 m apart),
 * downloads them once, and straightens each wall out of them. `topAt(x, y, part)` is the roof height (NAP) of another
 * building at an RD point, or -Infinity: the line of sight.
 */
export async function buildFacades(
  cache: string, walls: Wall[], panos: Pano[], download: Download,
  topAt: (x: number, y: number, part: number) => number,
): Promise<{ facades: Facade[]; used: number }> {
  const winter = (t: string) => /-(12|01|02|03)-/.test(t.slice(4, 8));
  // One panorama per THIN m square (winter first, then the newest): recordings are a metre apart, a wall needs few.
  const thin = new Map<string, Pano>();
  for (const p of panos) {
    const k = `${Math.floor(p.x / THIN)}_${Math.floor(p.y / THIN)}`, q = thin.get(k);
    if (!q || +winter(p.t) > +winter(q.t) || (winter(p.t) === winter(q.t) && p.t > q.t)) thin.set(k, p);
  }
  const grid = new Map<string, Pano[]>(), key = (x: number, y: number) => `${Math.floor(x / 20)}_${Math.floor(y / 20)}`;
  for (const p of thin.values()) { const k = key(p.x, p.y); if (!grid.has(k)) grid.set(k, []); grid.get(k)!.push(p); }
  console.log(`[canal] ${panos.length} panoramas listed, ${thin.size} after thinning to one per ${THIN} m`);
  const chosen = new Map<string, Array<{ wall: number }>>();
  let noView = 0;
  walls.forEach((wl, wi) => {
    const mx = wl.ax + wl.dx * wl.L / 2, my = wl.ay + wl.dy * wl.L / 2;
    const cands: Array<{ p: Pano; score: number; lat: number }> = [];
    for (let gx = Math.floor((mx - 40) / 20); gx <= Math.floor((mx + 40) / 20); gx++) for (let gy = Math.floor((my - 40) / 20); gy <= Math.floor((my + 40) / 20); gy++) {
      for (const p of grid.get(`${gx}_${gy}`) ?? []) {
        const vx = p.x - mx, vy = p.y - my, s = vx * wl.nx + vy * wl.ny, lat = vx * wl.dx + vy * wl.dy;
        if (s < 5 || s > 35 || Math.abs(lat) > s * 1.2 + wl.L / 2) continue;
        // Frontal and near beats oblique and far; a winter recording (bare trees) and an already chosen one (fewer downloads) help.
        const score = Math.abs(Math.atan2(lat, s)) * 2 + Math.abs(s - 12) / 12 - (winter(p.t) ? 0.6 : 0) - (chosen.has(p.id) ? 0.8 : 0) - Date.parse(p.t) / 3.15e13 * 0.05;
        cands.push({ p, score, lat });
      }
    }
    cands.sort((a, b) => a.score - b.score);
    const pick: typeof cands = [];
    for (const c of cands) { if (pick.length < VIEWS && pick.every((q) => Math.hypot(q.p.x - c.p.x, q.p.y - c.p.y) >= 4)) pick.push(c); }
    if (!pick.length) noView++;
    for (const c of pick) { if (!chosen.has(c.p.id)) chosen.set(c.p.id, []); chosen.get(c.p.id)!.push({ wall: wi }); }
  });
  console.log(`[canal] ${walls.length} street-facing walls, ${chosen.size} panoramas chosen; ${noView} walls with no panorama 5 to 35 m in front`);
  const fetchNeeded = [...chosen.keys()].filter((id) => !existsSync(join(cache, '..', 'pano', `${id}.jpg`)) && !existsSync(join(cache, '..', 'pano', `${id}.jpg.gone`))).length;
  if (fetchNeeded > MAX_NEW_PANOS) throw new Error(`${fetchNeeded} panoramas to download, more than MAX_NEW_PANOS (${MAX_NEW_PANOS}): narrow the box or raise the limit on purpose`);

  const views: Array<Array<{ rgb: Uint8Array; ok: Uint8Array }>> = walls.map(() => []);
  const byId = new Map(panos.map((p) => [p.id, p]));
  const dir = join(cache, '..', 'pano'); // shared by every box, so tiles never download a panorama twice
  mkdirSync(dir, { recursive: true });
  let done = 0;
  for (const [id, uses] of chosen) {
    const p = byId.get(id)!, jpg = join(dir, `${id}.jpg`), gone = `${jpg}.gone`;
    if (existsSync(gone)) continue;
    if (!existsSync(jpg)) {
      const res = await download(p.url, { signal: AbortSignal.timeout(120_000) });
      // Listed but not served (404): remembered, so a warm build asks again only after the cache is cleared.
      if (!res.ok) { console.log(`[canal] panorama ${id}: ${res.status}, skipped`); if (res.status === 404) writeFileSync(gone, ''); continue; }
      writeFileSync(jpg, Buffer.from(await res.arrayBuffer()));
      execFileSync('sips', ['-Z', String(PANO_W), jpg], { stdio: 'ignore' });
    }
    const img = decodeJpeg(jpg);
    for (const { wall: wi } of uses) views[wi]!.push(straighten(walls[wi]!, p, img, topAt));
    if (++done % 100 === 0) console.log(`[canal] panoramas read: ${done} of ${chosen.size}`);
  }
  const facades = walls.map((wall, wi) => combine(wall, views[wi]!));
  const hiddenAll = views.filter((v) => v.length && v.every((x) => !x.ok.some((o) => o))).length;
  console.log(`[canal] walls whose every view is blocked by another building: ${hiddenAll}`);
  return { facades, used: chosen.size };
}

function straighten(wl: Wall, p: Pano, img: { w: number; h: number; rgb: Uint8Array }, topAt: (x: number, y: number, part: number) => number) {
  const w = Math.max(1, Math.round(wl.L / TEXEL)), h = Math.max(1, Math.round(wl.H / TEXEL));
  const rgb = new Uint8Array(w * h * 3), ok = new Uint8Array(w * h);
  const cz = wl.g + CAMERA_M;
  for (let i = 0; i < w; i++) {
    const u = (i + 0.5) * TEXEL, X = wl.ax + wl.dx * u + wl.nx * 0.05, Y = wl.ay + wl.dy * u + wl.ny * 0.05;
    const vx = X - p.x, vy = Y - p.y, dist = Math.hypot(vx, vy);
    const yaw = (Math.atan2(vx, vy) * 180) / Math.PI;
    // The city's equirectangular images are all north-centred (x = W/2 looks north, clockwise); their `heading` is the
    // car's and must not be applied. Checked on the Dam: Paleis and Nationaal Monument within 6 degrees, June 2025 and
    // December 2024 recordings (headings 0 and 32.5).
    const ix = ((((yaw) / 360 + 0.5) % 1) + 1) % 1 * img.w;
    // Line of sight: the ray to height z passes a point at fraction f at cz + (z - cz) f, so a roof there of height
    // top hides every texel below cz + (top - cz) / f. One threshold per column, sampled every metre.
    let lowest = -Infinity;
    for (let s = 1; s < dist - 1; s += 1) {
      const f = s / dist, top = topAt(p.x + vx * f, p.y + vy * f, wl.part);
      if (top > -Infinity) lowest = Math.max(lowest, cz + (top - cz) / f);
    }
    for (let j = 0; j < h; j++) {
      const z = wl.g + wl.H - (j + 0.5) * TEXEL;
      if (z < lowest) continue;
      const pitch = (Math.atan2(z - cz, dist) * 180) / Math.PI;
      const iy = (0.5 - pitch / 180) * img.h;
      const x0 = Math.floor(ix) % img.w, y0 = Math.max(0, Math.min(img.h - 1, Math.floor(iy)));
      const o = (y0 * img.w + x0) * 3, t = j * w + i;
      rgb[t * 3] = img.rgb[o]!; rgb[t * 3 + 1] = img.rgb[o + 1]!; rgb[t * 3 + 2] = img.rgb[o + 2]!;
      ok[t] = 1;
    }
  }
  return { rgb, ok };
}

/** Per texel: the median of the views that see it (one view: that one; two: their mean). */
function combine(wall: Wall, views: Array<{ rgb: Uint8Array; ok: Uint8Array }>): Facade {
  const w = Math.max(1, Math.round(wall.L / TEXEL)), h = Math.max(1, Math.round(wall.H / TEXEL));
  const rgb = new Uint8Array(w * h * 3), ok = new Uint8Array(w * h);
  for (let t = 0; t < w * h; t++) {
    const vs = views.filter((v) => v.ok[t]);
    if (!vs.length) continue;
    ok[t] = 1;
    for (let c = 0; c < 3; c++) {
      const vals = vs.map((v) => v.rgb[t * 3 + c]!).sort((a, b) => a - b);
      rgb[t * 3 + c] = vals.length === 2 ? (vals[0]! + vals[1]!) >> 1 : vals[vals.length >> 1]!;
    }
  }
  return { wall, w, h, rgb, ok }; // raw: designWall reads the facts from it
}

/**
 * Pixel art from a photo: each façade keeps three of its own real colours. The wall is the median of its texels; texels
 * clearly darker are window (the median of those), clearly lighter are trim, frames or white paint (their median).
 * Winter light is flat, so the wall colour gets the haze taken off (saturation x 1.35).
 */
function poster(f: Facade): Facade {
  const lum = (t: number) => 0.3 * f.rgb[t * 3]! + 0.59 * f.rgb[t * 3 + 1]! + 0.11 * f.rgb[t * 3 + 2]!;
  const idx = [...f.ok.keys()].filter((t) => f.ok[t]);
  if (idx.length < 20) return f;
  const med = (ts: number[], c: number) => ts.map((t) => f.rgb[t * 3 + c]!).sort((a, b) => a - b)[ts.length >> 1]!;
  const ls = idx.map(lum).sort((a, b) => a - b), mid = ls[ls.length >> 1]!;
  const D = knob('darkStep', 22), Lt = knob('lightStep', 30);
  const dark = idx.filter((t) => lum(t) < mid - D), light = idx.filter((t) => lum(t) > mid + Lt), wallT = idx.filter((t) => Math.abs(lum(t) - mid) <= D);
  const tone = (ts: number[], sat: number): [number, number, number] => {
    const c = [0, 1, 2].map((ch) => med(ts.length ? ts : idx, ch)), grey = (c[0]! + c[1]! + c[2]!) / 3;
    return c.map((v) => Math.max(0, Math.min(255, Math.round(grey + (v - grey) * sat)))) as [number, number, number];
  };
  const shift = (c: [number, number, number], t: number): [number, number, number] => c.map((v) => Math.max(0, Math.min(255, Math.round(t < 0 ? v * (1 + t) : v + (255 - v) * t)))) as [number, number, number];
  const tones = { wall: shift(tone(wallT, knob('facadeSat', 1.35)), knob('wallLift', 0)), dark: shift(tone(dark, 1.1), -knob('windowDarken', 0)), light: shift(tone(light, 1), knob('trimLighten', 0)) };
  for (const t of idx) {
    const l = lum(t), c = l < mid - D ? tones.dark : l > mid + Lt ? tones.light : tones.wall;
    f.rgb[t * 3] = c[0]; f.rgb[t * 3 + 1] = c[1]; f.rgb[t * 3 + 2] = c[2];
  }
  return f;
}

export { rdToWgs };

/** An indexed PNG with its own palette: every colour if 255 or fewer, else a weighted median cut to 255. 0 is transparent. */
export function adaptivePNG(data: Uint32Array, w: number, h: number): Buffer {
  const counts = new Map<number, number>();
  for (const v of data) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  const unique = [...counts.keys()], channels = (c: number): [number, number, number] => [c & 255, (c >>> 8) & 255, (c >>> 16) & 255];
  const hex = (c: number) => '#' + channels(c).map((v) => v.toString(16).padStart(2, '0')).join('');
  let palette: string[], index: Map<number, number>;
  if (unique.length <= 255) { palette = ['#000000', ...unique.map(hex)]; index = new Map(unique.map((c, i) => [c, i + 1])); }
  else {
    // The 160 most common colours stay exact, so water, streets and roofs keep one colour across images; a per-image
    // cut of every colour moved the IJ to a lighter blue in one tile of the whole-city build (18 Nov 2026).
    const byCount = unique.sort((a, b) => counts.get(b)! - counts.get(a)!), exact = byCount.slice(0, 160), rest = byCount.slice(160);
    const cut = medianCut(rest.map((c) => ({ rgb: channels(c), weight: counts.get(c)! })), 255 - exact.length);
    palette = ['#000000', ...exact.map(hex), ...cut.palette];
    index = new Map([...exact.map((c, i) => [c, i + 1] as [number, number]), ...rest.map((c) => [c, exact.length + 1 + cut.nearest(channels(c))] as [number, number])]);
  }
  const px = new Uint8Array(w * h);
  for (let i = 0; i < px.length; i++) px[i] = data[i] ? index.get(data[i]!)! : 0;
  return writePNG(w, h, px, palette);
}

// ── façade design: the photo's facts, drawn as pixel art ────────────────────────────────────────────────────
// Judged climb (17 Nov 2026): straightened photo pixels read as smears at 0.47 m per pixel. Each wall is drawn from
// its own facts instead: wall, window and trim colours from its photo, the bay count and the storey rhythm that best
// match where its photo is dark (windows), and a shopfront where its ground floor is mostly glass.

export interface Design { wall: number; win: number; trim: number; bays: number; storey: number; ground: number; shop: boolean; blank: boolean; fromPhoto: boolean; crest?: Float32Array }

const packRgb = (c: number[]) => ((Math.round(c[0]!) | (Math.round(c[1]!) << 8) | (Math.round(c[2]!) << 16) | (0xff << 24)) >>> 0);
const unpack = (c: number) => [c & 255, (c >>> 8) & 255, (c >>> 16) & 255];
const packHex = (h: string) => packRgb([1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
// Front doors in Amsterdam door paint: dark green, navy, oxblood, black (the boats' colours, already in the palette).
const DOORS = ['#2f4a3c', '#3b4f6b', '#5b2f2a', '#2d2d33'].map(packHex);

/** A wall's design from its straightened photo views (raw texels), or a plain one with the given wall colour. */
export function designWall(L: number, H: number, f: Facade | undefined, fallbackWall: number, blank: boolean): Design {
  const plain = (wall: number): Design => {
    const [r, g, b] = unpack(wall);
    return legible({ wall, win: packRgb([r * 0.32, g * 0.34, b * 0.4]), trim: packRgb([236, 232, 222]), bays: Math.max(1, Math.round(L / 1.9)), storey: 3.2, ground: 3.8, shop: false, blank, fromPhoto: false });
  };
  if (!f || blank) return plain(fallbackWall);
  const idx: number[] = [];
  for (let t = 0; t < f.w * f.h; t++) if (f.ok[t]) idx.push(t);
  if (idx.length < 40) return plain(fallbackWall);
  const lum = (t: number) => 0.3 * f.rgb[t * 3]! + 0.59 * f.rgb[t * 3 + 1]! + 0.11 * f.rgb[t * 3 + 2]!;
  const ls = idx.map(lum).sort((a, b) => a - b), mid = ls[ls.length >> 1]!;
  const D = knob('darkStep', 22), Lt = knob('lightStep', 30);
  const tone = (ts: number[], sat: number, lift: number) => {
    const use = ts.length >= 5 ? ts : idx;
    const c = [0, 1, 2].map((ch) => use.map((t) => f.rgb[t * 3 + ch]!).sort((a, b) => a - b)[use.length >> 1]!);
    const grey = (c[0]! + c[1]! + c[2]!) / 3;
    return packRgb(c.map((v) => { const s = grey + (v - grey) * sat; return Math.max(0, Math.min(255, lift < 0 ? s * (1 + lift) : s + (255 - s) * lift)); }));
  };
  const dark = (t: number) => lum(t) < mid - D;
  const photoWall = tone(idx.filter((t) => Math.abs(lum(t) - mid) <= D), knob('facadeSat', 1.35), knob('wallLift', 0));
  // The photo picks the material; the material gives the clean colour (judged climb: grey winter light reads as mush).
  // White plaster only for a really bright photo wall (full belt, 17 Nov 2026: pale winter light turned brick houses
  // and the Noorderkerk white); otherwise the nearest brick or paint.
  const pw = unpack(photoWall) as [number, number, number], bright = 0.3 * pw[0] + 0.59 * pw[1] + 0.11 * pw[2] >= knob('plasterLum', 205);
  const wall = knob('wallMaterial', 1) ? packHex(nearestMaterial(pw, bright ? WALL_MATERIALS : WALL_MATERIALS.filter((h) => h !== '#e8e2d4'))) : photoWall;
  const win = tone(idx.filter(dark), 1.1, -knob('windowDarken', 0.3));
  const trim = tone(idx.filter((t) => lum(t) > mid + Lt), 1, knob('trimLighten', 0.2));
  // Dark share per column (bays) and per row (storeys), over seen texels.
  const col = new Float32Array(f.w), colN = new Float32Array(f.w), row = new Float32Array(f.h), rowN = new Float32Array(f.h);
  for (const t of idx) { const i = t % f.w, j = (t - i) / f.w, d = +dark(t); col[i] += d; colN[i]++; row[j] += d; rowN[j]++; }
  const contrast = (n: number, mask: (k: number) => boolean, v: Float32Array, w: Float32Array) => {
    let a = 0, an = 0, b = 0, bn = 0;
    for (let k = 0; k < n; k++) { if (!w[k]) continue; const x = v[k]! / w[k]!; if (mask(k)) { a += x; an++; } else { b += x; bn++; } }
    return an && bn ? a / an - b / bn : -1;
  };
  let bays = Math.max(1, Math.round(L / 1.9)), bestB = -1;
  for (let n = Math.max(1, Math.round(L / 2.8)); n <= Math.max(1, Math.round(L / 1.2)); n++) {
    const B = L / n, c = contrast(f.w, (i) => Math.abs((((i + 0.5) * TEXEL) % B) / B - 0.5) < 0.25, col, colN);
    if (c > bestB) { bestB = c; bays = n; }
  }
  const hAt = (j: number) => H - (j + 0.5) * TEXEL;
  let storey = 3.2, ground = 3.8, bestS = -1;
  for (let s = 2.8; s <= 3.81; s += 0.1) for (let g = 3; g <= 4.61; g += 0.2) {
    const c = contrast(f.h, (j) => { const z = hAt(j); if (z < g) return z > 0.9 && z < g - 0.6; const l = (z - g) % s; return l > 0.5 && l < s - 0.6; }, row, rowN);
    if (c > bestS) { bestS = c; storey = s; ground = g; }
  }
  let gd = 0, gn = 0;
  for (const t of idx) { const j = Math.floor(t / f.w), z = hAt(j); if (z > 0.4 && z < ground - 0.5) { gd += +dark(t); gn++; } }
  // The real top outline (gables): per column the highest seen texel that has two seen texels under it (sky and
  // occluded texels are not seen), median over five columns.
  const raw = new Float32Array(f.w).fill(NaN);
  for (let i = 0; i < f.w; i++) for (let j = 0; j < f.h - 2; j++) {
    if (f.ok[j * f.w + i] && f.ok[(j + 1) * f.w + i] && f.ok[(j + 2) * f.w + i]) { raw[i] = hAt(j); break; }
  }
  const crest = raw.map((_, i) => {
    const v = [-2, -1, 0, 1, 2].map((d) => raw[i + d]).filter((x): x is number => x !== undefined && Number.isFinite(x)).sort((a, b) => a - b);
    return v.length >= 3 ? v[v.length >> 1]! : NaN;
  });
  return legible({ wall, win, trim, bays, storey, ground, shop: gn > 20 && gd / gn > 0.5, blank: false, fromPhoto: true, crest });
}

/** Glass that reads on its wall (judged climb: dark windows vanished on dark brick): too close, it takes a pale sky reflection. */
function legible(d: Design): Design {
  const lum = (c: number) => { const [r, g, b] = unpack(c); return 0.3 * r! + 0.59 * g! + 0.11 * b!; };
  if (lum(d.wall) - lum(d.win) < knob('glassContrast', 55)) d.win = lum(d.wall) < 110 ? packHex('#9db3c2') : packRgb(unpack(d.win).map((v) => v * 0.5));
  return d;
}

/** The colour of a wall at u metres along it, h above the ground, top metres below its top. */
export function designColour(d: Design, L: number, u: number, h: number, top: number): number {
  const seam = knob('seam', 0.35);
  if (u < seam || u > L - seam) return dim(d.wall, 0.3); // the line between two houses
  if (d.blank) return d.wall; // a party wall above its neighbour: plain brick, no cornice
  if (top < 0.4) return d.trim; // cornice
  if (top < 0.9) return d.wall;
  const B = L / d.bays, local = u - Math.floor(u / B) * B, off = Math.abs(local - B / 2);
  const half = Math.max(0.4, knob('windowWidth', 0.21) * B);
  if (h < d.ground) {
    if (d.shop) return h > 0.3 && h < d.ground - 0.45 && off < 0.42 * B ? d.win : h >= d.ground - 0.45 && off < 0.42 * B ? d.trim : d.wall;
    // A front door every third bay (judged climb: streets read stamped, no doors), its bay and paint from the wall's
    // length, in a light frame under a fanlight.
    const pick = Math.floor(L * 3.7);
    if (Math.floor(u / B) % 3 === (d.bays < 3 ? 0 : pick % 3)) {
      const dh = Math.max(0.45, 0.27 * B), lintel = d.ground - 0.55;
      if (off < dh && h < lintel - 0.4) return DOORS[pick % DOORS.length]!;
      return off < dh + 0.3 && h < lintel ? d.trim : d.wall;
    }
    return h > 0.9 && h < d.ground - 0.6 && off < half ? d.win : d.wall;
  }
  const z = (h - d.ground) % d.storey;
  if (off >= half) return d.wall;
  const w0 = knob('windowSill', 0.7), w1 = d.storey - knob('windowHead', 0.85);
  if (z > w0 && z < w1) return d.win;
  if ((z >= w1 && z < w1 + 0.35) || (z > w0 - 0.3 && z <= w0)) return d.trim; // lintel and sill
  return d.wall;
}
function dim(c: number, t: number) { return packRgb(unpack(c).map((v) => v * (1 - t))); }
