// Look at one restaurant's open tables right now, straight from the platform.
//   npm run peek -- klepel            party of 2, next 7 days
//   npm run peek -- "bistro feline" 4 10
import { formitable } from './server/platforms/formitable.js';
import { loadCuratedRestaurants, slugify } from './server/restaurants.js';
import { addDays, localDate, slotLabel } from './server/time.js';

const [query, partyArg, daysArg] = process.argv.slice(2);
if (!query) {
  console.log('Usage: npm run peek -- <restaurant name> [party size] [days]');
  process.exit(1);
}
const partySize = Number(partyArg ?? 2);
const days = Math.min(Number(daysArg ?? 7), 31);

const needle = slugify(query);
const matches = loadCuratedRestaurants().filter((r) => r.id.includes(needle));
const restaurant = matches.find((r) => r.platform === 'formitable' && r.platformUid);
if (!restaurant) {
  const found = matches.map((r) => `${r.name} (${r.platform})`).join(', ');
  console.log(found ? `No Formitable match. Found: ${found}` : `No restaurant matches "${query}".`);
  process.exit(1);
}

console.log(`${restaurant.name} · ${restaurant.city} · party of ${partySize} · next ${days} days\n`);
const platform = formitable();
const today = localDate(new Date());
let total = 0;
for (let i = 0; i < days; i++) {
  const date = addDays(today, i);
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
