// The list picker: see the map through a guide's picks, or tell us about a restaurant we miss. A small host, drawn
// here pixel by pixel, asks the question. No account: the lens lives in the link, a suggestion goes by email.
import { useEffect, useRef, useState, type ReactElement } from 'react';

const C: Record<string, string> = {
  o: '#2b2733', // outline (dark violet, never black)
  h: '#4a3426', // hair
  s: '#f0c08a', // skin
  p: '#f2a0a0', // cheeks
  w: '#fffaf0', // shirt
  b: '#e0604c', // bow tie
  g: '#3fae5f', // the sign: a table is free
  y: '#fffaf0', // writing on the sign
  t: '#0f766e', // apron
  k: '#4a4554', // trousers
};

// 14 x 20. A round head on a simple body, holding a green "table free" sign. No face from any game.
const HOST = [
  '....oooooo....',
  '...ohhhhhho...',
  '..ohhhhhhhho..',
  '..osssssssso..',
  '..osossssoso..',
  '..opsssssspo..',
  '...osssssso...',
  '....oooooo....',
  '...owwbbwwo...',
  '..owwwbbwwwo..',
  '..owwwwwwwwo..',
  '.oggggggggggo.',
  '.ogyyygyyyggo.',
  '.oggggggggggo.',
  '.ogyygyyyyggo.',
  '.oggggggggggo.',
  '..otttttttto..',
  '..otttttttto..',
  '...okkookko...',
  '...ooo..ooo...',
];

/** The host as crisp SVG pixels. */
export function Host({ size = 56 }: { size?: number }) {
  const rects: ReactElement[] = [];
  HOST.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const fill = C[ch];
      if (fill) rects.push(<rect key={`${x}.${y}`} x={x} y={y} width="1" height="1" fill={fill} />);
    }),
  );
  return (
    <svg className="host" viewBox="0 0 14 20" width={size} height={(size * 20) / 14} shapeRendering="crispEdges" aria-hidden="true">
      {rects}
    </svg>
  );
}

export interface ListChoice {
  /** null is every restaurant. */
  id: string | null;
  name: string;
  by: string;
  line: string;
  picks: number;
  free: number;
}

interface PickerProps {
  lists: ListChoice[];
  current: string | null;
  /** "Sat 15 Nov", the day the free counts are for. */
  dayText: string;
  /** Where suggestions go; empty hides the form. */
  contact: string;
  onPick: (id: string | null) => void;
  onClose: () => void;
}

export function Picker({ lists, current, dayText, contact, onPick, onClose }: PickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const [name, setName] = useState('');
  const [where, setWhere] = useState('');
  const [sent, setSent] = useState(false);
  const clean = name.trim();
  const mail = clean
    ? `mailto:${contact}?subject=${encodeURIComponent(`Seated: please add ${clean}`)}&body=${encodeURIComponent(
        `Please add: ${clean}\n${where.trim() ? `Where: ${where.trim()}\n` : ''}\nSent from seated.food`,
      )}`
    : undefined;
  return (
    <div className="scrim" onClick={onClose}>
      <div ref={ref} tabIndex={-1} className="px dialog picker" role="dialog" aria-modal="true" aria-labelledby="pick-title" onClick={(e) => e.stopPropagation()}>
        <div className="hello">
          <Host />
          <div className="bubble">
            <h2 id="pick-title">Where shall we eat?</h2>
            <p>Pick a list and its restaurants light up on the map.</p>
          </div>
        </div>

        <ul className="choices" aria-label="Lists">
          {lists.map((l) => (
            <li key={l.id ?? 'all'}>
              <button className="choice" aria-pressed={l.id === current} onClick={() => onPick(l.id)} title={l.line || undefined}>
                <span className="nm">{l.name}</span>
                <span className="by">{l.by}</span>
                <span className="counts">
                  <span className="stud" aria-hidden="true" />
                  {l.free} free · {l.picks} {l.id ? (l.picks === 1 ? 'pick' : 'picks') : l.picks === 1 ? 'place' : 'places'}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="meta">Free means a table for two on {dayText}.</p>

        {contact && (
          <form className="missing" onSubmit={(e) => e.preventDefault()}>
            <h3>Missing a place?</h3>
            <p>Tell us which one. We add it when its booking calendar is public.</p>
            <label htmlFor="miss-name">Restaurant</label>
            <input id="miss-name" value={name} onChange={(e) => (setName(e.target.value), setSent(false))} placeholder="Name" autoComplete="off" maxLength={80} />
            <label htmlFor="miss-where">Area or website (if you know it)</label>
            <input id="miss-where" value={where} onChange={(e) => (setWhere(e.target.value), setSent(false))} placeholder="De Pijp, or their site" autoComplete="off" maxLength={120} />
            <a className="btn primary" href={mail} aria-disabled={!mail} onClick={() => mail && setSent(true)}>
              Send by email
            </a>
            {sent && (
              <p className="sent" role="status">
                Thanks! Your mail app opens with the message. Nothing opened? Write to <b>{contact}</b>.
              </p>
            )}
          </form>
        )}

        <div>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** Once per device, a few seconds in: the host points at the lists. */
export function Nudge({ onOpen, onClose }: { onOpen: () => void; onClose: () => void }) {
  return (
    <div className="px nudge" role="status">
      <Host size={34} />
      <p>
        <b>Looking for somewhere good?</b> Pick a list, or tell us who's missing.
      </p>
      <button className="btn small primary" onClick={onOpen}>
        Show me
      </button>
      <button className="x" onClick={onClose} aria-label="Not now">
        ×
      </button>
    </div>
  );
}
