// Applies supabase/schema.sql to Seated's Supabase project (accounts, lists, reports). Safe to run again: every
// statement is "if not exists" or "create or replace". Needs a Supabase personal access token:
//   SUPABASE_ACCESS_TOKEN=$(op item get "Supabase CLI:supabase" --vault bara-dev --fields password --reveal) npx tsx scripts/api-schema.ts
import { readFileSync } from 'node:fs';

export const SEATED_PROJECT = 'vczosuhhqvzombqtlscc'; // "seated", Joel AI org, eu-central-1

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error('Set SUPABASE_ACCESS_TOKEN (1Password bara-dev, "Supabase CLI:supabase") and run again.');
  process.exit(1);
}
const sql = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const res = await fetch(`https://api.supabase.com/v1/projects/${SEATED_PROJECT}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});
const text = await res.text();
if (!res.ok) {
  console.error(`The schema was not applied (${res.status}): ${text.slice(0, 600)}`);
  console.error('Nothing changed if the error names the first statement; otherwise fix the statement it names and run again.');
  process.exit(1);
}
// Check from the outside what the public key can call.
const check = await fetch(`https://api.supabase.com/v1/projects/${SEATED_PROJECT}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('public', 'seated') and has_function_privilege('anon', p.oid, 'execute') order by 1`,
  }),
});
console.log('Applied. The public key may call:', ((await check.json()) as Array<{ proname: string }>).map((r) => r.proname).join(', '));
