import { expect, it } from 'vitest';
import { fogTile } from '../src/map/render';

// Joel, 6 Nov 2026: outside sezlab's art the map looked broken (flat blank). It shows pixel fog instead.
it('the fog outside the art has clouds (all four tones, none taking over), the same on every visit', () => {
  const t = fogTile();
  const counts = [0, 0, 0, 0];
  for (const v of t) counts[v]!++;
  for (const c of counts) expect(c / t.length).toBeGreaterThan(0.03);
  expect(Math.max(...counts) / t.length).toBeLessThan(0.6);
  expect(fogTile()).toEqual(t);
});

it('the fog tile wraps: its edges meet without a seam', () => {
  const size = 64;
  const t = fogTile(size);
  // Tone steps across the wrap edge are no larger than steps inside the tile.
  let edge = 0;
  let inside = 0;
  for (let y = 0; y < size; y++) {
    edge += Math.abs(t[y * size]! - t[y * size + size - 1]!);
    inside += Math.abs(t[y * size + 31]! - t[y * size + 32]!);
  }
  expect(edge).toBeLessThanOrEqual(inside * 1.6 + 8);
});

it('fog reaches over a straight edge of the art by a ragged few pixels, and leaves the rest of the art alone', async () => {
  const { fogEdgeIndex } = await import('../src/map/render');
  // 200 x 200 pixels: the left 20 columns transparent (no art), the rest art.
  const w = 200;
  const h = 200;
  const alpha = new Uint8Array(w * h).map((_, i) => (i % w < 20 ? 0 : 1)); // (w, h: 200)
  const fog = fogEdgeIndex(alpha, w, h, 36);
  const depths: number[] = [];
  for (let y = 40; y < h - 40; y++) {
    for (let x = 0; x < 20; x++) expect(fog[y * w + x]).toBe(1); // no art: all fog
    let d = 0;
    while (fog[y * w + 20 + d]) d++;
    depths.push(d);
    expect(fog[y * w + 150]).toBe(0); // the middle of the art stays clear
  }
  expect(Math.max(...depths)).toBeLessThanOrEqual(36);
  expect(Math.min(...depths)).toBeGreaterThanOrEqual(1);
  expect(new Set(depths).size).toBeGreaterThan(1); // ragged, not a straight line
});

it('never lays the fog edge over a restaurant standing on the art (BAK and De Kas were hidden, 6 Nov 2026)', async () => {
  const { fogEdgeIndex } = await import('../src/map/render');
  const w = 200;
  const h = 200;
  const alpha = new Uint8Array(w * h).map((_, i) => (i % w < 20 ? 0 : 1)); // no art in the left 20 columns
  const at = { x: 24, y: 100 }; // a restaurant just inside the art's edge
  const fogged = fogEdgeIndex(alpha, w, h, 36);
  expect(fogged[at.y * w + at.x]).toBe(1); // without a clear spot the edge covers it
  const fog = fogEdgeIndex(alpha, w, h, 36, [at]);
  expect(fog[at.y * w + at.x]).toBe(0);
  expect(fog[(at.y - 10) * w + at.x + 10]).toBe(0); // and the ground around it
  expect(fog[at.y * w + 5]).toBe(1); // where there is no art at all, fog stays
});
