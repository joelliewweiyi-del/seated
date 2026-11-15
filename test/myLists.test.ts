// Alerts for your own lists (src/server/myLists.ts): each restaurant on your seated.food lists gets a prime-time
// watch, alerts only. These hold the lines that keep it safe: it never auto-books, never touches a watch you made,
// keeps your paused and booked ones as they are, and a failed read removes nothing.
import { describe, expect, it } from 'vitest';
import { Store } from '../src/server/db';
import { fetchMyPlaces, LIST_SOURCE, MAX_LIST_WATCHES, syncListWatches } from '../src/server/myLists';
import { createSeatedApi } from '../src/server/seatedApiDev';
import { PRIME } from '../src/shared/prime';
import type { Restaurant } from '../src/server/platforms/types';

const NOW = '2026-11-15T12:00:00.000Z';
const r = (id: string, platform = 'formitable', uid: string | null = `${id}-uid`): Restaurant => ({
  id, name: id, platform, platformUid: uid, website: null, city: 'Amsterdam', address: null,
});
const readable = (x: Restaurant) => x.platform !== 'other' && !!x.platformUid;

function store() {
  const s = new Store(':memory:');
  s.seedRestaurants([r('a'), r('b'), r('c'), r('phone', 'other', null)]);
  return s;
}

describe('list watches', () => {
  it('gives each listed restaurant a prime-time watch that only alerts, and skips what the radar cannot read', () => {
    const s = store();
    const out = syncListWatches(s, ['a', 'b', 'phone', 'unknown'], readable, NOW);
    expect(out).toEqual({ added: ['a', 'b'], removed: [], skipped: ['phone', 'unknown'] });
    const ws = s.watchesFrom(LIST_SOURCE);
    expect(ws.map((w) => w.restaurantId)).toEqual(['a', 'b']);
    for (const w of ws) expect(w).toMatchObject({ partySize: PRIME.partySize, weekdays: PRIME.weekdays, timeFrom: PRIME.timeFrom, timeTo: PRIME.timeTo, autoBook: false, status: 'watching' });
  });

  it('is idempotent, and removes a list watch when its restaurant leaves every list', () => {
    const s = store();
    syncListWatches(s, ['a', 'b'], readable, NOW);
    expect(syncListWatches(s, ['a', 'b'], readable, NOW)).toEqual({ added: [], removed: [], skipped: [] });
    expect(syncListWatches(s, ['a'], readable, NOW)).toEqual({ added: [], removed: ['b'], skipped: [] });
    expect(s.watchesFrom(LIST_SOURCE).map((w) => w.restaurantId)).toEqual(['a']);
  });

  it("never touches a watch you made, and adds none where yours already covers prime time", () => {
    const s = store();
    const mine = s.createWatch({ ...PRIME, restaurantId: 'a', timeFrom: '18:00', timeTo: '22:00' }, NOW);
    expect(syncListWatches(s, ['a'], readable, NOW).added).toEqual([]);
    syncListWatches(s, [], readable, NOW);
    expect(s.getWatch(mine.id)).toBeDefined();
  });

  it('keeps a list watch you paused or that got a table: no second watch, and a booked one is not deleted', () => {
    const s = store();
    syncListWatches(s, ['a', 'b'], readable, NOW);
    const [wa, wb] = s.watchesFrom(LIST_SOURCE);
    s.updateWatch(wa!.id, { status: 'paused' });
    s.updateWatch(wb!.id, { status: 'booked' });
    expect(syncListWatches(s, ['a', 'b'], readable, NOW).added).toEqual([]);
    expect(s.getWatch(wa!.id)!.status).toBe('paused');
    syncListWatches(s, [], readable, NOW);
    expect(s.getWatch(wb!.id)!.status).toBe('booked'); // its booking history stays
    expect(s.getWatch(wa!.id)).toBeUndefined();
  });

  it(`watches at most ${MAX_LIST_WATCHES} restaurants from lists, to keep live reads small`, () => {
    const s = new Store(':memory:');
    const ids = Array.from({ length: MAX_LIST_WATCHES + 5 }, (_, i) => `r${i}`);
    s.seedRestaurants(ids.map((id) => r(id)));
    const out = syncListWatches(s, ids, readable, NOW);
    expect(out.added).toHaveLength(MAX_LIST_WATCHES);
    expect(out.skipped).toHaveLength(5);
  });
});

describe('reading your lists', () => {
  it('reads every place on every list of your character, through the public API with your key', async () => {
    const api = await createSeatedApi();
    const made = await api.rpc('create_account', { p_name: 'Joel', p_avatar: {}, p_answers: {}, p_profile: null });
    const key = (made.body as { key: string }).key;
    await api.rpc('save_list', { p_key: key, p_title: 'Dates', p_places: ['a', 'b'], p_public: false });
    await api.rpc('save_list', { p_key: key, p_title: 'Wine', p_places: ['b', 'c'], p_public: false });
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const fn = String(url).split('/').pop()!;
      const r = await api.rpc(fn, JSON.parse(String(init!.body)));
      return new Response(JSON.stringify(r.body), { status: r.status });
    }) as typeof fetch;
    expect((await fetchMyPlaces({ url: 'https://x/rpc', key: 'pk' }, key, fetchImpl)).sort()).toEqual(['a', 'b', 'c']);
    await expect(fetchMyPlaces({ url: 'https://x/rpc', key: 'pk' }, 'AAAA-BBBB-CCCC-DDDD', fetchImpl)).rejects.toThrow(/No character has this key/);
  });
});
