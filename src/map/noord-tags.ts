import { T } from './noord-grid';

/** Physical stone wins over vegetation tags on the same OSM area. */
export function parkOrStoneTerrain(tags: Record<string, string> = {}): number | undefined {
  if (/^(stone|bare_rock)$/.test(tags.natural ?? '') || /^(breakwater|groyne)$/.test(tags.man_made ?? '')) return T.stone;
  if (/^(grass|recreation_ground|cemetery|village_green)$/.test(tags.landuse ?? '') ||
      /^(park|garden|pitch|golf_course|nature_reserve|playground)$/.test(tags.leisure ?? '') ||
      /^(scrub|grassland|wetland)$/.test(tags.natural ?? '')) return T.park;
  return undefined;
}

const GREEN = new Set<number>([T.park, T.wood, T.field, T.garden]);

/**
 * Turns vegetation cells with water on at least 5 of their 8 neighbours into water, until none is left. A park or
 * field outline in OSM that pokes past the water's outline otherwise leaves thin green strokes on open water.
 * Terrain codes sit in the low 4 bits; the flags above them are kept. Returns how many cells changed.
 */
export function cleanSlivers(terrain: Uint8Array, cols: number, rows: number): number {
  let changed = 0;
  for (let pass = 0, n = 1; n && pass < 8; pass++) {
    const turn: number[] = [];
    for (let y = 1; y < rows - 1; y++) {
      for (let x = 1; x < cols - 1; x++) {
        const i = y * cols + x;
        if (!GREEN.has(terrain[i]! & 15)) continue;
        let water = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && (terrain[i + dy * cols + dx]! & 15) === T.water) water++;
        if (water >= 5) turn.push(i);
      }
    }
    for (const i of turn) terrain[i] = (terrain[i]! & 0xf0) | T.water;
    n = turn.length;
    changed += n;
  }
  return changed;
}
