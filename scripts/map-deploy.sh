#!/usr/bin/env bash
# Puts the public map (dist/map) online at https://seated.food: Vercel team joelliewweiyi-dels-projects, project
# seated-map (also https://seated-map.vercel.app). Every CLI deploy of this project lands on production,
# also with --environment preview (tried 5 Nov 2026), and its .vercel.app domain is public.
# The page reads /data.json, which deploy/map/vercel.json points at the Vercel Blob store (fra1) that Seated fills
# after each census (BLOB_READ_WRITE_TOKEN, 1Password bara-dev/seated-map-blob). The AI search is a function here too
# (api/classify.mjs, Jev; TYPESAFE_API_KEY in the project's environment). Nothing else deploys from here.
# It also applies supabase/schema.sql to the Supabase project "seated" (characters and lists), which is idempotent.
#   VITE_MAP_CONTACT=hello@seated.food scripts/map-deploy.sh --prod
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "${1:-}" != "--prod" ]]; then
  echo "This deploy is public (https://seated.food). Run it with --prod." >&2
  exit 1
fi
if [[ -z "${VITE_MAP_CONTACT:-}" ]]; then
  echo "Set VITE_MAP_CONTACT (the address restaurants write to to come off the map) before going public." >&2
  exit 1
fi
# Characters and lists live in Supabase (supabase/schema.sql). The schema goes first, so the page never calls a
# function that is not there yet; the page gets the project URL and its public key from deploy/map/api.json.
if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  SUPABASE_ACCESS_TOKEN=$(op item get "Supabase CLI:supabase" --vault bara-dev --fields password --reveal) || {
    echo "No Supabase token: set SUPABASE_ACCESS_TOKEN, or make 1Password (bara-dev, \"Supabase CLI:supabase\") readable." >&2
    exit 1
  }
  export SUPABASE_ACCESS_TOKEN
fi
npx tsx scripts/api-schema.ts
export VITE_SEATED_API=$(node -p "require('./deploy/map/api.json').url")
export VITE_SEATED_API_KEY=$(node -p "require('./deploy/map/api.json').key")
npx tsx scripts/map-sez-sync.ts # the city art (sezlab, with permission): fetches only what is missing
# Our canal-belt sample (?art=ours): gitignored, built from open data cached in .cache/ (offline when warm).
if [[ ! -f src/map/public/canal/manifest.json ]]; then
  echo "No canal sample in src/map/public/canal: run SEATED_ART=canal npx tsx scripts/map-noord.ts first (offline from .cache)." >&2
  exit 1
fi
npx vite build -c vite.map.config.ts
npx tsx scripts/map-og.ts dist/map # the share card (og.jpg): built here, never committed (it shows his art)
# A data.json in the build would shadow the /data.json rewrite and freeze the public map.
if [[ -e dist/map/data.json ]]; then echo "dist/map/data.json must not exist" >&2; exit 1; fi
cp deploy/map/vercel.json dist/map/vercel.json
# The AI search (/api/classify): a Vercel function beside the page, with what it knows of each restaurant. It reads
# TYPESAFE_API_KEY from the project's environment (set once from 1Password bara-dev "typesafe api"; never in the page).
mkdir -p dist/map/api
cp deploy/map/api/classify.mjs dist/map/api/classify.mjs
npx tsx scripts/map-facts.ts dist/map/api/_facts.mjs
VERCEL_ORG_ID=team_eUkad93RQyEOnkyPiSoPR4Mr VERCEL_PROJECT_ID=prj_TUZq0gmT8CLbhxEHRADEXdOdsE9h vercel deploy dist/map --prod --yes
