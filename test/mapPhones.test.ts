// The Call button's numbers (Canberk through Joel, 27 Nov 2026: "add a call option next to reserve"). A wrong number
// calls a stranger, so: one spelling per number, a number only where the page gives one as a phone number, and the
// data file holds only whole Dutch numbers with the page they came from.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dutch, readPhone, sameName } from '../scripts/map-phones.js';
import { phoneWords } from '../src/map/data.js';

describe('dutch', () => {
  it('reads every spelling of one number as +31 and nine digits', () => {
    for (const raw of ['020 - 337 96 80', '+31 (0)20 3379680', '0031203379680', '+31%2020%20337%209680', '31203379680', '+31 020 3379680'])
      expect(dutch(raw)).toBe('+31203379680');
  });
  it('refuses what is not a whole Dutch number', () => {
    for (const raw of ['', '020 337 96', '+32 2 512 13 14', '0203379680123', '+1 212 555 0100']) expect(dutch(raw)).toBeNull();
  });
});

describe('readPhone', () => {
  it('takes the number the page links most, before any number in its text', () => {
    const html = `<a href="tel:+31612345678">site by</a> <a href="tel:0203379680">bel</a> <a href='tel:020-3379680'>bel</a> <p>06 87654321</p>`;
    expect(readPhone(html)).toBe('+31203379680');
  });
  it('reads schema.org telephone', () => {
    expect(readPhone(`<script type="application/ld+json">{"@type":"Restaurant","telephone":"+31 20 337 9680"}</script>`)).toBe('+31203379680');
  });
  it('without a link reads a number written in the text, never part of a longer row of digits or a script', () => {
    expect(readPhone('<p>Reserveren: 020 - 337 96 80</p><p>KvK 34567890, IBAN NL91ABNA0417164300</p>')).toBe('+31203379680');
    expect(readPhone('<p>Order 00203379680123</p><script>var id = "0203379680";</script>')).toBeNull();
  });
});

describe('sameName', () => {
  it('matches a name with or without "Restaurant" and marks, and not another place next door', () => {
    expect(sameName('Restaurant Scheepskameel', 'Scheepskameel')).toBe(true);
    expect(sameName('Café de Klepel', 'De Klepel')).toBe(true);
    expect(sameName('Scheepskameel', 'Pension Homeland')).toBe(false);
  });
});

describe('phoneWords', () => {
  it('writes a number the way people say it', () => {
    expect(phoneWords('+31203379680')).toBe('020 337 9680');
    expect(phoneWords('+31612345678')).toBe('06 1234 5678');
  });
});

describe('data/map-phones.json', () => {
  const { restaurants } = JSON.parse(readFileSync('data/map-phones.json', 'utf8')) as { restaurants: Record<string, { phone: string | null; from: string | null }> };
  it('holds only whole Dutch numbers, each with where it was read', () => {
    for (const [id, p] of Object.entries(restaurants)) {
      if (p.phone === null) continue;
      expect(p.phone, id).toMatch(/^\+31[1-9]\d{8}$/);
      expect(p.from, id).toBeTruthy();
    }
  });
  it('never holds Esra (hard rule 2)', () => {
    expect(Object.keys(restaurants).filter((id) => id.includes('esra'))).toEqual([]);
  });
});
