// Small marks and helpers the list, the card and the signs share: MICHELIN distinctions, "hard to get", favourites,
// walking distance, and settings this device remembers.
import { useEffect, useState } from 'react';
import type { MapRestaurant } from './data';

/** What a room kind is called in words. */
export const KIND_WORD: Record<string, string> = {
  bistro: 'Bistro',
  wine: 'Wine bar',
  japanese: 'Japanese',
  fine: 'Fine dining',
  cafe: 'Café',
  pizza: 'Italian',
  greenhouse: 'Greenhouse',
  island: 'Island',
  brasserie: 'Brasserie',
};

/** ★ means MICHELIN stars and nothing else; "hard to get" has its own flame. No MICHELIN logos. */
export function michelinText(r: Pick<MapRestaurant, 'michelin'>): string | null {
  if (!r.michelin) return null;
  return r.michelin === 'bib' ? 'Bib' : '★'.repeat(Number(r.michelin));
}

export function michelinWords(r: Pick<MapRestaurant, 'michelin'>): string | null {
  if (!r.michelin) return null;
  return r.michelin === 'bib' ? 'Bib Gourmand' : `${r.michelin} MICHELIN Star${r.michelin === '1' ? '' : 's'}`;
}

function Flame() {
  return (
    <svg className="mk-flame" viewBox="0 0 5 7" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="2" y="0" width="1" height="1" fill="#f26b1d" />
      <rect x="1" y="1" width="3" height="2" fill="#f26b1d" />
      <rect x="0" y="3" width="5" height="3" fill="#f26b1d" />
      <rect x="1" y="6" width="3" height="1" fill="#f26b1d" />
      <rect x="2" y="3" width="1" height="3" fill="#ffcf4a" />
    </svg>
  );
}

/** The marks after a name: MICHELIN, hard to get. `words` spells them out (the card). */
export function Marks({ r, words = false }: { r: MapRestaurant; words?: boolean }) {
  const m = michelinText(r);
  const label = [michelinWords(r), r.hot ? 'hard to get' : null].filter(Boolean).join(', ');
  if (!m && !r.hot) return null;
  return (
    <span className="marks" title={label} aria-label={label} role="img">
      {m && <span className={`mk-michelin${r.michelin === 'bib' ? ' bib' : ''}`}>{m}</span>}
      {r.hot ? <Flame /> : null}
      {words && <span className="mk-words">{label}</span>}
    </span>
  );
}

/** Metres between two points (haversine). */
export function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** Walking time: streets add about a third to the straight line, and people walk about 5 km/h. */
export function walk(m: number): string {
  const min = Math.max(1, Math.round((m * 1.3) / (5000 / 60)));
  return min < 60 ? `${min} min walk` : `${(m / 1000).toFixed(1)} km`;
}

/** A setting this device remembers. Storage can be blocked or empty; then it is just not remembered. */
export function useRemembered<T>(key: string, initial: T): [T, (v: T | ((old: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? ({ ...initial, ...JSON.parse(raw) } as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* not remembered */
    }
  }, [key, value]);
  return [value, setValue];
}
