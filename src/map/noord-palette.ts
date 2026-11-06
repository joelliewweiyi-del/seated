// Build-only measurement: colour frequencies, never reference geometry or pixel copying.
import { readFileSync } from 'node:fs';
import { readPNG } from './noord-png';
import { rgb } from './pix';
import type { SezManifest } from './world';

// Semantic swatches identified in the reference: verify each against the actual level-0 histogram.
export const SWATCHES = {
  water: '#2c8ba1', 'IJ water': '#3a869a', grass: '#8cc43b', tree: '#599533',
  street: '#dfcdae', quay: '#e7d4b8', 'roof red': '#893824', 'roof brown': '#482518',
  'roof grey': '#585657', wall: '#b9a489', shadow: '#2a2c33',
} as const;
export function measurePalette(sez: SezManifest) {
  const hist = new Map<string, number>();
  for (const [x, y] of sez.levels[0]!.chunks) {
    const p = readPNG(readFileSync(`src/map/public/sez/${sez.version}/0_${x}_${y}.png`));
    for (const k of p.pixels) if (p.alpha[k]) hist.set(p.palette[k]!, (hist.get(p.palette[k]!) ?? 0) + 1);
  }
  const table = Object.entries(SWATCHES).map(([kind, colour]) => {
    if (!hist.has(colour)) throw new Error(`Reference changed: ${kind} ${colour} absent; remeasure palette`);
    const ours = kind === 'shadow' ? '#2b2733' : kind === 'water' ? '#3a869a' : kind === 'roof brown' ? '#5c2b1b' : colour;
    const channels = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const a = channels(colour), b = channels(ours);
    return { kind, measured: colour, ours, count: hist.get(colour)!, distance: Math.hypot(...a.map((v, i) => v - b[i]!)) };
  });
  // Preserve our violet outlines instead of the nearly black reference inks.
  const colours = [...hist.keys()].filter(h => !['#181818', '#251d19', '#262628'].includes(h)).sort();
  const palette = ['#000000', ...new Set([...colours, '#2b2733', '#1d1a24'])];
  if (palette.length > 256) throw new Error('Palette no longer fits indexed PNG');
  return { palette, table };
}
export function quantizer(palette: string[]): (packed: number) => number {
  const colours = palette.map(h => rgb(h)), cache = new Map<number, number>([[0, 0]]);
  colours.forEach((c, i) => { if (i) cache.set(c, i); });
  return (c: number) => {
    if (!(c >>> 24)) return 0;
    const hit = cache.get(c); if (hit !== undefined) return hit;
    let best = 1, distance = Infinity;
    for (let i = 1; i < colours.length; i++) {
      const k = colours[i]!;
      const d = ((c & 255) - (k & 255)) ** 2 + (((c >>> 8) & 255) - ((k >>> 8) & 255)) ** 2 + (((c >>> 16) & 255) - ((k >>> 16) & 255)) ** 2;
      if (d < distance) { distance = d; best = i; }
    }
    cache.set(c, best); return best;
  };
}

// A curated subset of the measured swatches: retain material/shading families, merge rare near-duplicates.
// This controls indexed-PNG entropy without dropping geometric or alpha coverage at the ten-MB budget.
export const MATERIAL_COLOURS = new Set((
  '#000000 #2b2733 #1d1a24 ' +
  '#3a869a #2c8ba1 #30778b #41869a #388ba2 #4e92a4 ' +
  '#2c601d #398526 #599533 #70a14e #86b23b #8cc43b #96c658 #b6c895 ' +
  '#a79886 #aba395 #b9a489 #b9a995 #c4a78a #c7b399 #c8b8a4 #d3b69b #d8c5aa #dfcdae #e7d4b8 #efe4d1 ' +
  '#363639 #393b43 #433d45 #464548 #474953 #585657 #686665 #797368 #857d82 #8b8984 #938c85 #989388 ' +
  '#2a2c33 #352a27 #453a36 #48433a #544b45 #585349 ' +
  '#1c3847 #2d4f5a #597a88 #a1bac6 ' +
  '#5c2b1b #893824 #9e4f31 #a94729 #c85534 #ca6a4d #482518 #963018 #b44a28 #9a6b55'
).split(' '));

/** Shared far-level palette avoids per-tile colour seams; all are members of the measured material palette. */
export const FAR_PALETTE = '#000000 #3a869a #dfcdae #b9a995 #797368 #585657 #393b43 #8b8984 #893824 #5c2b1b #ca6a4d #599533 #2c601d #86b23b #e7d4b8 #2b2733'.split(' ');
