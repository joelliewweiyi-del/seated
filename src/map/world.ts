// The city layer: Amsterdam as drawn by sezlab (sezlab.dev/amsterdam), used with permission (Joel, 5 Nov 2026).
// scripts/map-sez-sync.ts copies his images and writes sez/manifest.json; this file places things on them.
// His projection: RD New metres from his origin (x east, y north), PX = (x + y) / sqrt 2, PY = (x - y) / (2 sqrt 2)
// - h * VZ. North-west is up. One world pixel here is one pixel of his sharpest images (3 per unit of his).
import { wgsToRd } from '../shared/rd';

export interface Level {
  w: number;
  h: number;
  /** Chunk size in image pixels. */
  cs: number;
  chunks: Array<[number, number]>;
}

export interface SezManifest {
  source: string;
  credit: string;
  version: string;
  X0: number;
  Y0: number;
  X1: number;
  Y1: number;
  VZ: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Image levels at 1/2, 1/4 and 1/8 of the sharpest; the last is one image. */
  levels: Level[];
  hi: Level;
  /** Where the art is drawn: mw x mh cells of `cell` world pixels, base64 bits, row-major. */
  mask: { mw: number; mh: number; cell: number; bits: string };
}

const R2 = Math.SQRT1_2;

export class World {
  /** World pixels per unit of his projection. */
  readonly scale: number;
  readonly width: number;
  readonly height: number;
  private readonly sets: Array<Set<string>>;
  private readonly mask: Uint8Array;

  constructor(
    readonly meta: SezManifest,
    readonly base = './sez/',
  ) {
    this.scale = meta.hi.w / meta.w;
    this.width = meta.hi.w;
    this.height = meta.hi.h;
    this.sets = [...meta.levels, meta.hi].map((l) => new Set(l.chunks.map(([x, y]) => `${x}_${y}`)));
    this.mask = Uint8Array.from(atob(meta.mask.bits), (ch) => ch.charCodeAt(0));
  }

  static async load(base = './sez/'): Promise<World> {
    const res = await fetch(`${base}manifest.json`);
    if (!res.ok) throw new Error(`the city map answered ${res.status}`);
    return new World((await res.json()) as SezManifest, base);
  }

  /** A point at `metres` above the ground -> world pixels. */
  project(lat: number, lng: number, metres = 0): { x: number; y: number } {
    const { x: rx, y: ry } = wgsToRd(lat, lng);
    const x = rx - this.meta.X0;
    const y = ry - this.meta.Y0;
    const px = (x + y) * R2;
    const py = (x - y) * R2 * 0.5 - metres * this.meta.VZ;
    return { x: (px - this.meta.x) * this.scale, y: (py - this.meta.y) * this.scale };
  }

  /** Whether his art is drawn at a place (it follows the city's outline, so the RD box alone is not enough). */
  covers(lat: number, lng: number): boolean {
    const { x, y } = this.project(lat, lng);
    const { mw, mh, cell } = this.meta.mask;
    const mx = Math.floor(x / cell);
    const my = Math.floor(y / cell);
    if (mx < 0 || my < 0 || mx >= mw || my >= mh) return false;
    const i = my * mw + mx;
    return !!(this.mask[i >> 3]! & (1 << (i & 7)));
  }

  /**
   * Level 'hi' (1:1), 0 (1/2), 1 (1/4) or 2 (the one overview image, 1/8): its image pixels per world pixel, the
   * world pixels one chunk covers, and whether a chunk exists (open water and the edges have none).
   */
  level(L: 'hi' | 0 | 1 | 2): { k: number; span: number; has: (cx: number, cy: number) => boolean; url: (cx: number, cy: number) => string } {
    const lv = L === 'hi' ? this.meta.hi : this.meta.levels[L]!;
    const set = this.sets[L === 'hi' ? 3 : L]!;
    const k = lv.w / this.width;
    const name = (cx: number, cy: number) => (L === 2 ? '2' : `${L === 'hi' ? 'h' : L}_${cx}_${cy}`);
    return { k, span: lv.cs / k, has: (cx, cy) => set.has(`${cx}_${cy}`), url: (cx, cy) => `${this.base}${this.meta.version}/${name(cx, cy)}.png` };
  }
}
