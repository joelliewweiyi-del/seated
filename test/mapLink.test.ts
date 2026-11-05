import { describe, expect, it } from 'vitest';
import { linkAt } from '../src/map/data';

describe('booking link for a picked time', () => {
  it('sets Formitable to the picked time in minutes after midnight, keeping date and party', () => {
    const u = new URL(linkAt('https://widget.formitable.com/side/en/b6328fcc/book?partysize=2&date=2026-11-05&time=1050', '21:30'));
    expect(u.searchParams.get('time')).toBe('1290');
    expect(u.searchParams.get('date')).toBe('2026-11-05');
    expect(u.searchParams.get('partysize')).toBe('2');
  });

  it('sets SevenRooms to the picked HH:mm', () => {
    const u = new URL(linkAt('https://www.sevenrooms.com/explore/restaurantflore/reservations/create/search/?date=2026-11-05&party_size=2&start_time=18%3A30', '19:15'));
    expect(u.searchParams.get('start_time')).toBe('19:15');
    expect(u.searchParams.get('party_size')).toBe('2');
  });

  it('leaves a link without a time as it is (Zenchef, Tebi, Guestplan, Frank)', () => {
    for (const url of ['https://bookings.zenchef.com/results?rid=387207&pid=1001&pax=2&day=2026-11-05', 'https://live.tebi.co/ecom/reservations/1_ab', 'not a url'])
      expect(linkAt(url, '20:00')).toBe(url);
  });
});
