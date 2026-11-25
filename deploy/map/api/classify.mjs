// The map's AI search (Joel, 25 Nov 2026: "a search bar that's powered by Jev ... every time you type, classify all the
// restaurants"). GET /api/classify?q=sunday+brunch answers which restaurants on the map fit the words, as Jev (TypeSafe's
// decision model, POST https://api.typesafe.ai/v1/systemone, docs.typesafe.ai/api) judges from what we know of each:
// kind, area, guides, the weekdays it opens, our own one line, and what its homepage says (data/map-about.json).
// One yes/no question (`noul`) per restaurant, in groups of GROUP so a request stays far under Jev's 32k tokens per
// question; about $0.001 a search. The Vercel CDN keeps an answer a day, so a repeated search costs nothing.
// The key (TYPESAFE_API_KEY, 1Password bara-dev "typesafe api") lives only in the Vercel project, never in the page.
// Without a key (tests, the demo server) a labelled keyword stand-in answers in the same shape, never as Jev.
// Deployed by scripts/map-deploy.sh next to the page as api/classify.mjs, with the facts in api/_facts.mjs.

export const MODEL = 'jev-1.13.0';
/** Restaurants per Jev request. */
export const GROUP = 30;
/** Jev's yes-probability from which a restaurant counts as a match. */
export const MATCH = 0.5;
export const MAX_QUERY = 80;
const DAYS = { Mo: 'Monday', Tu: 'Tuesday', We: 'Wednesday', Th: 'Thursday', Fr: 'Friday', Sa: 'Saturday', Su: 'Sunday' };
const KIND = { wine: 'wine bar', fine: 'fine dining', bistro: 'bistro', brasserie: 'brasserie', japanese: 'Japanese', pizza: 'Italian', cafe: 'café', greenhouse: 'greenhouse restaurant', island: 'island restaurant' };
const MICHELIN = { 3: 'three Michelin stars', 2: 'two Michelin stars', 1: 'one Michelin star', bib: 'Michelin Bib Gourmand' };

/** The search as it is asked and cached: lower case, single spaces, at most MAX_QUERY characters. */
export const normalise = (q) => String(q ?? '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY);

/**
 * One restaurant as the classifier reads it.
 * @param {{ id: string, name: string, area?: string, kind?: string, michelin?: string|null, g?: string[], hot?: number, why?: string, platform?: string }} r a data.json restaurant
 * @param {{ about?: Record<string, { text: string }>, hours?: Record<string, { open: string[] }>, guides?: Record<string, string> }} facts
 */
export function describe(r, facts) {
  const open = facts.hours?.[r.id]?.open;
  const guides = (r.g ?? []).map((g) => facts.guides?.[g]).filter(Boolean);
  return [
    `${r.name}: ${KIND[r.kind] ?? r.kind ?? 'restaurant'} in ${r.area ?? 'Amsterdam'}.`,
    r.michelin && `${MICHELIN[r.michelin] ?? 'Michelin'}.`,
    r.hot && 'Hard to book.',
    r.why && `${r.why}`,
    guides.length && `On the lists: ${guides.join(', ')}.`,
    open?.length && `Open on ${open.map((d) => DAYS[d] ?? d).join(', ')}.`,
    r.platform === 'walk-in' && 'Walk-in only, no reservations.',
    facts.about?.[r.id]?.text && `From its own website: ${facts.about[r.id].text}`,
  ]
    .filter(Boolean)
    .join(' ');
}

/** Jev's requests for one search: one `noul` question per restaurant, GROUP restaurants each. */
export function requests(q, restaurants, facts) {
  const out = [];
  for (let i = 0; i < restaurants.length; i += GROUP) {
    const group = restaurants.slice(i, i + GROUP);
    out.push({
      model: MODEL,
      state: { search: q, restaurants: Object.fromEntries(group.map((r) => [r.id, describe(r, facts)])) },
      questions: Object.fromEntries(
        group.map((r) => [
          r.id,
          {
            type: 'noul',
            instructions: `Someone looking for a place to eat in Amsterdam searched for "${q}". Does ${r.name} (state.restaurants["${r.id}"]) fit that search? Judge only from its description; when the description says nothing that fits, the answer is no.`,
          },
        ]),
      ),
    });
  }
  return out;
}

/** The restaurants Jev says yes to, most likely first. A missing or out-of-range answer is no. */
export function matchesFrom(answers) {
  return Object.entries(answers ?? {})
    .map(([id, a]) => ({ id, p: typeof a?.noul === 'number' && a.noul >= 0 && a.noul <= 1 ? a.noul : 0 }))
    .filter((x) => x.p >= MATCH)
    .sort((a, b) => b.p - a.p);
}

/** Ask Jev. Throws with what to do when it fails. */
export async function askJev(q, restaurants, facts, key, doFetch = fetch) {
  const all = await Promise.all(
    requests(q, restaurants, facts).map(async (body) => {
      const res = await doFetch('https://api.typesafe.ai/v1/systemone', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Jev answered ${res.status}: ${res.status === 401 ? 'the TYPESAFE_API_KEY in the Vercel project is wrong (1Password bara-dev, "typesafe api")' : res.status === 429 || res.status === 529 ? 'busy, try again in a moment' : 'see docs.typesafe.ai/api/errors'}`);
      return matchesFrom((await res.json()).answers);
    }),
  );
  return all.flat().sort((a, b) => b.p - a.p);
}

/** Without a key: every search word (3+ letters) in the description. Labelled "stand-in" wherever it answers. */
export function standIn(q, restaurants, facts) {
  const words = q.split(' ').filter((w) => w.length >= 3);
  return restaurants
    .filter((r) => words.length && words.every((w) => describe(r, facts).toLowerCase().includes(w)))
    .map((r) => ({ id: r.id, p: 1 }));
}

/** The answer for one search, from Jev or the stand-in. */
export async function classify(rawQ, restaurants, facts, key, doFetch = fetch) {
  const q = normalise(rawQ);
  if (q.length < 2) return { status: 400, body: { error: 'Type at least two letters.' } };
  try {
    const matches = key ? await askJev(q, restaurants, facts, key, doFetch) : standIn(q, restaurants, facts);
    return { status: 200, body: { q, by: key ? 'jev' : 'stand-in', model: key ? MODEL : null, matches } };
  } catch (err) {
    return { status: 502, body: { error: `${err instanceof Error ? err.message : err}. The name search still works.` } };
  }
}

// ---- the Vercel function ----
const DATA_URL = 'https://frbsdcwab8vdcurw.public.blob.vercel-storage.com/map/data.json';
let cache = null;
async function restaurantsNow() {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.list;
  const res = await fetch(DATA_URL, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`the map data answered ${res.status}`);
  cache = { at: Date.now(), list: (await res.json()).restaurants };
  return cache.list;
}

export async function GET(request) {
  const q = new URL(request.url).searchParams.get('q');
  let out;
  try {
    const facts = (await import('./_facts.mjs')).default;
    out = await classify(q, await restaurantsNow(), facts, process.env.TYPESAFE_API_KEY);
  } catch (err) {
    out = { status: 502, body: { error: `${err instanceof Error ? err.message : err}. The name search still works.` } };
  }
  return new Response(JSON.stringify(out.body), {
    status: out.status,
    headers: {
      'content-type': 'application/json',
      // A good answer is kept a day at the edge (the same search costs nothing twice); an error never.
      'cache-control': out.status === 200 ? 'public, max-age=300' : 'no-store',
      'vercel-cdn-cache-control': out.status === 200 ? 'max-age=86400' : 'no-store',
    },
  });
}
