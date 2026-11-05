import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { deflateSync } from 'node:zlib';
import { World, type SezManifest } from '../src/map/world';

const disk = vi.hoisted(() => new Map<string, Buffer>());

vi.mock('node:fs', () => ({
  existsSync: (path: string) => disk.has(path),
  mkdirSync: vi.fn(),
  readFileSync: (path: string, encoding?: string) => {
    const value = disk.get(path);
    if (!value) throw new Error(`Missing fixture: ${path}`);
    return encoding ? value.toString('utf8') : value;
  },
  writeFileSync: (path: string, value: string | Buffer) => {
    disk.set(path, Buffer.from(value));
  },
}));

const OUT = 'src/map/public/sez';
const BASE = 'https://sezlab.dev/amsterdam/';
const bounds = { X0: 118500, Y0: 484500, X1: 125000, Y1: 490000 };
const pxm = {
  x: 0, y: 0, w: 136, h: 72, v: 'test-version',
  levels: [
    { w: 68, h: 36, cs: 16, chunks: [[0, 0], [1, 0]] },
    { w: 34, h: 18, cs: 16, chunks: [[0, 0]] },
    { w: 17, h: 9, cs: 17, chunks: [[0, 0]] },
  ],
  hi: { w: 136, h: 72, cs: 16, chunks: [[0, 0], [2, 1]] },
};

function chunk(type: string, body: Buffer): Buffer {
  const name = Buffer.from(type);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([name, body])) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  const size = Buffer.alloc(4);
  size.writeUInt32BE(body.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, name, body, checksum]);
}

/** Six mask cells: 32/64, 33/64, 4/8, 5/8, 4/8, 1/1 drawn. */
function overview(filter: number): Buffer {
  const w = 17;
  const h = 9;
  const pixels = Buffer.alloc(w * h);
  const counts = [32, 33, 4, 5, 4, 1];
  for (let my = 0; my < 2; my++) {
    for (let mx = 0; mx < 3; mx++) {
      let remaining = counts[my * 3 + mx]!;
      for (let y = my * 8; y < Math.min(h, my * 8 + 8); y++) {
        for (let x = mx * 8; x < Math.min(w, mx * 8 + 8); x++) {
          // Index 2 has implicit opaque alpha; index 1 uses tRNS.
          if (remaining-- > 0) pixels[y * w + x] = (x + y) % 2 ? 1 : 2;
        }
      }
    }
  }
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = filter;
    for (let x = 0; x < w; x++) {
      const a = x ? pixels[y * w + x - 1]! : 0;
      const b = y ? pixels[(y - 1) * w + x]! : 0;
      const c = x && y ? pixels[(y - 1) * w + x - 1]! : 0;
      const p = a + b - c;
      const distances = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
      const paeth = distances[0]! <= distances[1]! && distances[0]! <= distances[2]!
        ? a : distances[1]! <= distances[2]! ? b : c;
      const predictor = [0, a, b, Math.floor((a + b) / 2), paeth][filter]!;
      raw[y * (w + 1) + 1 + x] = (pixels[y * w + x]! - predictor + 256) % 256;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 3;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('PLTE', Buffer.from([0, 0, 0, 120, 80, 40, 90, 130, 60])),
    chunk('tRNS', Buffer.from([0, 255])),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function serve(options: {
  page?: string;
  data?: object;
  png?: Buffer;
  failImage?: boolean;
} = {}) {
  const paths: string[] = [];
  let active = 0;
  let maximum = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    expect(input.startsWith(BASE)).toBe(true);
    const path = input.slice(BASE.length);
    paths.push(path);
    if (path === '') {
      return new Response(options.page ??
        `const PXM=${JSON.stringify(pxm)};fetch('data.json?v=test-version')`);
    }
    if (path === 'data.json?v=test-version') {
      return Response.json(options.data ?? bounds);
    }
    expect(path).toMatch(/^pixel\/(?:n?.+)\.(?:png|webp)\?v=test-version$/);
    if (options.failImage) return new Response('', { status: 503 });
    active++;
    maximum = Math.max(maximum, active);
    const body = path.startsWith('pixel/2.png')
      ? options.png ?? overview(0)
      : Buffer.from('fixture image');
    return {
      ok: true,
      async arrayBuffer() {
        await Promise.resolve();
        active--;
        return Uint8Array.from(body).buffer;
      },
    };
  }));
  return { paths, maximum: () => maximum };
}

const sync = () => import('../scripts/map-sez-sync');
const manifest = () =>
  JSON.parse(disk.get(`${OUT}/manifest.json`)!.toString()) as SezManifest;

beforeEach(() => {
  vi.resetModules();
  disk.clear();
  vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'map-sez-sync.ts']);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});


// Spec 1: upstream shape changes fail before publishing an unusable manifest.
it.each([
  ['missing RD bound', `const PXM=${JSON.stringify(pxm)};fetch('data.json?v=test-version')`,
    { X0: bounds.X0, Y0: bounds.Y0, X1: bounds.X1 }],
  ['invalid projection width',
    `const PXM=${JSON.stringify({ ...pxm, w: 0 })};fetch('data.json?v=test-version')`, bounds],
])('rejects %s', async (_name, page, data) => {
  serve({ page, data });
  await expect(sync()).rejects.toThrow();
  expect(disk.has(`${OUT}/manifest.json`)).toBe(false);
});
