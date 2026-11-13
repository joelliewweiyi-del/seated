// The map's small backend: characters and lists (supabase/schema.sql). Production talks to Supabase with its public
// key; the demo server answers the same calls at /map-api/rpc from the same SQL. Every failure says what to do next.
import type { Look } from './avatar';
import type { Answers } from './taste';

const BASE = ((import.meta.env.VITE_SEATED_API as string | undefined) || '/map-api/rpc').replace(/\/$/, '');
const KEY = (import.meta.env.VITE_SEATED_API_KEY as string | undefined) ?? '';

export interface Account {
  id: string;
  name: string;
  avatar: Partial<Look>;
  answers: Answers;
  profile: string | null;
  createdAt: string;
}

export interface SeatedList {
  id: string;
  title: string;
  note: string;
  places: string[];
  public: boolean;
  hidden: boolean;
  updatedAt: string;
  by: { name: string; avatar: Partial<Look>; profile: string | null } | null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    /** What the person can do about it. */
    readonly hint: string,
    /** True when the server answered: the request itself was refused, so trying again will not help. */
    readonly refused = false,
  ) {
    super(message);
  }
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/${fn}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(KEY ? { apikey: KEY } : {}) },
      body: JSON.stringify(args),
    });
  } catch {
    throw new ApiError('Seated could not reach its server.', 'Check your connection and try again. The map itself still works.');
  }
  const body = (await res.json().catch(() => null)) as { message?: string; hint?: string | null } | T | null;
  if (!res.ok) {
    const b = (body ?? {}) as { message?: string; hint?: string | null };
    if (res.status >= 500 || !b.message)
      throw new ApiError(`Seated's server answered ${res.status}.`, 'Try again in a minute. The map itself still works.');
    throw new ApiError(b.message, b.hint ?? 'Nothing to do.', true);
  }
  return body as T;
}

export const api = {
  createAccount: (name: string, avatar: Look, answers: Answers, profile: string | null) =>
    rpc<{ key: string; account: Account }>('create_account', { p_name: name, p_avatar: avatar, p_answers: answers, p_profile: profile }),
  me: (key: string) => rpc<{ account: Account; lists: SeatedList[] }>('get_me', { p_key: key }),
  update: (key: string, change: { name?: string; avatar?: Look; answers?: Answers; profile?: string }) =>
    rpc<Account>('update_me', { p_key: key, p_name: change.name ?? null, p_avatar: change.avatar ?? null, p_answers: change.answers ?? null, p_profile: change.profile ?? null }),
  deleteMe: (key: string) => rpc<boolean>('delete_me', { p_key: key }),
  saveList: (key: string, l: { id?: string | null; title: string; note?: string; places: string[]; public: boolean }) =>
    rpc<SeatedList>('save_list', { p_key: key, p_id: l.id ?? null, p_title: l.title, p_note: l.note ?? '', p_places: l.places, p_public: l.public }),
  deleteList: (key: string, id: string) => rpc<boolean>('delete_list', { p_key: key, p_id: id }),
  community: () => rpc<SeatedList[]>('community_lists', { p_limit: 40 }),
  list: (id: string) => rpc<SeatedList | null>('get_list', { p_id: id }),
  report: (id: string, key: string | null) => rpc<{ reports: number; hidden: boolean }>('report_list', { p_id: id, p_key: key }),
};
