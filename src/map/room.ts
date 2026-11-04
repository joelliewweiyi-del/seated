// The room inside a restaurant, drawn for the card: floor, two back walls, furniture by kind, and guests.
// Free tables are set and lit; taken ones have people at them. Closed rooms are dark with chairs up.
import { darken, dither, hash, lighten, mix, Pix, rgb } from './pix';
import type { Status } from './data';

const c = rgb;
const RW = 6; // tiles along x
const RD = 5; // tiles along y
const WALL = 54;
export const ROOM_W = (RW + RD) * 16 + 8;
export const ROOM_H = (RW + RD) * 8 + WALL + 18;
const OX = RD * 16 + 4;
const OY = WALL + 10;

const P = (gx: number, gy: number, gz = 0): [number, number] => [OX + (gx - gy) * 16, OY + (gx + gy) * 8 - gz];

interface Kind {
  floor: (x: number, y: number, gx: number, gy: number) => number;
  wallL: number;
  wallR: number;
  trim: number;
  tables: Array<[number, number]>;
  table: { w: number; d: number; h: number; top: number; cloth?: number };
  decor: (p: Pix, lit: boolean) => void;
  /** Long counter with stools instead of separate chairs (omakase, wine bar). */
  counter?: boolean;
}

function box(p: Pix, gx: number, gy: number, gz: number, sx: number, sy: number, sz: number, top: number, left?: number, right?: number): void {
  const l = left ?? darken(top, 0.12);
  const r = right ?? darken(top, 0.26);
  p.poly([P(gx, gy + sy, gz), P(gx + sx, gy + sy, gz), P(gx + sx, gy + sy, gz + sz), P(gx, gy + sy, gz + sz)], l);
  p.poly([P(gx + sx, gy, gz), P(gx + sx, gy + sy, gz), P(gx + sx, gy + sy, gz + sz), P(gx + sx, gy, gz + sz)], r);
  p.poly([P(gx, gy, gz + sz), P(gx + sx, gy, gz + sz), P(gx + sx, gy + sy, gz + sz), P(gx, gy + sy, gz + sz)], top);
}

/** A rectangle on the left wall (the plane x = 0), y along the wall, z up. */
function onLeftWall(p: Pix, y0: number, z0: number, w: number, h: number, colour: number | ((x: number, y: number) => number)): void {
  p.poly([P(0, y0, z0), P(0, y0 + w, z0), P(0, y0 + w, z0 + h), P(0, y0, z0 + h)], colour);
}
/** A rectangle on the right wall (the plane y = 0). */
function onRightWall(p: Pix, x0: number, z0: number, w: number, h: number, colour: number | ((x: number, y: number) => number)): void {
  p.poly([P(x0, 0, z0), P(x0 + w, 0, z0), P(x0 + w, 0, z0 + h), P(x0, 0, z0 + h)], colour);
}

function windowR(p: Pix, x0: number, lit: boolean, outside = c('#9fd3e0')): void {
  onRightWall(p, x0, 16, 1.2, 26, c('#f4efe4'));
  onRightWall(p, x0 + 0.08, 18, 1.04, 22, lit ? outside : darken(outside, 0.55));
  onRightWall(p, x0 + 0.58, 18, 0.06, 22, c('#f4efe4'));
}

function lamp(p: Pix, gx: number, gy: number, lit: boolean): void {
  const [x, y] = P(gx, gy, 44);
  p.vline(x, y - 14, y - 4, c('#3a3440'));
  p.rect(x - 3, y - 4, 7, 3, c('#3a3440'));
  if (lit) {
    p.rect(x - 2, y - 1, 5, 2, c('#ffe08a'));
    for (let i = 0; i < 12; i++) p.set(x - 6 + ((i * 7) % 13), y + 2 + (i % 3), c('#ffe08a', 70));
  }
}

const SKIN = ['#f1c7a5', '#d9a07c', '#a8714f', '#7a4b33', '#f6d6bc'].map((s) => c(s));
const SHIRT = ['#d9534f', '#3c6e8f', '#e6b33a', '#5b8f4e', '#7a5aa6', '#2b2733', '#e98a63', '#4fa3a5'].map((s) => c(s));
const HAIR = ['#3a2a22', '#7a4b2a', '#d8b26a', '#2b2733', '#a33b2a', '#c7c2bb'].map((s) => c(s));

/** A seated guest: our own small, round people. */
function guest(p: Pix, gx: number, gy: number, seed: number): void {
  const [x, y] = P(gx, gy, 6);
  const shirt = SHIRT[Math.floor(hash(seed, 1) * SHIRT.length)]!;
  const skin = SKIN[Math.floor(hash(seed, 2) * SKIN.length)]!;
  const hair = HAIR[Math.floor(hash(seed, 3) * HAIR.length)]!;
  p.rect(x - 3, y - 9, 6, 7, shirt);
  p.rect(x - 3, y - 9, 1, 7, darken(shirt, 0.2));
  // round head
  p.rect(x - 2, y - 15, 5, 5, skin);
  p.rect(x - 3, y - 14, 7, 3, skin);
  p.rect(x - 2, y - 16, 5, 2, hair);
  p.rect(x - 3, y - 15, 1, 2, hair);
  p.set(x + 1, y - 12, c('#2b2733'));
  p.set(x - 1, y - 12, c('#2b2733'));
}

function chair(p: Pix, gx: number, gy: number, colour: number, up = false): void {
  if (up) {
    box(p, gx, gy, 12, 0.32, 0.32, 3, colour);
    return;
  }
  box(p, gx, gy, 0, 0.3, 0.3, 7, colour);
  box(p, gx, gy, 7, 0.08, 0.3, 9, darken(colour, 0.1));
}

const KINDS: Record<string, Kind> = {
  bistro: {
    floor: (x, y, gx, gy) => ((Math.floor(gx * 2) + Math.floor(gy * 2)) % 2 ? c('#f1ebe0') : c('#3a3440')),
    wallL: c('#c9d3b8'),
    wallR: c('#b9c4a6'),
    trim: c('#5b4033'),
    tables: [[1.2, 1.33], [3.09, 1.33], [4.8, 1.33], [1.2, 3.5], [3.09, 3.5], [4.8, 3.5]],
    table: { w: 0.8, d: 0.8, h: 12, top: c('#8a5a3c') },
    decor: (p, lit) => {
      onLeftWall(p, 1, 18, 2.2, 16, c('#2f3a34')); // chalkboard menu
      for (let i = 0; i < 4; i++) onLeftWall(p, 1.25, 30 - i * 3.5, 1.2 + hash(i, 4) * 0.6, 1, c('#f4efe4'));
      windowR(p, 1, lit);
      windowR(p, 3.5, lit);
      onLeftWall(p, 3.4, 30, 1.4, 2, c('#5b4033'));
      for (let i = 0; i < 4; i++) onLeftWall(p, 3.5 + i * 0.3, 32, 0.14, 7, [c('#3f6b3a'), c('#6b2a33'), c('#2e4a38')][i % 3]!);
    },
  },
  wine: {
    floor: (x, y, gx) => ((Math.floor(gx * 4) % 2 === 0 ? c('#6b4a35') : c('#5e412f'))),
    wallL: c('#7c3b3a'),
    wallR: c('#6c3332'),
    trim: c('#2b2026'),
    tables: [[1.89, 3.67], [3.77, 3.67]],
    table: { w: 0.8, d: 0.8, h: 13, top: c('#4a3326') },
    counter: true,
    decor: (p) => {
      // A wall of bottles.
      for (let row = 0; row < 5; row++) {
        onLeftWall(p, 0.4, 14 + row * 7, 4.3, 1, c('#3a2a22'));
        for (let i = 0; i < 13; i++) {
          const col = [c('#2e4a38'), c('#6b2a33'), c('#c9b26a'), c('#3f6b3a')][Math.floor(hash(row, i) * 4)]!;
          onLeftWall(p, 0.5 + i * 0.32, 15 + row * 7, 0.14, 5, col);
        }
      }
      onRightWall(p, 3.4, 18, 1.8, 18, c('#e9dcc0'));
      onRightWall(p, 3.5, 20, 1.6, 14, c('#c45a3c'));
    },
  },
  japanese: {
    floor: (x, y, gx, gy) => (Math.floor(gy * 2) % 2 ? c('#e3d1a8') : c('#d8c59a')),
    wallL: c('#efe7d6'),
    wallR: c('#e3d9c4'),
    trim: c('#6b4a35'),
    tables: [[4.63, 3.83]],
    table: { w: 0.9, d: 0.9, h: 10, top: c('#b68e5e') },
    counter: true,
    decor: (p, lit) => {
      // Noren curtain and paper lanterns.
      onRightWall(p, 3.9, 26, 1.6, 16, c('#2d4f73'));
      onRightWall(p, 4.63, 26, 0.12, 16, c('#efe7d6'));
      for (const x of [1.4, 3]) {
        const [px, py] = P(x, 0.4, 44);
        p.rect(px - 3, py - 2, 7, 8, lit ? c('#f6a35f') : c('#9a6a46'));
        p.hline(px - 3, px + 3, py - 2, c('#3a3440'));
        p.hline(px - 3, px + 3, py + 5, c('#3a3440'));
      }
      onLeftWall(p, 2.2, 20, 1.4, 20, c('#f4efe4'));
      for (let i = 0; i < 4; i++) onLeftWall(p, 2.2 + i * 0.35, 20, 0.04, 20, c('#6b4a35'));
    },
  },
  fine: {
    floor: (x, y) => ((((x >> 2) + (y >> 1)) & 1) === 0 ? c('#a77b52') : c('#97704a')),
    wallL: c('#e6e1d8'),
    wallR: c('#d8d2c7'),
    trim: c('#c9a55a'),
    tables: [[1.37, 1.5], [3.6, 1.5], [1.37, 3.67], [3.6, 3.67]],
    table: { w: 0.9, d: 0.9, h: 12, top: c('#ffffff'), cloth: c('#f4f1ea') },
    decor: (p, lit) => {
      onLeftWall(p, 1.2, 20, 1.6, 18, c('#c9a55a'));
      onLeftWall(p, 1.3, 21.5, 1.4, 15, c('#4a6a8a'));
      onLeftWall(p, 3.1, 20, 1.6, 18, c('#c9a55a'));
      onLeftWall(p, 3.2, 21.5, 1.4, 15, c('#b8573f'));
      windowR(p, 1.8, lit, c('#a8cfe0'));
      windowR(p, 4, lit, c('#a8cfe0'));
    },
  },
  cafe: {
    floor: (x, y, gx, gy) => ((Math.floor(gx * 3) + Math.floor(gy * 3)) % 2 ? c('#e9e4da') : c('#d9d2c4')),
    wallL: c('#f0dcc0'),
    wallR: c('#e5cfb0'),
    trim: c('#3f6b5a'),
    tables: [[1.29, 2.67], [2.91, 2.67], [4.54, 2.67], [2.06, 4.17], [3.77, 4.17]],
    table: { w: 0.6, d: 0.6, h: 11, top: c('#f4efe4') },
    decor: (p, lit) => {
      windowR(p, 0.6, lit);
      windowR(p, 2.2, lit);
      windowR(p, 3.8, lit);
      for (const y of [1.2, 3.2]) {
        const [px, py] = P(0.4, y, 18);
        p.rect(px - 3, py - 2, 6, 6, c('#b8573f'));
        p.rect(px - 4, py - 9, 8, 7, c('#6aa84f'));
        p.rect(px - 2, py - 11, 4, 3, c('#8cc66a'));
      }
    },
  },
  pizza: {
    floor: (x, y, gx, gy) => ((Math.floor(gx * 2) + Math.floor(gy * 2)) % 2 ? c('#c87a52') : c('#b86d48')),
    wallL: c('#f1e6d2'),
    wallR: c('#e6d8c0'),
    trim: c('#3f6b3a'),
    tables: [[2.57, 1.5], [4.46, 1.5], [2.57, 3.67], [4.46, 3.67]],
    table: { w: 0.8, d: 0.8, h: 12, top: c('#e04f3f'), cloth: c('#f4efe4') },
    decor: (p, lit) => {
      // The oven: a white dome with a glowing mouth.
      const [x, y] = P(0.9, 1.4, 0);
      p.poly([[x - 16, y], [x + 16, y], [x + 14, y - 22], [x + 6, y - 30], [x - 6, y - 30], [x - 14, y - 22]], c('#efe7d6'));
      p.poly([[x - 6, y - 2], [x + 6, y - 2], [x + 5, y - 10], [x - 5, y - 10]], lit ? c('#ff8a3d') : c('#3a3440'));
      if (lit) p.rect(x - 3, y - 6, 6, 3, c('#ffd56b'));
      p.rect(x - 2, y - 40, 4, 10, c('#d9cdb8'));
      windowR(p, 3.2, lit);
    },
  },
  greenhouse: {
    floor: (x, y, gx, gy) => (dither(x, y, 0.2) ? c('#b9ad96') : c('#c9bea8')),
    wallL: c('#cfe6ea'),
    wallR: c('#c2dde2'),
    trim: c('#5f7a6e'),
    tables: [[1.71, 1.83], [3.77, 1.83], [1.71, 3.83], [3.77, 3.83]],
    table: { w: 1.3, d: 0.8, h: 12, top: c('#a2754e') },
    decor: (p) => {
      // Glass walls: a grid of panes, and plants everywhere.
      for (let i = 0; i <= RD; i += 0.75) onLeftWall(p, i, 0, 0.05, WALL, c('#5f7a6e'));
      for (let i = 0; i <= RW; i += 0.75) onRightWall(p, i, 0, 0.05, WALL, c('#5f7a6e'));
      for (const z of [18, 36]) {
        onLeftWall(p, 0, z, RD, 1, c('#5f7a6e'));
        onRightWall(p, 0, z, RW, 1, c('#5f7a6e'));
      }
      for (let i = 0; i < 9; i++) {
        const [px, py] = i < 4 ? P(0.35, 0.5 + i * 1.15, 0) : P(0.8 + (i - 4) * 1.1, 0.35, 0);
        p.rect(px - 3, py - 4, 7, 4, c('#8a5a3c'));
        for (let k = 0; k < 14; k++) p.set(px - 4 + Math.floor(hash(i, k) * 9), py - 6 - Math.floor(hash(k, i) * 12), k % 3 ? c('#5f9e4a') : c('#8cc66a'));
      }
    },
  },
  island: {
    floor: (x, y, gx) => (Math.floor(gx * 3) % 2 ? c('#b08a62') : c('#a07d58')),
    wallL: c('#d9e3e6'),
    wallR: c('#cbd7db'),
    trim: c('#8a3b33'),
    tables: [[2.23, 2.0], [2.23, 3.83]],
    table: { w: 3, d: 0.8, h: 12, top: c('#a2754e') },
    decor: (p, lit) => {
      windowR(p, 0.6, lit, c('#7fc0d0'));
      windowR(p, 2.4, lit, c('#7fc0d0'));
      windowR(p, 4.2, lit, c('#7fc0d0'));
      // A little lighthouse in the window.
      const [x, y] = P(3, 0, 22);
      p.rect(x - 1, y - 12, 3, 12, c('#f4efe4'));
      p.rect(x - 1, y - 8, 3, 2, c('#c4473b'));
      p.rect(x - 2, y - 14, 5, 2, lit ? c('#ffd56b') : c('#8a8f96'));
      for (let i = 0; i < 6; i++) {
        const [lx, ly] = P(0.6 + i * 0.95, 0.6 + (i % 2) * 1.8, 46);
        p.rect(lx - 1, ly, 3, 3, lit ? c('#ffd56b') : c('#8a8f96'));
      }
    },
  },
  brasserie: {
    floor: (x, y, gx, gy) => ((Math.floor(gx * 2) + Math.floor(gy * 2)) % 2 ? c('#ece6da') : c('#d7cfbf')),
    wallL: c('#2f4a40'),
    wallR: c('#2a4239'),
    trim: c('#c9a55a'),
    tables: [[2.4, 1.33], [4.11, 1.33], [2.4, 3.5], [4.11, 3.5], [0.86, 3.67]],
    table: { w: 0.8, d: 0.8, h: 12, top: c('#e9e1cf') },
    counter: false,
    decor: (p, lit) => {
      windowR(p, 0.9, lit);
      windowR(p, 2.7, lit);
      windowR(p, 4.5, lit);
      onLeftWall(p, 0.9, 22, 3.4, 14, c('#c9a55a'));
      onLeftWall(p, 1, 23, 3.2, 12, c('#f4efe4'));
      for (let i = 0; i < 5; i++) onLeftWall(p, 1.2 + i * 0.55, 31 - (i % 3) * 3, 0.3, 1, c('#2b2733'));
    },
  },
};

export interface RoomInput {
  kind: string;
  status: Status;
  /** Free tables to show (0 when full). */
  free: number;
  seed: number;
}

/** Draws a room. The canvas is meant to be shown at 2x with image-rendering: pixelated. */
export function drawRoom(input: RoomInput): Pix {
  const k = KINDS[input.kind] ?? KINDS.bistro!;
  const p = new Pix(ROOM_W, ROOM_H);
  const lit = input.status !== 'closed' && input.status !== 'unknown';

  // Walls with a skirting and a top trim.
  p.poly([P(0, 0, 0), P(0, RD, 0), P(0, RD, WALL), P(0, 0, WALL)], k.wallL);
  p.poly([P(0, 0, 0), P(RW, 0, 0), P(RW, 0, WALL), P(0, 0, WALL)], k.wallR);
  onLeftWall(p, 0, 0, RD, 4, k.trim);
  onRightWall(p, 0, 0, RW, 4, darken(k.trim, 0.1));
  onLeftWall(p, 0, WALL - 3, RD, 3, lighten(k.trim, 0.1));
  onRightWall(p, 0, WALL - 3, RW, 3, k.trim);
  // Wall thickness on the outer edges.
  p.poly([P(0, RD, 0), P(-0.2, RD + 0.1, 0), P(-0.2, RD + 0.1, WALL + 2), P(0, RD, WALL)], darken(k.wallL, 0.3));
  p.poly([P(RW, 0, 0), P(RW + 0.1, -0.2, 0), P(RW + 0.1, -0.2, WALL + 2), P(RW, 0, WALL)], darken(k.wallR, 0.3));

  // Floor.
  p.poly([P(0, 0), P(RW, 0), P(RW, RD), P(0, RD)], (x, y) => {
    const a = (x - OX + 0.5) / 16;
    const b = (y - OY + 0.5) / 8;
    return k.floor(x, y, (a + b) / 2, (b - a) / 2);
  });
  // Floor edge.
  p.poly([P(0, RD), P(RW, RD), P(RW, RD, -4), P(0, RD, -4)], darken(k.wallL, 0.45));
  p.poly([P(RW, 0), P(RW, RD), P(RW, RD, -4), P(RW, 0, -4)], darken(k.wallR, 0.55));

  k.decor(p, lit);

  // Counter with stools along the back for omakase and wine bars.
  const things: Array<{ depth: number; draw: () => void }> = [];
  if (k.counter) {
    things.push({ depth: 1.6, draw: () => box(p, 1, 0.9, 0, 4.2, 0.7, 16, c('#c9a87a'), c('#8a6a48'), c('#6e5338')) });
    for (let i = 0; i < 5; i++) {
      const gx = 1.25 + i * 0.85;
      const taken = input.status === 'full' || (input.status === 'open' && i >= input.free);
      things.push({ depth: gx + 2.2, draw: () => box(p, gx, 2.05, 0, 0.3, 0.3, 9, c('#3a3440')) });
      if (taken) things.push({ depth: gx + 2.3, draw: () => guest(p, gx + 0.15, 2.2, input.seed + i * 13) });
    }
  }

  // Tables. Which are free: the first `free` ones, counted from the front of the room.
  const tables = [...k.tables].sort((a, b) => b[0] + b[1] - (a[0] + a[1]));
  const freeTables = input.status === 'open' ? Math.max(1, Math.min(tables.length, input.free - (k.counter ? 5 : 0))) : 0;
  tables.forEach(([gx, gy], i) => {
    const free = i < freeTables && input.status === 'open';
    const taken = !free && (input.status === 'open' || input.status === 'full');
    const t = k.table;
    const chairCol = darken(t.top === c('#ffffff') ? c('#8a5a3c') : t.top, 0.1);
    const up = input.status === 'closed';
    // Chairs behind the table first, then the table, then chairs and guests in front.
    things.push({ depth: gx + gy - 0.6, draw: () => chair(p, gx + t.w / 2 - 0.15, gy - 0.45, chairCol, up) });
    things.push({
      depth: gx + gy,
      draw: () => {
        box(p, gx + 0.05, gy + 0.05, 0, 0.1, 0.1, t.h, darken(t.top, 0.4));
        box(p, gx + t.w - 0.15, gy + t.d - 0.15, 0, 0.1, 0.1, t.h, darken(t.top, 0.4));
        box(p, gx, gy, t.h, t.w, t.d, 2, t.cloth ?? t.top);
        if (up) {
          chair(p, gx + 0.1, gy + 0.1, chairCol, true);
          return;
        }
        if (free) {
          // Set: two plates, glasses and a candle.
          const [x, y] = P(gx + t.w / 2, gy + t.d / 2, t.h + 2);
          p.rect(x - 6, y - 1, 4, 2, c('#ffffff'));
          p.rect(x + 3, y - 1, 4, 2, c('#ffffff'));
          p.rect(x, y - 5, 1, 4, c('#f4efe4'));
          p.set(x, y - 6, c('#ffb347'));
          p.set(x, y - 7, c('#ffe08a'));
          for (let g = 0; g < 8; g++) p.set(x - 4 + ((g * 5) % 9), y - 8 + (g % 3), c('#ffe08a', 60));
        } else if (taken) {
          const [x, y] = P(gx + t.w / 2, gy + t.d / 2, t.h + 2);
          p.rect(x - 2, y - 1, 4, 2, c('#ffffff'));
          p.rect(x + 3, y - 4, 1, 3, c('#8a2a33'));
        }
      },
    });
    if (taken) things.push({ depth: gx + gy - 0.5, draw: () => guest(p, gx + t.w / 2 - 0.1, gy - 0.35, input.seed + i * 7) });
    things.push({ depth: gx + gy + t.d + 0.4, draw: () => chair(p, gx + t.w / 2 - 0.15, gy + t.d + 0.15, chairCol, up) });
    if (taken && t.w > 1.5) things.push({ depth: gx + gy + t.d + 0.5, draw: () => guest(p, gx + 0.4, gy + t.d + 0.3, input.seed + i * 3) });
    if (taken) things.push({ depth: gx + gy + t.d + 0.45, draw: () => guest(p, gx + t.w / 2 - 0.05, gy + t.d + 0.3, input.seed + i * 11) });
  });
  things.sort((a, b) => a.depth - b.depth).forEach((t) => t.draw());

  // Ceiling lamps.
  for (const [gx, gy] of k.tables.slice(0, 4)) lamp(p, gx + 0.4, gy + 0.4, lit);

  // The day's mood: night blue with the lights out when closed, faded when unknown, and a sign on the wall.
  if (!lit) {
    const night = c('#1f2a44');
    for (let i = 0; i < p.data.length; i++) {
      const v = p.data[i]!;
      if (v >>> 24) p.data[i] = input.status === 'closed' ? mix(v, night, 0.68) : mix(v, c('#d9d5df'), 0.35);
    }
  }
  if (input.status === 'closed' || input.status === 'later' || input.status === 'unknown') {
    // A hanging board on the right wall: red for closed, lavender for not yet, grey for unknown.
    // Closed: the board hangs in the dark too, so nothing in the room looks switched on.
    const board = input.status === 'closed' ? mix(c('#e0604c'), c('#1f2a44'), 0.45) : input.status === 'later' ? c('#8c7bd8') : c('#b9b4c2');
    onRightWall(p, 2.2, 22, 1.8, 13, c('#2b2733'));
    onRightWall(p, 2.25, 23, 1.7, 11, board);
    for (let i = 0; i < 4; i++) onRightWall(p, 2.45 + i * 0.35, 27.5, 0.22, 2, c('#fffaf0'));
    const [x0, y0] = P(3.1, 0, 35);
    p.line(x0 - 4, y0 - 6, x0, y0, c('#2b2733'));
    p.line(x0 + 4, y0 - 6, x0, y0, c('#2b2733'));
  }
  return p;
}
