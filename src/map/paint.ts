// Paints the city, tile by tile, into a Pix buffer. All art is drawn here in code: ground, canals and their
// stone walls, bridges, trees, houseboats, and the buildings (gabled canal houses in the centre, brick rows in
// the 19th-century belt, modern blocks further out, warehouses on industrial land).
import { darken, dither, hash, lighten, mix, Pix, rgb } from './pix';
import { F, S, T, TH, TW, World } from './world';

const c = rgb;
export const PAL = {
  water: c('#6cb4c4'),
  waterDeep: c('#5aa3b6'),
  waterLight: c('#a6dbe2'),
  wallTop: c('#b8a893'),
  wall: c('#7b6656'),
  wallDark: c('#5c4a3f'),
  paving: c('#d6cbb8'),
  pavingDot: c('#c4b8a3'),
  asphalt: c('#a9a39a'),
  asphaltDot: c('#9b958c'),
  square: c('#e2d8c6'),
  squareLine: c('#d1c5b0'),
  grass: c('#a9d07c'),
  grassDark: c('#93c06a'),
  woods: c('#8ab95f'),
  field: c('#cbd88e'),
  fieldLine: c('#b9c97c'),
  concrete: c('#d2cdc3'),
  concreteLine: c('#c2bcb1'),
  sand: c('#ecdba8'),
  gravel: c('#b2a898'),
  rail: c('#6f6860'),
  sleeper: c('#8b6f55'),
  tram: c('#8e877e'),
  deck: c('#c9bba5'),
  railing: c('#8d7f6e'),
  roof: c('#6e5a52'),
  roofDark: c('#5a4842'),
  zinc: c('#8c939b'),
  glass: c('#5f7d90'),
  glassHi: c('#a9c6d4'),
  lit: c('#ffd56b'),
  litHi: c('#fff1b8'),
  trim: c('#f4efe4'),
  ink: c('#2b2733'),
  leaf: c('#6aa84f'),
  leafLight: c('#8cc66a'),
  leafDark: c('#4f8a3c'),
  trunk: c('#7a5a3c'),
  flowerA: c('#fff0a0'),
  flowerB: c('#f4a7c3'),
};

/** Facade colours. Canal houses: brick, painted black-green, white plaster, sand. */
const CANAL = ['#9e4a3c', '#7e3d34', '#5b3b33', '#38443b', '#ece4d2', '#c9a878', '#8a5642', '#4a4f5c', '#b36b4f', '#e7dcc4'].map((h) => c(h));
const BRICK = ['#9a4c3b', '#8b5a45', '#a8694c', '#7f4637', '#b98b62', '#94604c'].map((h) => c(h));
const MODERN = ['#e8e4dc', '#d4d0c8', '#c88b6a', '#9aa6ad', '#d9c7a5', '#7d8a80', '#f0ebe0', '#b5a28a'].map((h) => c(h));
const WARE = ['#8f9a8a', '#a8735a', '#c4b79c', '#7c8a95', '#9c8f7a'].map((h) => c(h));

export interface Special {
  /** Awning colour, from the day's status. */
  awning: number;
  lit: boolean;
}

const pick = <X>(list: X[], r: number) => list[Math.floor(r * list.length) % list.length]!;

/** Calls fn for every pixel of a tile's diamond. u runs along +x, v along +y, both 0..1. */
function diamond(p: Pix, ox: number, oy: number, fn: (px: number, py: number, u: number, v: number) => number | null): void {
  for (let r = 0; r < TH; r++) {
    const hw = r < TH / 2 ? 2 * (r + 1) : 2 * (TH - r);
    const py = oy + r;
    for (let px = ox - hw; px < ox + hw; px++) {
      const a = (px - ox + 0.5) / (TW / 2);
      const b = (r + 0.5) / (TH / 2);
      const col = fn(px, py, (a + b) / 2, (b - a) / 2);
      if (col !== null) p.set(px, py, col);
    }
  }
}

const isWater = (w: World, x: number, y: number) => w.terrain(x, y) === T.water && !(w.flags(x, y) & F.bridge);

/** A built tile whose eight neighbours are all built: the inside of a block, so often a garden. */
export function isCourtyard(w: World, x: number, y: number): boolean {
  if (w.terrain(x, y) !== T.land) return false;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (!w.isBuilt(x + dx, y + dy)) return false;
  return hash(x, y, 7) < 0.72;
}

/** Ground of one tile. gx, gy offset the buffer into world pixels, so textures run on across tiles. */
export function paintGround(p: Pix, w: World, x: number, y: number, ox: number, oy: number, gx: number, gy: number): void {
  const t = w.terrain(x, y);
  const fl = w.flags(x, y);
  const G = (px: number, py: number) => [px + gx, py + gy] as const;

  if (t === T.water && !(fl & F.bridge)) {
    const landL = !isWater(w, x - 1, y);
    const landT = !isWater(w, x, y - 1);
    diamond(p, ox, oy, (px, py, u, v) => {
      const [X, Y] = G(px, py);
      // Canal walls on the two far edges: a stone lip, then brick going down to the water.
      if (landL && u < 0.16) return u < 0.05 ? PAL.wallTop : u < 0.11 ? PAL.wall : PAL.wallDark;
      if (landT && v < 0.16) return v < 0.05 ? PAL.wallTop : v < 0.11 ? PAL.wall : PAL.wallDark;
      const ripple = (X * 3 + Y * 7 + ((Y >> 2) * 11)) % 37 === 0 || (X + Y * 5) % 53 === 0;
      if (ripple) return PAL.waterLight;
      return dither(X >> 1, Y, 0.18) ? PAL.waterDeep : PAL.water;
    });
    return;
  }

  if (t === T.water && fl & F.bridge) {
    // A bridge: a stone deck with railings along its sides, water showing under the arch.
    const alongX = w.isStreetLike(x - 1, y) || w.isStreetLike(x + 1, y) || !!(w.flags(x - 1, y) & F.bridge);
    diamond(p, ox, oy, (px, py, u, v) => {
      const side = alongX ? v : u;
      if (side < 0.1 || side > 0.9) return ((alongX ? u : v) * 8) % 1 < 0.3 ? darken(PAL.railing, 0.25) : PAL.railing;
      if (side > 0.8) return darken(PAL.deck, 0.15);
      const [X, Y] = G(px, py);
      return dither(X, Y, 0.15) ? PAL.pavingDot : PAL.deck;
    });
    return;
  }

  diamond(p, ox, oy, (px, py, u, v) => {
    const [X, Y] = G(px, py);
    switch (t) {
      case T.street:
        return (X + (Y << 1)) % 4 === 0 && Y % 2 === 0 ? PAL.pavingDot : PAL.paving;
      case T.road:
        return dither(X, Y, 0.22) ? PAL.asphaltDot : PAL.asphalt;
      case T.square:
        return (X * 5 + Y * 3) % 11 === 0 ? PAL.squareLine : PAL.square;
      case T.park:
        if (hash(X, Y) < 0.012) return hash(Y, X) < 0.5 ? PAL.flowerA : PAL.flowerB;
        return dither(X, Y, 0.3) ? PAL.grassDark : PAL.grass;
      case T.wood:
        return dither(X, Y, 0.5) ? PAL.grassDark : PAL.woods;
      case T.field:
        return (X + Y * 2) % 6 < 2 ? PAL.fieldLine : PAL.field;
      case T.sand:
        return dither(X, Y, 0.1) ? darken(PAL.sand, 0.08) : PAL.sand;
      case T.rail:
        return dither(X, Y, 0.4) ? darken(PAL.gravel, 0.1) : PAL.gravel;
      case T.industry:
        return (X + Y * 2) % 16 === 0 ? PAL.concreteLine : PAL.concrete;
      default:
        // Under a building, or a courtyard garden.
        return isCourtyard(w, x, y) ? (dither(X, Y, 0.3) ? PAL.grassDark : PAL.grass) : PAL.paving;
    }
  });

  // Rails: along whichever axis the line continues.
  const lineFlag = t === T.rail || fl & F.railLine ? F.railLine : fl & F.tram ? F.tram : 0;
  if (lineFlag) {
    const alongX = !!(w.flags(x - 1, y) & lineFlag) || !!(w.flags(x + 1, y) & lineFlag);
    const railCol = lineFlag === F.tram ? PAL.tram : PAL.rail;
    diamond(p, ox, oy, (_px, _py, u, v) => {
      const across = alongX ? v : u;
      const along = alongX ? u : v;
      if (lineFlag === F.railLine && Math.abs(across - 0.5) < 0.22 && (along * 6) % 1 < 0.3) return PAL.sleeper;
      if (Math.abs(across - 0.38) < 0.03 || Math.abs(across - 0.62) < 0.03) return railCol;
      return null;
    });
  }

  // A light kerb where a street meets the canal.
  if ((t === T.street || t === T.road) && fl & F.quay) {
    diamond(p, ox, oy, (_px, _py, u, v) => {
      if ((isWater(w, x + 1, y) && u > 0.92) || (isWater(w, x, y + 1) && v > 0.92)) return PAL.wallTop;
      return null;
    });
  }
}

// ── trees, boats, bikes ────────────────────────────────────────────────────

const treeCache = new Map<number, Pix>();
/** A round tree, 16 x 22. Three variants. */
export function treeSprite(variant: number): Pix {
  const v = variant % 3;
  if (treeCache.has(v)) return treeCache.get(v)!;
  const p = new Pix(16, 22);
  p.rect(7, 14, 2, 7, PAL.trunk);
  p.set(6, 20, darken(PAL.trunk, 0.2));
  const r = [6.5, 5.5, 6][v]!;
  const cx = 8;
  const cy = [8, 9, 8][v]!;
  for (let y = 0; y < 18; y++) {
    for (let x = 0; x < 16; x++) {
      const d = Math.hypot((x - cx + 0.5) / r, (y - cy + 0.5) / (r * 0.95));
      if (d > 1) continue;
      const light = x - cx + (y - cy) < -2;
      const dark = x - cx + (y - cy) > 3 || d > 0.85;
      p.set(x, y, light ? PAL.leafLight : dark ? PAL.leafDark : dither(x, y, 0.25) ? PAL.leafDark : PAL.leaf);
    }
  }
  p.outline(darken(PAL.leafDark, 0.35));
  treeCache.set(v, p);
  return p;
}

const boatCache = new Map<number, Pix>();
/** A houseboat: hull, cabin, a few windows and plants on the roof. */
function boatSprite(variant: number): Pix {
  const v = variant % 4;
  if (boatCache.has(v)) return boatCache.get(v)!;
  const p = new Pix(22, 14);
  const hull = [c('#2f4a3c'), c('#3b4f6b'), c('#5b2f2a'), c('#2d2d33')][v]!;
  const cabin = [c('#e9e1cf'), c('#cfd9d6'), c('#f0d9a8'), c('#d8c2a8')][v]!;
  p.poly([[1, 8], [21, 8], [19, 12], [3, 12]], hull);
  p.hline(1, 21, 8, lighten(hull, 0.25));
  p.rect(4, 3, 14, 5, cabin);
  p.rect(4, 2, 14, 1, darken(cabin, 0.35));
  for (let i = 0; i < 3; i++) p.rect(6 + i * 4, 4, 2, 2, PAL.glass);
  if (v % 2 === 0) {
    p.set(15, 1, PAL.leaf);
    p.set(16, 1, PAL.leafLight);
    p.set(16, 0, PAL.flowerB);
  }
  boatCache.set(v, p);
  return p;
}

function paintBikes(p: Pix, ox: number, oy: number, n: number, seed: number): void {
  const wheel = c('#5a5462');
  for (let i = 0; i < n; i++) {
    const bx = ox - 5 + i * 4;
    const by = oy + 9 + (i % 2);
    const frame = [c('#b8473b'), c('#3c6e8f'), c('#e6b33a'), c('#5b8f4e')][Math.floor(hash(seed, i) * 4)]!;
    p.set(bx, by, wheel);
    p.set(bx + 2, by, wheel);
    p.set(bx + 1, by - 1, frame);
    p.set(bx + 2, by - 2, frame);
  }
}

/** Things that stand on a tile: trees on quays and in parks, houseboats along canals, parked bikes. */
export function paintProps(p: Pix, w: World, x: number, y: number, ox: number, oy: number): void {
  const t = w.terrain(x, y);
  const fl = w.flags(x, y);
  const r = hash(x, y, 3);
  if (t === T.water && !(fl & F.bridge)) {
    const quay = w.isStreetLike(x - 1, y) || w.isStreetLike(x, y - 1) || w.isStreetLike(x + 1, y) || w.isStreetLike(x, y + 1);
    const canalSide = w.style(x, y) <= S.brick;
    if (quay && canalSide && r < 0.16) p.blit(boatSprite(Math.floor(r * 100)), ox - 11, oy + 1);
    return;
  }
  const tree =
    ((t === T.street || t === T.square) && fl & F.quay && r < 0.55) ||
    (t === T.park && r < 0.2) ||
    (t === T.wood && r < 0.75) ||
    (isCourtyard(w, x, y) && r < 0.35);
  if (tree) p.blit(treeSprite(Math.floor(r * 30)), ox - 8, oy - 12);
  else if (t === T.street && fl & F.quay && r > 0.55 && r < 0.68) paintBikes(p, ox, oy, 2 + Math.floor(hash(x, y, 8) * 2), x * 7 + y);
}

// ── buildings ──────────────────────────────────────────────────────────────

/** Height above the facade line, per column (0..7) of a house front. */
const GABLES: number[][] = [
  [2, 4, 4, 7, 7, 4, 4, 2], // step gable
  [1, 3, 5, 6, 6, 5, 3, 1], // bell gable
  [1, 1, 5, 7, 7, 5, 1, 1], // neck gable
  [2, 3, 4, 5, 5, 4, 3, 2], // spout gable
  [1, 1, 1, 1, 1, 1, 1, 1], // flat with a cornice
];

interface Facade {
  colour: number;
  gable: number[] | null;
  trimmed: boolean;
  floors: number;
}

/**
 * Draws one block on a tile. The two faces you see point to +y (left) and +x (right); each holds two houses.
 * Gables go only on fronts that face a street, a canal or a park, like the real thing.
 */
export function paintBuilding(p: Pix, w: World, x: number, y: number, ox: number, oy: number, special?: Special): void {
  const t = w.terrain(x, y);
  if (t !== T.land && t !== T.industry) return;
  if (!special && isCourtyard(w, x, y)) return;
  const style = t === T.industry ? S.warehouse : w.style(x, y);
  const r = hash(x, y, 1);
  if (style === S.warehouse && !special && r < 0.35) return; // open yard
  const { floors, floorH, H } = buildingSize(w, x, y);
  const palette = style === S.canal ? CANAL : style === S.brick ? BRICK : style === S.modern ? MODERN : WARE;

  // Roof.
  const roof = style === S.modern ? PAL.zinc : style === S.warehouse ? c('#9aa09a') : PAL.roof;
  // Canal houses and brick rows get pitched roofs whose ridges run back from the main front: two houses, two
  // slopes each, so four strips, lit on one side. Modern blocks are flat with a rim; warehouses have sawtooth roofs.
  const mainFront = !w.isBuilt(x, y + 1) ? 'left' : !w.isBuilt(x + 1, y) ? 'right' : hash(x, y, 9) < 0.5 ? 'left' : 'right';
  const tileRoof = style === S.canal ? pick([c('#7a5248'), c('#6e5a52'), c('#5d6066'), c('#80503f')], hash(x, y, 17)) : PAL.roof;
  diamond(p, ox, oy - H, (px, py, u, v) => {
    if (style === S.warehouse) return (u * 6) % 1 < 0.5 ? roof : darken(roof, 0.12);
    if (style === S.modern) return u < 0.08 || v < 0.08 ? lighten(roof, 0.25) : dither(px, py, 0.1) ? darken(roof, 0.08) : roof;
    const across = mainFront === 'left' ? u : v; // position across the fronts
    const strip = (across * 4) % 1;
    const ridge = strip > 0.46 && strip < 0.56;
    const lit = strip < 0.5;
    if (ridge) return lighten(tileRoof, 0.22);
    return lit ? lighten(tileRoof, 0.1) : darken(tileRoof, 0.12);
  });

  const front = (dx: number, dy: number) => !w.isBuilt(x + dx, y + dy) || isCourtyard(w, x + dx, y + dy);
  const faces: Array<{ side: 'left' | 'right'; open: boolean }> = [
    { side: 'left', open: front(0, 1) },
    { side: 'right', open: front(1, 0) },
  ];
  for (const face of faces) {
    for (let house = 0; house < 2; house++) {
      const hr = hash(x, y, face.side === 'left' ? 11 : 13, house);
      const f: Facade = {
        colour: pick(palette, hr),
        gable: style === S.canal && face.open ? GABLES[Math.floor(hash(x, y, house, 5) * GABLES.length)]! : style === S.brick && face.open ? GABLES[4]! : null,
        trimmed: style === S.canal,
        floors,
      };
      paintHouse(p, ox, oy, H, floorH, face.side, house, f, style, x, y, special && face.open ? special : undefined);
    }
  }
}

/** Floors and height in pixels of the block on a tile (0 when it has none). The map's signs sit on top. */
export function buildingSize(w: World, x: number, y: number): { floors: number; floorH: number; H: number } {
  const t = w.terrain(x, y);
  if (t !== T.land && t !== T.industry) return { floors: 0, floorH: 0, H: 0 };
  const style = t === T.industry ? S.warehouse : w.style(x, y);
  const r = hash(x, y, 1);
  const floorH = style === S.modern ? 5 : 6;
  const floors =
    style === S.canal ? 3 + Math.floor(r * 3) : style === S.brick ? 4 + Math.floor(r * 2) : style === S.modern ? 3 + Math.floor(r * 4) + (r > 0.96 ? 8 : 0) : 2;
  return { floors, floorH, H: floors * floorH + (style === S.warehouse ? 4 : 0) };
}

function paintHouse(
  p: Pix,
  ox: number,
  oy: number,
  H: number,
  floorH: number,
  side: 'left' | 'right',
  house: number,
  f: Facade,
  style: number,
  tx: number,
  ty: number,
  special?: Special,
): void {
  const wall = side === 'left' ? f.colour : darken(f.colour, 0.22);
  const lightWall = f.colour === CANAL[4] || f.colour === CANAL[9] || style === S.modern;
  for (let i = 0; i < 8; i++) {
    // Column along the face: left face runs from the left corner to the bottom; right face from bottom to right.
    const col = side === 'left' ? ox - 16 + house * 8 + i : ox + house * 8 + i;
    const base = side === 'left' ? oy + 8 + Math.floor((col - (ox - 16)) / 2) + 0 : oy + 16 - 1 - Math.floor((col - ox) / 2);
    const bottom = side === 'left' ? base : base;
    const gableH = f.gable ? f.gable[side === 'left' ? i : 7 - i]! : 0;
    const top = bottom - H - gableH;
    for (let yy = top; yy <= bottom; yy++) p.set(col, yy, wall);
    // Gable trim and hoist beam.
    if (f.gable) {
      p.set(col, top, f.trimmed ? PAL.trim : lighten(wall, 0.2));
      if (f.trimmed && (i === 3 || i === 4) && gableH >= 5) p.set(col, top + 2, PAL.ink);
    } else if (style !== S.warehouse) {
      p.set(col, top, lighten(wall, 0.15));
    }
    // Windows: columns 1-2 and 5-6 of each house, one per floor.
    const winCol = i === 1 || i === 2 || i === 5 || i === 6;
    const ribbon = style === S.modern && i > 0 && i < 7;
    for (let fl = 0; fl < f.floors; fl++) {
      const fb = bottom - fl * floorH; // floor bottom
      const ground = fl === 0;
      if (special && ground) {
        // A restaurant: a lit shop window and an awning in today's colour.
        if (i > 0 && i < 7) {
          for (let yy = fb - 4; yy <= fb - 1; yy++) p.set(col, yy, special.lit ? (yy === fb - 4 ? PAL.litHi : PAL.lit) : PAL.glass);
        }
        p.set(col, fb - 5, i % 2 ? special.awning : lighten(special.awning, 0.35));
        p.set(col, fb - 6, darken(special.awning, 0.2));
        continue;
      }
      if (style === S.warehouse) {
        if (i % 2 === 0) for (let yy = top + 1; yy <= bottom; yy++) p.set(col, yy, darken(wall, 0.08));
        if (ground && (i === 3 || i === 4)) for (let yy = fb - 5; yy <= fb; yy++) p.set(col, yy, darken(wall, 0.28));
        continue;
      }
      if (!(winCol || ribbon)) continue;
      const lit = hash(tx, ty, fl, i + house * 9 + (side === 'left' ? 0 : 50)) < 0.06;
      const wy0 = fb - floorH + 2;
      const wy1 = fb - 2;
      for (let yy = wy0; yy <= wy1; yy++) {
        let col2 = lit ? PAL.lit : PAL.glass;
        if (yy === wy0) col2 = lit ? PAL.litHi : PAL.glassHi;
        p.set(col, yy, col2);
      }
      if (f.trimmed && !lightWall) p.set(col, wy1 + 1, PAL.trim); // white sills on dark brick
    }
    // A dark seam between the two houses of a face.
    if (i === 0 && house === 1) for (let yy = top + 1; yy <= bottom; yy++) p.set(col, yy, darken(wall, 0.18));
  }
}

/** Mixes for the far-away overview: one colour per tile. */
export function overviewColour(w: World, x: number, y: number): number {
  const t = w.terrain(x, y);
  switch (t) {
    case T.water:
      return w.flags(x, y) & F.bridge ? PAL.deck : PAL.water;
    case T.street:
      return PAL.paving;
    case T.road:
      return PAL.asphalt;
    case T.square:
      return PAL.square;
    case T.park:
      return PAL.grass;
    case T.wood:
      return PAL.leaf;
    case T.field:
      return PAL.field;
    case T.sand:
      return PAL.sand;
    case T.rail:
      return PAL.gravel;
    case T.industry:
      return mix(PAL.concrete, c('#9aa09a'), 0.5);
    default: {
      if (isCourtyard(w, x, y)) return PAL.grassDark;
      const style = w.style(x, y);
      const pal = style === S.canal ? CANAL : style === S.brick ? BRICK : MODERN;
      return mix(PAL.roof, pick(pal, hash(x, y, 11, 0)), 0.45);
    }
  }
}
