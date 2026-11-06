// Read-only style measurements. Fixed rectangular samples; no reference shapes enter the painter.
import { readFileSync } from 'node:fs';
import { tileReader } from './noord-alignment';

export const STYLE_REGIONS = [
  { name: 'Westerdok', x: 6640, y: 1390, w: 450, h: 350 },
  { name: 'Oostelijke eilanden', x: 7168, y: 3340, w: 200, h: 480 },
  // The installed art stops before most Eastern Docklands: its western quay/newbuild is the available sample.
  { name: 'Eastern Docklands western quay', x: 7168, y: 2690, w: 190, h: 300 },
  { name: 'Westerpark', x: 5470, y: 792, w: 330, h: 150 },
];
export const OUR_REGIONS = [
  { name: 'Bacalar industry', x: 8520, y: 1610, w: 450, h: 350 },
  { name: 'Noord postwar', x: 8920, y: 1980, w: 200, h: 480 },
  { name: 'Overhoeks newbuild', x: 7840, y: 1920, w: 190, h: 300 },
  { name: 'Noord park', x: 8690, y: 2240, w: 330, h: 150 },
];
const colours = (list: string) => new Set(list.split(' '));
const sets = {
  ground: colours('#a79886 #aba395 #b9a489 #b9a995 #c3ac94 #c4a78a #c7b399 #c8b8a4 #d3b69b #d8c5aa #d9c9b4 #dfcdae #e7d4b8 #efe4d1'),
  vegetation: colours('#2c601d #398526 #599533 #70a14e #75c537 #78c453 #86b23b #8cc43b #96c658 #b6c895'),
  water: colours('#2c8ba1 #30778b #32a3c3 #33c3dd #388ba2 #3a869a #41869a #4e92a4 #69b1c5 #73c5d6'),
  roofs: colours('#363639 #393b43 #433d45 #464548 #474953 #585657 #686665 #797368 #857d82 #8b8984 #938c85 #989388'),
  outlines: colours('#181818 #251d19 #262628 #2a2c33 #352a27 #453a36 #48433a #544b45 #585349 #2b2733 #1d1a24'),
  windows: colours('#1c3847 #2d4f5a #393b43 #474953 #597a88 #a1bac6 #b1c8cf #2b2733'),
};
export function measureStyle(base: string, regions = OUR_REGIONS) {
  const at = tileReader(base);
  const hist = Object.fromEntries(Object.keys(sets).map(k => [k, new Map<string, number>()]));
  const transitions: Record<string, number> = {}, pairs: Record<string, number> = {};
  for (const r of regions) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
    const p = at(x, y), q = at(x + 1, y);
    if (!p.alpha) continue;
    for (const [kind, set] of Object.entries(sets)) if (set.has(p.colour)) {
      const h = hist[kind]!; h.set(p.colour, (h.get(p.colour) ?? 0) + 1);
      if (q.alpha && set.has(q.colour)) { pairs[kind] = (pairs[kind] ?? 0) + 1; transitions[kind] = (transitions[kind] ?? 0) + +(p.colour !== q.colour); }
    }
  }
  return Object.fromEntries(Object.entries(hist).map(([kind, hist]) => {
    const rows = [...hist].sort((a,b) => b[1]-a[1]), n = rows.reduce((s, [,n]) => s+n, 0);
    const luma = (c: string) => [1,3,5].reduce((s, i, j) => s + parseInt(c.slice(i,i+2),16) * [0.2126,0.7152,0.0722][j]!, 0);
    const mean = rows.reduce((s,[c,k]) => s+luma(c)*k,0)/n;
    const sd = Math.sqrt(rows.reduce((s,[c,k]) => s+(luma(c)-mean)**2*k,0)/n);
    const saturation = rows.reduce((s,[c,k]) => { const ch=[1,3,5].map(i=>parseInt(c.slice(i,i+2),16));return s+(Math.max(...ch)-Math.min(...ch))/Math.max(...ch)*k;},0)/n;
    return [kind,{ pixels:n, colours:rows.length, lumaSD:+sd.toFixed(2), saturation:+saturation.toFixed(3), neighbourChange:+((transitions[kind]??0)/(pairs[kind]??1)*100).toFixed(2), dominant: rows.slice(0,3).map(([c,k])=>`${c} ${(k/n*100).toFixed(1)}%`) }];
  }));
}
/** Short blue/grey runs bracketed by wall tones: a window-pattern proxy, not semantic segmentation. */
export function windowPatterns(base: string, r: typeof OUR_REGIONS[number]) {
  const at = tileReader(base), widths: number[] = [], gaps: number[] = [];
  const wall = new Set([...sets.ground, ...'#5c2b1b #893824 #963018 #9e4f31 #a94729 #b44a28 #c85534 #ca6a4d #482518'.split(' ')]);
  for (let y=r.y; y<r.y+r.h; y++) {
    let previous=-100;
    for (let x=r.x; x<r.x+r.w;) {
      const a=at(x,y);
      if(!a.alpha || !sets.windows.has(a.colour)) {x++;continue;}
      const start=x;
      while(x<r.x+r.w && at(x,y).alpha && sets.windows.has(at(x,y).colour)) x++;
      const width=x-start;
      if(width>6 || !wall.has(at(start-1,y).colour) || !wall.has(at(x,y).colour)) continue;
      widths.push(width);
      if(start-previous<=20) gaps.push(start-previous);
      previous=start;
    }
  }
  const mean=(a:number[])=>a.reduce((s,n)=>s+n,0)/Math.max(1,a.length);
  return {count:widths.length, meanWidth:+mean(widths).toFixed(2), meanBay:+mean(gaps).toFixed(2),
    widthCounts:Array.from({length:6},(_,i)=>widths.filter(w=>w===i+1).length)};
}
export function styleComparison() {
  const sez=JSON.parse(readFileSync('src/map/public/sez/manifest.json','utf8'));
  return {
    reference:measureStyle(`src/map/public/sez/${sez.version}`,STYLE_REGIONS),
    before:measureStyle('.cache/noord/round2-before'),
    after:measureStyle('src/map/public/ours'),
    facades: [0,1,2].map(i=>({ reference:STYLE_REGIONS[i]!.name, ours:OUR_REGIONS[i]!.name,
      theirs:measureStyle(`src/map/public/sez/${sez.version}`,[STYLE_REGIONS[i]!]),
      before:measureStyle('.cache/noord/round2-before',[OUR_REGIONS[i]!]),
      after:measureStyle('src/map/public/ours',[OUR_REGIONS[i]!]),
      patterns:{theirs:windowPatterns(`src/map/public/sez/${sez.version}`,STYLE_REGIONS[i]!),
        before:windowPatterns('.cache/noord/round2-before',OUR_REGIONS[i]!),after:windowPatterns('src/map/public/ours',OUR_REGIONS[i]!)} })),
  };
}
