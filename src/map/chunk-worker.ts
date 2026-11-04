// A worker that paints chunks of the city. The page sends the world once, then one job per chunk.
import { paintChunk } from './chunks';
import type { Special } from './paint';
import { World, type WorldMeta } from './world';

let world: World | null = null;

export type ToWorker =
  | { type: 'init'; meta: WorldMeta; bytes: ArrayBuffer }
  | { type: 'paint'; id: number; cx: number; cy: number; level: 1 | 2; specials: Array<[number, Special]> };
export type FromWorker = { id: number; cx: number; cy: number; level: 1 | 2; w: number; h: number; buffer: ArrayBuffer };

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === 'init') {
    world = new World(m.meta, new Uint8Array(m.bytes));
    return;
  }
  if (!world) return;
  const pix = paintChunk(world, m.cx, m.cy, new Map(m.specials), m.level);
  const buffer = pix.data.buffer as ArrayBuffer;
  const out: FromWorker = { id: m.id, cx: m.cx, cy: m.cy, level: m.level, w: pix.w, h: pix.h, buffer };
  (self as unknown as Worker).postMessage(out, [buffer]);
};
