import { expect, it, vi } from 'vitest';
import { frank } from '../src/server/platforms/frank';
import type { Restaurant } from '../src/server/platforms/types';

const restaurant: Restaurant = {
  id: 'fixture', name: 'Fixture', platform: 'frank',
  platformUid: 'widget-fixture', website: null,
  city: 'Amsterdam', address: null,
};

const entry = (date: string, status: string) => ({
  date_time: `${date}T00:00:00Z`, status,
});

// Codex review, 5 Nov 2026: a status named like an Object key (constructor, __proto__) must stay unknown.
it.each(['future-status', 'constructor', 'toString', '__proto__'])(
  'leaves month status %s out of the calendar',
  async (status) => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ data: [entry('2026-11-05', status)] }),
    );
    const result = await frank({ fetchImpl, gapMs: 0 })
      .calendar!(restaurant, ['2026-11-05'], 2);
    expect([...result]).toEqual([]);
  },
);
