// A worker that paints chunks of the city. The page sends the world's description once, then one job per chunk
// with that chunk's cells and a small border around them (the whole city is 32 MB; a chunk is 18 KB).
import { paintChunk } from './chunks';
import type { Special } from './paint';
import { World, type WorldMeta } from './world';

let meta: WorldMeta | null = null;

export type ToWorker =
  | { type: 'init'; meta: WorldMeta }
  | { type: 'paint'; id: number; cx: number; cy: number; level: 1 | 2; specials: Array<[number, Special]>; slice: { x0: number; y0: number; w: number; h: number; bytes: ArrayBuffer } };
export type FromWorker = { id: number; cx: number; cy: number; level: 1 | 2; w: number; h: number; buffer: ArrayBuffer };

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === 'init') {
    meta = m.meta;
    return;
  }
  if (!meta) return;
  const s = m.slice;
  const world = new World(meta, new Uint8Array(s.bytes), s.x0, s.y0, s.w, s.h);
  const pix = paintChunk(world, m.cx, m.cy, new Map(m.specials), m.level);
  const buffer = pix.data.buffer as ArrayBuffer;
  const out: FromWorker = { id: m.id, cx: m.cx, cy: m.cy, level: m.level, w: pix.w, h: pix.h, buffer };
  (self as unknown as Worker).postMessage(out, [buffer]);
};
