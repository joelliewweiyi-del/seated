// Look at one restaurant's open tables right now, straight from its booking system.
//   npm run peek -- klepel            party of 2, next 7 days
//   npm run peek -- "bistro feline" 4 10
import { createPlatforms } from './server/platforms/index.js';
import type { Platform } from './server/platforms/types.js';
import { loadCuratedRestaurants, slugify } from './server/restaurants.js';
import { addDays, localDate, slotLabel } from './server/time.js';

const [query, partyArg, daysArg] = process.argv.slice(2);
if (!query) {
  console.log('Usage: npm run peek -- <restaurant name> [party size] [days]');
  process.exit(1);
}
const partySize = Number(partyArg ?? 2);
const days = Math.min(Number(daysArg ?? 7), 31);

const platforms: Record<string, Platform> = createPlatforms();
const needle = slugify(query);
const matches = loadCuratedRestaurants().filter((r) => r.id.includes(needle));
const restaurant = matches.find((r) => platforms[r.platform] && r.platformUid);
if (!restaurant) {
  const found = matches.map((r) => `${r.name} (${r.platform})`).join(', ');
  console.log(found ? `No supported match. Found: ${found}` : `No restaurant matches "${query}".`);
  process.exit(1);
}
// Esra is a two-person shop that asked not to be used as a test target.
if (/^esra/i.test(restaurant.name)) {
  console.log('Seated does not peek at Esra. See CLAUDE.md.');
  process.exit(1);
}

const platform = platforms[restaurant.platform]!;
console.log(`${restaurant.name} · ${restaurant.city} · ${platform.label} · party of ${partySize} · next ${days} days\n`);
const today = localDate(new Date());
const dates = Array.from({ length: days }, (_, i) => addDays(today, i));
// Like the radar: if the calendar call fails, read every day instead.
const worth = platform.openDates
  ? await platform.openDates(restaurant, dates, partySize).catch((err: Error) => {
      console.log(`(calendar unavailable: ${err.message}; reading every day)`);
      return new Set(dates);
    })
  : new Set(dates);
let total = 0;
for (const date of dates) {
  if (!worth.has(date)) {
    console.log(`${slotLabel(date).padEnd(12)} (calendar: no tables)`);
    continue;
  }
  try {
    const slots = await platform.getSlots(restaurant, date, partySize);
    const open = slots.filter((s) => s.open).map((s) => s.time);
    total += open.length;
    console.log(`${slotLabel(date).padEnd(12)} ${open.length ? open.join(' ') : slots.length ? '(full)' : '(no slots)'}`);
  } catch (err) {
    console.log(`${slotLabel(date).padEnd(12)} ERROR ${err instanceof Error ? err.message : err}`);
  }
}
console.log(`\n${total} open slots. Book: ${platform.bookingUrl(restaurant, today, '19:00', partySize)}`);
