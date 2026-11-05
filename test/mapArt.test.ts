// The map: where things land on the city art, the room drawings, and the date helpers. No network, no browser.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { codeOn, dayLabel, opensOn, statusOf, type MapData, type MapRestaurant } from '../src/map/data';
import { drawRoom } from '../src/map/room';
import { World, type SezManifest } from '../src/map/world';
import { rdToWgs } from '../src/shared/rd';

const manifest = JSON.parse(readFileSync('src/map/public/sez/manifest.json', 'utf8')) as SezManifest;
const world = new World(manifest);
/** A place by RD New metres from his origin. */
const at = (east: number, north: number) => rdToWgs(manifest.X0 + east, manifest.Y0 + north);

describe('map projection (sezlab city art)', () => {
  it("matches his projection: north-west is up, so a step north-east is straight right and a step south-east straight down", () => {
    const o = world.project(at(2000, 2000).lat, at(2000, 2000).lng);
    const ne = world.project(at(2100, 2100).lat, at(2100, 2100).lng);
    const se = world.project(at(2100, 1900).lat, at(2100, 1900).lng);
    // PX = (x + y) / sqrt 2 units, PY = (x - y) / (2 sqrt 2) units; world.scale pixels per unit.
    expect(ne.x - o.x).toBeCloseTo((200 / Math.SQRT2) * world.scale, 0);
    expect(Math.abs(ne.y - o.y)).toBeLessThan(1);
    expect(se.y - o.y).toBeCloseTo((200 / (2 * Math.SQRT2)) * world.scale, 0);
    expect(Math.abs(se.x - o.x)).toBeLessThan(1);
  });

  it('puts the origin where his art starts, and a sign on a roof: 20 m up is 20 x VZ units higher', () => {
    const o = world.project(at(0, 0).lat, at(0, 0).lng);
    expect(o.x).toBeCloseTo(-manifest.x * world.scale, 0);
    expect(o.y).toBeCloseTo(-manifest.y * world.scale, 0);
    const ground = world.project(52.3731, 4.8926);
    const roof = world.project(52.3731, 4.8926, 20);
    expect(ground.y - roof.y).toBeCloseTo(20 * manifest.VZ * world.scale, 1);
    expect(roof.x).toBe(ground.x);
  });

  it('knows what his art covers: the Dam is on it, Vuurtoreneiland is not (it gets no sign, only a list row)', () => {
    expect(world.covers(52.3731, 4.8926)).toBe(true);
    expect(world.covers(52.3807, 5.0055)).toBe(false);
    const dam = world.project(52.3731, 4.8926);
    expect(dam.x).toBeGreaterThan(0);
    expect(dam.x).toBeLessThan(world.width);
    expect(dam.y).toBeGreaterThan(0);
    expect(dam.y).toBeLessThan(world.height);
  });

  it('names chunk images by level and keeps whole chunks: the sharpest is 1:1, then 1/2, 1/4, and one overview', () => {
    expect(world.level('hi').k).toBe(1);
    expect(world.level(0).k).toBe(0.5);
    expect(world.level(1).k).toBe(0.25);
    expect(world.level(2).span).toBe(world.width);
    const [cx, cy] = manifest.hi.chunks[0]!;
    expect(world.level('hi').has(cx, cy)).toBe(true);
    expect(world.level('hi').url(cx, cy)).toBe(`./sez/${manifest.version}/h_${cx}_${cy}.png`);
    expect(world.level(2).url(0, 0)).toBe(`./sez/${manifest.version}/2.png`);
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
