import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dayState, tablecheck, toSlots } from '../src/server/platforms/tablecheck';
import type { Restaurant } from '../src/server/platforms/types';

// Recorded from Ciel Bleu (Hotel Okura), November 2026 and Wed 18 Nov, party of 2. Tests never call TableCheck.
const CALENDAR = JSON.parse(readFileSync(new URL('./fixtures/tablecheck-calendar.json', import.meta.url), 'utf8'));
const MEALS = JSON.parse(readFileSync(new URL('./fixtures/tablecheck-meals.json', import.meta.url), 'utf8'));

const cielBleu: Restaurant = {
  id: 'ciel-bleu', name: 'Ciel Bleu', platform: 'tablecheck', platformUid: 'okura-nl-cielbleu',
  website: 'https://www.cielbleu.nl/', city: 'Amsterdam', address: null,
};
const json = (data: unknown, status = 200, type = 'application/json') =>
  new Response(typeof data === 'string' ? data : JSON.stringify(data), { status, headers: { 'content-type': type } });
function fakeFetch(answer: (url: string, body: Record<string, unknown>) => Response) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    calls.push({ url: String(input), body });
    return answer(String(input), body);
  }) as typeof fetch;
  return { impl, calls };
}

describe('TableCheck days', () => {
  it('reads closed, full and open from the calendar tags: closed wins over nothing free', () => {
    expect(dayState(['closed', 'cache_unavailable'])).toBe('closed');
    expect(dayState(['cache_unavailable'])).toBe('full');
    expect(dayState([])).toBe('open');
  });

  it("gives the map Ciel Bleu's week: closed Sunday and Monday, full Friday and Saturday", async () => {
    const { impl, calls } = fakeFetch(() => json(CALENDAR));
    const days = ['2026-11-18', '2026-11-20', '2026-11-22', '2026-11-23', '2026-11-24'];
    const map = await tablecheck({ fetchImpl: impl, gapMs: 0 }).calendar!(cielBleu, days, 2);
    expect(Object.fromEntries(map)).toEqual({ '2026-11-18': 'open', '2026-11-20': 'full', '2026-11-22': 'closed', '2026-11-23': 'closed', '2026-11-24': 'open' });
    expect(calls).toHaveLength(1); // one call per month
    expect(calls[0]!.body).toMatchObject({ shop_id: 'okura-nl-cielbleu', pax_adult: 2 });
  });

  it('leaves a day the calendar does not list unknown', async () => {
    const { impl } = fakeFetch(() => json({ calendar: { '2026-12-01': [] } }));
    const map = await tablecheck({ fetchImpl: impl, gapMs: 0 }).calendar!(cielBleu, ['2026-12-01', '2026-12-02'], 2);
    expect([...map.keys()]).toEqual(['2026-12-01']);
  });
});

describe('TableCheck slots', () => {
  it('turns UTC times into Amsterdam times and keeps only available ones open', () => {
    const slots = toSlots('2026-11-18', MEALS.meals);
    expect(slots.map((s) => `${s.time}${s.open ? '+' : '-'}`)).toEqual(['18:30+', '19:00-', '19:30+', '20:00+']);
    expect(slots.every((s) => !s.autoBookable)).toBe(true); // Seated never books on TableCheck
  });

  it('reads no meals as no tables', () => {
    expect(toSlots('2026-11-22', {})).toEqual([]);
  });
});

describe('TableCheck errors', () => {
  it('throws on an error status and on a page that is not JSON (a waiting room), never "no tables"', async () => {
    for (const answer of [json({}, 503), json('<html>queue</html>', 200, 'text/html'), json({ unexpected: true })]) {
      const p = tablecheck({ fetchImpl: (async () => answer.clone()) as typeof fetch, gapMs: 0 });
      await expect(p.getSlots(cielBleu, '2026-11-18', 2)).rejects.toThrow(/TableCheck/);
      await expect(p.calendar!(cielBleu, ['2026-11-18'], 2)).rejects.toThrow(/TableCheck/);
    }
  });

  it('links to the shop reserve page', () => {
    expect(tablecheck().bookingUrl(cielBleu, '2026-11-18', '19:00', 2)).toBe('https://www.tablecheck.com/en/okura-nl-cielbleu/reserve');
  });
});
