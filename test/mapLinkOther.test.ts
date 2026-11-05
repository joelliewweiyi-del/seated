import { expect, it } from 'vitest';
import { linkAt } from '../src/map/data';

// Codex review, 5 Nov 2026: only Formitable and SevenRooms links get a new time; any other system's link stays as it is,
// even when it happens to carry a parameter with the same name.
it.each([
  'https://live.tebi.co/ecom/reservations/fixture?time=1080',
  'https://www.guestplan.com/?start_time=18%3A00',
  'https://widget.workspace.meetfrank.app/fixture/open?lang=en&time=1080',
  'https://bookings.zenchef.com/results?rid=123&start_time=18%3A00',
])('does not rewrite another platform link: %s', (url) => {
  expect(linkAt(url, '20:30')).toBe(url);
});

