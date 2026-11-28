// The welcome: choose your character (a scene, then a character in it), then your list: its places to start with,
// and a field to add your own (mylist.tsx). The map shows the list.
// A character with a name and a key keeps your lists; that is made later, from You or a list.
// Also "You" (your character, its key, sign out, delete). Every screen can be left: the map is always one tap away.
import { useEffect, useRef, useState } from 'react';
import { Avatar, cleanLook, EXTRAS, HAIR_COLOURS, HAIRS, LOCALS, localOf, PARTS, randomLook, SKINS, TOPS, type Look } from './avatar';
import { CURATED, type MapRestaurant, type Status } from './data';
import { Host } from './picker';
import { MyList } from './mylist';
import { PROFILES, SCENES, suggest } from './taste';
import type { Account } from './api';
import type { You } from './you';

export type WelcomeStep = 'scene' | `scene:${string}` | 'list' | 'character' | 'key' | 'restore';

/** Your list (mylist.tsx): the restaurants on the map, your character's picks, and the list kept on this device. */
export interface ListOnDevice {
  restaurants: MapRestaurant[];
  picks: MapRestaurant[];
  ids: string[];
  statusOf: (r: MapRestaurant) => Status;
  onIds: (ids: string[]) => void;
}

interface WelcomeProps {
  you: You;
  start: WelcomeStep;
  list: ListOnDevice;
  /** Show the map through a lens ('you', 'mine', a guide or a list) and close. */
  onLens: (id: string) => void;
  onClose: () => void;
}

/** Your top tables: the restaurants that fit your taste best, a free table today breaking ties. */
/** Picks come from the curated list only (Joel, 15 Nov 2026: no tourist traps among the suggestions). */
/** A character with a hand-picked list gets that list, in its order, from every restaurant on the map. */
export function picksFor(you: You, restaurants: MapRestaurant[], statusOf: (r: MapRestaurant) => Status, n = 12) {
  const hand = you.profile?.picks;
  if (hand) return hand.map((id) => restaurants.find((r) => r.id === id)).filter((r): r is MapRestaurant => !!r).slice(0, n);
  const curated = restaurants.filter((r) => r.g.includes(CURATED));
  return suggest(you.taste, curated.length ? curated : restaurants, (r) => statusOf(r) === 'open', n);
}

function useFocus<T extends HTMLElement>(dep: unknown) {
  const ref = useRef<T>(null);
  useEffect(() => ref.current?.focus(), [dep]);
  return ref;
}

export function Welcome({ you, start, list, onLens, onClose }: WelcomeProps) {
  const [step, setStep] = useState<WelcomeStep>(start);
  // A character chosen here starts an empty list with its picks.
  const [seed, setSeed] = useState(false);
  const ref = useFocus<HTMLDivElement>(step);
  const close = () => {
    you.setWelcomed();
    onClose();
  };
  const scene = step.startsWith('scene:') ? step.slice(6) : null;
  return (
    <div className="scrim welcome-scrim" onClick={close}>
      <div ref={ref} tabIndex={-1} className="px dialog welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title" onClick={(e) => e.stopPropagation()}>
        {step === 'scene' && <Scenes onScene={(id) => setStep(`scene:${id}`)} onRestore={() => setStep('restore')} hasKey={!!you.account} />}
        {scene && (
          <Characters
            scene={scene}
            picked={you.answers.type}
            onPick={(id) => {
              you.answer({ type: id });
              setSeed(true);
              setStep('list');
            }}
            onBack={() => setStep('scene')}
          />
        )}
        {step === 'list' && (
          <MyList
            look={you.account ? cleanLook(you.account.avatar) : (you.profile?.look ?? null)}
            restaurants={list.restaurants}
            suggested={list.picks}
            ids={list.ids}
            seed={seed}
            statusOf={list.statusOf}
            onIds={list.onIds}
            onShow={() => onLens('mine')}
          />
        )}
        {step === 'character' && <Character you={you} onDone={(made) => (made ? setStep('key') : close())} />}
        {step === 'key' && <KeyShown you={you} onDone={close} />}
        {step === 'restore' && <Restore you={you} onDone={(a) => (a.answers?.type ? onLens('you') : setStep('scene'))} onBack={() => setStep('scene')} />}
        {step !== 'key' && (
          <div className="welcome-foot">
            <button className="link" onClick={close}>
              {step === 'scene' || scene ? 'Skip, show me the map' : 'Close'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Step one: your scene. Each tile shows the characters in it. */
function Scenes({ onScene, onRestore, hasKey }: { onScene: (id: string) => void; onRestore: () => void; hasKey: boolean }) {
  return (
    <>
      <h2 id="welcome-title" className="welcome-title">Choose your character</h2>
      <ul className="scenes">
        {SCENES.map((sc) => (
          <li key={sc.id}>
            <button className="choice scene" onClick={() => onScene(sc.id)}>
              <span className="faces" aria-hidden="true">
                {PROFILES.filter((p) => p.scene === sc.id).map((p) => (
                  <Avatar key={p.id} look={p.look} size={40} />
                ))}
              </span>
              <span className="nm">{sc.name}</span>
            </button>
          </li>
        ))}
      </ul>
      {!hasKey && (
        <p className="welcome-links">
          <button className="link" onClick={onRestore}>
            Have an account? Use your key
          </button>
        </p>
      )}
    </>
  );
}

/** Step two: a character in that scene. Picking one shows its places on the map. */
function Characters({ scene, picked, onPick, onBack }: { scene: string; picked?: string; onPick: (id: string) => void; onBack: () => void }) {
  const sc = SCENES.find((x) => x.id === scene);
  return (
    <>
      <p className="welcome-links">
        <button className="link" onClick={onBack}>
          ‹ {sc?.name ?? 'Back'}
        </button>
      </p>
      <h2 id="welcome-title" className="welcome-title">Who are you?</h2>
      <ul className="characters">
        {PROFILES.filter((p) => p.scene === scene).map((p) => (
          <li key={p.id}>
            <button className="choice archetype" aria-pressed={picked === p.id} onClick={() => onPick(p.id)}>
              <Avatar look={p.look} size={72} />
              <span className="nm">{p.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

const PART_NAMES: Record<keyof Look, string[]> = {
  skin: SKINS.map((_, i) => `Tone ${i + 1}`),
  hair: HAIRS,
  hairColour: ['Ink', 'Brown', 'Chestnut', 'Blond', 'Red', 'Lilac'].slice(0, HAIR_COLOURS.length),
  top: ['Teal', 'Tomato', 'Mustard', 'Green', 'Violet', 'Pink', 'Sky', 'Slate'].slice(0, TOPS.length),
  extra: EXTRAS,
};

/** Make a character, or change the one you have. */
export function Character({ you, onDone }: { you: You; onDone: (made: boolean) => void }) {
  const editing = !!you.account;
  const [look, setLook] = useState<Look>(() => (you.account ? cleanLook(you.account.avatar) : { ...randomLook(), ...(you.profile?.look ?? {}) }));
  const [name, setName] = useState(you.account?.name ?? '');
  const ok = name.trim().length >= 2;
  const local = localOf(look);
  const step = (k: keyof Look, by: number, count: number) => setLook((l) => ({ ...l, [k]: (l[k] + by + count) % count }));
  const submit = async () => {
    if (!ok || you.busy) return;
    if (editing) {
      if (await you.change({ name: name.trim(), avatar: look })) onDone(false);
    } else if (await you.create(name.trim(), look)) onDone(true);
  };
  return (
    <form
      className="character"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h2 id="welcome-title">{editing ? 'Your character' : 'Make your character'}</h2>
      <div className="label locals-label">Be a local</div>
      <div className="locals" role="group" aria-label="Be a local">
        {LOCALS.map((l) => (
          <button type="button" key={l.name} className="local" aria-pressed={local === l} onClick={() => setLook({ ...l.look })}>
            <Avatar look={l.look} size={44} title={l.name} />
            <span>{l.name}</span>
          </button>
        ))}
      </div>
      <p className="local-line">{local ? <><b>{local.name}.</b> {local.line}</> : 'Or make your own below.'}</p>
      <div className="builder">
        <div className="stage">
          <Avatar look={look} size={112} title="Your character" />
          <button type="button" className="btn small" onClick={() => setLook((l) => ({ ...randomLook(), extra: l.extra }))}>
            Shuffle
          </button>
        </div>
        <div className="parts">
          {PARTS.map((p) => (
            <div className="part" key={p.key}>
              <button type="button" className="step" aria-label={`Previous ${p.label.toLowerCase()}`} onClick={() => step(p.key, -1, p.count)}>
                ‹
              </button>
              <span>
                <b>{p.label}</b> {PART_NAMES[p.key][look[p.key]]}
              </span>
              <button type="button" className="step" aria-label={`Next ${p.label.toLowerCase()}`} onClick={() => step(p.key, 1, p.count)}>
                ›
              </button>
            </div>
          ))}
        </div>
      </div>
      <label htmlFor="char-name">Name on your lists</label>
      <input id="char-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={24} placeholder="2 to 24 letters" autoComplete="nickname" />
      {you.problem && <Trouble you={you} />}
      <div className="result-actions">
        <button className="btn primary" type="submit" disabled={!ok || you.busy}>
          {you.busy ? 'Saving…' : editing ? 'Save' : 'Save my character'}
        </button>
      </div>
    </form>
  );
}

function KeyShown({ you, onDone }: { you: You; onDone: () => void }) {
  return (
    <>
      <div className="hello">
        <Avatar look={you.account ? cleanLook(you.account.avatar) : null} size={64} />
        <div className="bubble">
          <h2 id="welcome-title">Welcome, {you.account?.name}</h2>
          <p>This key is your account. There is no email and no password.</p>
        </div>
      </div>
      <KeyBox value={you.key ?? ''} />
      <p className="meta">Keep it somewhere safe, like your notes or password manager. It opens your character and lists on another device. Lose it and nobody, not even us, can open them again.</p>
      <div className="result-actions">
        <button className="btn primary" onClick={onDone}>
          Done
        </button>
      </div>
    </>
  );
}

export function KeyBox({ value }: { value: string }) {
  const [copied, setCopied] = useState('');
  return (
    <div className="keybox">
      <code aria-label="Your Seated key">{value}</code>
      <button
        className="btn small"
        onClick={() =>
          navigator.clipboard
            .writeText(value)
            .then(() => setCopied('Copied'))
            .catch(() => setCopied('Select the key and copy it'))
        }
      >
        Copy
      </button>
      {copied && (
        <span className="meta" role="status">
          {copied}
        </span>
      )}
    </div>
  );
}

function Restore({ you, onDone, onBack }: { you: You; onDone: (a: Account) => void; onBack: () => void }) {
  const [key, setKey] = useState('');
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const a = await you.restore(key);
        if (a) onDone(a);
      }}
    >
      <h2 id="welcome-title">Open your character</h2>
      <p>Type the key you got when you made it. Dashes and capitals don't matter.</p>
      <label htmlFor="restore-key">Your Seated key</label>
      <input id="restore-key" className="key-input" value={key} onChange={(e) => setKey(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX" autoComplete="off" autoCapitalize="characters" spellCheck={false} />
      {you.problem && <Trouble you={you} />}
      <div className="result-actions">
        <button className="btn primary" type="submit" disabled={key.replace(/[^0-9a-z]/gi, '').length < 16 || you.busy}>
          {you.busy ? 'Opening…' : 'Open my character'}
        </button>
        <button type="button" className="link" onClick={onBack}>
          ‹ Back
        </button>
      </div>
    </form>
  );
}

export function Trouble({ you }: { you: You }) {
  if (!you.problem) return null;
  return (
    <p className="trouble" role="alert">
      <b>{you.problem.message}</b> {you.problem.hint}
    </p>
  );
}

/** "You": your character and what you can do with it. */
export function YouPanel({ you, onWelcome, onLens, onClose }: { you: You; onWelcome: (s: WelcomeStep) => void; onLens: (id: string) => void; onClose: () => void }) {
  const ref = useFocus<HTMLDivElement>(null);
  const [showKey, setShowKey] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const a = you.account;
  return (
    <div className="scrim" onClick={onClose}>
      <div ref={ref} tabIndex={-1} className="px dialog you" role="dialog" aria-modal="true" aria-labelledby="you-title" onClick={(e) => e.stopPropagation()}>
        <div className="hello">
          <Avatar look={a ? cleanLook(a.avatar) : null} size={64} />
          <div className="bubble">
            <h2 id="you-title">{a ? a.name : 'You'}</h2>
            <p>{you.profile ? you.profile.name : 'Choose your character and the map finds your tables.'}</p>
          </div>
        </div>
        {you.problem && <Trouble you={you} />}
        <div className="you-actions">
          <button className="btn primary" onClick={() => onWelcome('list')}>
            My list
          </button>
          {you.profile && (
            <button className="btn" onClick={() => onLens('you')}>
              Show my picks
            </button>
          )}
          <button className="btn" onClick={() => onWelcome('scene')}>
            {you.answered ? 'Choose another character' : 'Choose your character'}
          </button>
          {a ? (
            <button className="btn" onClick={() => onWelcome('character')}>
              Change my character
            </button>
          ) : (
            <>
              <button className="btn" onClick={() => onWelcome('character')}>
                Make my character
              </button>
              <button className="link" onClick={() => onWelcome('restore')}>
                Have an account? Use your key
              </button>
            </>
          )}
        </div>
        {a && (
          <>
            <h3>Your key</h3>
            {showKey ? (
              <KeyBox value={you.key ?? ''} />
            ) : (
              <button className="link" onClick={() => setShowKey(true)}>
                Show my key
              </button>
            )}
            <p className="meta">The key opens this character on any device. Keep it to yourself.</p>
            <div className="you-actions">
              <button
                className="link"
                onClick={() => {
                  you.signOut();
                  onClose();
                }}
              >
                Sign out on this device
              </button>
              {confirm ? (
                <span className="confirm">
                  Delete {a.name} and all of its lists? This cannot be undone.{' '}
                  <button className="btn small danger" onClick={async () => (await you.deleteMe()) && onClose()}>
                    Delete for good
                  </button>{' '}
                  <button className="link" onClick={() => setConfirm(false)}>
                    Keep it
                  </button>
                </span>
              ) : (
                <button className="link" onClick={() => setConfirm(true)}>
                  Delete my character
                </button>
              )}
            </div>
          </>
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
