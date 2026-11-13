// Seated's public API (supabase/schema.sql), run in PGlite as the browser's "anon" role. These hold the lines that
// make a key-only account safe: the key is never stored, a wrong key opens nothing, one character cannot touch
// another's lists, the tables are out of reach, and three reports hide a community list.
import { beforeEach, describe, expect, it } from 'vitest';
import { createSeatedApi, type SeatedApi } from '../src/server/seatedApiDev';

let api: SeatedApi;
beforeEach(async () => {
  api = await createSeatedApi();
});

async function ok<T = any>(fn: string, args: Record<string, unknown>, ip?: string): Promise<T> {
  const r = await api.rpc(fn, args, ip);
  if (r.status !== 200) throw new Error(`${fn}: ${JSON.stringify(r.body)}`);
  return r.body as T;
}
async function refused(fn: string, args: Record<string, unknown>, ip?: string): Promise<string> {
  const r = await api.rpc(fn, args, ip);
  expect(r.status).toBe(400);
  return (r.body as { message: string }).message;
}
const character = (name = 'Ana') => ok('create_account', { p_name: name, p_avatar: { hair: 2 }, p_answers: { night: 'date' }, p_profile: 'wine-wanderer' });

describe('accounts', () => {
  it('a new character gets a key once; the database keeps only its hash', async () => {
    const { key, account } = await character();
    expect(key).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
    expect(account).toMatchObject({ name: 'Ana', avatar: { hair: 2 }, profile: 'wine-wanderer' });
    expect(account).not.toHaveProperty('key_hash');
    const stored = await api.db.query<{ t: string }>(`select row_to_json(a)::text t from seated.accounts a`);
    expect(stored.rows[0]!.t).not.toContain(key.replaceAll('-', ''));
    expect(stored.rows[0]!.t).not.toContain(key);
  });

  it('the key opens the character on another device, typed loosely; a wrong key opens nothing', async () => {
    const { key } = await character();
    const loose = key.toLowerCase().replaceAll('-', ' ').replaceAll('0', 'o').replaceAll('1', 'l');
    expect((await ok('get_me', { p_key: loose })).account.name).toBe('Ana');
    expect(await refused('get_me', { p_key: 'AAAA-BBBB-CCCC-DDDD' })).toBe('No character has this key.');
    expect(await refused('get_me', { p_key: '' })).toBe('No character has this key.');
  });

  it('names are checked, and the character can change its look and answers', async () => {
    expect(await refused('create_account', { p_name: 'x' })).toMatch(/2 to 24/);
    expect(await refused('create_account', { p_name: '<script>' })).toMatch(/2 to 24/);
    const { key } = await character('  Bo   Jansen ');
    const me = await ok('update_me', { p_key: key, p_avatar: { hair: 4 }, p_profile: 'tasting-chaser' });
    expect(me).toMatchObject({ name: 'Bo Jansen', avatar: { hair: 4 }, profile: 'tasting-chaser', answers: { night: 'date' } });
  });

  it('one connection makes at most 10 characters an hour', async () => {
    for (let i = 0; i < 10; i++) await ok('create_account', { p_name: `Guest ${i}` }, '9.9.9.9');
    expect(await refused('create_account', { p_name: 'Guest 11' }, '9.9.9.9')).toMatch(/Too many new characters/);
    await ok('create_account', { p_name: 'Elsewhere' }, '8.8.8.8');
  });

  it('deleting a character deletes its lists', async () => {
    const { key } = await character();
    await ok('save_list', { p_key: key, p_title: 'Dates', p_places: ['a', 'b', 'c'], p_public: true });
    expect(await ok('delete_me', { p_key: key })).toBe(true);
    const n = await api.db.query<{ n: number }>(`select count(*)::int n from seated.lists`);
    expect(n.rows[0]!.n).toBe(0);
  });
});

describe('the browser role reaches the API only', () => {
  it('cannot read or write the tables, nor call the private helpers', async () => {
    await character();
    for (const sql of ['select * from seated.accounts', 'select * from seated.lists', `insert into seated.reports values (gen_random_uuid(), '\\x00')`, `select seated.new_key()`]) {
      await expect(
        api.db.transaction(async (tx) => {
          await tx.exec('set local role anon');
          await tx.query(sql);
        }),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it('an unknown function or argument is refused', async () => {
    expect((await api.rpc('new_key', {})).status).toBe(404);
    expect((await api.rpc('get_me', { p_key: 'x', p_admin: true })).status).toBe(404);
  });
});

describe('lists', () => {
  it('a character saves, edits and deletes its own lists; ids are cleaned and deduplicated', async () => {
    const { key } = await character();
    const l = await ok('save_list', { p_key: key, p_title: ' Date  nights ', p_note: 'Small rooms', p_places: ['bak', 'rijsel', 'bak'] });
    expect(l).toMatchObject({ title: 'Date nights', places: ['bak', 'rijsel'], public: false, by: { name: 'Ana' } });
    const e = await ok('save_list', { p_key: key, p_id: l.id, p_title: 'Date nights', p_places: ['bak'], p_public: true });
    expect(e).toMatchObject({ id: l.id, places: ['bak'], public: true });
    expect((await ok('get_me', { p_key: key })).lists).toHaveLength(1);
    expect(await refused('save_list', { p_key: key, p_title: 'x', p_places: ['Not An Id'] })).toMatch(/restaurant ids/);
    expect(await refused('save_list', { p_key: key, p_title: '', p_places: [] })).toMatch(/1 to 60/);
    expect(await ok('delete_list', { p_key: key, p_id: l.id })).toBe(true);
    expect((await ok('get_me', { p_key: key })).lists).toHaveLength(0);
  });

  it("one character cannot change or delete another's list", async () => {
    const a = await character('Ana');
    const b = await character('Bo');
    const l = await ok('save_list', { p_key: a.key, p_title: 'Mine', p_places: ['bak'] });
    expect(await refused('save_list', { p_key: b.key, p_id: l.id, p_title: 'Taken', p_places: [] })).toMatch(/another character/);
    expect(await ok('delete_list', { p_key: b.key, p_id: l.id })).toBe(false);
    expect((await ok('get_me', { p_key: a.key })).lists[0]).toMatchObject({ title: 'Mine', places: ['bak'] });
  });

  it('a character keeps at most 20 lists of at most 50 restaurants', async () => {
    const { key } = await character();
    const many = Array.from({ length: 51 }, (_, i) => `r${i}`);
    expect(await refused('save_list', { p_key: key, p_title: 'Big', p_places: many })).toMatch(/at most 50/);
    for (let i = 0; i < 20; i++) await ok('save_list', { p_key: key, p_title: `L${i}`, p_places: [] });
    expect(await refused('save_list', { p_key: key, p_title: 'L21', p_places: [] })).toMatch(/at most 20/);
  });
});

describe('community lists', () => {
  async function publicList(key: string, title = 'Wine bars', places = ['a', 'b', 'c']) {
    return ok('save_list', { p_key: key, p_title: title, p_places: places, p_public: true });
  }

  it('shows public lists of 3 or more, with their maker, and never private ones', async () => {
    const { key } = await character();
    const shown = await publicList(key);
    await publicList(key, 'Too short', ['a', 'b']);
    await ok('save_list', { p_key: key, p_title: 'Secret', p_places: ['a', 'b', 'c'], p_public: false });
    const all = await ok<any[]>('community_lists', {});
    expect(all.map((l) => l.title)).toEqual(['Wine bars']);
    expect(all[0].by).toEqual({ name: 'Ana', avatar: { hair: 2 }, profile: 'wine-wanderer' });
    expect(await ok('get_list', { p_id: shown.id })).toMatchObject({ title: 'Wine bars' });
  });

  it('three different reporters hide a list; one reporter counts once', async () => {
    const maker = await character('Ana');
    const l = await publicList(maker.key);
    const fan = await character('Bo');
    expect(await ok('report_list', { p_id: l.id, p_key: fan.key })).toEqual({ reports: 1, hidden: false });
    expect(await ok('report_list', { p_id: l.id, p_key: fan.key })).toEqual({ reports: 1, hidden: false });
    expect(await ok('report_list', { p_id: l.id }, '1.1.1.1')).toEqual({ reports: 2, hidden: false });
    expect(await ok('report_list', { p_id: l.id }, '1.1.1.1')).toEqual({ reports: 2, hidden: false });
    expect(await ok('report_list', { p_id: l.id }, '2.2.2.2')).toEqual({ reports: 3, hidden: true });
    expect(await ok<any[]>('community_lists', {})).toEqual([]);
    expect(await ok('get_list', { p_id: l.id })).toBeNull();
    // Editing does not unhide it: only Joel does, in the database.
    await ok('save_list', { p_key: maker.key, p_id: l.id, p_title: 'Wine bars', p_places: ['a', 'b', 'c'], p_public: true });
    expect(await ok<any[]>('community_lists', {})).toEqual([]);
  });

  it('a private list cannot be reported or opened by id', async () => {
    const { key } = await character();
    const l = await ok('save_list', { p_key: key, p_title: 'Secret', p_places: ['a', 'b', 'c'] });
    expect(await refused('report_list', { p_id: l.id })).toMatch(/not public/);
    expect(await ok('get_list', { p_id: l.id })).toBeNull();
  });
});
