// Revived from a49cefd^:src/map/paint.ts. Paints Noord in RD cells (1.885618 m) into a Pix buffer. All art is drawn here in code from the world's data:
// ground, canals and quays, bridges, real trees, houseboats, and every building at its real height, with its roof
// colour from the aerial photo and walls and windows by the year it was built.
import { darken, dither, hash, lighten, mix, Pix, rgb } from './pix';
import { AGE, F, PX_PER_M, T, TH, TW, World } from './noord-grid';

// Palette measured from sezlab colours; geometry remains our old cell painter.
const c = rgb;
export const PAL = {
  water: c('#3a869a'),
  waterDeep: c('#30778b'),
  waterLight: c('#41869a'),
  quay: c('#e7d4b8'),
  quayWall: c('#797368'),
  paving: c('#dfcdae'),
  pavingDot: c('#d8c5aa'),
  pavement: c('#e7d4b8'),
  pavementLine: c('#dfcdae'),
  asphalt: c('#797368'),
  asphaltDot: c('#686665'),
  square: c('#e6dab9'),
  squareLine: c('#d8cba8'),
  grass: c('#86b23b'),
  grassDark: c('#70a14e'),
  grassLight: c('#8cc43b'),
  garden: c('#70a14e'),
  gardenDark: c('#398526'),
  woods: c('#398526'),
  field: c('#a9c86a'),
  fieldLine: c('#97b85c'),
  concrete: c('#b9a995'),
  concreteLine: c('#a79886'),
  sand: c('#e8d49c'),
  gravel: c('#a99f8e'),
  rail: c('#6f6860'),
  tram: c('#8a8278'),
  deck: c('#d9cfbc'),
  railing: c('#5c544c'),
  glass: c('#2b2733'),
  glassHi: c('#62798a'),
  trim: c('#efe7d6'),
  lit: c('#ffd56b'),
  litHi: c('#fff1b8'),
  ink: c('#2b2733'),
  leaf: c('#599533'),
  leafLight: c('#86b23b'),
  leafMid: c('#70a14e'),
  leafDark: c('#2c601d'),
  trunk: c('#6b4a33'),
  flowerA: c('#fff0a0'),
  flowerB: c('#f4a7c3'),
};

/** Walls by period: canal-house brick and paint; 19th-century brick; Amsterdam School; post-war; late 20th; new. */
const WALLS: number[][] = [
  ['#b9a489'],
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

/** Coherent material wear, anchored to world pixels so no cell/chunk motif repeats. */
function surface(X: number, Y: number, base: number, worn: number, light: number): number {
  const u = X / 48, v = Y / 24, ix = Math.floor(u), iy = Math.floor(v);
  const fx = u - ix, fy = v - iy;
  const a = hash(ix, iy, 67), b = hash(ix + 1, iy, 67), c = hash(ix, iy + 1, 67), d = hash(ix + 1, iy + 1, 67);
  const patch = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  // Broken material transitions, rather than smooth camouflage blobs or a repeated paving stamp.
  const edge = (hash(X >> 1, Y, 71) - 0.5) * 0.02;
  if (patch + edge < 0.31) return worn;
  if (patch + edge > 0.72) return light;
  return base;
}

/** Shade the completed pixel shoreline, never each diamond's guessed land-facing edges. */
export function finishQuays(p: Pix): void {
  const waterColours = new Set([PAL.water, PAL.waterDeep, PAL.waterLight, c('#388ba2'), c('#4e92a4')]);
  const water = new Uint8Array(p.data.length);
  for (let i = 0; i < water.length; i++) water[i] = +waterColours.has(p.data[i]!);
  const banks: number[] = [];
  for (let y = 1; y < p.h - 1; y++) for (let x = 1; x < p.w - 1; x++) {
    const i = y * p.w + x;
    if (!water[i]) continue;
    if ([i - 1, i + 1, i - p.w, i + p.w].some(j => !water[j] && p.data[j] !== 0 && p.data[j] !== PAL.deck)) banks.push(i);
  }
  for (const i of banks) for (const j of [i - 1, i + 1, i - p.w, i + p.w]) if (water[j]) p.data[j] = PAL.waterLight;
  for (const i of banks) p.data[i] = PAL.quayWall;
}

/** One continuous one-pixel railing along the water-facing boundary of a completed bridge. */
export function finishBridges(p: Pix): void {
  const water = new Set([PAL.water, PAL.waterDeep, PAL.waterLight, c('#388ba2'), c('#4e92a4')]);
  const edges: number[] = [];
  for (let y = 1; y < p.h - 1; y++) for (let x = 1; x < p.w - 1; x++) {
    const i = y * p.w + x;
    if (p.data[i] !== PAL.deck) continue;
    if ([i - 1, i + 1, i - p.w, i + p.w].some(j => water.has(p.data[j]!))) edges.push(i);
  }
  for (const i of edges) p.data[i] = PAL.railing;
}

/** Ground of one cell. gx, gy offset the buffer into world pixels, so textures run on across cells. */
export function paintGround(p: Pix, w: World, x: number, y: number, ox: number, oy: number, gx: number, gy: number): void {
  const t = w.terrain(x, y);
  const fl = w.flags(x, y);
  const shade = shaded(w, x, y);
  const S = (col: number) => (shade ? darken(col, 0.16) : col);

  if (t === T.water && !(fl & F.bridge)) {
    diamond(p, ox, oy, (px, py) => {
      const X = px + gx;
      const Y = py + gy;
      const distance = w.shoreDistance(x, y);
      const ripple = hash(X >> 1, Y, 41);
      const patch = hash(X >> 4, Y >> 3, 43);
      // Broken short ripples fade away from the actual OSM shore, leaving deep IJ water quiet.
      if (distance < 18 && ripple < (1 - distance / 18) * 0.25) return patch < 0.45 ? c('#4e92a4') : PAL.waterLight;
      if (distance < 6 && patch < 0.24) return PAL.waterDeep;
      if (distance < 24 && patch > 0.72 && ripple < 0.04) return c('#388ba2');
      return PAL.water;
    });
    return;
  }

  if (t === T.water) {
    // Railings are added to the completed bridge silhouette, never independently per cell.
    diamond(p, ox, oy, () => PAL.deck);
    return;
  }

  diamond(p, ox, oy, (px, py) => {
    const X = px + gx;
    const Y = py + gy;
    switch (t) {
      case T.street:
        return S(surface(X, Y, PAL.paving, PAL.pavingDot, PAL.pavement));
      case T.road:
        return S(surface(X, Y, PAL.asphalt, PAL.asphaltDot, c('#8b8984')));
      case T.stone:
        return S(surface(X, Y, PAL.quayWall, PAL.asphaltDot, c('#8b8984')));
      case T.square:
        return S(surface(X, Y, PAL.square, PAL.squareLine, PAL.pavement));
      case T.pavement:
        return S(surface(X, Y, PAL.pavement, PAL.paving, PAL.pavingDot));
      case T.garden:
        return S(surface(X, Y, PAL.garden, PAL.grassDark, PAL.grass));
      case T.park:
        return S(surface(X, Y, PAL.grass, PAL.grassDark, PAL.grassLight));
      case T.wood:
        return S(surface(X, Y, PAL.grassDark, PAL.woods, PAL.garden));
      case T.field:
        return (X + Y * 2) % 6 < 2 ? PAL.fieldLine : PAL.field;
      case T.sand:
        return dither(X, Y, 0.1) ? darken(PAL.sand, 0.08) : PAL.sand;
      case T.rail:
        return S(dither(X, Y, 0.4) ? darken(PAL.gravel, 0.1) : PAL.gravel);
      case T.industry:
        return S(surface(X, Y, PAL.concrete, c('#b9a489'), c('#c7b399')));
      default:
        return S(surface(X, Y, PAL.pavement, PAL.paving, PAL.pavingDot));
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
/** Seeded crowns with asymmetric lobes, gaps and varying stature. No three-sprite cycle. */
export function treeSprite(variant: number): Pix {
  const v = variant >>> 0;
  if (treeCache.has(v)) return treeCache.get(v)!;
  const p = new Pix(23, 28);
  const r = 3.6 + hash(v, 7) * 5.1;
  const stretch = 0.82 + hash(v, 11) * (v % 11 === 0 ? 0.5 : 0.3);
  const cx = 11, cy = 22 - r * stretch;
  const trunk = 11 + Math.floor(hash(v, 3) * 3) - 1;
  p.rect(trunk, Math.floor(cy), 1, 27 - Math.floor(cy), PAL.trunk);
  const phase = hash(v, 29) * Math.PI * 2;
  const lobes = [{ x: cx, y: cy, r: r * 0.7 }, ...Array.from({ length: 5 }, (_, i) => {
    const angle = phase + (i + hash(v, i, 13) * 0.45) * Math.PI * 2 / 5;
    return {
      x: cx + Math.cos(angle) * r * 0.47,
      y: cy + Math.sin(angle) * r * 0.47 * stretch,
      r: r * (0.4 + hash(v, i, 23) * 0.2),
    };
  })];
  const tones = v % 4 === 0 ? [c('#96c658'), PAL.leafLight, PAL.leaf, PAL.leafDark]
    : v % 4 === 1 ? [PAL.leafLight, PAL.leafMid, c('#398526'), PAL.leafDark]
    : [PAL.leafMid, PAL.leaf, c('#398526'), PAL.leafDark];
  for (let y = 0; y < 25; y++) for (let x = 0; x < 23; x++) {
    const d = Math.min(...lobes.map(l => Math.hypot((x - l.x) / l.r, (y - l.y) / (l.r * stretch))));
    if (d > 1) continue;
    const light = (x - cx + (y - cy) * 0.65) / r + (hash(x >> 1, y >> 1, v) - 0.5) * 0.8;
    p.set(x, y, tones[d > 0.84 && light > -0.15 ? 3 : light < -0.4 ? 0 : light < 0.1 ? 1 : light < 0.7 ? 2 : 3]!);
  }
  if (treeCache.size >= 256) treeCache.clear();
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
    if (!simple && quay && r < 0.035 && w.isWater(x + 1, y) && w.isWater(x - 1, y)) p.blit(boatSprite(Math.floor(r * 100)), ox - 6, oy - 3);
    return;
  }
  const tree = !!(w.details(x, y) & 1) || (t === T.park && r < (hash(x >> 4, y >> 4, 107) < 0.5 ? 0.006 : 0.025)) || (t === T.wood && r < (hash(x >> 4, y >> 4, 103) < 0.5 ? 0.008 : 0.035)) || (t === T.garden && r < (simple ? 0.0025 : 0.00375));
  if (tree) {
    const seed = Math.floor(hash(x, y, 31) * 0x1000000);
    // OSM anchors stay put; scatter inferred park trees within their source cell.
    const jitter = w.details(x, y) & 1 ? 0 : Math.floor(hash(x, y, 37) * 3) - 1;
    p.blit(treeSprite(seed), ox - 11 + jitter, oy - 25);
  }
}

// ── buildings ──────────────────────────────────────────────────────────────

/** Height in screen pixels at the top corner of cell (cx, cy): pitched roofs share their corners, so they slope. */
function corner(w: World, x: number, y: number, cx: number, cy: number, own: number): number {
  const d = w.details(x, y);
  if (!(d & 8)) return own;
  const key = w.buildingSeed(x, y);
  let sum = 0;
  let n = 0;
  for (const [ax, ay] of [[cx - 1, cy - 1], [cx, cy - 1], [cx - 1, cy], [cx, cy]] as const) {
    const da = w.details(ax, ay);
    if (!w.isBuilt(ax, ay) || !(da & 8) || w.buildingSeed(ax, ay) !== key) continue;
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
  const seed = w.buildingSeed(x, y);
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
  const base = pick(palette, hash(seed, 73));
  const industrial = w.industrial(x, y);
  const ribbon = !industrial && (age === AGE.postwar || age === AGE.new) && seed % 3 === 0;
  const trimmed = age === AGE.old || age === AGE.c19;
  const face = (side: 'left' | 'right') => {
    // One source-polygon normal per exposed cell: diagonal footprint walls must not alternate
    // bright/dark on each stair of the raster grid (the old vertical-bar facade artifact).
    const normal = w.facadeShade(x, y);
    const shade = normal ? (normal - 1) / 6 : side === 'left' ? 0 : 1;
    const wall = darken(base, shade * 0.3);
    const glassBase = pick([c('#2d4f5a'), c('#393b43'), c('#474953'), c('#544b45'), PAL.glass], hash(seed, 79));
    const glass = darken(glassBase, shade * 0.12);
    const glassHi = darken(PAL.glassHi, shade * 0.25);
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
        if (Y === y0) px = trimmed ? darken(PAL.trim, shade * 0.25) : lighten(wall, 0.12);
        else if (hp < 1) px = mix(wall, pick([c('#544b45'), c('#453a36'), c('#2a2c33')], hash(seed, 101)), 0.6);
        else if (special && hp < 4) px = special.lit ? (hp > 2.5 ? PAL.litHi : PAL.lit) : glass;
        else if (special && hp < 5) px = col % 2 ? special.awning : lighten(special.awning, 0.3);
        else if (Y > y0 + 1) {
          // Facade bays continue in RD coordinates, instead of restarting every 1.89 m cell.
          const along = (x - y) * (TW / 2) + X - ox;
          const bay = industrial ? 6 + seed % 5 : age === AGE.new ? 3 + seed % 3 : 3 + seed % 2;
          const floor = industrial ? 9 + seed % 4 : 4 + seed % 2;
          const phase = ((along + seed % bay) % bay + bay) % bay;
          const f = Math.floor(hp) % floor;
          const bayId = Math.floor((along + seed % bay) / bay);
          const blank = hash(bayId, seed, side === 'left' ? 1 : 2) < (industrial ? 0.24 : 0.06);
          const win = !blank && (ribbon ? phase !== 0 : phase > 0 && phase < Math.max(2, bay - 1));
          const glazed = industrial ? hp > own * 0.55 && f > 1 && f < 5 : f === 1 || f === 2;
          if (win && trimmed && f === 0 && !simple) px = darken(PAL.trim, shade * 0.25);
          else if (win && glazed) {
            const reflect = hash(bayId, seed, 83);
            px = reflect < 0.18 ? glassHi : glass;
          } else if (industrial && hp < 5 && phase > 1 && phase < bay - 1 && hash(bayId, seed, 89) < 0.18) {
            px = darken(wall, 0.25); // loading doors, at ground level only
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
    case T.stone:
      return PAL.quayWall;
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
