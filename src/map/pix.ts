// A tiny software rasterizer for crisp pixel art. Canvas paths are anti-aliased, which blurs pixel art,
// so every sprite and map chunk is drawn here, pixel by pixel, and handed to a canvas as ImageData.

/** "#rrggbb" -> packed ABGR (the byte order of ImageData on little-endian machines). */
export function rgb(hex: string, alpha = 255): number {
  const n = parseInt(hex.slice(1), 16);
  return ((alpha << 24) | ((n & 0xff) << 16) | (n & 0xff00) | ((n >> 16) & 0xff)) >>> 0;
}

/** Mixes two packed colours: t = 0 gives a, 1 gives b. */
export function mix(a: number, b: number, t: number): number {
  const ch = (c: number, s: number) => (c >>> s) & 0xff;
  const m = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t) << s;
  return (m(0) | m(8) | m(16) | (0xff << 24)) >>> 0;
}

export const darken = (c: number, t: number) => mix(c, rgb('#1d1a24'), t);
export const lighten = (c: number, t: number) => mix(c, rgb('#ffffff'), t);

export class Pix {
  readonly data: Uint32Array;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Uint32Array(w * h);
  }

  set(x: number, y: number, c: number): void {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    if (c >>> 24 === 255) this.data[y * this.w + x] = c;
    else if (c >>> 24 > 0) this.data[y * this.w + x] = mix(this.data[y * this.w + x]! | 0xff000000, c | 0xff000000, (c >>> 24) / 255);
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.data[y * this.w + x]!;
  }

  rect(x: number, y: number, w: number, h: number, c: number): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }

  /** A horizontal run, x0..x1 inclusive. */
  hline(x0: number, x1: number, y: number, c: number): void {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, c);
  }

  vline(x: number, y0: number, y1: number, c: number): void {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) this.set(x, y, c);
  }

  /** Bresenham line. */
  line(x0: number, y0: number, x1: number, y1: number, c: number): void {
    x0 |= 0;
    y0 |= 0;
    x1 |= 0;
    y1 |= 0;
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, c);
      if (x0 === x1 && y0 === y1) return;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  /**
   * Fills a polygon at pixel centres. `paint` can return a colour per pixel (textures, dithering).
   * Points are [x, y] in pixels; edges may be fractional.
   */
  poly(pts: Array<[number, number]>, paint: number | ((x: number, y: number) => number)): void {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, y] of pts) [minY, maxY] = [Math.min(minY, y), Math.max(maxY, y)];
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(this.h - 1, Math.ceil(maxY));
    for (let y = y0; y <= y1; y++) {
      const cy = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i]!;
        const [bx, by] = pts[(i + 1) % pts.length]!;
        if (ay <= cy !== by <= cy) xs.push(ax + ((cy - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.ceil(xs[k]! - 0.5));
        const xb = Math.min(this.w - 1, Math.floor(xs[k + 1]! - 0.5));
        for (let x = xa; x <= xb; x++) this.set(x, y, typeof paint === 'number' ? paint : paint(x, y));
      }
    }
  }

  /** Copies another buffer in, skipping transparent pixels. */
  blit(src: Pix, dx: number, dy: number): void {
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const c = src.data[y * src.w + x]!;
        if (c >>> 24) this.set(dx + x, dy + y, c);
      }
    }
  }

  /** A one-pixel dark outline around everything drawn (for sprites that sit on busy ground). */
  outline(c: number): void {
    const copy = this.data.slice();
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (copy[y * this.w + x]! >>> 24) continue;
        const near =
          (x > 0 && copy[y * this.w + x - 1]! >>> 24) ||
          (x < this.w - 1 && copy[y * this.w + x + 1]! >>> 24) ||
          (y > 0 && copy[(y - 1) * this.w + x]! >>> 24) ||
          (y < this.h - 1 && copy[(y + 1) * this.w + x]! >>> 24);
        if (near) this.data[y * this.w + x] = c;
      }
    }
  }

  toImageData(): ImageData {
    return new ImageData(new Uint8ClampedArray(this.data.buffer as ArrayBuffer, this.data.byteOffset, this.data.byteLength), this.w, this.h);
  }

  toCanvas(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.w;
    c.height = this.h;
    c.getContext('2d')!.putImageData(this.toImageData(), 0, 0);
    return c;
  }
}

/** Deterministic hash of integers, 0..1. The same tile always gets the same house. */
export function hash(...n: number[]): number {
  let h = 2166136261;
  for (const v of n) {
    h ^= v | 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
  }
  return (h >>> 0) / 4294967296;
}

/** 4x4 ordered dither: true where a pixel should take the second colour at density t. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export const dither = (x: number, y: number, t: number) => BAYER[(y & 3) * 4 + (x & 3)]! < t * 16;
