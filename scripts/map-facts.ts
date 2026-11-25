// Writes the AI search's facts module for the Vercel function: npx tsx scripts/map-facts.ts dist/map/api/_facts.mjs
import { writeFileSync } from 'node:fs';
import { factsModule, loadMapFacts } from '../src/server/mapFacts.js';

const out = process.argv[2];
if (!out) throw new Error('Name the file to write, for example dist/map/api/_facts.mjs');
writeFileSync(out, factsModule(loadMapFacts()));
console.log(`AI search facts: ${out}`);
