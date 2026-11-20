import { describe, expect, it } from 'vitest';
import { cells, cleanLook, EXTRAS, LOCALS, localOf } from '../src/map/avatar';

describe('ready-made locals', () => {
  it('each is a look a character can save as is, and no two look the same', () => {
    for (const l of LOCALS) expect(cleanLook(l.look)).toEqual(l.look);
    const drawn = LOCALS.map((l) => cells(l.look).map((r) => r.join('')).join('/') + l.look.skin + l.look.top + l.look.hairColour);
    expect(new Set(drawn).size).toBe(LOCALS.length);
  });

  it('every extra draws something, and a saved number keeps its extra (new ones only at the end)', () => {
    const plain = cells({ skin: 0, hair: 0, hairColour: 0, top: 0, extra: 0 }).map((r) => r.join('')).join('/');
    for (let e = 1; e < EXTRAS.length; e++) expect(cells({ skin: 0, hair: 0, hairColour: 0, top: 0, extra: e }).map((r) => r.join('')).join('/')).not.toBe(plain);
    expect(EXTRAS.slice(0, 6)).toEqual(['Nothing', 'Cap', 'Beret', "Chef's hat", 'Sunglasses', 'Flower']);
  });

  it('knows a local from its look, and not a changed one', () => {
    const l = LOCALS[3]!;
    expect(localOf({ ...l.look })).toBe(l);
    expect(localOf({ ...l.look, top: (l.look.top + 1) % 8 })).toBeNull();
  });
});
