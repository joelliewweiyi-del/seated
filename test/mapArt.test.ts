// The map's pixel art and its date helpers. No network, no browser: the painters write to plain buffers.
import { describe, expect, it } from 'vitest';
import { chunkOrigin, paintChunk, halve, N } from '../src/map/chunks';
import { buildingSize } from '../src/map/paint';
import { codeOn, dayLabel, opensOn, statusOf, type MapData, type MapRestaurant } from '../src/map/data';
import { Pix } from '../src/map/pix';
import { drawRoom } from '../src/map/room';
import { T, World, type WorldMeta } from '../src/map/world';

/** A small made-up world: a canal through canal houses, a street on each side, a park and a bridge. */
function testWorld(): World {
  const cols = N * 2;
  const rows = N * 2;
  const bytes = new Uint8Array(cols * rows * 2);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 2;
      let t: number = T.land;
      if (x === 10) t = T.water;
      else if (x === 9 || x === 11) t = T.street;
      else if (x > 24 && y > 24) t = T.park;
      bytes[i] = t | (((x + y) % 4) << 4); // all four building styles
      if (x === 10 && y === 12) bytes[i + 1] = 1; // a bridge
      if ((x === 9 || x === 11) && y !== 12) bytes[i + 1] = 16; // quay
    }
  }
  const meta: WorldMeta = { cols, rows, tileMeters: 16, bbox: { south: 0, west: 0, north: 1, east: 1 }, mPerDegLat: 1, mPerDegLng: 1, attribution: '' };
  return new World(meta, bytes);
}

function alphas(p: Pix): Set<number> {
  const out = new Set<number>();
  for (const c of p.data) out.add(c >>> 24);
  return out;
}

describe('map painting', () => {
  it('draws blocks lower at half size, so streets and canals show between them (Joel: "a sea of one colour")', () => {
    const w = testWorld();
    let tall = 0;
    for (let x = 0; x < 8; x++) {
      const near = buildingSize(w, x, 3);
      const far = buildingSize(w, x, 3, true);
      expect(far.H).toBeLessThan(near.H);
      expect(far.H).toBeGreaterThan(0);
      tall = Math.max(tall, far.H);
    }
    expect(tall).toBeLessThanOrEqual(24); // a canal house of 5 floors keeps 3: 18 px
  });

  it('keeps a restaurant at full height at half size, so its sign (placed for full height) sits on its roof', () => {
    const w = testWorld();
    const plain = paintChunk(w, 0, 0, new Map(), 2);
    const shop = paintChunk(w, 0, 0, new Map([[12 * w.cols + 12, { awning: 0xff3fae5f, lit: true }]]), 2);
    // The highest row the restaurant changes: its roof at half size.
    let top = shop.h;
    for (let i = 0; i < shop.data.length && top === shop.h; i++) if (shop.data[i] !== plain.data[i]) top = Math.floor(i / shop.w);
    const ground = (w.screenOf(12, 12).sy - chunkOrigin(w, 0, 0).top + 8) / 2; // middle of the tile, half size
    const full = buildingSize(w, 12, 12).H / 2;
    const low = buildingSize(w, 12, 12, true).H / 2;
    expect(ground - top).toBeGreaterThan(low + 2);
    expect(ground - top).toBeGreaterThanOrEqual(full - 4);
  });

  it('never paints near-black: the darkest colour is ink #2b2733 (a palette built with .map(c) once blended to black)', () => {
    const w = testWorld();
    for (const [cx, cy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      const p = paintChunk(w, cx, cy, new Map([[12 * w.cols + 12, { awning: 0xff3fae5f, lit: true }]]), 1);
      expect([...alphas(p)].sort((a, b) => a - b)).toEqual([0, 255]);
      const darkest = Math.min(...[...p.data].filter((c) => c >>> 24).map((c) => (c & 255) + ((c >>> 8) & 255) + ((c >>> 16) & 255)));
      expect(darkest).toBeGreaterThanOrEqual(70);
    }
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
