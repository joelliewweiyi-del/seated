// You: your two answers, your character and your lists. Answers stay on this device until you make a character;
// then the character's key (kept on this device, shown to you once and on request) opens them anywhere.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError, type Account, type SeatedList } from './api';
import type { Look } from './avatar';
import { profileFor, tasteOf, type Answers, type Profile, type Weights } from './taste';
import type { MapRestaurant } from './data';

const STORE = 'seated.map.you';

interface Stored {
  answers: Answers;
  key: string | null;
  /** The welcome was shown (answered or skipped): it does not open by itself again. */
  welcomed: boolean;
}

function read(): Stored {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) ?? 'null') as Partial<Stored> | null;
    return { answers: s?.answers ?? {}, key: s?.key ?? null, welcomed: !!s?.welcomed };
  } catch {
    return { answers: {}, key: null, welcomed: false };
  }
}
function write(s: Stored) {
  try {
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    /* not remembered: the character still works until the page closes */
  }
}

export interface Problem {
  message: string;
  hint: string;
}
const problem = (e: unknown): Problem =>
  e instanceof ApiError ? { message: e.message, hint: e.hint } : { message: 'Something went wrong on this page.', hint: 'Reload the page and try again.' };

export interface You {
  answers: Answers;
  answered: boolean;
  welcomed: boolean;
  key: string | null;
  account: Account | null;
  lists: SeatedList[];
  community: SeatedList[] | null;
  /** Lists opened by link that are not yours and not (yet) in Community. */
  opened: Record<string, SeatedList | null>;
  taste: Weights;
  profile: Profile | null;
  busy: boolean;
  problem: Problem | null;
  clearProblem(): void;
  setWelcomed(): void;
  answer(a: Answers): void;
  create(name: string, look: Look): Promise<string | null>;
  /** Opens a character by its key; gives its account, or null (the problem says why). */
  restore(key: string): Promise<Account | null>;
  change(c: { name?: string; avatar?: Look }): Promise<boolean>;
  saveList(l: { id?: string | null; title: string; note?: string; places: string[]; public: boolean }): Promise<SeatedList | null>;
  deleteList(id: string): Promise<boolean>;
  loadCommunity(): Promise<void>;
  open(id: string): Promise<void>;
  report(id: string): Promise<boolean>;
  signOut(): void;
  deleteMe(): Promise<boolean>;
}

export function useYou(restaurants: MapRestaurant[]): You {
  const [stored, setStored] = useState<Stored>(read);
  const [account, setAccount] = useState<Account | null>(null);
  const [lists, setLists] = useState<SeatedList[]>([]);
  const [community, setCommunity] = useState<SeatedList[] | null>(null);
  const [opened, setOpened] = useState<Record<string, SeatedList | null>>({});
  const [busy, setBusy] = useState(false);
  const [problem_, setProblem] = useState<Problem | null>(null);

  const save = useCallback((next: Partial<Stored>) => {
    setStored((s) => {
      const n = { ...s, ...next };
      write(n);
      return n;
    });
  }, []);

  // A stored key opens the character when the page loads.
  useEffect(() => {
    if (!stored.key || account) return;
    let live = true;
    api
      .me(stored.key)
      .then((m) => {
        if (!live) return;
        setAccount(m.account);
        setLists(m.lists);
        if (Object.keys(m.account.answers ?? {}).length) save({ answers: m.account.answers });
      })
      .catch((e) => {
        if (!live) return;
        // A key the server does not know (the character was deleted elsewhere) is forgotten; a network error is not.
        if (e instanceof ApiError && e.refused) save({ key: null });
        setProblem(problem(e));
      });
    return () => {
      live = false;
    };
  }, [stored.key, account, save]);

  const byId = useMemo(() => new Map(restaurants.map((r) => [r.id, r])), [restaurants]);
  const listed = useMemo(() => {
    const ids = new Set(lists.flatMap((l) => l.places));
    return [...ids].map((id) => byId.get(id)).filter((r): r is MapRestaurant => !!r);
  }, [lists, byId]);
  const answered = !!(stored.answers.night && stored.answers.win);
  const taste = useMemo(() => tasteOf(stored.answers, listed), [stored.answers, listed]);
  const profile = answered || listed.length ? profileFor(taste) : null;

  // Keep the character's profile in step with its taste.
  useEffect(() => {
    if (!stored.key || !account || !profile || account.profile === profile.id) return;
    api
      .update(stored.key, { profile: profile.id })
      .then(setAccount)
      .catch(() => {});
  }, [stored.key, account, profile]);

  const run = useCallback(async <T,>(f: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    setProblem(null);
    try {
      return await f();
    } catch (e) {
      setProblem(problem(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    answers: stored.answers,
    answered,
    welcomed: stored.welcomed,
    key: stored.key,
    account,
    lists,
    community,
    opened,
    taste,
    profile,
    busy,
    problem: problem_,
    clearProblem: () => setProblem(null),
    setWelcomed: () => save({ welcomed: true }),
    answer: (a) => {
      save({ answers: a, welcomed: true });
      if (stored.key && a.night && a.win) api.update(stored.key, { answers: a }).then(setAccount).catch(() => {});
    },
    create: async (name, look) => {
      const r = await run(() => api.createAccount(name, look, stored.answers, profile?.id ?? null));
      if (!r) return null;
      save({ key: r.key, welcomed: true });
      setAccount(r.account);
      setLists([]);
      return r.key;
    },
    restore: async (key) => {
      const m = await run(() => api.me(key));
      if (!m) return null;
      save({ key: key.trim().toUpperCase(), welcomed: true, answers: Object.keys(m.account.answers ?? {}).length ? m.account.answers : stored.answers });
      setAccount(m.account);
      setLists(m.lists);
      return m.account;
    },
    change: async (c) => {
      if (!stored.key) return false;
      const a = await run(() => api.update(stored.key!, c));
      if (a) setAccount(a);
      return !!a;
    },
    saveList: async (l) => {
      if (!stored.key) return null;
      // A change to a list you have shows at once; it goes back if the server refuses it.
      const before = lists;
      if (l.id) setLists((ls) => ls.map((x) => (x.id === l.id ? { ...x, title: l.title, places: l.places, public: l.public, note: l.note ?? x.note } : x)));
      const saved = await run(() => api.saveList(stored.key!, l));
      if (!saved) setLists(before);
      if (saved) setLists((ls) => [saved, ...ls.filter((x) => x.id !== saved.id)]);
      if (saved && community) setCommunity(null); // refresh on next look
      return saved;
    },
    deleteList: async (id) => {
      if (!stored.key) return false;
      const ok = await run(() => api.deleteList(stored.key!, id));
      if (ok) setLists((ls) => ls.filter((x) => x.id !== id));
      return !!ok;
    },
    loadCommunity: async () => {
      try {
        setCommunity(await api.community());
      } catch (e) {
        setCommunity([]);
        setProblem(problem(e));
      }
    },
    open: async (id) => {
      if (id in opened || lists.some((l) => l.id === id)) return;
      try {
        const l = await api.list(id);
        setOpened((o) => ({ ...o, [id]: l }));
      } catch (e) {
        setOpened((o) => ({ ...o, [id]: null }));
        setProblem(problem(e));
      }
    },
    report: async (id) => {
      // A list that a report hides stays on this screen with its thanks; it is gone on the next load.
      const r = await run(() => api.report(id, stored.key));
      return !!r;
    },
    signOut: () => {
      save({ key: null });
      setAccount(null);
      setLists([]);
    },
    deleteMe: async () => {
      if (!stored.key) return false;
      const ok = await run(() => api.deleteMe(stored.key!));
      if (ok) {
        save({ key: null });
        setAccount(null);
        setLists([]);
      }
      return !!ok;
    },
  };
}
