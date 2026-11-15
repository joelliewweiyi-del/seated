// The nightly backup of the map's Supabase project (scripts/api-backup.ts) must bring everything back: characters
// (their key still opens them), lists and reports. Run in PGlite with the real supabase/schema.sql.
import { describe, expect, it } from 'vitest';
import { createSeatedApi } from '../src/server/seatedApiDev';
import { DUMP_SQL, restoreSql, type Backup } from '../src/server/apiBackup';

async function ok<T = any>(api: Awaited<ReturnType<typeof createSeatedApi>>, fn: string, args: Record<string, unknown>, ip?: string): Promise<T> {
  const r = await api.rpc(fn, args, ip);
  if (r.status !== 200) throw new Error(`${fn}: ${JSON.stringify(r.body)}`);
  return r.body as T;
}

describe('Supabase backup', () => {
  it('a dump restored into an empty project gives back every character, list and report; the key still works', async () => {
    const src = await createSeatedApi();
    const { key } = await ok(src, 'create_account', { p_name: 'Ana', p_avatar: { hair: 2 }, p_answers: { night: 'date' }, p_profile: 'wine-wanderer' });
    const list = await ok(src, 'save_list', { p_key: key, p_title: 'Wine bars', p_places: ['vrr', 'bottleshop', 'nikotin'], p_public: true });
    await ok(src, 'report_list', { p_id: list.id }, '10.0.0.9');
    const dump = (await src.db.query<{ backup: Backup }>(DUMP_SQL)).rows[0]!.backup;
    expect(dump.accounts).toHaveLength(1);
    expect(dump.lists).toHaveLength(1);
    expect(dump.reports).toHaveLength(1);

    const dst = await createSeatedApi();
    await dst.db.exec(restoreSql(JSON.parse(JSON.stringify(dump)) as Backup));
    const me = await ok(dst, 'get_me', { p_key: key });
    expect(me.account).toMatchObject({ name: 'Ana', avatar: { hair: 2 }, profile: 'wine-wanderer' });
    expect(me.lists[0]).toMatchObject({ title: 'Wine bars', places: ['vrr', 'bottleshop', 'nikotin'], public: true });
    const again = (await dst.db.query<{ backup: Backup }>(DUMP_SQL)).rows[0]!.backup;
    expect({ ...again, at: null }).toEqual({ ...JSON.parse(JSON.stringify(dump)), at: null });

    // Restoring onto a live project only adds what was lost.
    await dst.db.exec(restoreSql(dump));
    expect((await dst.db.query<{ n: number }>('select count(*)::int n from seated.accounts')).rows[0]!.n).toBe(1);
  });

  it('refuses a backup of an unknown version', () => {
    expect(() => restoreSql({ v: 2 } as unknown as Backup)).toThrow(/Unknown backup version/);
  });
});
