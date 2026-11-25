// The AI half of the search (Joel, 25 Nov 2026: "a search bar powered by Jev ... every time you type, classify all the
// restaurants"). Half a second after the typing stops, the page asks api/classify (deploy/map/api/classify.mjs) which
// restaurants fit the words; the name search answers at once beside it. Each answer is kept for the visit.
import { useEffect, useState } from 'react';

/** Fewer letters than this: the name search only. */
export const AI_MIN = 3;
export const AI_WAIT_MS = 500;

export interface AiSearch {
  q: string;
  busy: boolean;
  /** Restaurant id to Jev's yes-probability; null while asking or after an error. */
  ids: Map<string, number> | null;
  /** Who answered: Jev, or the keyword stand-in on a server without a key. */
  by: 'jev' | 'stand-in' | null;
  error: string | null;
}

/** The search as the server asks and caches it (normalise in classify.mjs). */
export const normalise = (q: string) => q.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80);

const kept = new Map<string, AiSearch>();

/** Where the page's own api/ lives: /api on seated.food, /map/api on the demo server. */
const endpoint = (q: string) => new URL(`api/classify?q=${encodeURIComponent(q)}`, `${location.origin}${location.pathname.replace(/[^/]*$/, '')}`).href;

export function useAiSearch(query: string): AiSearch | null {
  const q = normalise(query);
  const [state, setState] = useState<AiSearch | null>(null);
  useEffect(() => {
    if (q.length < AI_MIN) {
      setState(null);
      return;
    }
    const hit = kept.get(q);
    if (hit) {
      setState(hit);
      return;
    }
    setState({ q, busy: true, ids: null, by: null, error: null });
    const stop = new AbortController();
    const wait = setTimeout(async () => {
      try {
        const res = await fetch(endpoint(q), { signal: stop.signal });
        const body = (await res.json().catch(() => ({}))) as { by?: 'jev' | 'stand-in'; matches?: Array<{ id: string; p: number }>; error?: string };
        if (!res.ok || !body.matches) throw new Error(body.error ?? `The AI search answered ${res.status}. The name search still works.`);
        const done: AiSearch = { q, busy: false, ids: new Map(body.matches.map((m) => [m.id, m.p])), by: body.by ?? null, error: null };
        kept.set(q, done);
        setState(done);
      } catch (err) {
        if (stop.signal.aborted) return;
        setState({ q, busy: false, ids: null, by: null, error: err instanceof Error ? err.message : 'The AI search did not answer. The name search still works.' });
      }
    }, AI_WAIT_MS);
    return () => {
      clearTimeout(wait);
      stop.abort();
    };
  }, [q]);
  return state?.q === q ? state : null;
}
