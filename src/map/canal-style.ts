// Seated's own city palette, for the canal-belt sample (scripts/map-noord.ts with SEATED_ART=canal; Joel, 17 Nov 2026).
// Picked from the real city, never from sezlab's images: ground, water and trees from the PDOK aerial photo of the
// canal belt (the build's own cache, measured by scripts/canal-colours.ts), façades from Amsterdam's building materials
// (Waal-format brick, black-green and white paint, sandstone trims, white window frames). Every pixel of the sample is
// one of these colours or a shade made from them here.
import { darken, lighten, rgb } from './pix';

const hex = (c: number) => '#' + [0, 8, 16].map((s) => ((c >>> s) & 255).toString(16).padStart(2, '0')).join('');

/** Ground, water, trees and details. Keys are the painter's (PAL in noord-paint.ts). */
export const CANAL_PAL = {
  // Canal water: olive green-grey, not the IJ's blue.
  water: '#456660', waterDeep: '#3a5754', waterLight: '#557870', ripple: '#6a8c80', glint: '#93b0a4',
  // Quays: grey hardstone edge, dark wet wall.
  quay: '#c4bcae', quayWall: '#5e5852',
  // Streets: red-brown and grey klinkers; pavements: grey tiles.
  paving: '#ad9886', pavingDot: '#9c8676', pavement: '#c4bcae', pavementLine: '#b3ab9e',
  asphalt: '#56585a', asphaltDot: '#4a4c4f', asphaltLight: '#686a6b',
  square: '#c2b4a0', squareLine: '#b0a28f',
  grass: '#6a873a', grassDark: '#55712f', grassLight: '#7f9a46', garden: '#5b7634', gardenDark: '#405a28', woods: '#405a28',
  field: '#8a9a52', fieldLine: '#78884a',
  concrete: '#a19c93', concreteLine: '#8e8981', concreteWorn: '#948e85', concreteLight: '#b4afa5',
  sand: '#d2c095', gravel: '#9d978c', rail: '#4b4641', tram: '#77716a',
  // Bridges: brick deck, oxblood iron railings.
  deck: '#9a8676', railing: '#4a2422',
  glass: '#23272c', glassHi: '#7d93a0', trim: '#f1eee6', lit: '#ffd56b', litHi: '#fff1b8', ink: '#2b2733',
  // Elms along the canals: dark, a little blue in the shade.
  leaf: '#4a6a2e', leafLight: '#6a8a3a', leafMid: '#577933', leafDark: '#2e4522', leafBright: '#86a04a', leafDeep: '#3a5627',
  trunk: '#4a3b30', flowerA: '#f2e08c', flowerB: '#e39ab2',
};

/** Walls by period (AGE in noord-grid.ts): none, before 1800, 1800-1899, 1900-44, 1945-79, 1980-99, 2000 on, unknown. */
export const CANAL_WALLS = [
  ['#9a8a7a'],
  // Canal houses: dark red-brown brick, black-green and white paint, sandstone.
  ['#7a3b2e', '#8a4535', '#6a3328', '#5b2e27', '#9a5a43', '#4e3b33', '#33393a', '#2c3230', '#e8e2d4', '#d6cbb3'],
  ['#86412f', '#9a4f37', '#763a2c', '#d9d0bd', '#b9a98f', '#6c392d'],
  ['#873e2c', '#773526', '#964a33', '#6d392b'],
  ['#c8c0b1', '#b4ac9f', '#8e8984', '#d7d1c3', '#a6784f'],
  ['#985f46', '#ad7858', '#8a8a8a', '#c1b399'],
  ['#e5e1d9', '#53575c', '#ad6849', '#a8adaf', '#3d4144', '#d2c6ae'],
  ['#985944', '#855f4e', '#c3b49d', '#999fa2'],
];
export const CANAL_GLASS = ['#283238', '#2f3438', '#3a3f45', '#2a2e33'];
export const CANAL_PLINTH = ['#3d3633', '#2f2b2a', '#4a4440'];

/** Roofs: dark grey tiles and slate, orange-red pantiles, zinc, bitumen, gravel, sedum, white. */
const ROOFS = {
  tileRed: ['#7e3a28', '#924530', '#a6553a', '#b8673f'],
  tileBrown: ['#4e3b34', '#5d463c', '#6d5245', '#7d5e4e'],
  slateBlue: ['#3b4450', '#4b5663', '#5e6b78', '#73808c'],
  slate: ['#35383c', '#43464a', '#525559', '#626569', '#74777a'],
  hall: ['#4b4f55', '#5b6066', '#6c7177', '#7f8489'],
  sedum: ['#5f7340', '#71854a', '#8a9a60'],
  pale: ['#a8a296', '#c4beb1', '#dcd6ca'],
  flat: ['#4f4f4e', '#5f5e5c', '#706e6a', '#83807a', '#96928b'],
};
export const CANAL_ROOFS = [...new Set(Object.values(ROOFS).flat())];

/** The aerial photo's mean roof colour (city tint taken off) -> one of CANAL_ROOFS. Same decisions as Noord's roofColour. */
export function canalRoof(r: number, g: number, b: number, light: number, pitched: boolean, hall: boolean, jitter: number): string {
  const warm = r - b;
  const pick = (list: string[]) => list[Math.max(0, Math.min(list.length - 1, Math.floor((light - 0.3) / 0.07) + jitter))]!;
  if (pitched && hall) return pick(ROOFS.hall);
  if (pitched) {
    // Red pantiles only on clearly warm roofs: most canal-belt roofs are anthracite tile or slate.
    if (warm > 14) return pick(ROOFS.tileRed);
    if (warm > 5) return pick(ROOFS.tileBrown);
    if (warm < -8) return pick(ROOFS.slateBlue);
    return pick(ROOFS.slate);
  }
  if (g - (r + b) / 2 > 6) return pick(ROOFS.sedum);
  if (warm > 10 && light > 0.6) return pick(ROOFS.pale);
  return pick(ROOFS.flat);
}

const BOATS = ['#2f4a3c', '#3b4f6b', '#5b2f2a', '#2d2d33', '#e9e1cf', '#cfd9d6', '#f0d9a8', '#d8c2a8', '#e8c04a', '#f4f1ea'];

/**
 * The level-0 palette: every base colour, plus the shades the painter makes of walls, roofs and ground (darker toward
 * violet for shade, lighter for lit roof planes and rims). Near-duplicates merge until it fits an indexed PNG.
 */
export function canalPalette(): string[] {
  const out: number[] = [];
  const add = (c: number) => out.push(c);
  const shades = (list: string[], ts: number[]) => list.forEach((h) => { const c = rgb(h); add(c); ts.forEach((t) => add(t < 0 ? darken(c, -t) : lighten(c, t))); });
  shades(Object.values(CANAL_PAL), [-0.16]);
  shades(CANAL_WALLS.flat(), [-0.1, -0.2, -0.3, 0.12]);
  shades([...CANAL_GLASS, ...CANAL_PLINTH], [-0.12]);
  shades(CANAL_ROOFS, [-0.04, -0.26, 0.18, 0.14, 0.3]);
  shades(BOATS, [-0.2]);
  [rgb('#2b2733'), rgb('#1d1a24')].forEach(add);
  const dist = (a: number, b: number) => Math.hypot((a & 255) - (b & 255), ((a >>> 8) & 255) - ((b >>> 8) & 255), ((a >>> 16) & 255) - ((b >>> 16) & 255));
  for (let min = 0; ; min += 1) {
    const kept: number[] = [];
    for (const c of out) if (!kept.some((k) => dist(k, c) <= min)) kept.push(c);
    if (kept.length <= 255) return ['#000000', ...kept.map(hex)];
  }
}

/** Far levels (1/4 and 1/8): 15 colours and transparent, one shared palette so tiles meet without seams. */
export const CANAL_FAR = ['#000000', '#456660', '#3a5754', '#ad9886', '#c4bcae', '#56585a', '#7a3b2e', '#5b2e27', '#43464a',
  '#626569', '#924530', '#4a6a2e', '#2e4522', '#a7a196', '#e8e2d4', '#2b2733'];
