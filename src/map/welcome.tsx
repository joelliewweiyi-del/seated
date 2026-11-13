// The welcome: two questions, your profile and your tables; then, if you like, a character to keep them.
// Also "You" (your character, its key, sign out, delete). Every screen can be left: the map is always one tap away.
import { useEffect, useRef, useState } from 'react';
import { Avatar, cleanLook, EXTRAS, HAIR_COLOURS, HAIRS, PARTS, randomLook, SKINS, TOPS, type Look } from './avatar';
import { dayLabel, STATUS_COLOUR, STATUS_WORD, type MapRestaurant, type Status } from './data';
import { KIND_WORD } from './marks';
import { Host } from './picker';
import { QUESTIONS, suggest, type Answers } from './taste';
import type { Account } from './api';
import type { You } from './you';

export type WelcomeStep = 'q0' | 'q1' | 'result' | 'character' | 'key' | 'restore';

interface WelcomeProps {
  you: You;
  restaurants: MapRestaurant[];
  day: string;
  statusOf: (r: MapRestaurant) => Status;
  start: WelcomeStep;
  /** Show the map through a lens ('you', a guide or a list) and close. */
  onLens: (id: string) => void;
  onPick: (id: string) => void;
  onClose: () => void;
}

/** Your top tables: the restaurants that fit your taste best, a free table today breaking ties. */
export function picksFor(you: You, restaurants: MapRestaurant[], statusOf: (r: MapRestaurant) => Status, n = 12) {
  return suggest(you.taste, restaurants, (r) => statusOf(r) === 'open', n);
}

function useFocus<T extends HTMLElement>(dep: unknown) {
  const ref = useRef<T>(null);
  useEffect(() => ref.current?.focus(), [dep]);
  return ref;
}

export function Welcome({ you, restaurants, day, statusOf, start, onLens, onPick, onClose }: WelcomeProps) {
  const [step, setStep] = useState<WelcomeStep>(start);
  const [answers, setAnswers] = useState<Answers>(you.answers);
  const ref = useFocus<HTMLDivElement>(step);
  const close = () => {
    you.setWelcomed();
    onClose();
  };
  const choose = (q: 0 | 1, id: string) => {
    const next = { ...answers, [QUESTIONS[q]!.id]: id };
    setAnswers(next);
    if (q === 0) setStep('q1');
    else {
      you.answer(next);
      setStep('result');
    }
  };
  return (
    <div className="scrim welcome-scrim" onClick={close}>
      <div ref={ref} tabIndex={-1} className="px dialog welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title" onClick={(e) => e.stopPropagation()}>
        {(step === 'q0' || step === 'q1') && (
          <Question
            n={step === 'q0' ? 0 : 1}
            picked={answers[QUESTIONS[step === 'q0' ? 0 : 1]!.id]}
            onChoose={(id) => choose(step === 'q0' ? 0 : 1, id)}
            onBack={step === 'q1' ? () => setStep('q0') : null}
            onRestore={() => setStep('restore')}
            hasKey={!!you.account}
          />
        )}
        {step === 'result' && <Result you={you} restaurants={restaurants} day={day} statusOf={statusOf} onLens={onLens} onPick={onPick} onCharacter={() => setStep('character')} />}
        {step === 'character' && <Character you={you} onDone={(made) => (made ? setStep('key') : close())} />}
        {step === 'key' && <KeyShown you={you} onDone={close} />}
        {step === 'restore' && (
          <Restore
            you={you}
            onDone={(a) => {
              if (a.answers?.night && a.answers?.win) {
                setAnswers(a.answers);
                setStep('result');
              } else setStep('q0');
            }}
            onBack={() => setStep('q0')}
          />
        )}
        {step !== 'key' && (
        <div className="welcome-foot">
          <button className="link" onClick={close}>
            {step === 'q0' || step === 'q1' ? 'Skip, show me the map' : 'Close'}
          </button>
        </div>
        )}
      </div>
    </div>
  );
}

function Question({ n, picked, onChoose, onBack, onRestore, hasKey }: { n: 0 | 1; picked?: string; onChoose: (id: string) => void; onBack: (() => void) | null; onRestore: () => void; hasKey: boolean }) {
  const q = QUESTIONS[n]!;
  return (
    <>
      <div className="hello">
        <Host />
        <div className="bubble">
          <p className="step-count">{n + 1} of 2</p>
          <h2 id="welcome-title">{q.ask}</h2>
          {n === 0 && <p>Two questions, and I'll find your tables.</p>}
        </div>
      </div>
      <ul className="answers" aria-label={q.ask}>
        {q.choices.map((c) => (
          <li key={c.id}>
            <button className="choice answer" aria-pressed={picked === c.id} onClick={() => onChoose(c.id)}>
              <span className="nm">{c.label}</span>
              <span className="by">{c.sub}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="welcome-links">
        {onBack && (
          <button className="link" onClick={onBack}>
            ‹ Back
          </button>
        )}
        {!hasKey && n === 0 && (
          <button className="link" onClick={onRestore}>
            Have an account? Use your key
          </button>
        )}
      </p>
    </>
  );
}

function Result({ you, restaurants, day, statusOf, onLens, onPick, onCharacter }: Omit<WelcomeProps, 'start' | 'onClose'> & { onCharacter: () => void }) {
  const p = you.profile;
  // Of your twelve best fits, the ones with a table come first: a list of full rooms is no answer.
  const top = picksFor(you, restaurants, statusOf, 12)
    .map((r, i) => ({ r, i, free: statusOf(r) === 'open' }))
    .sort((a, b) => Number(b.free) - Number(a.free) || a.i - b.i)
    .slice(0, 5)
    .map((x) => x.r);
  if (!p) return null;
  return (
    <>
      <div className="hello result-head">
        <Avatar look={you.account ? cleanLook(you.account.avatar) : { ...randomLook(() => 0.3), ...p.look }} size={64} />
        <div className="bubble">
          <p className="step-count">You're a</p>
          <h2 id="welcome-title">{p.name}</h2>
          <p>{p.line}</p>
        </div>
      </div>
      <h3>Your tables for {dayLabel(day)}</h3>
      <ul className="picks">
        {top.map((r) => {
          const s = statusOf(r);
          return (
            <li key={r.id}>
              <button className="pick-row" onClick={() => onPick(r.id)}>
                <span className="stud" style={{ background: STATUS_COLOUR[s] }} aria-hidden="true" />
                <span className="nm">{r.name}</span>
                <span className="by">
                  {KIND_WORD[r.kind] ?? 'Restaurant'} · {r.area}
                </span>
                <span className="badge" style={{ background: STATUS_COLOUR[s] }}>
                  {STATUS_WORD[s]}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="result-actions">
        <button className="btn primary" onClick={() => onLens('you')}>
          Show my picks on the map
        </button>
        {!you.account && (
          <button className="btn" onClick={onCharacter}>
            Make my character
          </button>
        )}
      </div>
      {!you.account && <p className="meta">A character keeps your picks and lists on any device. No email, no password.</p>}
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
          ‹ Back to the questions
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
            <p>{you.profile ? `${you.profile.name}. ${you.profile.line}` : 'Answer two questions and the map finds your tables.'}</p>
          </div>
        </div>
        {you.problem && <Trouble you={you} />}
        <div className="you-actions">
          {you.profile && (
            <button className="btn primary" onClick={() => onLens('you')}>
              Show my picks
            </button>
          )}
          <button className="btn" onClick={() => onWelcome('q0')}>
            {you.answered ? 'Retake the two questions' : 'Answer two questions'}
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
