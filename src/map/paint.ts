// Paints the city, cell by cell (4 m), into a Pix buffer. All art is drawn here in code from the world's data:
// ground, canals and quays, bridges, real trees, houseboats, and every building at its real height, with its roof
// colour from the aerial photo and walls and windows by the year it was built.
import { darken, dither, hash, lighten, mix, Pix, rgb } from './pix';
import { AGE, F, PX_PER_M, T, TH, TW, World } from './world';

const c = rgb;
export const PAL = {
  water: c('#2f86a8'),
  waterDeep: c('#28799a'),
  waterLight: c('#5fb0cc'),
  quay: c('#e4dccb'),
  quayWall: c('#7d7263'),
  paving: c('#d9c9a7'),
  pavingDot: c('#cbbb98'),
  pavement: c('#e4d8bb'),
  pavementLine: c('#d6c9aa'),
  asphalt: c('#b9ae98'),
  asphaltDot: c('#ab9f88'),
  square: c('#e6dab9'),
  squareLine: c('#d8cba8'),
  grass: c('#72b843'),
  grassDark: c('#5aa236'),
  grassLight: c('#8fcb57'),
  garden: c('#63a83d'),
  gardenDark: c('#4f9031'),
  woods: c('#4f9a33'),
  field: c('#a9c86a'),
  fieldLine: c('#97b85c'),
  concrete: c('#cfc8ba'),
  concreteLine: c('#bfb7a8'),
  sand: c('#e8d49c'),
  gravel: c('#a99f8e'),
  rail: c('#6f6860'),
  tram: c('#8a8278'),
  deck: c('#d9cfbc'),
  railing: c('#5c544c'),
  glass: c('#2e3742'),
  glassHi: c('#62798a'),
  trim: c('#efe7d6'),
  lit: c('#ffd56b'),
  litHi: c('#fff1b8'),
  ink: c('#2b2733'),
  leaf: c('#2f7d2a'),
  leafLight: c('#78c04e'),
  leafMid: c('#47983a'),
  leafDark: c('#225f20'),
  trunk: c('#6b4a33'),
  flowerA: c('#fff0a0'),
  flowerB: c('#f4a7c3'),
};

/** Walls by period: canal-house brick and paint; 19th-century brick; Amsterdam School; post-war; late 20th; new. */
const WALLS: number[][] = [
  ['#b8a99a'],
  ['#a5503b', '#8a3e2e', '#6b3a30', '#3f4a40', '#ece2cc', '#cfae7c', '#934f3c', '#4b5160', '#b96b4f', '#e6d9bf'],
  ['#a8432c', '#963b28', '#b65434', '#8e4a35', '#dccaa6', '#a24a30'],
  ['#a0432e', '#8c3826', '#ab4a30', '#9f5034', '#7f3123'],
  ['#d8d0bf', '#c4bfb3', '#c9a86e', '#a9adb0', '#e3dccb', '#b98b55'],
  ['#a06c52', '#b5805f', '#8f9396', '#cbbba0', '#86604b'],
  ['#ebe7df', '#5d6166', '#c9714c', '#aeb5b8', '#45494d', '#dacdb3', '#8e6c50'],
  ['#a9553d', '#8b5a45', '#c9b9a0', '#9da3a6'],
].map((list) => list.map((h) => c(h)));

export interface Special {
  /** Awning colour, from the day's status. */
  awning: number;
  lit: boolean;
}

const pick = <X>(list: X[], r: number) => list[Math.floor(r * list.length) % list.length]!;
const roofCache = new WeakMap<object, number[]>();
function roofPalette(w: World): number[] {
  let pal = roofCache.get(w.meta);
  if (!pal) roofCache.set(w.meta, (pal = w.meta.roofPalette.map((h) => c(h))));
  return pal;
}

/** Calls fn for every pixel of a cell's diamond (exact 2:1 tiling). u runs along +x, v along +y, both 0..1. */
function diamond(p: Pix, ox: number, oy: number, fn: (px: number, py: number, u: number, v: number) => number | null): void {
  for (let r = 0; r < TH; r++) {
    const half = (TW / 2) * (1 - Math.abs(r + 0.5 - TH / 2) / (TH / 2));
    const py = oy + r;
    for (let px = Math.ceil(ox - half - 0.5); px < ox + half - 0.5; px++) {
      const a = (px - ox + 0.5) / (TW / 2);
      const b = (r + 0.5) / (TH / 2);
      const col = fn(px, py, (a + b) / 2, (b - a) / 2);
      if (col !== null) p.set(px, py, col);
    }
  }
}

/** Ground in the shade of a building on its upper left, where the light comes from. */
function shaded(w: World, x: number, y: number): boolean {
  if (w.isBuilt(x - 1, y) || w.isBuilt(x, y - 1)) return true;
  return w.heightM(x - 2, y) > 12 || w.heightM(x - 1, y - 1) > 10;
}

/** Ground of one cell. gx, gy offset the buffer into world pixels, so textures run on across cells. */
export function paintGround(p: Pix, w: World, x: number, y: number, ox: number, oy: number, gx: number, gy: number): void {
  const t = w.terrain(x, y);
  const fl = w.flags(x, y);
  const shade = shaded(w, x, y);
  const S = (col: number) => (shade ? darken(col, 0.16) : col);

  if (t === T.water && !(fl & F.bridge)) {
    const landL = !w.isWater(x - 1, y);
    const landT = !w.isWater(x, y - 1);
    diamond(p, ox, oy, (px, py, u, v) => {
      const X = px + gx;
      const Y = py + gy;
      // The quay: a pale stone lip, then the wall down to the water.
      if ((landL && u < 0.25) || (landT && v < 0.25)) return PAL.quay;
      if ((landL && u < 0.34) || (landT && v < 0.34)) return PAL.quayWall;
      if ((landL && u < 0.44) || (landT && v < 0.44)) return PAL.waterLight; // light catches the water by the wall
      if ((X * 3 + Y * 7 + (Y >> 2) * 11) % 37 === 0 || (X + Y * 5) % 53 === 0) return PAL.waterLight;
      return PAL.water;
    });
    return;
  }

  if (t === T.water) {
    // A bridge: a stone deck with dark railings along its sides.
    const alongX = w.isStreetLike(x - 1, y) || w.isStreetLike(x + 1, y) || (!!(w.flags(x - 1, y) & F.bridge) && w.terrain(x - 1, y) === T.water);
    const edgeA = alongX ? w.isWater(x, y - 1) : w.isWater(x - 1, y);
    const edgeB = alongX ? w.isWater(x, y + 1) : w.isWater(x + 1, y);
    diamond(p, ox, oy, (_px, _py, u, v) => {
      const side = alongX ? v : u;
      if ((edgeA && side < 0.2) || (edgeB && side > 0.8)) return PAL.railing;
      return PAL.deck;
    });
    return;
  }

  diamond(p, ox, oy, (px, py) => {
    const X = px + gx;
    const Y = py + gy;
    switch (t) {
      case T.street:
        return S((X + (Y << 1)) % 6 === 0 && Y % 2 === 0 ? PAL.pavingDot : PAL.paving);
      case T.road:
        return S(hash(X >> 1, Y, 7) < 0.08 ? PAL.asphaltDot : PAL.asphalt);
      case T.square:
        return S((X * 5 + Y * 3) % 11 === 0 ? PAL.squareLine : PAL.square);
      case T.pavement:
        return S((X + Y * 2) % 8 === 0 ? PAL.pavementLine : PAL.pavement);
      case T.garden:
        return S(hash(X >> 1, Y, 8) < 0.14 ? PAL.gardenDark : PAL.garden);
      case T.park:
        if (hash(X, Y) < 0.01) return hash(Y, X) < 0.5 ? PAL.flowerA : PAL.flowerB;
        return S(hash(X >> 1, Y, 9) < 0.1 ? PAL.grassDark : hash(X >> 2, Y >> 1) < 0.12 ? PAL.grassLight : PAL.grass);
      case T.wood:
        return S(dither(X, Y, 0.5) ? PAL.grassDark : PAL.woods);
      case T.field:
        return (X + Y * 2) % 6 < 2 ? PAL.fieldLine : PAL.field;
      case T.sand:
        return dither(X, Y, 0.1) ? darken(PAL.sand, 0.08) : PAL.sand;
      case T.rail:
        return S(dither(X, Y, 0.4) ? darken(PAL.gravel, 0.1) : PAL.gravel);
      case T.industry:
        return S((X + Y * 2) % 16 === 0 ? PAL.concreteLine : PAL.concrete);
      default:
        return S(PAL.pavement);
    }
  });

  // Rails and tram tracks: two thin lines along whichever axis the line continues.
  const lineFlag = t === T.rail || fl & F.railLine ? F.railLine : fl & F.tram ? F.tram : 0;
  if (lineFlag) {
    const alongX = !!(w.flags(x - 1, y) & lineFlag) || !!(w.flags(x + 1, y) & lineFlag);
    const col = lineFlag === F.tram ? PAL.tram : PAL.rail;
    diamond(p, ox, oy, (_px, _py, u, v) => {
      const across = alongX ? v : u;
      if (Math.abs(across - 0.3) < 0.1 || Math.abs(across - 0.7) < 0.1) return col;
      return null;
    });
  }
}

// ── trees and boats ────────────────────────────────────────────────────────

const treeCache = new Map<number, Pix>();
/** A round street tree, about 12 m across, as Amsterdam's elms are: 15 x 18 pixels. Three variants. */
export function treeSprite(variant: number): Pix {
  const v = variant % 3;
  if (treeCache.has(v)) return treeCache.get(v)!;
  const p = new Pix(15, 18);
  p.rect(7, 14, 1, 4, PAL.trunk);
  const r = [6.6, 5.9, 7][v]!;
  const cx = 7.5;
  const cy = [7.5, 8, 7.5][v]!;
  for (let y = 0; y < 15; y++) {
    for (let x = 0; x < 15; x++) {
      const d = Math.hypot((x + 0.5 - cx) / r, (y + 0.5 - cy) / (r * 0.92));
      if (d > 1) continue;
      const k = x + 0.5 - cx + (y + 0.5 - cy);
      p.set(x, y, k < -4 ? PAL.leafLight : k < -0.5 ? PAL.leafMid : d > 0.84 || k > 4 ? PAL.leafDark : PAL.leaf);
    }
  }
  treeCache.set(v, p);
  return p;
}

const boatCache = new Map<number, Pix>();
/** A houseboat, 12 x 7: hull, a cream cabin with a yellow or white roof. */
function boatSprite(variant: number): Pix {
  const v = variant % 4;
  if (boatCache.has(v)) return boatCache.get(v)!;
  const p = new Pix(12, 7);
  const hull = [c('#2f4a3c'), c('#3b4f6b'), c('#5b2f2a'), c('#2d2d33')][v]!;
  const cabin = [c('#e9e1cf'), c('#cfd9d6'), c('#f0d9a8'), c('#d8c2a8')][v]!;
  p.rect(0, 4, 12, 2, hull);
  p.rect(1, 6, 10, 1, darken(hull, 0.2));
  p.rect(2, 1, 8, 3, cabin);
  p.rect(2, 0, 8, 1, v % 2 ? c('#e8c04a') : c('#f4f1ea'));
  p.set(4, 2, PAL.glass);
  p.set(7, 2, PAL.glass);
  boatCache.set(v, p);
  return p;
}

/** Things that stand on a cell: the city's own trees, more in parks and woods, houseboats along the quays. */
export function paintProps(p: Pix, w: World, x: number, y: number, ox: number, oy: number, simple = false): void {
  if (w.isBuilt(x, y)) return;
  const t = w.terrain(x, y);
  const r = hash(x, y, 3);
  if (w.isWater(x, y)) {
    const quay = !w.isWater(x - 1, y) || !w.isWater(x, y - 1) || !w.isWater(x + 1, y) || !w.isWater(x, y + 1);
    if (!simple && quay && r < 0.07 && w.isWater(x + 1, y) && w.isWater(x - 1, y)) p.blit(boatSprite(Math.floor(r * 100)), ox - 6, oy - 3);
    return;
  }
  const tree = !!(w.details(x, y) & 1) || (t === T.park && r < 0.12) || (t === T.wood && r < 0.35) || (t === T.garden && r < (simple ? 0.04 : 0.08));
  if (tree) p.blit(treeSprite(Math.floor(r * 30)), ox - 7, oy - 15);
}

// ── buildings ──────────────────────────────────────────────────────────────

/** Height in screen pixels at the top corner of cell (cx, cy): pitched roofs share their corners, so they slope. */
function corner(w: World, x: number, y: number, cx: number, cy: number, own: number): number {
  const d = w.details(x, y);
  if (!(d & 8)) return own;
  const key = w.roof(x, y) * 16 + (d >> 4);
  let sum = 0;
  let n = 0;
  for (const [ax, ay] of [[cx - 1, cy - 1], [cx, cy - 1], [cx - 1, cy], [cx, cy]] as const) {
    const da = w.details(ax, ay);
    if (!w.isBuilt(ax, ay) || !(da & 8) || w.roof(ax, ay) * 16 + (da >> 4) !== key) continue;
    sum += w.heightM(ax, ay);
    n++;
  }
  return n ? Math.min(own + 8, Math.round((sum / n) * PX_PER_M)) : own;
}

/**
 * Draws the building on a cell: a roof (flat, or part of a pitched roof that slopes with its neighbours) and the two
 * walls you see, facing +y (left, in the light) and +x (right, in the shade), down to the ground. Cells are painted
 * back to front, so the cells in front cover what they should.
 */
export function paintBuilding(p: Pix, w: World, x: number, y: number, ox: number, oy: number, special?: Special, simple = false): void {
  const own = w.heightPx(x, y);
  if (!own) return;
  const d = w.details(x, y);
  const age = d & 7;
  const pitched = !!(d & 8);
  const seed = d >> 4;
  const roofCol = roofPalette(w)[w.roof(x, y)] ?? PAL.concrete;
  const hT = corner(w, x, y, x, y, own);
  const hR = corner(w, x, y, x + 1, y, own);
  const hB = corner(w, x, y, x + 1, y + 1, own);
  const hL = corner(w, x, y, x, y + 1, own);

  // Roof: lit when it faces up-left, toward the light.
  const gx = (hR - hT + hB - hL) / 2;
  const gy = (hL - hT + hB - hR) / 2;
  // Three shades only (lit, flat, shaded), so a roof reads as clean planes, not a speckle of per-cell shades.
  const raw = (gx + 0.5 * gy) / 5;
  const s = raw > 0.2 ? 1 : raw < -0.2 ? -1 : 0;
  let top = s > 0 ? lighten(roofCol, 0.18 * s) : s < 0 ? darken(roofCol, -0.26 * s) : roofCol;
  if (pitched && !s) top = darken(roofCol, 0.04);
  const lowerL = !w.isBuilt(x - 1, y) || w.heightPx(x - 1, y) < own - 2;
  const lowerT = !w.isBuilt(x, y - 1) || w.heightPx(x, y - 1) < own - 2;
  p.poly(
    [
      [ox, oy - hT],
      [ox + TW / 2, oy + TH / 2 - hR],
      [ox, oy + TH - hB],
      [ox - TW / 2, oy + TH / 2 - hL],
    ],
    (px, py) => {
      // A flat roof's rim catches the light on its two far edges.
      if (!pitched) {
        const a = (px - ox + 0.5) / (TW / 2);
        const b = (py - (oy - own) + 0.5) / (TH / 2);
        if ((lowerL && (a + b) / 2 < 0.22) || (lowerT && (b - a) / 2 < 0.22)) return lighten(top, 0.14);
      }
      return top;
    },
  );

  // Walls.
  const palette = WALLS[age] ?? WALLS[AGE.unknown]!;
  const base = pick(palette, (seed + 0.5) / 16);
  const ribbon = age === AGE.postwar || age === AGE.new;
  const trimmed = age === AGE.old || age === AGE.c19;
  const face = (side: 'left' | 'right') => {
    const wall = side === 'left' ? base : darken(base, 0.3);
    const glass = side === 'left' ? PAL.glass : darken(PAL.glass, 0.1);
    const glassHi = side === 'left' ? PAL.glassHi : darken(PAL.glassHi, 0.25);
    const [ax, ay, ah, bx, by, bh] =
      side === 'left' ? [ox - TW / 2, oy + TH / 2, hL, ox, oy + TH, hB] : [ox, oy + TH, hB, ox + TW / 2, oy + TH / 2, hR];
    for (let X = ax; X < bx; X++) {
      const t = (X + 0.5 - ax) / (bx - ax);
      const ground = ay + (by - ay) * t;
      const edge = ground - (ah + (bh - ah) * t);
      const col = X - ax; // 0..3 along this cell's face
      const y0 = Math.floor(edge - 0.5) + 1;
      const y1 = Math.floor(ground - 0.5);
      for (let Y = y0; Y <= y1; Y++) {
        const hp = ground - (Y + 0.5); // pixels above the ground
        let px = wall;
        if (Y === y0) px = trimmed ? (side === 'left' ? PAL.trim : darken(PAL.trim, 0.25)) : lighten(wall, 0.12);
        else if (hp < 1) px = darken(wall, 0.18);
        else if (special && hp < 4) px = special.lit ? (hp > 2.5 ? PAL.litHi : PAL.lit) : glass;
        else if (special && hp < 5) px = col % 2 ? special.awning : lighten(special.awning, 0.3);
        else if (Y > y0 + 1) {
          const f = Math.floor(hp) % 4;
          const win = ribbon ? col !== 0 : col % 2 === 1;
          if (win && trimmed && (f === 0 || f === 3) && !simple) px = side === 'left' ? PAL.trim : darken(PAL.trim, 0.25); // sill, lintel
          else if (win && (f === 1 || f === 2) && !(simple && (Math.floor(hp / 4) + col) % 2)) {
            const lit = hash(x * 4 + col, y, Math.floor(hp / 4), side === 'left' ? 1 : 2) < 0.05;
            px = lit ? PAL.lit : f === 2 ? glassHi : glass;
          }
        }
        p.set(X, Y, px);
      }
    }
  };
  face('left');
  face('right');
}

/** One colour per cell for the far-away overview. */
export function overviewColour(w: World, x: number, y: number): number {
  if (w.isBuilt(x, y)) return roofPalette(w)[w.roof(x, y)] ?? PAL.concrete;
  switch (w.terrain(x, y)) {
    case T.water:
      return w.flags(x, y) & F.bridge ? PAL.deck : PAL.water;
    case T.street:
      return PAL.paving;
    case T.road:
      return PAL.asphalt;
    case T.square:
      return PAL.square;
    case T.pavement:
      return PAL.pavement;
    case T.garden:
      return PAL.garden;
    case T.park:
      return PAL.grass;
    case T.wood:
      return PAL.woods;
    case T.field:
      return PAL.field;
    case T.sand:
      return PAL.sand;
    case T.rail:
      return PAL.gravel;
    case T.industry:
      return PAL.concrete;
    default:
      return mix(PAL.pavement, PAL.garden, 0.5);
  }
}
