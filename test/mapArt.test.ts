// The map's pixel art and its date helpers. No network, no browser: the painters write to plain buffers.
import { describe, expect, it } from 'vitest';
import { chunkOrigin, paintChunk, halve, N } from '../src/map/chunks';
import { codeOn, dayLabel, opensOn, statusOf, type MapData, type MapRestaurant } from '../src/map/data';
import { Pix } from '../src/map/pix';
import { drawRoom } from '../src/map/room';
import { PX_PER_M, T, World, type WorldMeta } from '../src/map/world';

const PALETTE = ['#b8603a', '#cfc4b0', '#4a5260'];

/**
 * A small made-up world of 4 m cells: a canal with streets on both sides and a bridge, a flat-roofed block of two
 * buildings, one pitched-roof house, and single test towers. `edit` changes the planes before the world is made.
 */
function testWorld(edit?: (set: (plane: number, x: number, y: number, v: number) => void) => void): World {
  const cols = N * 2;
  const rows = N * 2;
  const n = cols * rows;
  const planes = new Uint8Array(n * 4);
  const set = (plane: number, x: number, y: number, v: number) => (planes[plane * n + y * cols + x] = v);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let t: number = T.land;
      if (x === 10) t = T.water | (y === 12 ? 1 << 4 : 0); // a bridge at y 12
      else if (x === 9 || x === 11) t = T.street;
      else if (x >= 50 && y >= 50 && x < 60 && y < 60) t = T.park;
      set(0, x, y, t);
    }
  }
  // Two flat-roofed buildings side by side, 12 m high, same roof colour, different seeds (BAG panden).
  for (let y = 4; y < 10; y++) {
    for (let x = 12; x < 21; x++) {
      set(1, x, y, 24);
      set(2, x, y, 1);
      set(3, x, y, 2 | ((x < 18 ? 3 : 7) << 4)); // 1800s; seed 3, then seed 7
    }
  }
  // A pitched-roof house: eaves 8 m, ridge 12 m along y.
  for (let y = 20; y < 26; y++) {
    for (let x = 30; x < 37; x++) {
      set(1, x, y, Math.round((12 - Math.abs(x - 33) * 1.3) * 2));
      set(2, x, y, 0);
      set(3, x, y, 2 | 8 | (5 << 4));
    }
  }
  edit?.(set);
  const meta: WorldMeta = { cols, rows, cellMeters: 4, bbox: { south: 0, west: 0, north: 1, east: 1 }, mPerDegLat: 1, mPerDegLng: 1, roofPalette: PALETTE, attribution: '' };
  return new World(meta, planes);
}

function alphas(p: Pix): Set<number> {
  const out = new Set<number>();
  for (const c of p.data) out.add(c >>> 24);
  return out;
}

/** The highest row where two paintings of the same chunk differ. */
function topChange(a: Pix, b: Pix): number {
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return Math.floor(i / a.w);
  return -1;
}

describe('map painting', () => {
  it('stands every building at its real height from 3DBAG: a 6 m and a 30 m tower rise 6 x and 30 x PX_PER_M', () => {
    const empty = paintChunk(testWorld(), 0, 0, new Map(), 1);
    const top = chunkOrigin(testWorld(), 0, 0).top;
    for (const metres of [6, 30]) {
      const w = testWorld((set) => {
        set(1, 40, 40, metres * 2);
        set(3, 40, 40, 4);
      });
      const roofTop = w.screenOf(40, 40).sy - top - Math.round(metres * PX_PER_M);
      expect(topChange(paintChunk(w, 0, 0, new Map(), 1), empty)).toBe(roofTop);
    }
  });

  it('puts a restaurant storefront on its whole building and not on the building next door', () => {
    const w = testWorld();
    const cells = w.buildingAt(14, 6);
    expect(cells).toHaveLength(6 * 6); // x 12..17, y 4..9
    expect(cells).not.toContain(6 * w.cols + 18); // the next building: same roof colour, other seed
    // Its storefront shows: the cell on the street-facing (front) row changes.
    const shop = new Map(cells.map((i) => [i, { awning: 0xff3fae5f, lit: true }] as const));
    const plain = paintChunk(w, 0, 0, new Map(), 1);
    expect(topChange(paintChunk(w, 0, 0, shop, 1), plain)).toBeGreaterThan(-1);
  });

  it('paints a pitched roof in at most three shades of its colour, so roofs read as planes (a per-cell shade speckled)', () => {
    const w = testWorld();
    const red = paintChunk(w, 0, 0, new Map(), 1);
    // The same house with another roof colour: the pixels that change are exactly its roof.
    const stone = paintChunk(testWorld((set) => { for (let y = 20; y < 26; y++) for (let x = 30; x < 37; x++) set(2, x, y, 1); }), 0, 0, new Map(), 1);
    const shades = new Set<number>();
    for (let i = 0; i < red.data.length; i++) if (red.data[i] !== stone.data[i]) shades.add(red.data[i]!);
    expect(shades.size).toBeGreaterThan(1); // it slopes
    expect(shades.size).toBeLessThanOrEqual(3);
  });

  it('never paints near-black: the darkest colour is ink #2b2733 (a palette built with .map(c) once blended to black)', () => {
    const w = testWorld();
    for (const [cx, cy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      const p = paintChunk(w, cx, cy, new Map([[6 * w.cols + 14, { awning: 0xff3fae5f, lit: true }]]), 1);
      expect([...alphas(p)].sort((a, b) => a - b)).toEqual([0, 255]);
      const darkest = Math.min(...[...p.data].filter((c) => c >>> 24).map((c) => (c & 255) + ((c >>> 8) & 255) + ((c >>> 16) & 255)));
      expect(darkest).toBeGreaterThanOrEqual(70);
    }
  });

  it('paints a chunk the same from a worker slice as from the whole city (a short border cut roofs at chunk edges)', () => {
    const w = testWorld();
    const s = w.slice(N - 2, -2, N + 4, N + 4);
    const part = new World(w.meta, s, N - 2, -2, N + 4, N + 4);
    expect(paintChunk(part, 1, 0, new Map(), 1).data).toEqual(paintChunk(w, 1, 0, new Map(), 1).data);
  });

  it('keeps colours exact when halving: every pixel of the half-size level is a colour from the full one', () => {
    const p = paintChunk(testWorld(), 0, 0, new Map(), 1);
    const full = new Set(p.data);
    const half = halve(p);
    for (const c of half.data) if (c >>> 24) expect(full.has(c)).toBe(true);
  });

  it('draws a room for every kind and status without leaving the canvas empty', () => {
    for (const kind of ['bistro', 'wine', 'japanese', 'fine', 'cafe', 'pizza', 'greenhouse', 'island', 'brasserie', 'unknown-kind']) {
      for (const status of ['open', 'full', 'closed', 'later', 'unknown'] as const) {
        const p = drawRoom({ kind, status, free: 2, seed: 1 });
        const filled = p.data.filter((c) => c >>> 24).length;
        expect(filled / p.data.length).toBeGreaterThan(0.4);
      }
    }
  });
});

describe('map dates', () => {
  const data = { start: '2026-11-04', days: 63 } as MapData;
  const r = { d: 'o' + 'f'.repeat(55) + 'l'.repeat(7), win: 56 } as unknown as MapRestaurant;

  it('reads the day code by restaurant-local date, and unknown outside the window', () => {
    expect(codeOn(r, data, '2026-11-04')).toBe('o');
    expect(codeOn(r, data, '2026-11-05')).toBe('f');
    expect(codeOn(r, data, '2027-03-01')).toBe('?');
    expect(statusOf('n')).toBe('full');
    expect(statusOf('l')).toBe('later');
  });

  it('works out when a day that is not bookable yet opens: the window before it (Rijsel on 31 Dec, 4 Nov)', () => {
    expect(opensOn(r, '2026-12-31')).toBe('2026-11-05');
    expect(opensOn({ ...r, win: null }, '2026-12-31')).toBeNull();
  });

  it('labels a date without shifting it by time zone', () => {
    expect(dayLabel('2026-12-31')).toBe('Thu 31 Dec');
    expect(dayLabel('2027-01-01', { long: true })).toBe('Friday 1 Jan');
  });
});
