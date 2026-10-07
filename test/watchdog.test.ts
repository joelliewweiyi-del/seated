import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JavaScript module without types: the watchdog runs on bare Node, without a build step
import { decide } from '../scripts/watchdog.mjs';

const T0 = '2026-10-07T22:00:00Z';
const T1 = '2026-10-07T22:05:00Z';
const T2 = '2026-10-07T22:10:00Z';
const fresh = { downSince: null, told: false };

describe('watchdog', () => {
  it('does nothing while Seated is healthy', () => {
    expect(decide({ ok: true }, fresh, T0)).toEqual({ state: fresh, actions: [] });
  });

  it('restarts Seated and tells the user once when it stops, not every five minutes', () => {
    const first = decide(null, fresh, T0);
    expect(first.actions).toEqual(['restart', 'push-down']);
    const second = decide({ ok: false }, first.state, T1); // still down after the restart
    expect(second.actions).toEqual(['restart']);
    expect(second.state.downSince).toBe(T0); // the outage started at the first failed look
  });

  it('says it is back once it recovers, so the user knows the radar is watching again', () => {
    const down = decide(null, fresh, T0).state;
    expect(decide({ ok: true }, down, T2)).toEqual({ state: fresh, actions: ['push-up'] });
  });
});
