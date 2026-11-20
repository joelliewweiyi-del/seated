// Characters: a pixel bust drawn here, cell by cell (16 x 16), from five choices. Our own drawing: round head,
// dot eyes, no face or style from any game. Outlines are the map's dark violet, never black.
import type { ReactElement } from 'react';

export interface Look {
  skin: number;
  hair: number;
  hairColour: number;
  top: number;
  extra: number;
}

export const SKINS = ['#f6d5b5', '#f0c08a', '#d9a066', '#b97a4a', '#8d5a3b', '#5e3b26'];
export const HAIR_COLOURS = ['#2b2733', '#4a3426', '#8a5a2b', '#d8a945', '#c0504d', '#8c7bd8'];
export const TOPS = ['#0f766e', '#e0604c', '#ffcf4a', '#3fae5f', '#5b4a8a', '#f2a0a0', '#6cb4c4', '#4a4554'];
export const HAIRS = ['Short', 'Long', 'Bun', 'Curls', 'None'];
// New extras go at the end: a saved character keeps its number.
export const EXTRAS = [
  'Nothing', 'Cap', 'Beret', "Chef's hat", 'Sunglasses', 'Flower',
  "Skipper's cap", 'Orange crown', 'Bike helmet', 'Beanie', 'Bucket hat', 'Headphones', 'Herring', 'Moustache', 'Scarf',
];

export const PARTS: Array<{ key: keyof Look; label: string; count: number }> = [
  { key: 'skin', label: 'Skin', count: SKINS.length },
  { key: 'hair', label: 'Hair', count: HAIRS.length },
  { key: 'hairColour', label: 'Hair colour', count: HAIR_COLOURS.length },
  { key: 'top', label: 'Top', count: TOPS.length },
  { key: 'extra', label: 'Extra', count: EXTRAS.length },
];

const OUT = '#2b2733';

const BASE = [
  '................',
  '................',
  '.....oooooo.....',
  '....osssssso....',
  '...osssssssso...',
  '...osssssssso...',
  '...ossessesso...',
  '...osssssssso...',
  '...ocssssssco...',
  '....osssssso....',
  '.....oooooo.....',
  '......onno......',
  '..oottttttttoo..',
  '.otttttttttttto.',
  '.otttttttttttto.',
  '.otttttttttttto.',
];

type Grid = string[][];
const put = (g: Grid, x: number, y: number, c: string) => {
  if (y >= 0 && y < 16 && x >= 0 && x < 16) g[y]![x] = c;
};
const row = (g: Grid, y: number, s: string) => [...s].forEach((c, x) => c !== '.' && put(g, x, y, c));

function hair(g: Grid, style: number) {
  if (style === 4) return; // none
  if (style === 3) {
    // Curls: a wider crown.
    row(g, 1, '....oooooooo....');
    row(g, 2, '...ohhhhhhhho...');
    row(g, 3, '..ohhhhhhhhhho..');
    row(g, 4, '..ohhsssssshho..');
    row(g, 5, '..ohssssssssho..');
    return;
  }
  row(g, 2, '.....oooooo.....');
  row(g, 3, '....ohhhhhho....');
  row(g, 4, '...ohhhhhhhho...');
  row(g, 5, '...ohssssssho...');
  if (style === 1) {
    // Long: strands down both sides to the shoulders.
    for (let y = 5; y <= 11; y++) {
      put(g, 2, y, 'o');
      put(g, 3, y, 'h');
      put(g, 12, y, 'h');
      put(g, 13, y, 'o');
    }
  }
  if (style === 2) {
    row(g, 0, '.......oo.......');
    row(g, 1, '......ohho......');
  }
}

function extra(g: Grid, e: number) {
  if (e === 1) {
    row(g, 1, '.....oooooo.....');
    row(g, 2, '....oCCCCCCo....');
    row(g, 3, '...oCCCCCCCCCCo.');
    row(g, 4, '...oooooooooooo.');
  } else if (e === 2) {
    row(g, 0, '........o.......');
    row(g, 1, '.....oooooo.....');
    row(g, 2, '...oBBBBBBBBo...');
    row(g, 3, '..oBBBBBBBBBBo..');
    row(g, 4, '...oooooooooo...');
  } else if (e === 3) {
    row(g, 0, '....oooooooo....');
    row(g, 1, '...oWWWWWWWWo...');
    row(g, 2, '...oWWWWWWWWo...');
    row(g, 3, '....oWWWWWWo....');
    row(g, 4, '...oooooooooo...');
  } else if (e === 4) {
    row(g, 6, '...osggggggso...');
  } else if (e === 5) {
    put(g, 12, 2, 'f');
    put(g, 11, 3, 'f');
    put(g, 13, 3, 'f');
    put(g, 12, 4, 'f');
    put(g, 12, 3, 'y');
  } else if (e === 6) {
    // Skipper's cap: white crown, gold badge, dark peak.
    row(g, 1, '....oooooooo....');
    row(g, 2, '...oWWWWyWWWo...');
    row(g, 3, '...oWWWWWWWWo...');
    row(g, 4, '..oNNNNNNNNNNo..');
  } else if (e === 7) {
    // King's Day: an orange crown with a gold stone.
    row(g, 0, '..o....oo....o..');
    row(g, 1, '..oOo.oOOo.oOo..');
    row(g, 2, '..oOOoOOOOoOOo..');
    row(g, 3, '..oOOOOOyOOOOo..');
    row(g, 4, '..oooooooooooo..');
  } else if (e === 8) {
    // Bike helmet with vents.
    row(g, 1, '....oooooooo....');
    row(g, 2, '...oCCoCCoCCo...');
    row(g, 3, '..oCCCCCCCCCCo..');
    row(g, 4, '..oooooooooooo..');
  } else if (e === 9) {
    // Beanie: pompom, knit, a folded band in the top's colour.
    row(g, 0, '.......oo.......');
    row(g, 1, '.....ooWWoo.....');
    row(g, 2, '....oCCCCCCo....');
    row(g, 3, '...oCCCCCCCCo...');
    row(g, 4, '...otttttttto...');
  } else if (e === 10) {
    // Bucket hat with a wide brim.
    row(g, 1, '.....oooooo.....');
    row(g, 2, '....obbbbbbo....');
    row(g, 3, '....obbbbbbo....');
    row(g, 4, '.oobbbbbbbbbboo.');
    row(g, 5, '.oooooooooooooo.');
  } else if (e === 11) {
    // Headphones: a band over the head, a cup on each ear.
    row(g, 1, '.....oooooo.....');
    row(g, 2, '....oCCCCCCo....');
    row(g, 3, '...oCo....oCo...');
    for (const y of [4, 9]) row(g, y, '..oo........oo..');
    for (let y = 5; y <= 8; y++) row(g, y, '.oCC........CCo.');
  } else if (e === 12) {
    // A herring held up by the tail, mouth open below it.
    row(g, 1, '............o..o');
    row(g, 2, '............oSSo');
    row(g, 3, '.............oo.');
    for (let y = 4; y <= 7; y++) row(g, y, '............oSSo');
    row(g, 8, '............oeSo');
    row(g, 9, '.............oo.');
    row(g, 8, '.......oo.......');
  } else if (e === 13) {
    // A proper moustache.
    row(g, 7, '......oooo......');
    row(g, 8, '.....o....o.....');
  } else if (e === 14) {
    // A striped football scarf, one end hanging.
    row(g, 11, '....oRWRWRWRo...');
    for (let y = 12; y <= 14; y++) row(g, y, `.........o${y % 2 ? 'R' : 'W'}o....`);
  }
}

/** Ready-made characters: Amsterdam types, our own drawing and our own jokes (Joel, 20 Nov 2026: "Make them fun"). */
export const LOCALS: Array<{ name: string; line: string; look: Look }> = [
  { name: 'Bakfiets parent', line: 'Three kids, one cargo bike, no fear.', look: { skin: 1, hair: 1, hairColour: 3, top: 0, extra: 8 } },
  { name: 'Canal skipper', line: 'Owns a boat. Will invite you once.', look: { skin: 3, hair: 4, hairColour: 1, top: 7, extra: 6 } },
  { name: "King's Day", line: 'Orange from head to toe, one day a year.', look: { skin: 0, hair: 0, hairColour: 4, top: 1, extra: 7 } },
  { name: 'Herring eater', line: 'Holds it by the tail. Onions, please.', look: { skin: 2, hair: 0, hairColour: 0, top: 6, extra: 12 } },
  { name: 'Noord creative', line: 'Studio in a shipping container.', look: { skin: 4, hair: 3, hairColour: 0, top: 7, extra: 9 } },
  { name: 'Lost tourist', line: 'Standing in the bike lane. Loving it.', look: { skin: 0, hair: 0, hairColour: 3, top: 5, extra: 10 } },
  { name: 'Zuidas suit', line: 'Lunch is a meeting.', look: { skin: 1, hair: 0, hairColour: 1, top: 7, extra: 4 } },
  { name: 'Brown café regular', line: 'Same stool since 1987.', look: { skin: 2, hair: 4, hairColour: 0, top: 4, extra: 13 } },
  { name: 'Market seller', line: 'Three for five euro!', look: { skin: 3, hair: 0, hairColour: 0, top: 3, extra: 1 } },
  { name: 'Laptop nomad', line: 'One flat white, seven hours.', look: { skin: 5, hair: 2, hairColour: 0, top: 0, extra: 11 } },
  { name: 'Football fan', line: 'Sings on the tram. Every tram.', look: { skin: 1, hair: 0, hairColour: 2, top: 7, extra: 14 } },
  { name: 'Night chef', line: 'Dinner at one in the morning, standing up.', look: { skin: 4, hair: 0, hairColour: 0, top: 7, extra: 3 } },
  { name: 'Vondelpark picnic', line: 'Blanket out at the first ray of sun.', look: { skin: 0, hair: 1, hairColour: 5, top: 3, extra: 5 } },
];
const same = (a: Look, b: Look) => (Object.keys(a) as Array<keyof Look>).every((k) => a[k] === b[k]);
/** The ready-made character this look is, if any. */
export const localOf = (look: Look) => LOCALS.find((l) => same(l.look, look)) ?? null;

/** The cells of a character, top to bottom. */
export function cells(look: Look): Grid {
  const g: Grid = BASE.map((r) => [...r]);
  hair(g, look.hair);
  extra(g, look.extra);
  return g;
}

const mod = (n: number, k: number) => ((Math.round(n) % k) + k) % k;
/** Any stored look, made safe: unknown or out-of-range parts wrap around. */
export function cleanLook(l: Partial<Look> | null | undefined): Look {
  const v = (k: keyof Look, n: number) => mod(Number(l?.[k] ?? 0) || 0, n);
  return { skin: v('skin', SKINS.length), hair: v('hair', HAIRS.length), hairColour: v('hairColour', HAIR_COLOURS.length), top: v('top', TOPS.length), extra: v('extra', EXTRAS.length) };
}

export function randomLook(rand: () => number = Math.random): Look {
  const pick = (n: number) => Math.floor(rand() * n);
  return { skin: pick(SKINS.length), hair: pick(HAIRS.length - 1), hairColour: pick(HAIR_COLOURS.length), top: pick(TOPS.length), extra: 0 };
}

/** The coloured cells of a character, or of the grey silhouette when there is none yet. Shared by the badge and the map. */
export function pixels(look: Look | null): Array<[number, number, string]> {
  const out: Array<[number, number, string]> = [];
  if (!look) {
    BASE.forEach((r, y) => [...r].forEach((ch, x) => ch !== '.' && out.push([x, y, ch === 'o' ? '#6e6878' : '#b8b1a3'])));
    return out;
  }
  const l = cleanLook(look);
  const colour: Record<string, string> = {
    o: OUT,
    e: OUT,
    s: SKINS[l.skin]!,
    n: SKINS[l.skin]!,
    c: '#f2a0a0',
    t: TOPS[l.top]!,
    h: HAIR_COLOURS[l.hairColour]!,
    C: TOPS[(l.top + 1) % TOPS.length]!,
    B: '#5b4a8a',
    W: '#fffaf0',
    g: OUT,
    f: '#f2a0a0',
    y: '#ffcf4a',
    N: '#2f3d5c',
    O: '#f28c28',
    b: '#e8d5a3',
    S: '#b8c4cc',
    R: '#e0604c',
  };
  cells(l).forEach((r, y) => r.forEach((ch, x) => colour[ch] && out.push([x, y, colour[ch]!])));
  return out;
}

export function Avatar({ look, size = 40, title }: { look: Look | null; size?: number; title?: string }) {
  const rects: ReactElement[] = pixels(look).map(([x, y, fill]) => <rect key={`${x}.${y}`} x={x} y={y} width="1" height="1" fill={fill} />);
  return look ? (
    <svg className="avatar" viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" role="img" aria-label={title ?? 'Character'}>
      {rects}
    </svg>
  ) : (
    // No character yet: a grey silhouette of the same bust.
    <svg className="avatar no-character" viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" role="img" aria-label={title ?? 'No character yet'}>
      {rects}
    </svg>
  );
}
