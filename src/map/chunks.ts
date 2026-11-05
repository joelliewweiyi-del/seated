// Paints one chunk of the city (64 x 64 cells of 4 m). Runs in Web Workers (chunk-worker.ts), so the page stays
// smooth while the city is drawn, and on the main thread when workers are not available.
import { Pix } from './pix';
import { paintBuilding, paintGround, paintProps, type Special } from './paint';
import { HEAD, TH, TW, World } from './world';

export const N = 64;
/** Cells around a chunk that its painter also needs: roof corners, shade, quays. */
export const MARGIN = 2;

export function chunkOrigin(w: World, cx: number, cy: number): { left: number; top: number } {
  const x0 = cx * N;
  const y0 = cy * N;
  return { left: w.screenOf(x0, y0 + N - 1).sx - TW / 2, top: (x0 + y0) * (TH / 2) };
}

export function paintChunk(w: World, cx: number, cy: number, specials: Map<number, Special>, level: 1 | 2): Pix {
  const p = new Pix(N * TW, N * TH + HEAD);
  const x0 = cx * N;
  const y0 = cy * N;
  const { left, top } = chunkOrigin(w, cx, cy);
  for (let s = 0; s <= 2 * N - 2; s++) {
    for (let i = 0; i < N; i++) {
      const j = s - i;
      if (j < 0 || j >= N) continue;
      const x = x0 + i;
      const y = y0 + j;
      const { sx, sy } = w.screenOf(x, y);
      const ox = sx - left;
      const oy = sy - top;
      paintGround(p, w, x, y, ox, oy, left, top);
      paintBuilding(p, w, x, y, ox, oy, specials.get(y * w.cols + x), level === 2);
      paintProps(p, w, x, y, ox, oy, level === 2);
    }
  }
  return level === 1 ? p : halve(p);
}

/**
 * Halves a buffer for the mid-distance level. Each 2 x 2 block keeps its most common colour (ties go to the
 * darker one), which keeps pixel art crisp: averaging would blur every window and gable into mush.
 */
export function halve(src: Pix): Pix {
  const out = new Pix(Math.ceil(src.w / 2), Math.ceil(src.h / 2));
  const block = [0, 0, 0, 0];
  for (let y = 0; y < out.h; y++) {
    for (let x = 0; x < out.w; x++) {
      block[0] = src.get(x * 2, y * 2);
      block[1] = src.get(x * 2 + 1, y * 2);
      block[2] = src.get(x * 2, y * 2 + 1);
      block[3] = src.get(x * 2 + 1, y * 2 + 1);
      let best = 0;
      let bestCount = 0;
      for (let i = 0; i < 4; i++) {
        const c = block[i]!;
        if (!(c >>> 24)) continue;
        let n = 0;
        for (let j = 0; j < 4; j++) if (block[j] === c) n++;
        if (n > bestCount || (n === bestCount && luma(c) < luma(best))) {
          best = c;
          bestCount = n;
        }
      }
      if (bestCount) out.data[y * out.w + x] = best;
    }
  }
  return out;
}

const luma = (c: number) => (c & 0xff) * 3 + ((c >>> 8) & 0xff) * 6 + ((c >>> 16) & 0xff);
