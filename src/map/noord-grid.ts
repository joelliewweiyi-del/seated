// The pre-sez grid model, retained for the build-time Noord painter. Cells are now 1.885618 m on RD axes,
// built by scripts/map-noord.ts from OpenStreetMap, 3DBAG and PDOK. Grid x runs east, y south.
// Four planes of one byte per cell: terrain and flags, building height, roof colour, and building or ground details.

export const T = { land: 0, water: 1, park: 2, road: 3, street: 4, square: 5, rail: 6, wood: 7, field: 8, industry: 9, sand: 10, pavement: 11, garden: 12, stone: 13 } as const;
export const F = { bridge: 1, tram: 2, ferry: 4, railLine: 8 } as const;

/** One cell in level-0 pixels, and the room above the ground for buildings and trees. */
export const TW = 4;
export const TH = 2;
export const HEAD = 160;
/** Exactly sezlab’s level-0 pixels per metre of height. */
export const PX_PER_M = 1.5 * 0.866;

export interface WorldMeta {
  cols: number;
  rows: number;
  cellMeters: number;
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
    readonly features?: { shore: Uint8Array; building: Uint32Array; industrial: Uint8Array; facade: Uint8Array },
  ) {
    this.cols = meta.cols;
    this.rows = meta.rows;
    this.originX = this.rows * (TW / 2);
    this.width = (this.cols + this.rows) * (TW / 2);
    this.height = (this.cols + this.rows) * (TH / 2) + HEAD;
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

  /** Building height in level-0 pixels. */
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

  shoreDistance(x: number, y: number): number {
    return this.features?.shore[y * this.cols + x] ?? 255;
  }

  buildingSeed(x: number, y: number): number {
    return this.features?.building[y * this.cols + x] ?? (this.details(x, y) >> 4);
  }

  /** Quantized normal of the actual 3DBAG footprint edge (0 = no exposed source edge). */
  facadeShade(x: number, y: number): number {
    return this.features?.facade[y * this.cols + x] ?? 0;
  }

  industrial(x: number, y: number): boolean {
    return !!this.features?.industrial[y * this.cols + x];
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

}

/**
 * Where our drawing is needed: every pixel of his overview that is transparent, and opaque pixels within `margin`
 * pixels of one (so our ground runs a little way under his edge and no seam opens). 1 = keep ours, 0 = his art
 * covers it anyway. Outside his image counts as transparent.
 */
export function gapMask(alpha: Uint8Array, w: number, h: number, margin: number): Uint8Array {
  const dist = new Uint16Array(w * h).fill(65535);
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  for (let i = 0; i < w * h; i++) {
    const x = i % w, y = (i - x) / w;
    if (!alpha[i]) dist[i] = 0;
    else if (x === 0 || y === 0 || x === w - 1 || y === h - 1) dist[i] = 1;
    else continue;
    queue[tail++] = i;
  }
  while (head < tail) {
    const i = queue[head++]!, d = dist[i]!;
    if (d >= margin) continue;
    const x = i % w, y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (dist[j]! > d + 1) { dist[j] = d + 1; queue[tail++] = j; }
    }
  }
  return Uint8Array.from(dist, (d) => +(d <= margin));
}
