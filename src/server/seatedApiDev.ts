// A local stand-in for Seated's public API (supabase/schema.sql on Supabase): the same SQL, run in PGlite (Postgres in
// WebAssembly), answering the same way PostgREST answers /rest/v1/rpc/<fn>. The demo server and the tests use it, so
// no test ever writes to the real project. Calls run as the "anon" role, like the browser's public key.
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const SCHEMA = new URL('../../supabase/schema.sql', import.meta.url);

export interface RpcAnswer {
  status: number;
  body: unknown;
}

interface Fn {
  args: Array<{ name: string; type: string }>;
}

const CAST: Record<string, (n: number) => string> = {
  text: (n) => `($${n}::jsonb #>> '{}')`,
  uuid: (n) => `($${n}::jsonb #>> '{}')::uuid`,
  integer: (n) => `($${n}::jsonb #>> '{}')::int`,
  boolean: (n) => `($${n}::jsonb #>> '{}')::boolean`,
  jsonb: (n) => `nullif($${n}::jsonb, 'null'::jsonb)`,
  'text[]': (n) => `case when $${n}::jsonb = 'null'::jsonb then null else array(select jsonb_array_elements_text($${n}::jsonb)) end`,
};

export interface SeatedApi {
  db: PGlite;
  /** One API call, as the browser makes it: POST /rest/v1/rpc/<fn> with a JSON body. `ip` stands in for X-Forwarded-For. */
  rpc(fn: string, args: Record<string, unknown>, ip?: string): Promise<RpcAnswer>;
}

export async function createSeatedApi(): Promise<SeatedApi> {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(readFileSync(SCHEMA, 'utf8'));
  // What the public key may call: exactly the functions granted to anon.
  const rows = await db.query<{ name: string; argnames: string[] | null; argtypes: string }>(
    `select p.proname as name, p.proargnames as argnames, pg_get_function_identity_arguments(p.oid) as argtypes
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')`,
  );
  const fns = new Map<string, Fn>();
  for (const r of rows.rows) {
    const types = r.argtypes ? r.argtypes.split(', ').map((a) => a.split(' ').slice(1).join(' ')) : [];
    fns.set(r.name, { args: (r.argnames ?? []).map((name, i) => ({ name, type: types[i]! })) });
  }

  async function rpc(name: string, args: Record<string, unknown>, ip = '127.0.0.1'): Promise<RpcAnswer> {
    const fn = fns.get(name);
    if (!fn) return { status: 404, body: { code: 'PGRST202', message: `Could not find the function public.${name}`, hint: null } };
    const given = fn.args.filter((a) => a.name in args);
    const unknown = Object.keys(args).filter((k) => !fn.args.some((a) => a.name === k));
    if (unknown.length) return { status: 404, body: { code: 'PGRST202', message: `public.${name} has no argument ${unknown.join(', ')}`, hint: null } };
    const params = given.map((a) => JSON.stringify(args[a.name] ?? null));
    const call = `select public.${name}(${given.map((a, i) => `${a.name} => ${CAST[a.type]!(i + 1)}`).join(', ')}) as r`;
    try {
      const r = await db.transaction(async (tx) => {
        await tx.query(`select set_config('request.headers', $1, true)`, [JSON.stringify({ 'x-forwarded-for': ip })]);
        await tx.exec('set local role anon');
        return tx.query<{ r: unknown }>(call, params);
      });
      return { status: 200, body: r.rows[0]?.r ?? null };
    } catch (e) {
      const err = e as { code?: string; message?: string; hint?: string };
      return { status: 400, body: { code: err.code ?? 'XX000', message: err.message ?? String(e), hint: err.hint ?? null } };
    }
  }

  return { db, rpc };
}
