// Taste: you pick a character, lists pull the taste, and the profile ranks restaurants. The cases encode what each
// character means, so a change to a weight that breaks the meaning fails here.
import { describe, expect, it } from 'vitest';
import { PROFILES, SCENES, fit, listsFor, profileFor, suggest, tasteOf } from '../src/map/taste';

const r = (id: string, kind: string, extra: { michelin?: '1' | '2' | '3' | 'bib' | null; hot?: number | null; g?: string[] } = {}) => ({
  id,
  name: id,
  kind,
  michelin: extra.michelin ?? null,
  hot: extra.hot ?? null,
  g: extra.g ?? [],
});
const as = (type: string) => tasteOf({ type });

describe('characters', () => {
  it('every scene holds two or more characters, and every character sits in a scene', () => {
    for (const sc of SCENES) expect(PROFILES.filter((p) => p.scene === sc.id).length).toBeGreaterThanOrEqual(2);
    for (const p of PROFILES) expect(SCENES.map((s) => s.id)).toContain(p.scene);
  });

  it('a taste made of only lists can land on every character', () => {
    for (const p of PROFILES) expect(profileFor(p.axis).id).toBe(p.id);
  });

  it("a person's lists pull a listless profile toward what is in them", () => {
    const starred = ['a', 'b', 'c', 'd', 'e'].map((id) => r(id, 'fine', { michelin: '2' }));
    expect(profileFor(tasteOf({}, starred)).id).toBe('tasting-chaser');
  });
});

describe('suggestions', () => {
  const rs = [r('star', 'fine', { michelin: '2' }), r('corner', 'bistro', { michelin: 'bib' }), r('buzz', 'bistro', { hot: 3, g: ['x', 'y'] }), r('wine', 'wine')];

  it('the tasting chaser and the Zuidas suit get the starred kitchen first; the regular gets the corner bistro first and the hot table last', () => {
    expect(suggest(as('tasting-chaser'), rs, () => false, 4)[0]!.id).toBe('star');
    expect(suggest(as('zuidas-suit'), rs, () => false, 4)[0]!.id).toBe('star');
    const local = suggest(as('local-regular'), rs, () => false, 4);
    expect(local[0]!.id).toBe('corner');
    expect(local.at(-1)!.id).toBe('buzz');
    expect(suggest(as('founder'), rs, () => false, 4)[0]!.id).toBe('buzz');
  });

  it('the Fashion Baddie gets the small wine bar first and the starred kitchen and the brasserie last', () => {
    const more = [...rs, r('brasserie', 'brasserie')];
    const order = suggest(as('fashion-baddie'), more, () => false, 5).map((x) => x.id);
    expect(order[0]).toBe('wine');
    expect(order.slice(-2).sort()).toEqual(['brasserie', 'star']);
    expect(fit(as('fashion-baddie'), rs[3]!)).toBeGreaterThan(fit(as('fashion-baddie'), rs[0]!));
  });

  it('a free table breaks a tie', () => {
    const twins = [r('a-closed', 'wine'), r('b-free', 'wine')];
    expect(suggest(as('fashion-baddie'), twins, (x) => x.id === 'b-free', 2).map((x) => x.id)).toEqual(['b-free', 'a-closed']);
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
