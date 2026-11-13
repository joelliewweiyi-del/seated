// The list picker: see the map through a guide's picks, or tell us about a restaurant we miss. A small host, drawn
// here pixel by pixel, asks the question. No account: the lens lives in the link, a suggestion goes by email.
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import type { SeatedList } from './api';
import { Avatar, cleanLook, type Look } from './avatar';

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
  /** null is every restaurant; 'you' your picks; a guide id; 'l:<uuid>' a list. */
  id: string | null;
  name: string;
  by: string;
  line: string;
  picks: number;
  free: number;
  /** The maker's character, on community lists. */
  look?: Look | null;
  /** "Only you" or "In Community", on your own lists. */
  badge?: string;
}

interface PickerProps {
  lists: ListChoice[];
  /** Your picks, when you answered the two questions. */
  forYou: ListChoice | null;
  /** Your own lists; null when you have no character yet. */
  mine: Array<ListChoice & { list: SeatedList }> | null;
  /** Community lists; null while they load. */
  community: ListChoice[] | null;
  current: string | null;
  /** "Sat 15 Nov", the day the free counts are for. */
  dayText: string;
  /** Where suggestions go; empty hides the form. */
  contact: string;
  problem: ReactNode;
  busy: boolean;
  onPick: (id: string | null) => void;
  onCharacter: () => void;
  onSaveList: (l: { id?: string | null; title: string; note?: string; places: string[]; public: boolean }) => Promise<SeatedList | null>;
  onDeleteList: (id: string) => Promise<boolean>;
  onReport: (id: string) => Promise<boolean>;
  onClose: () => void;
}

function Choice({ l, current, onPick, extra }: { l: ListChoice; current: string | null; onPick: (id: string | null) => void; extra?: ReactNode }) {
  const unit = l.id === null ? (l.picks === 1 ? 'place' : 'places') : l.picks === 1 ? 'pick' : 'picks';
  return (
    <li>
      <button className="choice" aria-pressed={l.id === current} onClick={() => onPick(l.id)} title={l.line || undefined}>
        <span className="nm">{l.name}</span>
        <span className="by">
          {l.look !== undefined && <Avatar look={l.look ? cleanLook(l.look) : null} size={18} />}
          {l.by}
        </span>
        <span className="counts">
          <span className="stud" aria-hidden="true" />
          {l.free} free · {l.picks} {unit}
          {l.badge && <span className="tag">{l.badge}</span>}
        </span>
      </button>
      {extra}
    </li>
  );
}

/** Rename, share or delete one of your lists. Restaurants are added from their card. */
function ListEditor({ list, busy, onSave, onDelete, onDone }: { list: SeatedList | null; busy: boolean; onSave: PickerProps['onSaveList']; onDelete: PickerProps['onDeleteList']; onDone: (saved: SeatedList | null) => void }) {
  const [title, setTitle] = useState(list?.title ?? '');
  const [note, setNote] = useState(list?.note ?? '');
  const [pub, setPub] = useState(list?.public ?? false);
  const [sure, setSure] = useState(false);
  const [copied, setCopied] = useState('');
  const link = list ? `${location.origin}${location.pathname}?list=${list.id}` : '';
  return (
    <form
      className="list-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        const saved = await onSave({ id: list?.id ?? null, title, note, places: list?.places ?? [], public: pub });
        if (saved) onDone(saved);
      }}
    >
      <label htmlFor="list-title">List name</label>
      <input id="list-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} placeholder="Date nights in De Pijp" autoComplete="off" />
      <label htmlFor="list-note">A line about it (optional)</label>
      <input id="list-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Small rooms, good wine" autoComplete="off" />
      <label className="check">
        <input type="checkbox" checked={pub} onChange={(e) => setPub(e.target.checked)} /> Share it in Community (with your character's name)
      </label>
      {!list && <p className="meta">Then add restaurants from their card: “+ List”.</p>}
      <div className="result-actions">
        <button className="btn primary small" type="submit" disabled={!title.trim() || busy}>
          {list ? 'Save' : 'Make the list'}
        </button>
        <button type="button" className="link" onClick={() => onDone(null)}>
          Cancel
        </button>
        {list?.public && (
          <button
            type="button"
            className="link"
            onClick={() =>
              navigator.clipboard
                .writeText(link)
                .then(() => setCopied('Link copied'))
                .catch(() => setCopied(link))
            }
          >
            Copy its link
          </button>
        )}
        {list &&
          (sure ? (
            <span className="confirm">
              Delete “{list.title}”?{' '}
              <button type="button" className="btn small danger" onClick={async () => (await onDelete(list.id)) && onDone(null)}>
                Delete
              </button>
            </span>
          ) : (
            <button type="button" className="link" onClick={() => setSure(true)}>
              Delete
            </button>
          ))}
      </div>
      {copied && (
        <p className="meta" role="status">
          {copied}
        </p>
      )}
    </form>
  );
}

export function Picker(p: PickerProps) {
  const { lists, current, dayText, contact, onPick, onClose } = p;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const [name, setName] = useState('');
  const [where, setWhere] = useState('');
  const [sent, setSent] = useState(false);
  // Which list is open in the editor: 'new', a list id, or none.
  const [editing, setEditing] = useState<string | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const [reported, setReported] = useState<Set<string>>(new Set());
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
        {p.problem}

        <ul className="choices" aria-label="Lists">
          {p.forYou && <Choice l={p.forYou} current={current} onPick={onPick} />}
          {lists.map((l) => (
            <Choice key={l.id ?? 'all'} l={l} current={current} onPick={onPick} />
          ))}
        </ul>
        <p className="meta">Free means a table for two on {dayText}.</p>

        <section className="mine" aria-labelledby="mine-title">
          <h3 id="mine-title">Your lists</h3>
          {p.mine === null ? (
            <p>
              Make a character to keep your own lists and share them.{' '}
              <button className="link" onClick={p.onCharacter}>
                Make my character
              </button>
            </p>
          ) : (
            <>
              <ul className="choices" aria-label="Your lists">
                {p.mine.map((l) => (
                  <Choice
                    key={l.id}
                    l={l}
                    current={current}
                    onPick={onPick}
                    extra={
                      <button className="link edit" onClick={() => setEditing(editing === l.list.id ? null : l.list.id)} aria-label={`Edit ${l.name}`}>
                        Edit
                      </button>
                    }
                  />
                ))}
              </ul>
              {editing && editing !== 'new' && (
                <ListEditor key={editing} list={p.mine.find((l) => l.list.id === editing)?.list ?? null} busy={p.busy} onSave={p.onSaveList} onDelete={p.onDeleteList} onDone={() => setEditing(null)} />
              )}
              {editing === 'new' ? (
                <ListEditor key="new" list={null} busy={p.busy} onSave={p.onSaveList} onDelete={p.onDeleteList} onDone={() => setEditing(null)} />
              ) : (
                <button className="btn small" onClick={() => setEditing('new')}>
                  + New list
                </button>
              )}
            </>
          )}
        </section>

        <section className="community" aria-labelledby="community-title">
          <h3 id="community-title">Community</h3>
          {p.community === null ? (
            <p className="meta">Loading lists from other people…</p>
          ) : p.community.length === 0 ? (
            <p className="meta">No community lists yet. Make one and share it: it shows here once it holds three places.</p>
          ) : (
            <ul className="choices" aria-label="Community lists">
              {p.community.map((l) => (
                <Choice
                  key={l.id}
                  l={l}
                  current={current}
                  onPick={onPick}
                  extra={
                    reported.has(l.id!) ? (
                      <span className="meta report">Reported. Thanks.</span>
                    ) : reporting === l.id ? (
                      <span className="meta report">
                        Report this list as spam or abuse?{' '}
                        <button
                          className="link"
                          onClick={async () => {
                            if (await p.onReport(l.id!.slice(2))) setReported((r) => new Set(r).add(l.id!));
                            setReporting(null);
                          }}
                        >
                          Report
                        </button>{' '}
                        <button className="link" onClick={() => setReporting(null)}>
                          No
                        </button>
                      </span>
                    ) : (
                      <button className="link report" onClick={() => setReporting(l.id)} aria-label={`Report ${l.name}`}>
                        Report
                      </button>
                    )
                  }
                />
              ))}
            </ul>
          )}
        </section>

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

/** Once per device, a few seconds in, for someone who came by a link: the host offers the two questions. */
export function Nudge({ onOpen, onClose }: { onOpen: () => void; onClose: () => void }) {
  return (
    <div className="px nudge" role="status">
      <Host size={34} />
      <p>
        <b>Looking for somewhere good?</b> Two questions, and I'll find your tables.
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
