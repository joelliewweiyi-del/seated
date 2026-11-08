import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { World, type OursManifest, type SezManifest } from '../src/map/world';
import { readPNG, writePNG } from '../src/map/noord-png';
import { tileReader } from '../src/map/noord-alignment';
import { ZOOMS, fogEdgeIndex, fogAlphaUnion } from '../src/map/render';
import { Pix } from '../src/map/pix';
import { PAL, paintGround, finishBridges, finishQuays, treeSprite } from '../src/map/noord-paint';
import { World as Grid, T, F, gapMask } from '../src/map/noord-grid';
import { rdToWgs } from '../src/shared/rd';
import { cleanSlivers, parkOrStoneTerrain } from '../src/map/noord-tags';

const sez = JSON.parse(readFileSync('src/map/public/sez/manifest.json', 'utf8')) as SezManifest;
const ours = JSON.parse(readFileSync('src/map/public/ours/manifest.json', 'utf8')) as OursManifest & {
  palette: string[]; cellMeters: number; heightScale: number;
  origin: { exact: { x: number; y: number }; pixel: { x: number; y: number }; registration: { x: number; y: number } };
  measurements: Array<{ kind: string; measured: string; ours: string; count: number; distance: number }>;
  files: Array<{ name: string; bytes: number; sha256: string }>;
};
const world = new World(sez, './sez/', ours);
const places = JSON.parse(readFileSync('data/map-places.json', 'utf8'));
const at = tileReader('src/map/public/ours');

describe('Seated Noord', () => {
  it('keeps stone breakwaters grey even when the same way is tagged as grass or park', () => {
    const stoneTags: Record<string, string>[] = [{ natural: 'stone' }, { natural: 'bare_rock' }, { man_made: 'breakwater' }, { man_made: 'groyne' }];
    const greenTags: Record<string, string>[] = [{ landuse: 'grass' }, { leisure: 'park' }];
    for (const physical of stoneTags) {
      for (const vegetation of greenTags) {
        expect(parkOrStoneTerrain({ ...vegetation, ...physical })).toBe(T.stone);
      }
    }
    expect(parkOrStoneTerrain({ landuse: 'grass', natural: 'stone', man_made: 'reinforced_slope' })).toBe(T.stone);
    expect(parkOrStoneTerrain({ landuse: 'grass' })).toBe(T.park);
    expect(parkOrStoneTerrain({ leisure: 'park' })).toBe(T.park);
    expect(parkOrStoneTerrain()).toBeUndefined();
    expect(parkOrStoneTerrain({ natural: 'water' })).toBeUndefined();
  });
  it('turns green slivers on open water into water, and keeps a park along the shore and a stone pier', () => {
    // 9 x 7: water everywhere; a 1-cell park line across the middle (a sliver), a 3 x 2 park block on the left edge
    // with land behind it (a park on the shore), and a 1-cell stone pier in the right column.
    const W = 9, H = 7, at = (x: number, y: number) => y * W + x;
    const grid = new Uint8Array(W * H).fill(T.water);
    for (let x = 3; x <= 6; x++) grid[at(x, 3)] = T.park;
    for (let y = 0; y < H; y++) grid[at(0, y)] = T.land;
    for (let y = 1; y <= 2; y++) for (let x = 1; x <= 3; x++) grid[at(x, y)] = T.park;
    for (let y = 2; y <= 5; y++) grid[at(7, y)] = T.stone;
    grid[at(5, 3)] = grid[at(5, 3)]! | (4 << 4); // a flag above the terrain bits survives
    const changed = cleanSlivers(grid, W, H);
    for (let x = 4; x <= 6; x++) expect(grid[at(x, 3)]! & 15).toBe(T.water);
    expect(grid[at(5, 3)]! >> 4).toBe(4);
    expect(grid[at(1, 1)]! & 15).toBe(T.park);
    expect(grid[at(1, 2)]! & 15).toBe(T.park);
    for (let y = 2; y <= 5; y++) expect(grid[at(7, y)]! & 15).toBe(T.stone);
    expect(changed).toBeGreaterThanOrEqual(3);
  });
  for (const id of ['bacalar', 'barracuda', 'cornerstore', 'euro-pizza', 'europa', 'helling-7', 'hotel-de-goudfazant', 'klaproos', 'nikotin', 'pelusa', 'copain']) {
    it(`${id} stands on our opaque ground and receives its actual roof height`, () => {
      const p = places[id], ground = world.project(p.lat, p.lng), roof = world.project(p.lat, p.lng, p.roof);
      expect(at(ground.x / 2, ground.y / 2).alpha).toBe(true);
      expect(at(roof.x / 2, roof.y / 2).alpha).toBe(true);
      expect(world.covers(p.lat, p.lng)).toBe(true);
      expect(ground.y - roof.y).toBeCloseTo(p.roof * sez.VZ * world.scale, 6);
    });
  }
  it('uses the reference projection with exact integer grid increments and less than half a pixel origin rounding', () => {
    for (const axis of ['x', 'y'] as const) expect(Math.abs(ours.origin.exact[axis] - ours.origin.pixel[axis] + ours.origin.registration[axis])).toBeLessThanOrEqual(0.5);
    const a = rdToWgs(122000, 489000), b = rdToWgs(122000 + ours.cellMeters, 489000);
    const p = world.project(a.lat, a.lng), q = world.project(b.lat, b.lng);
    expect((q.x - p.x) / 2).toBeCloseTo(2, 2);
    expect((q.y - p.y) / 2).toBeCloseTo(1, 2);
    expect(ours.heightScale).toBeCloseTo(sez.VZ * world.scale / 2, 10);
  });
  it('lines up with his water at the IJ south shore within two pixels (measured by the build on the whole painting)', () => {
    // The tiles keep only his gaps and a strip over his edge (gapMask), so the build measures before that cut.
    const a = (ours as unknown as { alignment: { dx: number; dy: number; correlation: number; samples: number } }).alignment;
    expect(a.samples).toBeGreaterThan(1000);
    expect(a.correlation).toBeGreaterThan(0.7);
    expect(Math.abs(a.dx)).toBeLessThanOrEqual(2);
    expect(Math.abs(a.dy)).toBeLessThanOrEqual(2);
  });
  it('uses measured colours within RGB distance 24, with no interpolated colours or partial alpha in any tile', () => {
    for (const m of ours.measurements) {
      const channels = (s: string) => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16));
      const a = channels(m.measured), b = channels(m.ours);
      expect(Math.hypot(...a.map((v, i) => v - b[i]!)), m.kind).toBeLessThanOrEqual(24);
      expect(m.count).toBeGreaterThan(0);
    }
    const allowed = new Set(ours.palette.slice(1));
    const rendered = new Set<string>();
    for (const f of readdirSync('src/map/public/ours').filter(f => f.endsWith('.png'))) {
      const p = readPNG(readFileSync(`src/map/public/ours/${f}`));
      const used = new Set(p.pixels);
      expect(used.size, f).toBeLessThanOrEqual(ours.palette.length);
      for (const k of used) {
        expect([0, 255], f).toContain(p.alpha[k]);
        if (p.alpha[k]) {
          rendered.add(p.palette[k]!);
          expect(allowed.has(p.palette[k]!), `${f}: ${p.palette[k]}`).toBe(true);
        }
      }
    }
    for (const m of ours.measurements) expect(rendered.has(m.ours), m.kind).toBe(true);
  });
  it('has intact deterministic files and fits within ten megabytes', () => {
    const names = readdirSync('src/map/public/ours');
    expect(names.sort()).toEqual([...ours.files.map(f => f.name), 'manifest.json'].sort());
    expect(names.reduce((n, f) => n + statSync(`src/map/public/ours/${f}`).size, 0)).toBeLessThanOrEqual(13_000_000);
    for (const f of ours.files) {
      const bytes = readFileSync(`src/map/public/ours/${f.name}`);
      expect(bytes.length).toBe(f.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(f.sha256);
    }
  });
  it('enlarges our source pixels by whole multiples at every supported zoom, including hi', () => {
    for (const z of ZOOMS) {
      const level = z >= 1 ? 'hi' : z >= 0.5 ? 0 : z >= 0.25 ? 1 : 2;
      expect(Number.isInteger(z / world.oursLevel(level).k)).toBe(true);
    }
    expect(world.oursLevel('hi').url(0, 0)).toBe(world.oursLevel(0).url(0, 0));
    expect(world.oursLevel('hi').k).toBe(0.5);
  });
  it('round trips packed far pixels at odd widths without changing colours or alpha', () => {
    for (const colours of [16, 61]) {
      const palette = Array.from({length:colours}, (_, i) => '#' + (i * 3571).toString(16).padStart(6, '0'));
      const pixels = Uint8Array.from({length:7 * 9}, (_, i) => i % colours);
      const decoded = readPNG(writePNG(7, 9, pixels, palette));
      expect(decoded.pixels).toEqual(pixels);
      expect(decoded.palette).toEqual(palette);
      expect(decoded.alpha[0]).toBe(0);
      expect(decoded.alpha[1]).toBe(255);
    }
  });
  it('unions translated overview alpha: the fog covers every pixel outside both and reaches only the edge of either', () => {
    const layers = [
      { x: 0, y: 0, w: 100, h: 80, alpha: new Uint8Array(8000).fill(1) },
      { x: 50, y: -40, w: 100, h: 120, alpha: Uint8Array.from({ length: 12000 }, (_, i) => +(i % 100 < 70 && Math.floor(i / 100) < 110)) },
    ];
    const u = fogAlphaUnion(layers);
    expect([u.x, u.y, u.w, u.h]).toEqual([0, -40, 150, 120]);
    const fog = fogEdgeIndex(u.alpha, u.w, u.h, 36);
    let occupied = 0;
    for (let y = 0; y < u.h; y++) for (let x = 0; x < u.w; x++) {
      const expected = layers.some(l => {
        const lx = x + u.x - l.x, ly = y + u.y - l.y;
        return lx >= 0 && ly >= 0 && lx < l.w && ly < l.h && !!l.alpha[ly * l.w + lx];
      });
      expect(!!u.alpha[y * u.w + x]).toBe(expected);
      if (expected) occupied++;
      else expect(fog[y * u.w + x]).toBe(1);
    }
    expect(occupied).toBeGreaterThan(8000);
    // Where the two drawings overlap, far from any edge, the art stays clear: the seam between them is not an edge.
    expect(fog[(40 + 40) * u.w + 75]).toBe(0);
  });
  it('keeps our drawing only in the gaps of his and a margin under his edge (Oost, 8 Nov 2026)', () => {
    // 60 x 40: his art everywhere but a 10-column gap in the middle.
    const w = 60, h = 40, alpha = Uint8Array.from({ length: w * h }, (_, i) => +(i % w < 25 || i % w >= 35));
    const keep = gapMask(alpha, w, h, 4);
    const at = (x: number, y: number) => keep[y * w + x];
    for (let x = 25; x < 35; x++) expect(at(x, 20)).toBe(1); // the gap: ours
    expect(at(22, 20)).toBe(1); // 3 pixels under his edge: ours too, so no seam opens
    expect(at(10, 20)).toBe(0); // deep in his art: left out
    expect(at(50, 20)).toBe(0);
    expect(at(10, 1)).toBe(1); // near the border of his image: treated as an edge
  });
  it('paints diagonal bridge railings only on the completed water-facing boundary, never across its deck', () => {
    const n = 20, planes = new Uint8Array(n * n * 4);
    planes.fill(T.water, 0, n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (Math.abs(x - y) < 3) planes[y * n + x] = T.water | (F.bridge << 4);
    const w = new Grid({cols:n,rows:n,cellMeters:1.885618,roofPalette:[],attribution:''}, planes);
    const p = new Pix(100, 60);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) paintGround(p, w, x, y, 50 + (x-y)*2, 10+x+y, 0, 0);
    for (let y = 14; y < 44; y++) expect(p.get(49,y)).toBe(PAL.deck);
    finishBridges(p);
    for (let y = 14; y < 44; y++) expect(p.get(49,y)).toBe(PAL.deck);
    expect(p.data.some(c => c === PAL.railing)).toBe(true);
  });
  it('gives a straight paved canal bank a continuous quay instead of alternating per-cell stripes', () => {
    const p = new Pix(64, 64);
    p.rect(0, 0, 64, 64, PAL.water);
    p.rect(32, 0, 32, 64, PAL.paving);
    finishQuays(p);
    for (let y = 2; y < 62; y++) {
      expect(p.get(31, y)).toBe(PAL.quayWall);
      expect(p.get(30, y)).toBe(PAL.waterLight);
      expect(p.get(29, y)).toBe(PAL.water);
      expect(p.get(32, y)).toBe(PAL.paving);
    }
  });
  it('does not cycle tree crowns through repeated sprites', () => {
    const crowns = new Set(Array.from({length:128}, (_, seed) => createHash('sha256').update(Buffer.from(treeSprite(seed).data.buffer)).digest('hex')));
    expect(crowns.size).toBe(128);
    expect(treeSprite(71).data).not.toEqual(treeSprite(71 + 256).data);
    expect(treeSprite(71).data).toEqual(treeSprite(71).data);
  });
  it('removes the internal fog edge when two layers meet, while retaining the restaurant clear rule', () => {
    const w = 200, h = 200;
    const theirs = Uint8Array.from({ length: w * h }, (_, i) => +(i % w < 100));
    const ours = Uint8Array.from({ length: w * h }, (_, i) => +(i % w >= 90));
    const union = theirs.map((a, i) => a || ours[i]!);
    const fog = fogEdgeIndex(union, w, h, 36, [{ x: 190, y: 100 }]);
    for (let x = 80; x < 120; x++) expect(fog[100 * w + x]).toBe(0);
    expect(fog[100 * w + 190]).toBe(0);
  });
});
