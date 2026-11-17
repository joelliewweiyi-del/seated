// Canal sample: buildings drawn from 3DBAG's LoD 2.2 models (real roof planes, ridges and gables), not from 0.94 m
// cells (judged climb, 17 Nov 2026: every slope on the cell grid came out as sawtooth edges). Each face is filled as a
// polygon with a depth buffer; a pixel-art pass then marks where one house meets the next and where a wall meets its roof.
// 3DBAG by the 3D geoinformation group, TU Delft, and 3DGI: CC BY 4.0 (https://docs.3dbag.nl/en/copyright/).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

const VERSION = 'v20250903';
const INDEX = `https://data.3dbag.nl/${VERSION}/tile_index.fgb`;

export interface Face { roof: boolean; rings: number[][][] } // RD x, y and metres above the building's ground
export interface Building { id: string; faces: Face[] }

/**
 * Every 3DBAG building with a LoD 2.2 model inside the box. Tiles come from the tile index (its download links); a
 * tile's id is level/x/y, and its south-west corner is RD (x * 250 + 13593, y * 250 + 306890), 500 m wide at level 10
 * and twice that per level up (checked against the index's own boxes for levels 9 and 10, 17 Nov 2026).
 */
export async function loadBag3d(cache: string, box: { x0: number; y0: number; x1: number; y1: number }, download: (url: string) => Promise<Response>): Promise<Building[]> {
  const dir = join(cache, 'bag3d-lod22');
  mkdirSync(dir, { recursive: true });
  const indexFile = join(dir, 'tile_index.fgb');
  if (!existsSync(indexFile)) writeFileSync(indexFile, Buffer.from(await (await download(INDEX)).arrayBuffer()));
  const urls = [...new Set(readFileSync(indexFile).toString('latin1').match(/https:\/\/[\w./-]+\.city\.json\.gz/g) ?? [])];
  const tiles = urls.filter((u) => {
    const [, l, x, y] = u.match(/tiles\/(\d+)\/(\d+)\/(\d+)\//)!.map(Number) as [number, number, number, number];
    const size = 500 * 2 ** (10 - l), mx = x * 250 + 13593, my = y * 250 + 306890;
    return mx < box.x1 && mx + size > box.x0 && my < box.y1 && my + size > box.y0;
  });
  if (!tiles.length) throw new Error('No 3DBAG tile covers the canal box: the tile index format may have changed. Check ' + INDEX + ' and the tile formula in scripts/canal-mesh.ts.');
  const out: Building[] = [];
  for (const url of tiles) {
    const file = join(dir, url.split('/').at(-1)!);
    if (!existsSync(file)) writeFileSync(file, Buffer.from(await (await download(url)).arrayBuffer()));
    const raw = readFileSync(file), cj = JSON.parse((raw[0] === 0x1f ? gunzipSync(raw) : raw).toString('utf8')); // fetch may have unpacked it
    const [sx, sy, sz] = cj.transform.scale as number[], [tx, ty, tz] = cj.transform.translate as number[];
    const V = cj.vertices as number[][];
    for (const [id, o] of Object.entries<any>(cj.CityObjects)) {
      if (o.type !== 'Building') continue;
      const ground = o.attributes?.b3_h_maaiveld;
      if (typeof ground !== 'number') continue;
      const faces: Face[] = [];
      for (const child of o.children ?? []) {
        const g = (cj.CityObjects[child]?.geometry ?? []).find((g: any) => g.lod === '2.2');
        if (!g || g.type !== 'Solid') continue;
        const types = g.semantics.surfaces.map((s: any) => s.type);
        g.boundaries[0].forEach((surface: number[][], i: number) => {
          const type = types[g.semantics.values[0][i]];
          if (type !== 'RoofSurface' && type !== 'WallSurface') return;
          faces.push({ roof: type === 'RoofSurface', rings: surface.map((ring) => ring.map((v) => [V[v]![0]! * sx! + tx!, V[v]![1]! * sy! + ty!, V[v]![2]! * sz! + tz! - ground])) });
        });
      }
      if (faces.length) out.push({ id: id.replace(/-\d+$/, ''), faces });
    }
  }
  return out;
}

export interface Raster { w: number; h: number; colour: Uint32Array; depth: Float32Array; owner: Int32Array; kind: Uint8Array }

/**
 * Fills every face that faces the viewer. `project` gives screen x, y and depth (larger is nearer) of an RD point;
 * `paint` the colour of a face at a pixel, given the point's RD x, y and height and the face's normal.
 */
export function rasterize(buildings: Building[], w: number, h: number, project: (x: number, y: number, z: number) => [number, number, number], paint: (b: number, face: Face, n: [number, number, number], x: number, y: number, z: number) => number, viewer: [number, number, number]): Raster {
  const colour = new Uint32Array(w * h), depth = new Float32Array(w * h).fill(-Infinity), owner = new Int32Array(w * h).fill(-1), kind = new Uint8Array(w * h);
  buildings.forEach((b, bi) => {
    for (const face of b.faces) {
      const outer = face.rings[0]!;
      if (outer.length < 3) continue;
      // Newell normal: robust for any planar polygon.
      let nx = 0, ny = 0, nz = 0;
      for (let i = 0; i < outer.length; i++) {
        const p = outer[i]!, q = outer[(i + 1) % outer.length]!;
        nx += (p[1]! - q[1]!) * (p[2]! + q[2]!); ny += (p[2]! - q[2]!) * (p[0]! + q[0]!); nz += (p[0]! - q[0]!) * (p[1]! + q[1]!);
      }
      const len = Math.hypot(nx, ny, nz);
      if (!len) continue;
      const n: [number, number, number] = [nx / len, ny / len, nz / len];
      if (n[0] * viewer[0] + n[1] * viewer[1] + n[2] * viewer[2] <= 0.02) continue; // back face or edge-on
      const rings = face.rings.map((r) => r.map((p) => project(p[0]!, p[1]!, p[2]!)));
      // Screen is an affine image of the face's plane: solve x, y, z and depth as affine functions of screen x, y.
      const sp = rings[0]!, wp = outer;
      let best = 0, ia = 0, ib = 1, ic = 2;
      for (let j = 1; j < sp.length - 1; j++) for (let k = j + 1; k < sp.length; k++) {
        const a = Math.abs((sp[j]![0]! - sp[0]![0]!) * (sp[k]![1]! - sp[0]![1]!) - (sp[k]![0]! - sp[0]![0]!) * (sp[j]![1]! - sp[0]![1]!));
        if (a > best) { best = a; ia = 0; ib = j; ic = k; }
      }
      if (best < 1e-6) continue;
      const P = [sp[ia]!, sp[ib]!, sp[ic]!], W = [wp[ia]!, wp[ib]!, wp[ic]!];
      const det = (P[1]![0]! - P[0]![0]!) * (P[2]![1]! - P[0]![1]!) - (P[2]![0]! - P[0]![0]!) * (P[1]![1]! - P[0]![1]!);
      const affine = (v: [number, number, number]) => {
        const a = ((v[1] - v[0]) * (P[2]![1]! - P[0]![1]!) - (v[2] - v[0]) * (P[1]![1]! - P[0]![1]!)) / det;
        const c = ((v[2] - v[0]) * (P[1]![0]! - P[0]![0]!) - (v[1] - v[0]) * (P[2]![0]! - P[0]![0]!)) / det;
        return [a, c, v[0] - a * P[0]![0]! - c * P[0]![1]!] as const;
      };
      const fx = affine([W[0]![0]!, W[1]![0]!, W[2]![0]!]), fy = affine([W[0]![1]!, W[1]![1]!, W[2]![1]!]), fz = affine([W[0]![2]!, W[1]![2]!, W[2]![2]!]), fd = affine([P[0]![2]!, P[1]![2]!, P[2]![2]!]);
      // Scanline fill, even-odd over all rings (courtyards are holes), at pixel centres.
      let minY = Infinity, maxY = -Infinity;
      for (const r of rings) for (const p of r) { minY = Math.min(minY, p[1]!); maxY = Math.max(maxY, p[1]!); }
      for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(h - 1, Math.ceil(maxY)); y++) {
        const cy = y + 0.5, xs: number[] = [];
        for (const r of rings) for (let i = 0; i < r.length; i++) {
          const [ax, ay] = r[i]!, [bx, by] = r[(i + 1) % r.length]!;
          if (ay! <= cy !== by! <= cy) xs.push(ax! + ((cy - ay!) / (by! - ay!)) * (bx! - ax!));
        }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          for (let x = Math.max(0, Math.ceil(xs[k]! - 0.5)); x <= Math.min(w - 1, Math.floor(xs[k + 1]! - 0.5)); x++) {
            const cx = x + 0.5, i = y * w + x, d = fd[0] * cx + fd[1] * cy + fd[2];
            if (d <= depth[i]!) continue;
            depth[i] = d; owner[i] = bi; kind[i] = face.roof ? 1 : 2;
            colour[i] = paint(bi, face, n, fx[0] * cx + fx[1] * cy + fx[2], fy[0] * cx + fy[1] * cy + fy[2], fz[0] * cx + fz[1] * cy + fz[2]);
          }
        }
      }
    }
  });
  return { w, h, colour, depth, owner, kind };
}

/**
 * The pixel-art pass: a wall pixel under anything that is not its own wall is the cornice (light trim), and a pixel
 * whose left or upper neighbour is another building, nearer or farther, gets the dark line between houses.
 */
export function outline(r: Raster, trim: (c: number) => number, seam: (c: number) => number): void {
  const { w, h, colour, owner, kind } = r, out = colour.slice();
  for (let y = 1; y < h; y++) for (let x = 1; x < w; x++) {
    const i = y * w + x, o = owner[i]!;
    if (o < 0) continue;
    const up = i - w, left = i - 1;
    if ((owner[up]! >= 0 && owner[up] !== o) || (owner[left]! >= 0 && owner[left] !== o)) out[i] = seam(colour[i]!);
    else if (kind[i] === 2 && !(kind[up] === 2 && owner[up] === o)) out[i] = trim(colour[i]!);
  }
  colour.set(out);
}

/**
 * Canal gables (judged climb: no stepped or bell gables). 3DBAG models the roof, not the gable ornament, and cuts a
 * gable wall into pieces at the ridge: the wall pieces of a building in one plane are taken together, and a narrow one
 * (at most 12 m) whose top rises at least 1.5 m from its ends gets a gable in that plane, by `style`: 0 step, 1 neck,
 * 2 bell (judged climb: read as tunnels, unused), 3 spout; up to 0.8 m over the ridge.
 */
export function addGables(b: Building, style: (wall: number) => number): number {
  const planes: Array<{ a: number; off: number; pts: number[][] }> = [];
  for (const f of b.faces) {
    if (f.roof) continue;
    const r = f.rings[0]!;
    let nx = 0, ny = 0;
    for (let i = 0; i < r.length; i++) { const p = r[i]!, q = r[(i + 1) % r.length]!; nx += (p[1]! - q[1]!) * (p[2]! + q[2]!); ny += (p[2]! - q[2]!) * (p[0]! + q[0]!); }
    const len = Math.hypot(nx, ny);
    if (len < 1e-6) continue;
    const o = b.faces[0]!.rings[0]![0]!; // offsets from the building itself: from RD's origin a 1 degree tilt moves them kilometres
    const a = Math.atan2(ny, nx), off = ((r[0]![0]! - o[0]!) * nx + (r[0]![1]! - o[1]!) * ny) / len;
    const same = planes.find((pl) => Math.abs(Math.atan2(Math.sin(pl.a - a), Math.cos(pl.a - a))) < 0.06 && Math.abs(pl.off - off) < 0.4);
    if (same) same.pts.push(...r); else planes.push({ a, off, pts: [...r] });
  }
  let added = 0;
  for (const { pts: r } of planes) {
    const zb = Math.min(...r.map((p) => p[2]!)), top = r.filter((p) => p[2]! > zb + 1);
    if (top.length < 2) continue;
    const low = r.reduce((a, p) => (p[2]! < a[2]! ? p : a)), far = r.reduce((a, p) => (Math.hypot(p[0]! - low[0]!, p[1]! - low[1]!) > Math.hypot(a[0]! - low[0]!, a[1]! - low[1]!) ? p : a));
    const L0 = Math.hypot(far[0]! - low[0]!, far[1]! - low[1]!);
    if (L0 < 2) continue;
    const dx = (far[0]! - low[0]!) / L0, dy = (far[1]! - low[1]!) / L0;
    const uOf = (p: number[]) => (p[0]! - low[0]!) * dx + (p[1]! - low[1]!) * dy;
    const us = r.map(uOf), u0 = Math.min(...us), u1 = Math.max(...us), L = u1 - u0;
    if (L > 12 || L < 3) continue;
    const ends = top.filter((p) => uOf(p) - u0 < 0.5 || u1 - uOf(p) < 0.5);
    const ridge = Math.max(...top.map((p) => p[2]!)), eave = ends.length ? Math.max(...ends.map((p) => p[2]!)) : ridge;
    const rise = ridge - eave;
    if (rise < 1.5) continue;
    const s = style(added), pts: number[][] = [];
    const at = (u: number, z: number) => [low[0]! + dx * u, low[1]! + dy * u, z];
    pts.push(at(u0, eave));
    for (let j = 0; j <= 24; j++) {
      const u = u0 + (L * j) / 24, t = Math.min(1, Math.abs(u - (u0 + L / 2)) / (L / 2));
      const z = s === 0 ? eave + (rise + 0.8) * Math.ceil((1 - t) * 3.999) / 4
        : s === 1 ? (t < 0.3 ? ridge + 0.8 : eave + rise * 0.55 * Math.max(0, 1 - (t - 0.3) / 0.7))
        : s === 2 ? eave + (rise + 0.8) * Math.sqrt(Math.max(0, 1 - t * t))
        : eave + (rise + 0.4) * (1 - t);
      if (s === 0 && j > 0) pts.push(at(u, pts.at(-1)![2]!)); // a step: across, then up
      pts.push(at(u, z));
    }
    pts.push(at(u1, eave));
    // Winding: the same side as the plane's own pieces, so it faces the same way.
    b.faces.push({ roof: false, rings: [orient(pts, r)] });
    added++;
  }
  return added;
}

/** `pts` wound so its normal points the same way as the wall pieces' (their first vertices give the plane's side). */
function orient(pts: number[][], ref: number[][]): number[][] {
  const n = (r: number[][]) => { let nx = 0, ny = 0; for (let i = 0; i < r.length; i++) { const p = r[i]!, q = r[(i + 1) % r.length]!; nx += (p[1]! - q[1]!) * (p[2]! + q[2]!); ny += (p[2]! - q[2]!) * (p[0]! + q[0]!); } return [nx, ny]; };
  const a = n(pts), b = n(ref.slice(0, 4));
  return a[0]! * b[0]! + a[1]! * b[1]! < 0 ? pts.reverse() : pts;
}
