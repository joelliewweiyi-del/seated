import { describe, expect, it } from 'vitest';
import { freeTimes } from '../src/map/data';

describe('free times on the map', () => {
  const r = { t: { '2026-11-05': ['17:00', '17:15', '20:30'], '2026-11-06': ['17:00'] } };
  // 17:10 in Amsterdam is 16:10 UTC in November.
  const now = new Date('2026-11-05T16:10:00Z');

  it("hides today's times that have gone by, in Amsterdam time", () => {
    expect(freeTimes(r, '2026-11-05', now)).toEqual(['17:15', '20:30']);
  });

  it('keeps every time on a later day', () => {
    expect(freeTimes(r, '2026-11-06', now)).toEqual(['17:00']);
  });
});
