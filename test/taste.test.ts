// Taste: two answers pick a profile, lists pull it, and the profile ranks restaurants. The cases encode what each
// answer means, so a change to a weight that breaks the meaning fails here.
import { describe, expect, it } from 'vitest';
import { PROFILES, QUESTIONS, fit, listsFor, profileFor, suggest, tasteOf, type Answers } from '../src/map/taste';

const r = (id: string, kind: string, extra: { michelin?: '1' | '2' | '3' | 'bib' | null; hot?: number | null; g?: string[] } = {}) => ({
  id,
  name: id,
  kind,
  michelin: extra.michelin ?? null,
  hot: extra.hot ?? null,
  g: extra.g ?? [],
});
const of = (night: string, win: string) => profileFor(tasteOf({ night, win } as Answers)).id;

describe('profiles from two answers', () => {
  it('each answer pair lands where its words point', () => {
    expect(of('special', 'chef')).toBe('tasting-chaser');
    expect(of('date', 'wine')).toBe('wine-wanderer');
    expect(of('date', 'buzz')).toBe('hot-hunter');
    expect(of('date', 'chef')).toBe('date-planner');
    expect(of('easy', 'local')).toBe('local-regular');
    expect(of('friends', 'buzz')).toBe('table-host');
  });

  it('every profile is reachable from some pair of answers', () => {
    const reached = new Set<string>();
    for (const a of QUESTIONS[0]!.choices) for (const b of QUESTIONS[1]!.choices) reached.add(of(a.id, b.id));
    expect([...reached].sort()).toEqual(PROFILES.map((p) => p.id).sort());
  });

  it("a person's lists pull the profile toward what is in them", () => {
    const starred = ['a', 'b', 'c', 'd', 'e'].map((id) => r(id, 'fine', { michelin: '2' }));
    expect(profileFor(tasteOf({ night: 'easy', win: 'local' })).id).toBe('local-regular');
    expect(profileFor(tasteOf({ night: 'easy', win: 'local' }, starred)).id).toBe('tasting-chaser');
    // One restaurant is not enough to overturn both answers.
    expect(profileFor(tasteOf({ night: 'easy', win: 'local' }, starred.slice(0, 1))).id).toBe('local-regular');
  });
});

describe('suggestions', () => {
  const rs = [r('star', 'fine', { michelin: '2' }), r('corner', 'bistro', { michelin: 'bib' }), r('buzz', 'bistro', { hot: 3, g: ['x', 'y'] }), r('wine', 'wine')];

  it("the chef's menu puts the starred kitchen first; no hype puts the hot table last", () => {
    expect(suggest(tasteOf({ night: 'special', win: 'chef' }), rs, () => false, 4)[0]!.id).toBe('star');
    const local = suggest(tasteOf({ night: 'easy', win: 'local' }), rs, () => false, 4);
    expect(local[0]!.id).toBe('corner');
    expect(local.at(-1)!.id).toBe('buzz');
    expect(fit(tasteOf({ night: 'date', win: 'wine' }), rs[3]!)).toBeGreaterThan(fit(tasteOf({ night: 'date', win: 'wine' }), rs[0]!));
  });

  it('a free table breaks a tie', () => {
    const twins = [r('a-closed', 'wine'), r('b-free', 'wine')];
    expect(suggest(tasteOf({ win: 'wine' }), twins, (x) => x.id === 'b-free', 2).map((x) => x.id)).toEqual(['b-free', 'a-closed']);
  });

  it('suggested lists share at least two of the top fits, most shared first', () => {
    const lists = [
      { id: 'one', places: ['a', 'z'] },
      { id: 'two', places: ['a', 'b', 'c'] },
      { id: 'three', places: ['a', 'b'] },
    ];
    expect(listsFor(['a', 'b', 'c'], lists).map((l) => l.id)).toEqual(['two', 'three']);
  });
});
