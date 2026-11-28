// Your list: the restaurants you want a table at (Joel, 28 Nov 2026: "make it very easy for the user to keep their own
// list ... a screen with a suggested list and then a field where they can add a restaurant to that list and then have
// that be an ongoing process"). It lives on this device, with no character or key needed: the same places the ♥ on a
// card marks. It starts as your character's picks; the field adds any restaurant on the map; a pick you take off stays
// on offer under "Suggested".
import { useEffect, useRef, useState } from 'react';
import { Avatar, type Look } from './avatar';
import { STATUS_COLOUR, type MapRestaurant, type Status } from './data';
import { KIND_WORD } from './marks';

interface MyListProps {
  look: Look | null;
  restaurants: MapRestaurant[];
  /** Your character's picks. */
  suggested: MapRestaurant[];
  /** The list, newest first. */
  ids: string[];
  /** A character was just chosen: an empty list starts as its picks. */
  seed: boolean;
  statusOf: (r: MapRestaurant) => Status;
  onIds: (ids: string[]) => void;
  /** Show the list on the map. */
  onShow: () => void;
}

/** Lower case without accents, so "elan" finds Élan and "cafe" finds Café. */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** The restaurants a typed name finds that are not on the list yet: names that start with it first. */
export function namesFor(q: string, restaurants: MapRestaurant[], on: Set<string>, n = 6): MapRestaurant[] {
  const w = fold(q.trim());
  if (!w) return [];
  return restaurants
    .filter((r) => !on.has(r.id) && fold(r.name).includes(w))
    .sort((a, b) => Number(fold(b.name).startsWith(w)) - Number(fold(a.name).startsWith(w)) || a.name.localeCompare(b.name))
    .slice(0, n);
}

export function MyList({ look, restaurants, suggested, ids, seed, statusOf, onIds, onShow }: MyListProps) {
  const [q, setQ] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const seeded = useRef(false);
  useEffect(() => {
    if (!seed || seeded.current || !suggested.length) return;
    seeded.current = true;
    if (!ids.length) onIds(suggested.map((r) => r.id));
  }, [seed, suggested, ids, onIds]);

  const on = new Set(ids);
  const byId = new Map(restaurants.map((r) => [r.id, r]));
  const mine = ids.map((id) => byId.get(id)).filter((r): r is MapRestaurant => !!r);
  const offers = suggested.filter((r) => !on.has(r.id));
  const found = namesFor(q, restaurants, on);
  const add = (id: string) => {
    onIds([id, ...ids.filter((x) => x !== id)]);
    setQ('');
    field.current?.focus();
  };
  const row = (r: MapRestaurant, action: 'add' | 'drop') => (
    <li key={r.id}>
      <span className="stud" style={{ background: STATUS_COLOUR[statusOf(r)] }} />
      <span className="who">
        <span className="nm">{r.name}</span>
        <span className="ar">
          {KIND_WORD[r.kind] ? `${KIND_WORD[r.kind]} · ` : ''}
          {r.area}
        </span>
      </span>
      {action === 'add' ? (
        <button type="button" className="btn small" aria-label={`Add ${r.name}`} onClick={() => add(r.id)}>
          + Add
        </button>
      ) : (
        <button type="button" className="btn small drop" aria-label={`Take ${r.name} off`} onClick={() => onIds(ids.filter((x) => x !== r.id))}>
          ✕
        </button>
      )}
    </li>
  );
  return (
    <div className="mylist">
      <h2 id="welcome-title" className="welcome-title">
        <Avatar look={look} size={40} /> Your list
      </h2>
      <form
        className="mylist-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (found[0]) add(found[0].id);
        }}
      >
        <input ref={field} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add a restaurant…" aria-label="Add a restaurant" autoComplete="off" enterKeyHint="done" />
        {q.trim() && (
          <ul className="mylist-rows found" aria-label="Restaurants with that name">
            {found.map((r) => row(r, 'add'))}
            {!found.length && <li className="none">No restaurant with that name on the map, or it is on your list.</li>}
          </ul>
        )}
      </form>
      {mine.length > 0 ? (
        <ul className="mylist-rows" aria-label="Your list">
          {mine.map((r) => row(r, 'drop'))}
        </ul>
      ) : (
        <p className="none">Nothing on it yet.</p>
      )}
      {offers.length > 0 && (
        <>
          <h3>Suggested</h3>
          <ul className="mylist-rows" aria-label="Suggested">
            {offers.map((r) => row(r, 'add'))}
          </ul>
        </>
      )}
      <div className="result-actions">
        <button className="btn primary" disabled={!mine.length} onClick={onShow}>
          Show my list on the map
        </button>
      </div>
    </div>
  );
}
