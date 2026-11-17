// Seated's own city palette, for the canal-belt sample (scripts/map-noord.ts with SEATED_ART=canal; Joel, 17 Nov 2026).
// Picked from the real city, never from sezlab's images: ground, water and trees from the PDOK aerial photo of the
// canal belt (the build's own cache, measured by scripts/canal-colours.ts), each roof from that photo, façades from Amsterdam's building materials
// (Waal-format brick, black-green and white paint, sandstone trims, white window frames). Every pixel of the sample is
// one of these colours or a shade made from them here.
import { darken, lighten, rgb } from './pix';

const hex = (c: number) => '#' + [0, 8, 16].map((s) => ((c >>> s) & 255).toString(16).padStart(2, '0')).join('');

/** Ground, water, trees and details. Keys are the painter's (PAL in noord-paint.ts). */
export const CANAL_PAL = {
  // Canal water: olive green-grey, not the IJ's blue.
  // Brighter and cleaner than the photo's #394d4a (judged climb: canals must read against the streets).
  water: '#3f7c86', waterDeep: '#356d78', waterLight: '#4d8b92', ripple: '#5f9ba0', glint: '#a8cdcc',
  // Quays: grey hardstone edge, dark wet wall.
  quay: '#d3cbbb', quayWall: '#5e5852',
  // Streets: red-brown and grey klinkers; pavements: grey tiles.
  // Close tones (judged climb: wide steps between them read as blotchy patches).
  paving: '#bba997', pavingDot: '#b5a391', pavement: '#c9beaf', pavementLine: '#c0b4a5',
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

/**
 * Roofs come from the aerial photo, building by building (Joel, 17 Nov 2026: "rebuild per building based on satellite
 * imagery"): the median colour of each building's roof pixels, the photo's city-wide tint taken off and its haze
 * lifted (saturation x SATURATE), then median cut to ROOF_COLOURS shared colours so the tiles stay indexed PNGs.
 */
export const ROOF_COLOURS = 72;
const SATURATE = 1.45;
export function photoColour(r: number, g: number, b: number, sat = SATURATE): [number, number, number] {
  const grey = (r + g + b) / 3;
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(grey + (v - grey) * sat)));
  return [c(r), c(g), c(b)];
}

/** Weighted median cut: the box with the widest channel splits at its weighted median until there are n boxes. */
export function medianCut(colours: Array<{ rgb: [number, number, number]; weight: number }>, n: number): { palette: string[]; nearest: (rgb: [number, number, number]) => number } {
  type Box = typeof colours;
  const range = (box: Box) => [0, 1, 2].map((ch) => {
    let lo = 255, hi = 0;
    for (const c of box) { const v = c.rgb[ch]!; if (v < lo) lo = v; if (v > hi) hi = v; }
    return hi - lo;
  });
  const boxes: Box[] = [colours.filter((c) => c.weight > 0)];
  while (boxes.length < n) {
    let best = -1, widest = 0, channel = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      const r = range(box), ch = r.indexOf(Math.max(...r));
      if (r[ch]! > widest) { widest = r[ch]!; best = i; channel = ch; }
    });
    if (best < 0) break;
    const box = boxes[best]!.sort((a, b) => a.rgb[channel]! - b.rgb[channel]!);
    const total = box.reduce((t, c) => t + c.weight, 0);
    let acc = 0, cut = 1;
    for (let i = 0; i < box.length - 1; i++) { acc += box[i]!.weight; if (acc >= total / 2) { cut = i + 1; break; } }
    boxes.splice(best, 1, box.slice(0, cut), box.slice(cut));
  }
  const centres = boxes.map((box) => {
    const w = box.reduce((t, c) => t + c.weight, 0);
    return [0, 1, 2].map((ch) => Math.round(box.reduce((t, c) => t + c.rgb[ch]! * c.weight, 0) / w)) as [number, number, number];
  });
  const palette = centres.map((c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join(''));
  const nearest = (rgb: [number, number, number]) => {
    let best = 0, d = Infinity;
    centres.forEach((c, i) => { const e = (c[0] - rgb[0]) ** 2 + (c[1] - rgb[1]) ** 2 + (c[2] - rgb[2]) ** 2; if (e < d) { d = e; best = i; } });
    return best;
  };
  return { palette, nearest };
}

const BOATS = ['#2f4a3c', '#3b4f6b', '#5b2f2a', '#2d2d33', '#e9e1cf', '#cfd9d6', '#f0d9a8', '#d8c2a8', '#e8c04a', '#f4f1ea'];

/**
 * The level-0 palette: every base colour, plus the shades the painter makes of walls, roofs and ground (darker toward
 * violet for shade, lighter for lit roof planes and rims). Near-duplicates merge until it fits an indexed PNG.
 */
export function canalPalette(roofs: string[]): string[] {
  const out: number[] = [];
  const add = (c: number) => out.push(c);
  const shades = (list: string[], ts: number[]) => list.forEach((h) => { const c = rgb(h); add(c); ts.forEach((t) => add(t < 0 ? darken(c, -t) : lighten(c, t))); });
  shades(Object.values(CANAL_PAL), [-0.16]);
  shades(CANAL_WALLS.flat(), [-0.1, -0.2, -0.3, 0.12]);
  shades([...CANAL_GLASS, ...CANAL_PLINTH], [-0.12]);
  shades(roofs, [-0.04, -0.26, 0.18, 0.14]);
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

/**
 * Materials (judged climb, 17 Nov 2026: raw winter-grey photo colours read as grey mush). The photo still decides per
 * building; its colour picks the nearest of these, Amsterdam's own roof and wall materials, picked for this palette.
 */
export const ROOF_MATERIALS = [
  '#7e3a28', '#924530', '#a6553a', '#b8673f', // red pantiles
  '#5d463c', '#6d5245', '#7d5e4e', // brown tiles
  '#35383c', '#43464a', '#525559', '#626569', // anthracite tiles and slate
  '#3b4450', '#4b5663', '#5e6b78', // blue slate
  '#7f8489', '#9aa0a4', // zinc
  '#666562', '#76746f', '#86837d', '#96928b', // bitumen, silver-coated (judged climb: dark flats read as holes)
  '#a8a296', '#c4beb1', // gravel, pale
  '#5f7340', '#71854a', // sedum
];
/** Pitched roofs are tile, slate or zinc; flat roofs bitumen, gravel or sedum (judged climb: no bitumen on a pitch). */
export const ROOF_PITCHED = ROOF_MATERIALS.slice(0, 16);
export const ROOF_FLAT = ROOF_MATERIALS.slice(14);
// Canal belt, before 1945. Seated's world leans to brick (Joel, 17 Nov 2026: "exaggerate the colours"): of the light
// stones only white plaster stays, so a pale winter photo of brick no longer turns a house beige.
export const WALL_MATERIALS = [...new Set(CANAL_WALLS.slice(1, 4).flat())].filter((h) => !['#d6cbb3', '#d9d0bd', '#b9a98f'].includes(h));
export function nearestMaterial(rgb: [number, number, number], list: string[]): string {
  let best = list[0]!, d = Infinity;
  for (const h of list) {
    const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const e = (c[0]! - rgb[0]) ** 2 * 0.3 + (c[1]! - rgb[1]) ** 2 * 0.59 + (c[2]! - rgb[2]) ** 2 * 0.11 + ((c[0]! - c[2]!) - (rgb[0] - rgb[2])) ** 2 * 0.6;
    if (e < d) { d = e; best = h; }
  }
  return best;
}

/**
 * Seated's world grade (Joel, 17 Nov 2026: "exaggerate the colours … my world … more or less in line with reality").
 * Applied to every finished pixel of the canal sample: brick redder, water a clear canal blue, leaves greener, cool
 * greys toward blue slate, and more contrast so lit and shaded planes part. Hue families stay where reality has them.
 */
export function worldGrade(c: number, g: { sat?: number; contrast?: number; slate?: number; green?: number; stone?: number } = {}): number {
  if (!c) return 0;
  let r = (c & 255) / 255, gr = ((c >>> 8) & 255) / 255, b = ((c >>> 16) & 255) / 255;
  const max = Math.max(r, gr, b), min = Math.min(r, gr, b), l = (max + min) / 2, d = max - min;
  let h = 0, s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d) h = max === r ? ((gr - b) / d + 6) % 6 : max === gr ? (b - r) / d + 2 : (r - gr) / d + 4;
  h *= 60;
  const sat = g.sat ?? 1.5, contrast = g.contrast ?? 1.18, slate = g.slate ?? 0.16;
  let L = l, S = s, H = h;
  if (s < 0.1 && b >= r - 0.01) { H = 212; S = Math.max(s, slate * Math.min(1, l * 2.2)); } // cool grey: slate
  else if (s < 0.1) S = l > 0.45 ? Math.max(s * 1.6, g.stone ?? 0.14) : s * 1.4; // warm grey: light stone a little warmer
  else if (h < 40 || h >= 340) { S = s * sat * 1.1; } // brick, tile
  else if (h < 70) { S = s * sat * 0.9; } // sandstone, ochre
  else if (h < 160) { H = h + (108 - h) * 0.4; S = s * sat * (g.green ?? 0.9); } // leaves, grass (judged climb: 1.15 read as neon)
  else if (h < 250) { H = h + (198 - h) * 0.6; S = s * sat * 1.35; L = l * 1.1; } // water, slate
  else S = s * sat;
  L = 0.47 + (L - 0.47) * contrast;
  S = Math.min(0.85, S); L = Math.max(0.04, Math.min(0.96, L));
  const C = (1 - Math.abs(2 * L - 1)) * S, X = C * (1 - Math.abs(((H / 60) % 2) - 1)), m = L - C / 2;
  const [r1, g1, b1] = H < 60 ? [C, X, 0] : H < 120 ? [X, C, 0] : H < 180 ? [0, C, X] : H < 240 ? [0, X, C] : H < 300 ? [X, 0, C] : [C, 0, X];
  const q = (v: number) => Math.round((v + m) * 255);
  return (c & 0xff000000) | (q(b1) << 16) | (q(g1) << 8) | q(r1);
}
