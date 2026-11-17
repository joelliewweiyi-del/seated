// The city overview is checked against the manifest's coverage mask before the fog edge is built from it. On 17 Nov
// 2026 a copy cut off at row 642 (of 1472) put fog over the canal belt, and the year-long cache kept it.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readPNG } from '../src/map/noord-png';
import { missingArt } from '../src/map/render';
import type { SezManifest } from '../src/map/world';

const sez = JSON.parse(readFileSync('src/map/public/sez/manifest.json', 'utf8')) as SezManifest;
const png = readPNG(readFileSync(`src/map/public/sez/${sez.version}/2.png`));
const alpha = Uint8Array.from(png.pixels, (p) => +(png.alpha[p]! > 0)); // palette alpha per pixel, as the browser reads it
const mask = { mw: sez.mask.mw, mh: sez.mask.mh, bits: Uint8Array.from(Buffer.from(sez.mask.bits, 'base64')) };
const k = sez.mask.cell / (sez.hi.w / png.w);

describe('the city overview check', () => {
  it('finds nothing missing in the whole image', () => {
    expect(missingArt(alpha, png.w, png.h, mask, k)).toBeLessThan(0.01);
  });
  it('finds the art missing in a copy cut off at row 642, as on 17 Nov 2026', () => {
    const cut = alpha.slice();
    cut.fill(0, 642 * png.w);
    expect(missingArt(cut, png.w, png.h, mask, k)).toBeGreaterThan(0.3);
  });
  it('finds even a small cut: the last tenth of the rows', () => {
    const cut = alpha.slice();
    cut.fill(0, Math.floor(png.h * 0.9) * png.w);
    expect(missingArt(cut, png.w, png.h, mask, k)).toBeGreaterThan(0.01);
  });
});
