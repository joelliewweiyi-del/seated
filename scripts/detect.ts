// Finds which booking system a restaurant uses, from its website.
//   npx tsx scripts/detect.ts https://www.restaurant.nl [more urls...]
// Reads the homepage and up to 4 linked reservation pages. Prints one JSON line per site.
import { findFormitableUid } from '../src/server/platforms/formitable.js';
import { findTebiUid } from '../src/server/platforms/tebi.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const OTHERS: Array<[string, RegExp]> = [
  ['zenchef', /zenchef\.com|bookings\.zenchef/i],
  ['sevenrooms', /sevenrooms\.com/i],
  ['guestplan', /guestplan/i],
  ['tablecheck', /tablecheck\.com/i],
  ['thefork', /thefork\.|lafourchette/i],
  ['opentable', /opentable\./i],
  ['resengo', /resengo/i],
  ['couverts', /couverts\.nl/i],
];

async function page(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(12_000) });
  return res.ok ? res.text() : '';
}

export async function detect(url: string) {
  const html = await page(url).catch(() => '');
  const pages = [html];
  // Follow links that look like a reservation page on the same site.
  const base = new URL(url);
  const links = [...html.matchAll(/href=["']([^"'#]+)["']/gi)]
    .map((m) => m[1]!)
    .filter((h) => /reserv|book|tafel|table/i.test(h))
    .map((h) => {
      try {
        return new URL(h, base).toString();
      } catch {
        return '';
      }
    })
    .filter((h) => h && new URL(h).hostname === base.hostname);
  for (const link of [...new Set(links)].slice(0, 4)) pages.push(await page(link).catch(() => ''));

  const all = pages.join('\n');
  const formitable = findFormitableUid(all);
  const tebi = findTebiUid(all);
  const others = OTHERS.filter(([, re]) => re.test(all)).map(([n]) => n);
  return { url, reachable: html.length > 0, formitable, tebi, others };
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('detect.ts')) {
  for (const url of process.argv.slice(2)) console.log(JSON.stringify(await detect(url)));
}
