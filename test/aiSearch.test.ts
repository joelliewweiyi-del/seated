// The map's AI search (deploy/map/api/classify.mjs) and what it knows of each restaurant (scripts/map-about.ts).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error: plain JS module shared with the Vercel function
import { classify, describe as describeR, GROUP, MATCH, matchesFrom, normalise, requests } from '../deploy/map/api/classify.mjs';
import { readAbout } from '../scripts/map-about';
import { loadMapFacts } from '../src/server/mapFacts';

const r = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: `Name ${id}`, area: 'Jordaan', kind: 'wine', g: [], ...extra });
const facts = { about: { a: { text: 'Says: Brunch every Sunday, natuurwijn.' } }, hours: { a: { open: ['Sa', 'Su'] } }, guides: { seated: 'Seated curated' } };

describe('the AI search', () => {
  it('describes a restaurant from our facts and its own homepage, so "sunday brunch" has something to go on', () => {
    const text = describeR(r('a', { g: ['seated'], michelin: 'bib' }), facts);
    expect(text).toContain('wine bar in Jordaan');
    expect(text).toContain('Michelin Bib Gourmand');
    expect(text).toContain('Open on Saturday, Sunday');
    expect(text).toContain('Seated curated');
    expect(text).toContain('Brunch every Sunday');
  });

  it('asks one yes/no question per restaurant, in groups small enough for Jev (32k tokens per question)', () => {
    const list = Array.from({ length: GROUP * 2 + 5 }, (_, i) => r(`r${i}`));
    const reqs = requests('natural wine', list, facts);
    expect(reqs.map((x: { questions: object }) => Object.keys(x.questions).length)).toEqual([GROUP, GROUP, 5]);
    const q = reqs[0].questions.r0;
    expect(q.type).toBe('noul');
    expect(q.instructions).toContain('"natural wine"');
    expect(reqs[0].state.restaurants.r0).toContain('Name r0');
    // The real list stays far under the limit: about 4 characters a token, 32k tokens.
    const data = JSON.parse(readFileSync('data/map-places.json', 'utf8')) as Record<string, { area: string; kind: string }>;
    const real = Object.entries(data).map(([id, p]) => r(id, p));
    for (const body of requests('quick and easy brunch', real, loadMapFacts())) expect(JSON.stringify(body).length / 4).toBeLessThan(24_000);
  });

  it('counts a place only from MATCH up, most likely first; a broken answer is no', () => {
    expect(matchesFrom({ a: { noul: 0.2 }, b: { noul: 0.91 }, c: { noul: MATCH }, d: { noul: 7 }, e: {} })).toEqual([
      { id: 'b', p: 0.91 },
      { id: 'c', p: MATCH },
    ]);
  });

  it('caches one spelling of a search, and says what to do when Jev fails', async () => {
    expect(normalise('  Sunday   BRUNCH ')).toBe('sunday brunch');
    expect(normalise('x'.repeat(200))).toHaveLength(80);
    const failing = async () => new Response('{}', { status: 401 });
    const out = await classify('brunch', [r('a')], facts, 'key', failing);
    expect(out.status).toBe(502);
    expect(out.body.error).toContain('TYPESAFE_API_KEY');
    expect(out.body.error).toContain('The name search still works.');
    const ok = async () => new Response(JSON.stringify({ answers: { a: { type: 'noul', noul: 0.8 } } }));
    expect((await classify('Brunch', [r('a')], facts, 'key', ok)).body).toEqual({ q: 'brunch', by: 'jev', model: 'jev-1.13.0', matches: [{ id: 'a', p: 0.8 }] });
  });

  it('answers without a key as the labelled stand-in, never as Jev', async () => {
    const out = await classify('brunch', [r('a'), r('b')], facts, undefined);
    expect(out.body).toMatchObject({ by: 'stand-in', model: null, matches: [{ id: 'a', p: 1 }] });
  });

  it('reads a homepage for its words and prices, from its own description too', () => {
    const html = `<html><head><title>Café X | Amsterdam</title><meta name="description" content="Ontbijt, brunch &amp; natural wine"></head>
      <body><script>var brunch = 1</script><h1>Welkom</h1><p>Menu € 45,- and €12,50. Terras aan het water.</p></body></html>`;
    const text = readAbout(html);
    expect(text).toContain('Title: Café X | Amsterdam.');
    expect(text).toContain('Says: Ontbijt, brunch & natural wine');
    expect(text).toContain('Mentions: brunch, ontbijt, natural wine, terras, aan het water.');
    expect(text).toContain('Prices on the homepage: €12, €45.');
  });
});
