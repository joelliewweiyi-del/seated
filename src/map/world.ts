// The world: Amsterdam as a grid of 16 m tiles (built by scripts/map-world.ts from OpenStreetMap), and the
// isometric projection. Grid x runs east, y runs south; on screen north-west is up.

export const T = { land: 0, water: 1, park: 2, road: 3, street: 4, square: 5, rail: 6, wood: 7, field: 8, industry: 9, sand: 10 } as const;
export const F = { bridge: 1, tram: 2, ferry: 4, railLine: 8, quay: 16 } as const;
/** Building styles: canal houses, 19th-century brick rows, modern blocks, warehouses. */
export const S = { canal: 0, brick: 1, modern: 2, warehouse: 3 } as const;

/** Tile size on screen at zoom 1, and the room left above each chunk for buildings and trees. */
export const TW = 32;
export const TH = 16;
export const HEAD = 112;

export interface WorldMeta {
  cols: number;
  rows: number;
  tileMeters: number;
  bbox: { south: number; west: number; north: number; east: number };
  mPerDegLat: number;
  mPerDegLng: number;
  attribution: string;
}

export class World {
  readonly cols: number;
  readonly rows: number;
  /** Screen x of tile (0, 0)'s top corner, so the whole map has x >= 0. */
  readonly originX: number;
  readonly width: number;
  readonly height: number;
  /** Restaurant tiles: their building gets a storefront. */
  readonly special = new Map<number, string>();

  constructor(
    readonly meta: WorldMeta,
    private readonly bytes: Uint8Array,
  ) {
    this.cols = meta.cols;
    this.rows = meta.rows;
    this.originX = this.rows * (TW / 2);
    this.width = (this.cols + this.rows) * (TW / 2);
    this.height = (this.cols + this.rows) * (TH / 2) + HEAD;
  }

  static async load(base = './'): Promise<World> {
    const [meta, bin] = await Promise.all([
      fetch(`${base}world.json`).then((r) => r.json() as Promise<WorldMeta>),
      fetch(`${base}world.bin`).then((r) => r.arrayBuffer()),
    ]);
    return new World(meta, new Uint8Array(bin));
  }

  /** The raw tile bytes, to hand to the painter workers. */
  get raw(): Uint8Array {
    return this.bytes;
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.cols && y < this.rows;
  }

  /** Outside the grid is open water (the IJmeer and the edges): it frames the map. */
  terrain(x: number, y: number): number {
    return this.inside(x, y) ? this.bytes[(y * this.cols + x) * 2]! & 15 : T.water;
  }

  style(x: number, y: number): number {
    return this.inside(x, y) ? this.bytes[(y * this.cols + x) * 2]! >> 4 : S.modern;
  }

  flags(x: number, y: number): number {
    return this.inside(x, y) ? this.bytes[(y * this.cols + x) * 2 + 1]! : 0;
  }

  /** Land that carries a building (not a courtyard). Courtyards are decided by the painter, see paint.ts. */
  isBuilt(x: number, y: number): boolean {
    const t = this.terrain(x, y);
    return t === T.land || t === T.industry;
  }

  isStreetLike(x: number, y: number): boolean {
    const t = this.terrain(x, y);
    return t === T.street || t === T.road || t === T.square;
  }

  /** lat/lng -> fractional tile. */
  tileOf(lat: number, lng: number): { x: number; y: number } {
    const { bbox, mPerDegLat, mPerDegLng, tileMeters } = this.meta;
    return { x: ((lng - bbox.west) * mPerDegLng) / tileMeters, y: ((bbox.north - lat) * mPerDegLat) / tileMeters };
  }

  /** Tile -> screen position of its top corner at zoom 1. */
  screenOf(x: number, y: number): { sx: number; sy: number } {
    return { sx: this.originX + (x - y) * (TW / 2), sy: HEAD + (x + y) * (TH / 2) };
  }

  /** Screen point at zoom 1 -> fractional tile. */
  tileAt(sx: number, sy: number): { x: number; y: number } {
    const a = (sx - this.originX) / (TW / 2);
    const b = (sy - HEAD) / (TH / 2);
    return { x: (a + b) / 2, y: (b - a) / 2 };
  }

  /** The nearest built tile to a point, so a restaurant sits in a building, not in the canal. */
  nearestBuilt(x: number, y: number): { x: number; y: number } {
    const fx = Math.floor(x);
    const fy = Math.floor(y);
    for (let r = 0; r < 6; r++) {
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
}
