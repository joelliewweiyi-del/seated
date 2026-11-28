import { describe, expect, it } from 'vitest';
import type { MapRestaurant } from '../src/map/data';
import { namesFor } from '../src/map/mylist';

// The field on "Your list" (Joel, 28 Nov 2026: "a field where they can add a restaurant to that list"): a typed name
// must find the place whatever its accents, and never offer what is already on the list.
const r = (id: string, name: string) => ({ id, name }) as MapRestaurant;
const all = [r('elan', 'Élan'), r('cafe-binnenvisser', 'Café Binnenvisser'), r('bar-centraal', 'Bar Centraal'), r('rijks', 'RIJKS®'), r('de-kas', 'De Kas'), r('kaagman-kortekaas', 'Kaagman & Kortekaas')];
const names = (q: string, on: string[] = [], n?: number) => namesFor(q, all, new Set(on), n).map((x) => x.name);

describe('the names the add field finds', () => {
  it('finds a name typed without its accents or capitals', () => {
    expect(names('elan')).toEqual(['Élan']);
    expect(names('CAFE')).toEqual(['Café Binnenvisser']);
    expect(names('  rijks ')).toEqual(['RIJKS®']);
  });

  it('puts a name that starts with the letters before one that only holds them', () => {
    expect(names('ka')).toEqual(['Kaagman & Kortekaas', 'De Kas']);
  });

  it('never offers a place that is on the list, and nothing for an empty field', () => {
    expect(names('ka', ['kaagman-kortekaas'])).toEqual(['De Kas']);
    expect(names('')).toEqual([]);
    expect(names('   ')).toEqual([]);
  });

  it('stops at the number asked for', () => {
    expect(names('a', [], 2)).toHaveLength(2);
  });
});
