import { describe, expect, it } from 'vitest';
import { createApi } from '../src/server/api';
import { Store } from '../src/server/db';
import { Radar } from '../src/server/radar';
import { demoPlatform } from '../src/server/platforms/demo';
import { memoryNotifier } from '../src/server/notify';

function app({ localOnly = false } = {}) {
  const store = new Store(':memory:');
  store.seedRestaurants([
    { id: 'klepel', name: 'Café de Klepel', platform: 'formitable', platformUid: 'd94c781e', website: null, city: 'Amsterdam', address: null },
    { id: 'esra', name: 'Esra', platform: 'tebi', platformUid: '967051_x', website: null, city: 'Amsterdam', address: null },
  ]);
  const demo = demoPlatform();
  const notifier = memoryNotifier({ quiet: true });
  const platforms = { formitable: demo };
  const radar = new Radar({ store, platforms, notifier, horizonDays: 14, autoBookEnabled: false });
  const api = createApi({
    store,
    radar,
    platforms,
    notifier,
    demo,
    autoBookEnabled: false,
    pollSeconds: 120,
    horizonDays: 14,
    nextCheckAt: () => null,
    localOnly,
  });
  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = { 'X-Seated': '1' }) =>
    api.request(path, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { store, call };
}

const valid = {
  restaurantId: 'klepel',
  partySize: 2,
  dateFrom: null,
  dateTo: null,
  weekdays: null,
  timeFrom: '19:00',
  timeTo: '21:00',
  autoBook: false,
};

describe('watch API', () => {
  it('creates a valid watch', async () => {
    const { call } = app();
    expect((await call('POST', '/watches', valid)).status).toBe(201);
  });

  it('refuses a restaurant on a platform Seated cannot read, with a reason the user understands', async () => {
    const { call } = app();
    const res = await call('POST', '/watches', { ...valid, restaurantId: 'esra' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/cannot read yet/);
  });

  it('refuses a time window that ends before it starts', async () => {
    const { call } = app();
    expect((await call('POST', '/watches', { ...valid, timeFrom: '22:00', timeTo: '19:00' })).status).toBe(400);
  });

  it('refuses an edit of one end that would invert the stored window, so a watch cannot silently match nothing', async () => {
    const { call } = app();
    await call('POST', '/watches', valid);
    expect((await call('PATCH', '/watches/1', { timeFrom: '22:00' })).status).toBe(400);
    expect((await call('PATCH', '/watches/1', { timeFrom: '20:00' })).status).toBe(200);
  });

  it('will not resume a watch that already holds a table', async () => {
    const { store, call } = app();
    await call('POST', '/watches', valid);
    await call('PATCH', '/watches/1', { status: 'paused' });
    store.addBooking({
      watchId: 1,
      restaurantId: 'klepel',
      restaurantName: 'Café de Klepel',
      date: '2099-01-01',
      time: '19:00',
      partySize: 2,
      status: 'booked',
      reference: 'R',
      paymentUrl: null,
      error: null,
      createdAt: '',
    });
    expect((await call('PATCH', '/watches/1', { status: 'watching' })).status).toBe(400);
  });
});

describe('protection against other websites (found in review round 3)', () => {
  it('refuses a change request without the X-Seated header, which a cross-site form or fetch cannot add', async () => {
    const { call, store } = app();
    const res = await call('POST', '/watches', { ...valid, autoBook: true }, {});
    expect(res.status).toBe(403);
    expect(store.listWatches()).toHaveLength(0);
  });

  it('still allows reading state without the header', async () => {
    const { call } = app();
    expect((await call('GET', '/state', undefined, {})).status).toBe(200);
  });

  it('refuses requests for a foreign host name when no password is set (DNS rebinding)', async () => {
    const { call } = app({ localOnly: true });
    expect((await call('GET', '/state', undefined, { Host: 'evil.example:4310' })).status).toBe(403);
    expect((await call('GET', '/state', undefined, { Host: '127.0.0.1:4310' })).status).toBe(200);
  });
});
