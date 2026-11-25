// What the map's AI search knows besides data.json (deploy/map/api/classify.mjs): each restaurant's own homepage text
// (data/map-about.json, scripts/map-about.ts), the weekdays it opens (data/map-hours.json), the guides' names, and the
// researched brunch days, lunch, dinner price and tags (data/map-extras.json, each with its sources).
import { existsSync, readFileSync } from 'node:fs';

export interface MapFacts {
  about: Record<string, { text: string }>;
  hours: Record<string, { open: string[] }>;
  guides: Record<string, string>;
  /** Brunch days, lunch, dinner price and tags per restaurant, each from a source read (data/map-extras.json). */
  extras: Record<string, { brunch: string[] | null; lunch: boolean | null; price: { low: number; high: number } | null; level: number | null; vibe: string[] }>;
}

const read = <T>(file: string, fallback: T): T => (existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : fallback);

export function loadMapFacts(): MapFacts {
  const about = read<Record<string, { text: string }>>('data/map-about.json', {});
  const hours = read<{ restaurants: Record<string, { open: string[] }> }>('data/map-hours.json', { restaurants: {} }).restaurants;
  const extras = read<{ restaurants: MapFacts['extras'] }>('data/map-extras.json', { restaurants: {} }).restaurants;
  const guides = read<{ guides: Array<{ id: string; short?: string; name?: string }> }>('data/map-guides.json', { guides: [] }).guides;
  return {
    about: Object.fromEntries(Object.entries(about).map(([id, a]) => [id, { text: a.text }])),
    hours: Object.fromEntries(Object.entries(hours).map(([id, h]) => [id, { open: h.open }])),
    guides: Object.fromEntries(guides.map((g) => [g.id, g.short ?? g.name ?? g.id])),
    extras: Object.fromEntries(Object.entries(extras).map(([id, x]) => [id, { brunch: x.brunch, lunch: x.lunch, price: x.price, level: x.level, vibe: x.vibe ?? [] }])),
  };
}

/** The facts as the module the Vercel function imports (api/_facts.mjs). */
export const factsModule = (f: MapFacts): string => `// Built by scripts/map-deploy.sh from data/ (src/server/mapFacts.ts). Do not edit.\nexport default ${JSON.stringify(f)};\n`;
