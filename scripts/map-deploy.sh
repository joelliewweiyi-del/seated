#!/usr/bin/env bash
# Puts the public map (dist/map) online: Vercel team joelliewweiyi-dels-projects, project seated-map,
# https://seated-map.vercel.app. This is the go-live step: every CLI deploy of this project lands on production,
# also with --environment preview (tried 5 Nov 2026), and its .vercel.app domain is public.
# The page reads /data.json, which deploy/map/vercel.json points at the Vercel Blob store (fra1) that Seated fills
# after each census (BLOB_READ_WRITE_TOKEN, 1Password bara-dev/seated-map-blob). Nothing else deploys from here.
#   VITE_MAP_CONTACT=<opt-out address> scripts/map-deploy.sh --prod
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "${1:-}" != "--prod" ]]; then
  echo "This deploy is public. Run it with --prod once Joel has said go." >&2
  exit 1
fi
if [[ -z "${VITE_MAP_CONTACT:-}" ]]; then
  echo "Set VITE_MAP_CONTACT (the address restaurants write to to come off the map) before going public." >&2
  exit 1
fi
npx tsx scripts/map-sez-sync.ts # the city art (sezlab, with permission): fetches only what is missing
npx vite build -c vite.map.config.ts
cp deploy/map/vercel.json dist/map/vercel.json
VERCEL_ORG_ID=team_eUkad93RQyEOnkyPiSoPR4Mr VERCEL_PROJECT_ID=prj_TUZq0gmT8CLbhxEHRADEXdOdsE9h vercel deploy dist/map --prod --yes
