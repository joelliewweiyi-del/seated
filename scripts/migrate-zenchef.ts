// Moves restaurants from Formitable to Zenchef in data/restaurants.json, where Zenchef really serves them.
//   npx tsx scripts/migrate-zenchef.ts --city Amsterdam            dry run: prints what would change
//   npx tsx scripts/migrate-zenchef.ts --city Amsterdam --write    writes the changes
// Why: Formitable belongs to Zenchef. A restaurant that moved keeps a Formitable calendar that no longer gets
// bookings (Oct 2026: De Kas looked nearly empty on Formitable and was fully booked on Zenchef).
// Per restaurant: one Formitable status request, and if it names a zenchefId, one Zenchef summary request.
// A restaurant moves only when Zenchef shows open days with shifts: a Zenchef account alone is not proof.
import { readFileSync, writeFileSync } from 'node:fs';
import { addDays, localDate } from '../src/server/time.js';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const args = process.argv.slice(2);
const city = args.includes('--city') ? args[args.indexOf('--city') + 1] : null;
const write = args.includes('--write');
const path = 'data/restaurants.json';

interface Row {
  id: string;
  name: string;
  platform: string;
  platformUid: string | null;
  city: string | null;
  website: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const get = async (url: string, headers: Record<string, string> = {}) => {
  await sleep(600); // polite: well under two requests a second
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(15_000) });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<unknown>;
};

const raw = readFileSync(path, 'utf8');
const list = JSON.parse(raw) as Row[];
const candidates = list.filter((r) => r.platform === 'formitable' && r.platformUid && (!city || r.city === city));
console.log(`${candidates.length} Formitable restaurants${city ? ` in ${city}` : ''}. ${write ? 'Writing changes.' : 'Dry run.'}\n`);

const today = localDate(new Date());
let moved = 0;
for (const r of candidates) {
  let verdict: string;
  try {
    const status = (await get(`https://widget-api.formitable.com/api/restaurant/${r.platformUid}/status`, {
      Referer: 'https://widget.formitable.com/',
    })) as { zenchefId?: number | string | null };
    const zid = status?.zenchefId ? String(status.zenchefId) : null;
    if (!zid) {
      verdict = 'stays on Formitable (no zenchefId)';
    } else {
      const q = new URLSearchParams({ restaurantId: zid, date_begin: today, date_end: addDays(today, 13) });
      const days = (await get(`https://bookings-middleware.zenchef.com/getAvailabilitiesSummary?${q}`)) as Array<{
        isOpen?: boolean | string;
        shifts?: unknown[];
      }>;
      const live = Array.isArray(days) && days.some((d) => d.isOpen === true && (d.shifts?.length ?? 0) > 0);
      if (live) {
        verdict = `MOVES to Zenchef ${zid}`;
        r.platform = 'zenchef';
        r.platformUid = zid;
        moved++;
      } else {
        verdict = `has zenchefId ${zid}, but Zenchef shows no open days: left on Formitable`;
      }
    }
  } catch (err) {
    verdict = `skipped (${err instanceof Error ? err.message : err})`;
  }
  console.log(`${r.name.padEnd(32)} ${verdict}`);
}

console.log(`\n${moved} of ${candidates.length} move to Zenchef.`);
if (write && moved > 0) {
  writeFileSync(path, JSON.stringify(list, null, 2) + (raw.endsWith('\n') ? '\n' : ''));
  console.log(`Wrote ${path}.`);
}
