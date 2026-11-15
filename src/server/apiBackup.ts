// Backups of the map's Supabase project (characters, lists, reports). The free plan keeps none (Joel's go,
// 15 Nov 2026), so the Mac mini keeps a nightly copy: scripts/api-backup.ts. One SQL statement reads everything as
// one JSON document; another puts such a document back. Both run the same in PGlite (test/apiBackup.test.ts).

/** Every row of the three tables, as one JSON object. bytea columns travel as hex. */
export const DUMP_SQL = `select json_build_object(
  'v', 1,
  'at', now(),
  'accounts', coalesce((select json_agg(json_build_object('id', id, 'key_hash', encode(key_hash, 'hex'), 'name', name,
    'avatar', avatar, 'answers', answers, 'profile', profile, 'ip_hash', encode(ip_hash, 'hex'),
    'created_at', created_at, 'updated_at', updated_at) order by created_at) from seated.accounts), '[]'),
  'lists', coalesce((select json_agg(row_to_json(l) order by l.created_at) from seated.lists l), '[]'),
  'reports', coalesce((select json_agg(json_build_object('list_id', list_id, 'reporter', encode(reporter, 'hex'),
    'created_at', created_at)) from seated.reports), '[]')
) as backup`;

export interface Backup {
  v: 1;
  at: string;
  accounts: unknown[];
  lists: unknown[];
  reports: unknown[];
}

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * Puts a backup back. Rows that exist are left as they are (on conflict do nothing), so restoring onto a live
 * project only adds what was lost. One transaction: it lands whole or not at all.
 */
export function restoreSql(b: Backup): string {
  if (b.v !== 1) throw new Error(`Unknown backup version ${String(b.v)}: restore it with the version of this script that wrote it.`);
  const j = (x: unknown) => `${lit(JSON.stringify(x))}::json`;
  return `begin;
insert into seated.accounts (id, key_hash, name, avatar, answers, profile, ip_hash, created_at, updated_at)
select id, decode(key_hash, 'hex'), name, avatar, answers, profile, decode(ip_hash, 'hex'), created_at, updated_at
from json_to_recordset(${j(b.accounts)}) as x(id uuid, key_hash text, name text, avatar jsonb, answers jsonb, profile text,
  ip_hash text, created_at timestamptz, updated_at timestamptz)
on conflict do nothing;
insert into seated.lists (id, owner, title, note, places, public, hidden, created_at, updated_at)
select id, owner, title, note, places, public, hidden, created_at, updated_at
from json_to_recordset(${j(b.lists)}) as x(id uuid, owner uuid, title text, note text, places text[], public boolean,
  hidden boolean, created_at timestamptz, updated_at timestamptz)
on conflict do nothing;
insert into seated.reports (list_id, reporter, created_at)
select list_id, decode(reporter, 'hex'), created_at
from json_to_recordset(${j(b.reports)}) as x(list_id uuid, reporter text, created_at timestamptz)
on conflict do nothing;
commit;`;
}
