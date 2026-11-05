// The world: Amsterdam as a grid of 4 m cells (built by scripts/map-world.ts from OpenStreetMap, 3DBAG and the PDOK
// aerial photo), and the isometric projection. Grid x runs east, y runs south; on screen north-west is up.
// Four planes of one byte per cell: terrain and flags, building height, roof colour, and building or ground details.

export const T = { land: 0, water: 1, park: 2, road: 3, street: 4, square: 5, rail: 6, wood: 7, field: 8, industry: 9, sand: 10, pavement: 11, garden: 12 } as const;
export const F = { bridge: 1, tram: 2, ferry: 4, railLine: 8 } as const;

/** One cell on screen at zoom 1, and the room left above each chunk for tall buildings and trees. */
export const TW = 8;
export const TH = 4;
export const HEAD = 160;
/** Screen pixels per metre of building height: a touch taller than true, as pixel cities are. */
export const PX_PER_M = 1.25;

export interface WorldMeta {
  cols: number;
  rows: number;
  cellMeters: number;
  bbox: { south: number; west: number; north: number; east: number };
  mPerDegLat: number;
  mPerDegLng: number;
  roofPalette: string[];
  attribution: string;
}

/** Building periods (meta bits 0-2): before 1800, 1800s, 1900-1944, 1945-1979, 1980-1999, 2000 on, unknown. */
export const AGE = { none: 0, old: 1, c19: 2, early20: 3, postwar: 4, late20: 5, new: 6, unknown: 7 } as const;

/**
 * A rectangle of the world: the whole city on the page, a chunk plus a border in a painter worker. Outside the
 * rectangle is open water with nothing on it, which frames the map.
 */
export class World {
  readonly cols: number;
  readonly rows: number;
  /** Screen x of cell (0, 0)'s top corner, so the whole map has x >= 0. */
  readonly originX: number;
  readonly width: number;
  readonly height: number;

  constructor(
    readonly meta: WorldMeta,
    /** terrain, height, roof, details: four planes of w x h bytes. */
    private readonly planes: Uint8Array,
    private readonly ox = 0,
    private readonly oy = 0,
    private readonly w = meta.cols,
    private readonly h = meta.rows,
  ) {
    this.cols = meta.cols;
    this.rows = meta.rows;
    this.originX = this.rows * (TW / 2);
    this.width = (this.cols + this.rows) * (TW / 2);
    this.height = (this.cols + this.rows) * (TH / 2) + HEAD;
  }

  static async load(base = './'): Promise<World> {
    const [meta, bytes] = await Promise.all([
      fetch(`${base}world.json`).then((r) => r.json() as Promise<WorldMeta>),
      fetch(`${base}world.bin`).then((r) => gunzip(r)),
    ]);
    return new World(meta, bytes);
  }

  /** The planes of a rectangle, to hand to a painter worker. */
  slice(x0: number, y0: number, w: number, h: number): Uint8Array {
    const out = new Uint8Array(w * h * 4);
    for (let p = 0; p < 4; p++) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) out[p * w * h + y * w + x] = this.byte(p, x0 + x, y0 + y);
      }
    }
    return out;
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.cols && y < this.rows;
  }

  private byte(plane: number, x: number, y: number): number {
    const lx = x - this.ox;
    const ly = y - this.oy;
    if (lx < 0 || ly < 0 || lx >= this.w || ly >= this.h || !this.inside(x, y)) return plane === 0 ? T.water : 0;
    return this.planes[plane * this.w * this.h + ly * this.w + lx]!;
  }

  terrain(x: number, y: number): number {
    return this.byte(0, x, y) & 15;
  }

  flags(x: number, y: number): number {
    return this.byte(0, x, y) >> 4;
  }

  /** Building height in metres above the ground; 0 where there is no building. */
  heightM(x: number, y: number): number {
    return this.byte(1, x, y) / 2;
  }

  /** Building height in screen pixels at zoom 1. */
  heightPx(x: number, y: number): number {
    return Math.min(HEAD - 6, Math.round(this.heightM(x, y) * PX_PER_M));
  }

  /** Index into meta.roofPalette. */
  roof(x: number, y: number): number {
    return this.byte(2, x, y);
  }

  /** Buildings: age (bits 0-2), pitched roof (bit 3), seed (bits 4-7). Ground: a tree (bit 0). */
  details(x: number, y: number): number {
    return this.byte(3, x, y);
  }

  isBuilt(x: number, y: number): boolean {
    return this.byte(1, x, y) > 0;
  }

  isWater(x: number, y: number): boolean {
    return this.terrain(x, y) === T.water && !(this.flags(x, y) & F.bridge) && !this.isBuilt(x, y);
  }

  isStreetLike(x: number, y: number): boolean {
    const t = this.terrain(x, y);
    return !this.isBuilt(x, y) && (t === T.street || t === T.road || t === T.square || t === T.pavement);
  }

  /** lat/lng -> fractional cell. */
  tileOf(lat: number, lng: number): { x: number; y: number } {
    const { bbox, mPerDegLat, mPerDegLng, cellMeters } = this.meta;
    return { x: ((lng - bbox.west) * mPerDegLng) / cellMeters, y: ((bbox.north - lat) * mPerDegLat) / cellMeters };
  }

  /** Cell -> screen position of its top corner at zoom 1. */
  screenOf(x: number, y: number): { sx: number; sy: number } {
    return { sx: this.originX + (x - y) * (TW / 2), sy: HEAD + (x + y) * (TH / 2) };
  }

  /** Screen point at zoom 1 -> fractional cell. */
  tileAt(sx: number, sy: number): { x: number; y: number } {
    const a = (sx - this.originX) / (TW / 2);
    const b = (sy - HEAD) / (TH / 2);
    return { x: (a + b) / 2, y: (b - a) / 2 };
  }

  /** The nearest building cell to a point (within 40 m), so a restaurant sits in a building, not in the canal. */
  nearestBuilt(x: number, y: number): { x: number; y: number } {
    const fx = Math.floor(x);
    const fy = Math.floor(y);
    for (let r = 0; r < 10; r++) {
      let best: { x: number; y: number; d: number } | null = null;
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = fx + dx;
          const ty = fy + dy;
          if (!this.isBuilt(tx, ty)) continue;
          const d = Math.hypot(tx + 0.5 - x, ty + 0.5 - y);
          if (!best || d < best.d) best = { x: tx, y: ty, d };
        }
      }
      if (best) return { x: best.x, y: best.y };
    }
    return { x: fx, y: fy };
  }

  /**
   * The cells of the building at a cell: the connected cells with the same roof colour and seed (one 3DBAG building
   * keeps both), at most `max`. A restaurant's storefront goes on all of them.
   */
  buildingAt(x: number, y: number, max = 60): number[] {
    if (!this.isBuilt(x, y)) return [];
    const key = (cx: number, cy: number) => this.roof(cx, cy) * 16 + (this.details(cx, cy) >> 4);
    const want = key(x, y);
    const seen = new Set<number>([y * this.cols + x]);
    const queue: Array<[number, number]> = [[x, y]];
    for (let q = 0; q < queue.length && seen.size < max; q++) {
      const [cx, cy] = queue[q]!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = cx + dx;
        const ny = cy + dy;
        const i = ny * this.cols + nx;
        if (seen.has(i) || !this.isBuilt(nx, ny) || key(nx, ny) !== want) continue;
        seen.add(i);
        queue.push([nx, ny]);
        if (seen.size >= max) break;
      }
    }
    return [...seen];
  }
}

/** world.bin is gzip: the browser unpacks it natively. */
async function gunzip(res: Response): Promise<Uint8Array> {
  if (!res.ok || !res.body) throw new Error(`world.bin answered ${res.status}`);
  const stream = res.body.pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
