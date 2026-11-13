-- Seated's small public backend: characters (accounts), their lists, and reports on community lists.
-- Supabase project "seated" (Joel AI org, eu-central-1). Applied by scripts/api-schema.ts; safe to run again.
--
-- The browser holds the project's public key, so it can call only the functions below (PostgREST RPC). Tables live
-- in the private schema "seated", which PostgREST does not expose, and have row-level security on with no policies.
-- An account is a random key that only its holder knows: we store its SHA-256, never the key, and no email.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists seated;

do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;

create table if not exists seated.accounts (
  id uuid primary key default gen_random_uuid(),
  key_hash bytea not null unique,
  name text not null check (char_length(name) between 2 and 24),
  avatar jsonb not null default '{}' check (jsonb_typeof(avatar) = 'object' and length(avatar::text) <= 400),
  answers jsonb not null default '{}' check (jsonb_typeof(answers) = 'object' and length(answers::text) <= 400),
  profile text check (profile is null or profile ~ '^[a-z-]{1,40}$'),
  ip_hash bytea,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists seated.lists (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references seated.accounts (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 60),
  note text not null default '' check (char_length(note) <= 200),
  places text[] not null default '{}' check (cardinality(places) <= 50),
  public boolean not null default false,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lists_owner on seated.lists (owner);
create index if not exists lists_community on seated.lists (updated_at desc) where public and not hidden;

create table if not exists seated.reports (
  list_id uuid not null references seated.lists (id) on delete cascade,
  reporter bytea not null,
  created_at timestamptz not null default now(),
  primary key (list_id, reporter)
);

alter table seated.accounts enable row level security;
alter table seated.lists enable row level security;
alter table seated.reports enable row level security;
revoke all on schema seated from public, anon, authenticated;
revoke all on all tables in schema seated from public, anon, authenticated;

-- Private helpers ---------------------------------------------------------------------------------------------------

create or replace function seated.sha(t text) returns bytea
language sql immutable set search_path = seated, extensions as $$
  select extensions.digest(t, 'sha256')
$$;

-- Keys are 16 characters of Crockford base32 (80 bits), shown as XXXX-XXXX-XXXX-XXXX. Typing is forgiving:
-- case, dashes and spaces are ignored, O reads as 0 and I or L as 1.
create or replace function seated.norm_key(k text) returns text
language sql immutable as $$
  select translate(regexp_replace(upper(coalesce(k, '')), '[^0-9A-Z]', '', 'g'), 'OIL', '011')
$$;

create or replace function seated.new_key() returns text
language plpgsql volatile set search_path = seated, extensions as $$
declare
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  b bytea := extensions.gen_random_bytes(16);
  k text := '';
begin
  for i in 0..15 loop
    k := k || substr(alphabet, (get_byte(b, i) % 32) + 1, 1);
    if i in (3, 7, 11) then k := k || '-'; end if;
  end loop;
  return k;
end $$;

create or replace function seated.me(p_key text) returns seated.accounts
language plpgsql stable set search_path = seated, extensions as $$
declare
  a seated.accounts;
begin
  select * into a from seated.accounts where key_hash = seated.sha(seated.norm_key(p_key));
  if not found then
    raise exception 'No character has this key.'
      using errcode = 'P0001', hint = 'Check the key for typos, or start a new character on this device.';
  end if;
  return a;
end $$;

-- The visitor's address, hashed with a fixed label, for rate limits and reports. The raw address is never stored.
create or replace function seated.client() returns bytea
language sql stable set search_path = seated, extensions as $$
  select seated.sha('seated-ip:' || coalesce(
    nullif(trim(split_part(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ''), ',', 1)), ''),
    'unknown'))
$$;

create or replace function seated.clean_name(p text) returns text
language plpgsql immutable as $$
declare
  n text := regexp_replace(trim(coalesce(p, '')), '\s+', ' ', 'g');
begin
  if char_length(n) < 2 or char_length(n) > 24 or n !~ '^[[:alnum:] ._''-]+$' then
    raise exception 'A name needs 2 to 24 letters, digits, spaces, dots, dashes or apostrophes.'
      using errcode = 'P0001', hint = 'Pick another name.';
  end if;
  return n;
end $$;

create or replace function seated.clean_places(p text[]) returns text[]
language plpgsql immutable as $$
declare
  out_ text[] := '{}';
  x text;
begin
  foreach x in array coalesce(p, '{}') loop
    if x !~ '^[a-z0-9][a-z0-9-]{0,48}$' then
      raise exception 'A list holds Seated restaurant ids only.' using errcode = 'P0001', hint = 'Add restaurants from the map.';
    end if;
    if not x = any (out_) then out_ := out_ || x; end if;
  end loop;
  if cardinality(out_) > 50 then
    raise exception 'A list holds at most 50 restaurants.' using errcode = 'P0001', hint = 'Split it into two lists.';
  end if;
  return out_;
end $$;

create or replace function seated.small_object(p jsonb, what text) returns jsonb
language plpgsql immutable as $$
begin
  if p is null then return '{}'::jsonb; end if;
  if jsonb_typeof(p) <> 'object' or length(p::text) > 400 then
    raise exception '% is too large.', what using errcode = 'P0001', hint = 'Nothing to do: the page sends this itself.';
  end if;
  return p;
end $$;

create or replace function seated.account_json(a seated.accounts) returns json
language sql stable as $$
  select json_build_object('id', a.id, 'name', a.name, 'avatar', a.avatar, 'answers', a.answers, 'profile', a.profile,
    'createdAt', a.created_at)
$$;

create or replace function seated.list_json(l seated.lists) returns json
language sql stable set search_path = seated as $$
  select json_build_object('id', l.id, 'title', l.title, 'note', l.note, 'places', l.places, 'public', l.public,
    'hidden', l.hidden, 'updatedAt', l.updated_at,
    'by', (select json_build_object('name', a.name, 'avatar', a.avatar, 'profile', a.profile) from seated.accounts a where a.id = l.owner))
$$;

-- Public functions (the API) ------------------------------------------------------------------------------------------

create or replace function public.create_account(p_name text, p_avatar jsonb default '{}', p_answers jsonb default '{}', p_profile text default null)
returns json language plpgsql security definer set search_path = seated, extensions as $$
declare
  k text := seated.new_key();
  ip bytea := seated.client();
  a seated.accounts;
begin
  if (select count(*) from seated.accounts where ip_hash = ip and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many new characters from this connection in the last hour.'
      using errcode = 'P0001', hint = 'Try again in an hour, or use the key of a character you already have.';
  end if;
  insert into seated.accounts (key_hash, name, avatar, answers, profile, ip_hash)
  values (seated.sha(seated.norm_key(k)), seated.clean_name(p_name), seated.small_object(p_avatar, 'The character'),
    seated.small_object(p_answers, 'The answers'), p_profile, ip)
  returning * into a;
  return json_build_object('key', k, 'account', seated.account_json(a));
end $$;

create or replace function public.get_me(p_key text)
returns json language plpgsql security definer set search_path = seated, extensions as $$
declare
  a seated.accounts := seated.me(p_key);
begin
  return json_build_object('account', seated.account_json(a),
    'lists', coalesce((select json_agg(seated.list_json(l) order by l.updated_at desc) from seated.lists l where l.owner = a.id), '[]'::json));
end $$;

create or replace function public.update_me(p_key text, p_name text default null, p_avatar jsonb default null, p_answers jsonb default null, p_profile text default null)
returns json language plpgsql security definer set search_path = seated, extensions as $$
declare
  a seated.accounts := seated.me(p_key);
begin
  update seated.accounts set
    name = case when p_name is null then name else seated.clean_name(p_name) end,
    avatar = case when p_avatar is null then avatar else seated.small_object(p_avatar, 'The character') end,
    answers = case when p_answers is null then answers else seated.small_object(p_answers, 'The answers') end,
    profile = coalesce(p_profile, profile),
    updated_at = now()
  where id = a.id
  returning * into a;
  return seated.account_json(a);
end $$;

create or replace function public.delete_me(p_key text)
returns boolean language plpgsql security definer set search_path = seated, extensions as $$
declare
  a seated.accounts := seated.me(p_key);
begin
  delete from seated.accounts where id = a.id;
  return true;
end $$;

create or replace function public.save_list(p_key text, p_id uuid default null, p_title text default null, p_note text default '',
  p_places text[] default '{}', p_public boolean default false)
returns json language plpgsql security definer set search_path = seated, extensions as $$
declare
  a seated.accounts := seated.me(p_key);
  l seated.lists;
  t text := regexp_replace(trim(coalesce(p_title, '')), '\s+', ' ', 'g');
begin
  if char_length(t) < 1 or char_length(t) > 60 then
    raise exception 'A list needs a name of 1 to 60 characters.' using errcode = 'P0001', hint = 'Give the list a shorter name.';
  end if;
  if char_length(coalesce(p_note, '')) > 200 then
    raise exception 'A note holds at most 200 characters.' using errcode = 'P0001', hint = 'Shorten the note.';
  end if;
  if p_id is null then
    if (select count(*) from seated.lists where owner = a.id) >= 20 then
      raise exception 'A character keeps at most 20 lists.' using errcode = 'P0001', hint = 'Delete a list you no longer use.';
    end if;
    insert into seated.lists (owner, title, note, places, public)
    values (a.id, t, coalesce(p_note, ''), seated.clean_places(p_places), coalesce(p_public, false))
    returning * into l;
  else
    update seated.lists set title = t, note = coalesce(p_note, ''), places = seated.clean_places(p_places),
      public = coalesce(p_public, false), updated_at = now()
    where id = p_id and owner = a.id
    returning * into l;
    if not found then
      raise exception 'This list belongs to another character.' using errcode = 'P0001', hint = 'Make a copy instead: start a new list.';
    end if;
  end if;
  return seated.list_json(l);
end $$;

create or replace function public.delete_list(p_key text, p_id uuid)
returns boolean language plpgsql security definer set search_path = seated, extensions as $$
declare
  a seated.accounts := seated.me(p_key);
begin
  delete from seated.lists where id = p_id and owner = a.id;
  return found;
end $$;

-- Community: public lists that are not hidden and hold at least 3 restaurants, newest first.
create or replace function public.community_lists(p_limit int default 30)
returns json language sql stable security definer set search_path = seated, extensions as $$
  select coalesce(json_agg(seated.list_json(l) order by l.updated_at desc), '[]'::json)
  from (select * from seated.lists where public and not hidden and cardinality(places) >= 3
        order by updated_at desc limit least(greatest(coalesce(p_limit, 30), 1), 100)) l
$$;

-- One list by its id: any public list that is not hidden (the link a maker shares).
create or replace function public.get_list(p_id uuid)
returns json language sql stable security definer set search_path = seated, extensions as $$
  select seated.list_json(l) from seated.lists l where l.id = p_id and l.public and not l.hidden
$$;

-- A report counts once per reporter: the character when a key is given, otherwise the connection. Three hide a list
-- until Joel looks (lists.hidden; seated.reports holds who and when).
create or replace function public.report_list(p_id uuid, p_key text default null)
returns json language plpgsql security definer set search_path = seated, extensions as $$
declare
  who bytea;
  n int;
  h boolean;
begin
  if not exists (select from seated.lists where id = p_id and public) then
    raise exception 'This list is not public (any more).' using errcode = 'P0001', hint = 'Nothing to do.';
  end if;
  who := case when nullif(p_key, '') is null then seated.client() else seated.sha('seated-acct:' || (seated.me(p_key)).id::text) end;
  insert into seated.reports (list_id, reporter) values (p_id, who) on conflict do nothing;
  select count(*) into n from seated.reports where list_id = p_id;
  update seated.lists set hidden = true where id = p_id and n >= 3 and not hidden;
  select hidden into h from seated.lists where id = p_id;
  return json_build_object('reports', n, 'hidden', h);
end $$;

-- Only the API is callable from outside.
revoke all on all functions in schema seated from public, anon, authenticated;
revoke execute on function public.create_account(text, jsonb, jsonb, text), public.get_me(text), public.update_me(text, text, jsonb, jsonb, text),
  public.delete_me(text), public.save_list(text, uuid, text, text, text[], boolean), public.delete_list(text, uuid),
  public.community_lists(int), public.get_list(uuid), public.report_list(uuid, text) from public;
grant execute on function public.create_account(text, jsonb, jsonb, text), public.get_me(text), public.update_me(text, text, jsonb, jsonb, text),
  public.delete_me(text), public.save_list(text, uuid, text, text, text[], boolean), public.delete_list(text, uuid),
  public.community_lists(int), public.get_list(uuid), public.report_list(uuid, text) to anon, authenticated;
