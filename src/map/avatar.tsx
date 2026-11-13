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
export const EXTRAS = ['Nothing', 'Cap', 'Beret', "Chef's hat", 'Sunglasses', 'Flower'];

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
  }
}

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

export function Avatar({ look, size = 40, title }: { look: Look | null; size?: number; title?: string }) {
  if (!look) {
    // No character yet: a grey silhouette of the same bust.
    const rects: ReactElement[] = [];
    BASE.forEach((r, y) =>
      [...r].forEach((ch, x) => {
        if (ch !== '.') rects.push(<rect key={`${x}.${y}`} x={x} y={y} width="1" height="1" fill={ch === 'o' ? '#6e6878' : '#b8b1a3'} />);
      }),
    );
    return (
      <svg className="avatar no-character" viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" role="img" aria-label={title ?? 'No character yet'}>
        {rects}
      </svg>
    );
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
  };
  const rects: ReactElement[] = [];
  cells(l).forEach((r, y) =>
    r.forEach((ch, x) => {
      const fill = colour[ch];
      if (fill) rects.push(<rect key={`${x}.${y}`} x={x} y={y} width="1" height="1" fill={fill} />);
    }),
  );
  return (
    <svg className="avatar" viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" role="img" aria-label={title ?? 'Character'}>
      {rects}
    </svg>
  );
}
