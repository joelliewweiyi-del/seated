import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { wgsToRd } from '../src/shared/rd';

const files = vi.hoisted(() => new Map<string, string>());

vi.mock('node:fs', () => ({
  existsSync: (path: string) => files.has(path),
  readFileSync: (path: string) => {
    const value = files.get(path);
    if (value === undefined) throw new Error(`Missing fixture: ${path}`);
    return value;
  },
  writeFileSync: (path: string, value: string) => files.set(path, value),
}));

vi.mock('../src/server/restaurants.js', () => ({
  loadCuratedRestaurants: () => [],
}));

const path = 'data/map-places.json';
const address = {
  lat: 52.3731,
  lng: 4.8926,
  area: 'Centrum',
  kind: 'bistro',
};
const rd = wgsToRd(address.lat, address.lng);

function part(
  dx: number,
  dy: number,
  nok: number | null,
  max: number | null,
  ground: number,
) {
  const x = rd.x + dx;
  const y = rd.y + dy;
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [x, y], [x + 0.1, y], [x + 0.1, y + 0.1],
        [x, y + 0.1], [x, y],
      ]],
    },
    properties: {
      b3_h_nok: nok,
      b3_h_max: max,
      b3_h_maaiveld: ground,
    },
  };
}

async function run(features: ReturnType<typeof part>[]) {
  const fetchMock = vi.fn(async (_url: string) =>
    Response.json({ type: 'FeatureCollection', features }));
  vi.stubGlobal('fetch', fetchMock);

  let done = false;
  const task = import('../scripts/map-places').then(() => (done = true));
  while (!done) await vi.advanceTimersByTimeAsync(1000);
  await task;

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const url = new URL(String(fetchMock.mock.calls[0]![0]));
  expect(url.origin).toBe('https://data.3dbag.nl');
  const bbox = url.searchParams.get('bbox')!.split(',');
  expect(bbox.slice(0, 4).map(Number)).toEqual([
    rd.x - 4, rd.y - 4, rd.x + 4, rd.y + 4,
  ]);
  expect(bbox[4]).toBe('EPSG:28992');

  return JSON.parse(files.get(path)!) as Record<
    string,
    typeof address & { roof?: number }
  >;
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.spyOn(process, 'argv', 'get').mockReturnValue([
    'node', 'map-places.ts',
  ]);
  files.clear();
  files.set(path, JSON.stringify({ fixture: address }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// Spec 6: a tall part inside the bounding square but more than 4 m away is excluded.
it('excludes building parts farther than 4 metres from the address', async () => {
  const result = await run([
    part(1, 0, 12, 12, 2),
    part(3.5, 3.5, 100, 100, 0),
  ]);

  expect(result.fixture!.roof).toBe(10);
});
