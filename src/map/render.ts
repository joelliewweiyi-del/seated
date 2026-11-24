// Draws the map on a canvas: the city (sezlab's images, the level that fits the zoom, loaded as the view needs them)
// and a sign over every restaurant.
import { World } from './world';
import { pixels, type Look } from './avatar';

export interface Marker {
  id: string;
  name: string;
  /** Anchor in world pixels: the roof of the restaurant's building. */
  ax: number;
  ay: number;
  colour: string;
  /** Short text on the sign: "3 free", "full", "opens 5 Nov". */
  badge: string;
  /** Higher draws first and keeps its label when signs crowd. */
  rank: number;
  /** A hollow badge: cream with an edge in the colour ("No tables online", never to be read as Full). */
  hollow?: boolean;
  /** MICHELIN: '1' to '3' stars, or 'bib'. Drawn as its own red mark, on the sign and on the pin. */
  michelin?: string | null;
  dim: boolean;
  /** Outside the lens: a dot only, never a name, unless selected or hovered (Joel, 24 Nov 2026: "too much going on"). */
  pin?: boolean;
}

const MICHELIN_RED = '#b8322a';
/** Text on a dimmed sign: dark enough for 4.5:1 on its board (#f1eee8), still lighter than the ink. */
/** Pins whose boxes come closer than this (screen pixels) merge into one numbered pin; its hit id starts with CLUSTER. */
const CLUSTER_GAP = 2;
const CLUSTER = 'cluster:';
export const DIM_INK = '#625d6b';
const michelinMark = (m: Pick<Marker, 'michelin'>) => (!m.michelin ? null : m.michelin === 'bib' ? 'Bib' : '★'.repeat(Number(m.michelin)));

/** Crisp zooms: at each one the chosen image level is shown at a whole multiple of its pixels. */
export const ZOOMS = [0.125, 0.25, 0.5, 1, 2, 3, 4];
const MAX_IMAGES = 48;
/** Bobbing in whole pixels: the selected sign, and your ring and lift. */
const bobAt = (now: number) => Math.round(Math.sin(now / 260) * 1.5);
const ringAt = (now: number) => Math.round((Math.sin(now / 400) + 1) * 2);
const liftAt = (now: number) => Math.round((Math.sin(now / 300) + 1) * 2);
/** Outside the art: fog, so the edge reads as "not explored yet" and never as a gap (Joel, 6 Nov 2026). */
const FOG_TONES = ['#a8a4bc', '#bbb7cb', '#cecbda', '#e3e1ea'];
/** Screen pixels per fog pixel: chunky like the signs, at every zoom. */
const FOG_PX = 4;

/**
 * One tileable square of pixel fog: smooth noise that wraps at the edges, cut into four flat tones, so the clouds
 * have hard pixel steps and no blur. Drawn once; deterministic, so every visit looks the same.
 */
export function fogTile(size = 256): Uint8Array {
  const cells = [16, 8, 4];
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const grids = cells.map((c) => Array.from({ length: c * c }, rnd));
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const raw = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      let total = 0;
      cells.forEach((c, o) => {
        const g = grids[o]!;
        const fx = (x / size) * c;
        const fy = (y / size) * c;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const at = (i: number, j: number) => g[((j % c) * c + (i % c)) % (c * c)]!;
        const tx = smooth(fx - x0);
        const ty = smooth(fy - y0);
        const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
        const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
        const w = 1 / (o + 1);
        v += (top * (1 - ty) + bottom * ty) * w;
        total += w;
      });
      raw[y * size + x] = v / total;
    }
  }
  // Rank the values (0 = lowest, 1 = highest), so the clouds use every tone in steady shares.
  const order = Array.from(raw.keys()).sort((a, b) => raw[a]! - raw[b]!);
  const rank = new Float32Array(raw.length);
  order.forEach((i, n) => (rank[i] = n / (raw.length - 1)));
  // Flat bands, no dither: a fine dither read as a transparency checkerboard (Codex, 6 Nov 2026).
  const out = new Uint8Array(size * size);
  rank.forEach((u, i) => {
    out[i] = Math.min(FOG_TONES.length - 1, Math.floor(u * FOG_TONES.length));
  });
  return out;
}

function fogCanvas(size = 256): HTMLCanvasElement {
  const tones = FOG_TONES.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
  const idx = fogTile(size);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  idx.forEach((t, i) => {
    img.data.set([...tones[t]!, 255], i * 4);
  });
  g.putImageData(img, 0, 0);
  return c;
}

/** How far fog reaches over the art, in overview pixels (8 world pixels each). */
const FOG_REACH = 36;
/** The fog edge leaves this many overview pixels (8 world pixels each) clear around a restaurant. */
const FOG_CLEAR = 24;

/**
 * The fog-over-art mask: opaque where the art is transparent, and also on art within a ragged distance of it or of
 * the image's edge. The distance limit follows smooth noise, so the fringe has the shape of cloud, in whole pixels.
 */
export function fogEdgeIndex(
  alpha: Uint8Array,
  w: number,
  h: number,
  reach = FOG_REACH,
  clear: Array<{ x: number; y: number }> = [],
  /** A window of a larger grid: its offset (the noise follows the whole grid) and no edge of its own. */
  at: { x: number; y: number; edge: boolean } = { x: 0, y: 0, edge: true },
): Uint8Array {
  const dist = new Uint8Array(w * h).fill(255);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  // Seeds: cells without art next to art (the rest are 0 and lead nowhere nearer), and art on the grid's edge.
  for (let i = 0; i < w * h; i++) {
    const x = i % w;
    const y = (i / w) | 0;
    if (!alpha[i]) {
      dist[i] = 0;
      let nextToArt = false;
      for (let dy = -1; dy <= 1 && !nextToArt; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && alpha[ny * w + nx]) { nextToArt = true; break; }
      }
      if (!nextToArt) continue;
    } else if (at.edge && (x === 0 || y === 0 || x === w - 1 || y === h - 1)) dist[i] = 1;
    else continue;
    queue[tail++] = i;
  }
  while (head < tail) {
    const i = queue[head++]!;
    const d = dist[i]!;
    if (d >= reach) continue;
    const x = i % w;
    const y = (i / w) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (dist[j]! > d + 1) {
          dist[j] = d + 1;
          queue[tail++] = j;
        }
      }
    }
  }
  const out = new Uint8Array(w * h);
  const wy = Float64Array.from({ length: h }, (_, y) => Math.sin((y + at.y) * 0.02) * 2);
  const wx = Float64Array.from({ length: w }, (_, x) => Math.sin((x + at.x) * 0.013) * 2);
  for (let i = 0; i < w * h; i++) {
    if (dist[i] === 0) { out[i] = 1; continue; }
    if (dist[i] === 255) continue; // deep in the art, beyond the reach: never fog
    const lx = i % w, ly = (i / w) | 0;
    const x = lx + at.x;
    const y = ly + at.y;
    const n = 0.5 + 0.25 * Math.sin(x * 0.03 + wy[ly]!) + 0.25 * Math.sin(y * 0.026 + wx[lx]!);
    out[i] = dist[i]! <= Math.round(1 + n * (reach - 1)) ? 1 : 0;
  }
  // Around a restaurant, the art it stands on stays visible: only where there is no art at all does fog remain.
  const r = FOG_CLEAR;
  for (const p of clear) {
    const cx = Math.round(p.x) - at.x;
    const cy = Math.round(p.y) - at.y;
    for (let y = Math.max(0, cy - r); y <= Math.min(h - 1, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(w - 1, cx + r); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r && alpha[y * w + x]) out[y * w + x] = 0;
      }
    }
  }
  return out;
}

/** Overview pixels placed on one shared grid. Offsets may be negative; transparent pixels never erase art. */
export function fogAlphaUnion(layers: Array<{ alpha: Uint8Array; w: number; h: number; x: number; y: number }>) {
  const x = Math.min(...layers.map(l => l.x)), y = Math.min(...layers.map(l => l.y));
  const w = Math.max(...layers.map(l => l.x + l.w)) - x;
  const h = Math.max(...layers.map(l => l.y + l.h)) - y;
  const alpha = new Uint8Array(w * h);
  for (const l of layers) for (let row = 0; row < l.h; row++) for (let col = 0; col < l.w; col++) {
    if (l.alpha[row * l.w + col]) alpha[(row + l.y - y) * w + col + l.x - x] = 1;
  }
  return { alpha, x, y, w, h };
}

/** Side of one fog edge tile, in overview pixels. Small, so no tile is a texture a phone cannot hold. */
export const FOG_TILE = 128;

/** Art as runs per row ([start, end) pairs of overview pixels), from an alpha grid. */
export function alphaRuns(alpha: Uint8Array, w: number, h: number): number[][] {
  const rows: number[][] = [];
  for (let y = 0; y < h; y++) {
    const row: number[] = [];
    for (let x = 0; x < w; x++) {
      if (!alpha[y * w + x]) continue;
      const a = x;
      while (x < w && alpha[y * w + x]) x++;
      row.push(a, x);
    }
    rows.push(row);
  }
  return rows;
}

/**
 * The fog edge in tiles of FOG_TILE overview pixels, only where it lies over art: fog over no art is the fog already
 * under everything, so tiles of no art, and tiles of art far from its edge, need none. The same mask as fogEdgeIndex
 * over the whole grid (test/mapFog.test.ts), built a tile at a time as the view needs it: on a phone the whole-city
 * mask (11,776 x 5,120 cells) froze the page 8.7 s on load and was a texture too large for its GPU (Joel, 19 Nov 2026:
 * "laggy on my chrome mobile").
 */
export function fogPlan(runs: number[][], w: number, h: number): Uint8Array {
  const T = FOG_TILE, tw = Math.ceil(w / T), th = Math.ceil(h / T);
  const art = new Float64Array(tw * th);
  runs.forEach((row, y) => {
    const ty = (y / T) | 0;
    for (let i = 0; i < row.length; i += 2) {
      const a = row[i]!, b = row[i + 1]!;
      for (let tx = (a / T) | 0; tx * T < b; tx++) art[ty * tw + tx]! += Math.min(b, (tx + 1) * T) - Math.max(a, tx * T);
    }
  });
  const full = (tx: number, ty: number) => tx >= 0 && ty >= 0 && tx < tw && ty < th && art[ty * tw + tx] === T * T;
  const needs = new Uint8Array(tw * th);
  for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
    if (!art[ty * tw + tx]) continue;
    let inside = true;
    for (let dy = -1; dy <= 1 && inside; dy++) for (let dx = -1; dx <= 1; dx++) if (!full(tx + dx, ty + dy)) { inside = false; break; }
    if (!inside) needs[ty * tw + tx] = 1;
  }
  return needs;
}

/** One tile of the fog edge (1 = fog over art), or null when none of it lies over art. */
export function fogEdgeTile(runs: number[][], w: number, h: number, tx: number, ty: number, reach = FOG_REACH, clear: Array<{ x: number; y: number }> = []): Uint8Array | null {
  const T = FOG_TILE, m = reach + 1;
  // The tile and a margin as wide as the fog reaches; outside the grid is no art.
  const x0 = tx * T - m, y0 = ty * T - m, ww = T + 2 * m, wh = T + 2 * m;
  const alpha = new Uint8Array(ww * wh);
  for (let y = Math.max(0, y0); y < Math.min(h, y0 + wh); y++) {
    const row = runs[y]!;
    for (let i = 0; i < row.length; i += 2) {
      const a = Math.max(row[i]!, x0), b = Math.min(row[i + 1]!, x0 + ww);
      if (a < b) alpha.fill(1, (y - y0) * ww + a - x0, (y - y0) * ww + b - x0);
    }
  }
  const near = clear.filter((p) => p.x > x0 - FOG_CLEAR && p.x < x0 + ww + FOG_CLEAR && p.y > y0 - FOG_CLEAR && p.y < y0 + wh + FOG_CLEAR);
  const fog = fogEdgeIndex(alpha, ww, wh, reach, near, { x: x0, y: y0, edge: false });
  const mask = new Uint8Array(T * T);
  let any = false;
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const j = (y + m) * ww + x + m;
    if (fog[j] && alpha[j]) { mask[y * T + x] = 1; any = true; }
  }
  return any ? mask : null;
}

/**
 * Share of the coverage mask's art cells (manifest.mask, `k` overview pixels square) that have no pixel in this
 * overview: 0 for a whole image. A download cut short decodes only its top rows (Joel, 17 Nov 2026: fog over the canal
 * belt below row 642), and the fog edge built from it covered the art; the cache then kept that copy for a year.
 */
export function missingArt(alpha: Uint8Array, w: number, h: number, mask: { mw: number; mh: number; bits: Uint8Array }, k: number): number {
  let art = 0, missing = 0;
  for (let my = 0; my < mask.mh; my++) for (let mx = 0; mx < mask.mw; mx++) {
    const i = my * mask.mw + mx;
    if (!(mask.bits[i >> 3]! & (1 << (i & 7)))) continue;
    art++;
    let seen = false;
    for (let y = my * k; y < Math.min(h, (my + 1) * k) && !seen; y++) for (let x = mx * k; x < Math.min(w, (mx + 1) * k); x++) if (alpha[y * w + x]) { seen = true; break; }
    if (!seen) missing++;
  }
  return art ? missing / art : 0;
}

/** The manifest's coverage mask (cells of `k` overview pixels) as overview-sized alpha: 1 where his art is. */
export function maskAlpha(mask: { mw: number; mh: number; bits: string }, w: number, h: number, k: number): Uint8Array {
  const bits = Uint8Array.from(atob(mask.bits), (ch) => ch.charCodeAt(0));
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const mx = Math.floor(x / k), my = Math.floor(y / k);
    if (mx >= mask.mw || my >= mask.mh) continue;
    const i = my * mask.mw + mx;
    if (bits[i >> 3]! & (1 << (i & 7))) out[y * w + x] = 1;
  }
  return out;
}

function overviewAlpha(img: HTMLImageElement): Uint8Array {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height).data;
  return Uint8Array.from({ length: c.width * c.height }, (_, i) => +(data[i * 4 + 3]! > 0));
}

interface Tile {
  img: HTMLImageElement;
  ok: boolean;
  failed: boolean;
  /** His overview only: its alpha once checked whole; null when it stayed incomplete (no fog edge from it). */
  alpha?: Uint8Array | null;
}

export class MapView {
  readonly ctx: CanvasRenderingContext2D;
  /** Camera centre in world pixels and zoom (CSS pixels per world pixel). */
  cam = { x: 0, y: 0, z: 0.25 };
  target: { x: number; y: number; z: number } | null = null;
  /** The fog tile (fogCanvas), and where its repeat starts on screen this frame. */
  private fog: HTMLCanvasElement | ImageBitmap | null = null;
  private fogAt = { x: 0, y: 0 };
  /**
   * The art as runs per overview row, and which FOG_TILE tiles may have fog over art (fogPlan); tiles are built as the
   * view reaches them (null: none of it over art). Our art's runs come from its manifest, his from his overview.
   */
  private fogMask: { runs: number[][]; w: number; h: number; needs: Uint8Array; tiles: Map<number, HTMLCanvasElement | null> } | null = null;
  /** Restaurants: the fog edge never covers the ground around one. World pixels. */
  private clear: Array<{ x: number; y: number }> = [];
  /** Where the camera may go: his drawing, and every restaurant in the fog around it with some room to spare. */
  private bounds = { x0: 0, y0: 0, x1: 0, y1: 0 };
  private fogScratch: HTMLCanvasElement | null = null;
  private dpr = 1;
  /** His overview; none when only our art is drawn. */
  private overview: Tile | null = null;
  private oursOverview: Tile | null = null;
  private fogOrigin = { x: 0, y: 0 };
  private tiles = new Map<string, Tile>();
  /** Images the current view shows but has not got yet. Tests wait for 0. */
  private waiting = 0;
  private markers: Marker[] = [];
  /** Where you are, in world pixels, and your character's cells (a silhouette when you have none). */
  private you: { x: number; y: number; cells: Array<[number, number, string]> } | null = null;
  private hits: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];
  private raf = 0;
  private dirty = true;
  /** The bob offsets last drawn (see loop). */
  private motion = '';
  private last = performance.now();
  selected: string | null = null;
  hovered: string | null = null;
  onSelect: (id: string | null) => void = () => {};
  onCamera: (cam: { x: number; y: number; z: number }) => void = () => {};
  reducedMotion = false;
  /** Screen areas covered by panels: signs there shrink to pins. */
  safe = { top: 0, right: 0, bottom: 0, left: 0 };
  /** Screen boxes of controls on the map itself (the zoom buttons), set by the page like `safe`. */
  controls: Array<{ x: number; y: number; w: number; h: number }> = [];
  private home = { x: 0, y: 0, z: 0.5 };
  private wheelAcc = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly world: World,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.bounds = { x0: 0, y0: 0, x1: world.width, y1: world.height };
    const dam = world.project(52.3731, 4.8926);
    this.cam = { x: dam.x, y: dam.y, z: 0.5 };
    this.home = { ...this.cam };
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Only our art: no overview at all. Ours is 11,776 x 5,120 px (240 MB decoded), more than a phone's GPU holds in one
    // texture; its chunk levels cover every zoom, and the fog edge comes from the manifest's coverage.
    if (!world.onlyOurs) {
      this.overview = this.loadOverview(world.level(2).url(0, 0));
      if (world.ours) this.oursOverview = this.load(world.oursLevel(2).url(0, 0));
    }
    this.bindInput();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.loop();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
  }

  // ── public ───────────────────────────────────────────────────────────────

  /** The places the fog edge leaves clear (every restaurant). Rebuilds the fog edge when they move. */
  keepClear(points: Array<{ x: number; y: number }>): void {
    const key = (ps: Array<{ x: number; y: number }>) => ps.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(';');
    if (key(points) === key(this.clear)) return;
    this.clear = points;
    this.fogMask = null;
    const m = 600;
    const ext = this.world.ours?.levels.at(-1);
    const extBounds = ext ? { x0: ext.x / ext.k, y0: ext.y / ext.k, x1: (ext.x + ext.w) / ext.k, y1: (ext.y + ext.h) / ext.k } : { x0: 0, y0: 0, x1: 0, y1: 0 };
    this.bounds = {
      x0: Math.min(0, extBounds.x0, ...points.map((p) => p.x - m)),
      y0: Math.min(0, extBounds.y0, ...points.map((p) => p.y - m)),
      x1: Math.max(this.world.width, extBounds.x1, ...points.map((p) => p.x + m)),
      y1: Math.max(this.world.height, extBounds.y1, ...points.map((p) => p.y + m)),
    };
  }

  setMarkers(markers: Marker[]): void {
    this.markers = markers;
    this.dirty = true;
  }

  setYou(p: { x: number; y: number } | null, look: Look | null = null): void {
    this.you = p && { ...p, cells: pixels(look) };
    this.dirty = true;
  }

  /** Back to the first view. */
  reset(z?: number): void {
    this.flyTo(this.home.x, this.home.y, z ?? this.home.z);
  }

  /** The first view, and where ⌂ goes back to. */
  setHome(x: number, y: number, z: number): void {
    this.home = this.clamp({ x, y, z });
    this.cam = { ...this.home };
    this.target = null;
    this.dirty = true;
  }

  /** Keeps the camera over the map. */
  private clamp(p: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    const z = Math.max(ZOOMS[0]!, Math.min(ZOOMS.at(-1)!, p.z));
    const b = this.bounds;
    return { x: Math.max(b.x0, Math.min(b.x1, p.x)), y: Math.max(b.y0, Math.min(b.y1, p.y)), z };
  }

  /** Moves the camera smoothly. */
  flyTo(sx: number, sy: number, z = this.cam.z): void {
    this.target = this.clamp({ x: sx, y: sy, z });
    if (this.reducedMotion) {
      this.cam = { ...this.target };
      this.target = null;
    }
    this.dirty = true;
  }

  zoomBy(steps: number, at?: { x: number; y: number }): void {
    const base = this.target?.z ?? this.cam.z;
    let i = ZOOMS.findIndex((z) => z >= base - 1e-6);
    if (i === -1) i = ZOOMS.length - 1;
    const z = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, i + steps))]!;
    this.zoomTo(z, at);
  }

  zoomTo(z: number, at?: { x: number; y: number }): void {
    const rect = this.canvas.getBoundingClientRect();
    const px = at ? at.x - rect.left : rect.width / 2;
    const py = at ? at.y - rect.top : rect.height / 2;
    // Keep the world point under the cursor where it is.
    const from = this.target ?? this.cam;
    const wx = from.x + (px - rect.width / 2) / from.z;
    const wy = from.y + (py - rect.height / 2) / from.z;
    const x = wx - (px - rect.width / 2) / z;
    const y = wy - (py - rect.height / 2) / z;
    this.flyTo(x, y, z);
  }

  markerScreen(id: string): { x: number; y: number } | null {
    const m = this.markers.find((k) => k.id === id);
    if (!m) return null;
    const rect = this.canvas.getBoundingClientRect();
    return { x: (m.ax - this.cam.x) * this.cam.z + rect.width / 2, y: (m.ay - this.cam.y) * this.cam.z + rect.height / 2 };
  }

  /** City images the view still waits for. Tests wait for 0. */
  pending(): number {
    return this.waiting + (!this.overview || this.overview.ok || this.overview.failed ? 0 : 1) + (this.oursOverview && !this.oursOverview.ok && !this.oursOverview.failed ? 1 : 0);
  }

  // ── frame ────────────────────────────────────────────────────────────────

  private resize(): void {
    // At most 2x for speed; the launch film (scripts/map-film.mjs) draws at 4x and scales down, for half-pixel motion.
    this.dpr = Math.min(window.devicePixelRatio || 1, (window as { __maxDpr?: number }).__maxDpr ?? 2);
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    this.dirty = true;
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    let moving = false;
    if (this.target) {
      const k = 1 - Math.pow(0.0008, dt);
      this.cam.x += (this.target.x - this.cam.x) * k;
      this.cam.y += (this.target.y - this.cam.y) * k;
      this.cam.z += (this.target.z - this.cam.z) * k;
      if (Math.abs(this.target.x - this.cam.x) < 0.5 && Math.abs(this.target.y - this.cam.y) < 0.5 && Math.abs(this.target.z - this.cam.z) < 0.002) {
        this.cam = { ...this.target };
        this.target = null;
      }
      moving = true;
      this.onCamera(this.cam);
    }
    // The selected sign and you bob in whole pixels: draw again only when one of them moves a pixel (about 10 times a
    // second, not 60: a phone redrew the whole city every frame with a card open; Joel, 19 Nov 2026: laggy).
    const motion = this.reducedMotion ? '' : `${this.selected ? bobAt(now) : ''}|${this.you ? `${ringAt(now)},${liftAt(now)}` : ''}`;
    if (this.dirty || moving || motion !== this.motion) this.draw(now);
    this.motion = motion;
    this.dirty = false;
  };

  /**
   * His overview, checked against the manifest's coverage mask before anyone uses it. A copy with art missing (a cut-off
   * download, kept by the year-long cache) is fetched once more past the cache; if that one is cut off too, the art
   * still draws but no fog edge is built from it, so fog never covers art.
   */
  private loadOverview(url: string, retry = true): Tile {
    const t: Tile = { img: new Image(), ok: false, failed: false };
    t.img.onload = () => {
      const { mw, mh, cell, bits } = this.world.meta.mask;
      const alpha = overviewAlpha(t.img);
      const k = cell / (this.world.width / t.img.naturalWidth);
      const gone = missingArt(alpha, t.img.naturalWidth, t.img.naturalHeight, { mw, mh, bits: Uint8Array.from(atob(bits), (ch) => ch.charCodeAt(0)) }, k);
      if (gone > 0.01 && retry) {
        console.warn(`[map] the city overview came back with ${Math.round(gone * 100)}% of its art missing; fetching it again past the cache.`);
        this.overview = this.loadOverview(`${url}${url.includes('?') ? '&' : '?'}fresh=${Date.now()}`, false);
        return;
      }
      if (gone > 0.01) console.error(`[map] the city overview is still ${Math.round(gone * 100)}% incomplete after a fresh download: drawing it without the fog edge. Fix: reload the page; if it stays, check ${url} on the server.`);
      t.alpha = gone > 0.01 ? null : alpha;
      t.ok = true;
      this.dirty = true;
    };
    t.img.onerror = () => {
      if (retry) {
        this.overview = this.loadOverview(`${url}${url.includes('?') ? '&' : '?'}fresh=${Date.now()}`, false);
        return;
      }
      t.failed = true;
      this.dirty = true;
    };
    t.img.src = url;
    return t;
  }

  private load(url: string): Tile {
    const t: Tile = { img: new Image(), ok: false, failed: false };
    t.img.onload = () => {
      t.ok = true;
      this.dirty = true;
    };
    t.img.onerror = () => {
      t.failed = true;
      this.dirty = true;
    };
    t.img.src = url;
    return t;
  }

  /** A chunk image, loaded on first use; the least recently used ones are dropped. */
  private tile(url: string): Tile {
    let t = this.tiles.get(url);
    if (t) this.tiles.delete(url);
    else t = this.load(url);
    this.tiles.set(url, t);
    if (this.tiles.size > MAX_IMAGES) this.tiles.delete(this.tiles.keys().next().value!);
    return t;
  }

  /** Draws the visible chunks of one level; returns how many it still waits for. */
  /**
   * Fog over the edge of the art: everywhere neither drawing (his, our Noord) has pixels, and a ragged band over the
   * art's edge, clear around every restaurant. Drawn after the art, so the edge reads as cloud, never as a straight
   * cut along a tile (Joel, 8 Nov 2026: "wtf is this" at the gap in his drawing in Oost).
   */
  private drawFogEdge(toX: (x: number) => number, toY: (y: number) => number, W: number, H: number): void {
    if (!this.fog) return;
    if (!this.fogMask) {
      let runs: number[][], w: number, h: number;
      const cov = this.world.ours?.coverage;
      if (this.world.onlyOurs && cov) {
        ({ runs, w, h } = cov);
        this.fogOrigin = { x: cov.x * 8, y: cov.y * 8 };
      } else {
        if (!this.overview?.ok || (this.oursOverview && !this.oursOverview.ok && !this.oursOverview.failed)) return;
        const ext = this.oursOverview?.ok ? this.world.ours?.levels.at(-1) : undefined;
        // An overview with art missing gives no edge of its own: the manifest's coverage outline stands in (coarser).
        const ow = Math.round(this.world.width / 8), oh = Math.round(this.world.height / 8);
        const alpha = this.overview.alpha ?? maskAlpha(this.world.meta.mask, ow, oh, this.world.meta.mask.cell / 8);
        const layers = [{ alpha, w: ow, h: oh, x: 0, y: 0 }];
        if (ext) layers.push({ alpha: overviewAlpha(this.oursOverview!.img), w: ext.w, h: ext.h, x: ext.x, y: ext.y });
        const union = fogAlphaUnion(layers);
        ({ w, h } = union);
        runs = alphaRuns(union.alpha, w, h);
        this.fogOrigin = { x: union.x * 8, y: union.y * 8 };
      }
      this.fogMask = { runs, w, h, needs: fogPlan(runs, w, h), tiles: new Map() };
    }
    const f = this.fogMask, z = this.cam.z, T = FOG_TILE, span = T * 8;
    const tw = Math.ceil(f.w / T), th = Math.ceil(f.h / T);
    const tx0 = Math.max(0, Math.floor((this.cam.x - W / 2 / z - this.fogOrigin.x) / span));
    const ty0 = Math.max(0, Math.floor((this.cam.y - H / 2 / z - this.fogOrigin.y) / span));
    const tx1 = Math.min(tw - 1, Math.floor((this.cam.x + W / 2 / z - this.fogOrigin.x) / span));
    const ty1 = Math.min(th - 1, Math.floor((this.cam.y + H / 2 / z - this.fogOrigin.y) / span));
    const clear = this.clear.map((p) => ({ x: (p.x - this.fogOrigin.x) / 8, y: (p.y - this.fogOrigin.y) / 8 }));
    const budget = performance.now() + 6; // build a few tiles a frame, never a long freeze
    const show: Array<[number, number, HTMLCanvasElement]> = [];
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const i = ty * tw + tx;
      if (!f.needs[i]) continue;
      let c = f.tiles.get(i);
      if (c === undefined) {
        if (performance.now() > budget) { this.dirty = true; continue; }
        const mask = fogEdgeTile(f.runs, f.w, f.h, tx, ty, FOG_REACH, clear);
        c = null;
        if (mask) {
          c = document.createElement('canvas');
          c.width = c.height = T;
          const data = new ImageData(T, T);
          mask.forEach((a, j) => { data.data[j * 4 + 3] = a ? 255 : 0; });
          c.getContext('2d')!.putImageData(data, 0, 0);
        }
        f.tiles.set(i, c);
      }
      if (c) show.push([tx, ty, c]);
    }
    if (!show.length) return; // no edge of the art in view: nothing to draw
    const { canvas, dpr } = this;
    const sc = (this.fogScratch ??= document.createElement('canvas'));
    if (sc.width !== canvas.width || sc.height !== canvas.height) {
      sc.width = canvas.width;
      sc.height = canvas.height;
    }
    const g = sc.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, sc.width, sc.height);
    g.imageSmoothingEnabled = false;
    for (const [tx, ty, c] of show) {
      // Whole pixels, so neighbouring tiles meet without a seam.
      const sx = Math.round(toX(this.fogOrigin.x + tx * span)), sy = Math.round(toY(this.fogOrigin.y + ty * span));
      const ex = Math.round(toX(this.fogOrigin.x + (tx + 1) * span)), ey = Math.round(toY(this.fogOrigin.y + (ty + 1) * span));
      g.drawImage(c, sx, sy, ex - sx, ey - sy);
    }
    g.globalCompositeOperation = 'source-atop'; // fog only where the mask is; each tile leaves the rest as it is
    this.paintFog(g, W, H);
    this.ctx.drawImage(sc, 0, 0, sc.width / dpr, sc.height / dpr);
  }

  /**
   * The fog tile repeated over the screen at FOG_PX per pixel, as a few whole-pixel image copies: a scaled pattern fill
   * cost 2.5 ms a frame on the Mac's GPU, most of a frame (19 Nov 2026).
   */
  private paintFog(g: CanvasRenderingContext2D, W: number, H: number): void {
    const tile = 256 * FOG_PX;
    g.imageSmoothingEnabled = false;
    for (let y = this.fogAt.y; y < H; y += tile) for (let x = this.fogAt.x; x < W; x += tile) g.drawImage(this.fog!, x, y, tile, tile);
  }

  /**
   * A screen position rounded to whole device pixels: on a 2x screen a slow pan moved in 2-pixel steps with a still frame
   * between (CSS-pixel rounding; the launch film stuttered, Joel 24 Nov 2026). Everything drawn from it stays on device pixels.
   */
  private snap(v: number): number {
    return Math.round(v * this.dpr) / this.dpr;
  }

  private drawLevel(L: 'hi' | 0 | 1, toX: (x: number) => number, toY: (y: number) => number, W: number, H: number, ours = false): number {
    const { k, span, has, url } = ours ? this.world.oursLevel(L) : this.world.level(L);
    const z = this.cam.z;
    const x0 = Math.floor((this.cam.x - W / 2 / z) / span);
    const y0 = Math.floor((this.cam.y - H / 2 / z) / span);
    const x1 = Math.floor((this.cam.x + W / 2 / z) / span);
    const y1 = Math.floor((this.cam.y + H / 2 / z) / span);
    let waiting = 0;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        if (!has(cx, cy)) continue;
        const t = this.tile(url(cx, cy));
        if (!t.ok) {
          if (!t.failed) waiting++;
          continue;
        }
        // Whole device pixels, so neighbouring chunks meet without a seam and a slow pan moves in device-pixel steps.
        const sx = this.snap(toX(cx * span));
        const sy = this.snap(toY(cy * span));
        const ex = this.snap(toX(cx * span + (t.img.width / k)));
        const ey = this.snap(toY(cy * span + (t.img.height / k)));
        this.ctx.drawImage(t.img, sx, sy, ex - sx, ey - sy);
      }
    }
    return waiting;
  }

  private draw(now: number): void {
    const { ctx, canvas, cam, dpr } = this;
    const W = canvas.width / dpr;
    const H = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const z = cam.z;
    // Fog under everything. It moves with the map at half its speed, like a layer further down, in steady pixels.
    if (!this.fog) {
      const c = (this.fog = fogCanvas());
      // A bitmap stays on the GPU; a small canvas is uploaded again each time it is drawn.
      void createImageBitmap(c).then((b) => { this.fog = b; this.dirty = true; }, () => {});
    }
    const tile = 256 * FOG_PX;
    this.fogAt = {
      x: Math.round(((((-cam.x * z + W / 2) * 0.5) % tile) + tile) % tile) - tile,
      y: Math.round(((((-cam.y * z + H / 2) * 0.5) % tile) + tile) % tile) - tile,
    };
    this.paintFog(ctx, W, H);
    const toX = (wx: number) => (wx - cam.x) * z + W / 2;
    const toY = (wy: number) => (wy - cam.y) * z + H / 2;

    // The overview underneath his chunks: it shows while chunks load, and alone when far away.
    if (this.overview?.ok) {
      ctx.imageSmoothingEnabled = z < 0.125;
      ctx.drawImage(this.overview.img, this.snap(toX(0)), this.snap(toY(0)), this.snap(this.world.width * z), this.snap(this.world.height * z));
      ctx.imageSmoothingEnabled = false;
    }
    // The level whose pixels are at least as fine as the screen's, so images are only ever enlarged.
    let waiting = 0;
    if (this.world.onlyOurs) {
      // ?art=ours: his art hidden, ours alone.
    } else if (z >= 1) {
      this.drawLevel(0, toX, toY, W, H); // under the sharpest: it fills where a sharp chunk is missing or loading
      waiting = this.drawLevel('hi', toX, toY, W, H);
    } else if (z >= 0.5) waiting = this.drawLevel(0, toX, toY, W, H);
    else if (z >= 0.25) waiting = this.drawLevel(1, toX, toY, W, H);
    else {
      // Far out, his 1/4 level too (15 images of 1024 px), over the overview: on some screens the one 2144x1472 overview
      // shows only its top part (Joel, 17 Nov 2026, Windows: the art cut by a straight line, fog below it).
      ctx.imageSmoothingEnabled = z < 0.125;
      waiting = this.drawLevel(1, toX, toY, W, H);
      ctx.imageSmoothingEnabled = false;
    }
    // Our layer on top: it is cut to his gaps plus a strip over his edge (scripts/map-noord.ts, gapMask), so it covers
    // only where his art is missing or fades out in a dither, and never the rest of his drawing.
    let oursWaiting = 0;
    const ext = this.world.ours?.levels.at(-1);
    if (this.oursOverview?.ok && ext) ctx.drawImage(this.oursOverview.img, this.snap(toX(ext.x / ext.k)), this.snap(toY(ext.y / ext.k)), this.snap(ext.w / ext.k * z), this.snap(ext.h / ext.k * z));
    if (this.world.ours && (z >= 0.25 || this.world.onlyOurs)) {
      ctx.imageSmoothingEnabled = z < 0.25; // far out (only our art): its 1/4 level, shrunk
      oursWaiting = this.drawLevel(z >= 1 ? 'hi' : z >= 0.5 ? 0 : 1, toX, toY, W, H, true);
      ctx.imageSmoothingEnabled = false;
    }
    this.waiting = waiting + oursWaiting;
    this.drawFogEdge(toX, toY, W, H);
    this.drawMarkers(ctx, toX, toY, W, H, now);
    // You go over the signs: a sign never hides where you are.
    if (this.you) this.drawYou(ctx, this.snap(toX(this.you.x)), this.snap(toY(this.you.y)), now);
  }

  /** You are here: your character floats over a small ring on the ground, bobbing (still when motion is reduced). */
  private drawYou(ctx: CanvasRenderingContext2D, x: number, y: number, now: number): void {
    const you = this.you!;
    const ring = this.reducedMotion ? 9 : 8 + ringAt(now);
    pxCircle(ctx, x, y, ring, '#2b273344');
    pxCircle(ctx, x, y, 4, '#2b2733');
    const k = 2; // 16 cells, 2 screen pixels each
    const lift = this.reducedMotion ? 0 : liftAt(now);
    const left = x - 8 * k;
    const top = y - 16 * k - 12 - lift;
    // A cream plate like the panels, so a grey silhouette still stands out on the art.
    pxBox(ctx, left - 3, top - 3, 16 * k + 6, 16 * k + 6, '#2b2733', '#fffaf0');
    for (const [cx, cy, fill] of you.cells) {
      ctx.fillStyle = fill;
      ctx.fillRect(left + cx * k, top + cy * k, k, k);
    }
  }

  // ── signs ────────────────────────────────────────────────────────────────

  private drawMarkers(ctx: CanvasRenderingContext2D, toX: (x: number) => number, toY: (y: number) => number, W: number, H: number, now: number): void {
    this.hits = [];
    const z = this.cam.z;
    // The zoom buttons count as placed: a name that would cover them shrinks to a pin.
    const placed: Array<{ x: number; y: number; w: number; h: number }> = this.controls.map((c) => ({ ...c }));
    const overlaps = (r: { x: number; y: number; w: number; h: number }) =>
      placed.some((o) => r.x < o.x + o.w + 2 && r.x + r.w + 2 > o.x && r.y < o.y + o.h + 2 && r.y + r.h + 2 > o.y);
    const order = [...this.markers].sort((a, b) => {
      const pa = a.id === this.selected ? 1e9 : a.id === this.hovered ? 1e8 : a.rank;
      const pb = b.id === this.selected ? 1e9 : b.id === this.hovered ? 1e8 : b.rank;
      return pb - pa;
    });
    const drawn: Array<{ m: Marker; x: number; y: number; full: boolean }> = [];
    for (const m of order) {
      const x = this.snap(toX(m.ax));
      const y = this.snap(toY(m.ay));
      if (x < -120 || y < -60 || x > W + 120 || y > H + 60) continue;
      // Names from the city view in; zoomed further out only free places keep theirs. Crowded names shrink to pins.
      const showName = m.id === this.selected || m.id === this.hovered || (!m.pin && (z >= 0.25 || (z >= 0.125 && m.rank >= 300)));
      const full = showName;
      ctx.font = '600 13px "Pixelify Sans", ui-monospace, monospace';
      const label = full ? `${m.name} ${michelinMark(m) ?? ''}  ${m.badge}` : m.badge;
      const tw = Math.ceil(ctx.measureText(label).width);
      const bw = full ? tw + 26 : Math.max(22, tw + 18);
      // The board drawSign draws (top = y - 32), so the clear-of-panels margin holds for what is drawn.
      const rect = { x: x - bw / 2, y: y - 32, w: bw, h: 22 };
      const s = this.safe;
      const clipped = rect.x < s.left + 4 || rect.y < s.top + 4 || rect.x + rect.w > W - s.right - 4 || rect.y + rect.h + 10 > H - s.bottom;
      if (y < s.top || y > H - s.bottom + 20 || x < s.left || x > W - s.right) {
        if (m.id !== this.selected) continue; // under a panel: not drawn at all
      }
      if (full && (overlaps(rect) || clipped) && m.id !== this.selected && m.id !== this.hovered) {
        drawn.push({ m, x, y, full: false });
        continue;
      }
      placed.push(rect);
      drawn.push({ m, x, y, full });
    }
    // Pins whose drawn boxes (stud, plus its MICHELIN tag) touch merge into one numbered pin (judge, 19 Nov 2026: pins
    // and star tags stacked on each other read as nameless dots); a tap on it zooms in one step there. The selected and
    // hovered places always keep their own.
    const box = (d: { m: Marker; x: number; y: number }) => {
      const tag = d.m.michelin && !d.m.dim ? this.michelinWidth(ctx, d.m, true) + 1 : 0;
      return { x0: d.x - 7, x1: d.x + 7 + tag, y0: d.y - 23, y1: d.y };
    };
    const touch = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) =>
      a.x0 < b.x1 + CLUSTER_GAP && b.x0 < a.x1 + CLUSTER_GAP && a.y0 < b.y1 + CLUSTER_GAP && b.y0 < a.y1 + CLUSTER_GAP;
    const loose = drawn.filter((d) => !d.full && d.m.id !== this.selected && d.m.id !== this.hovered);
    const boxes = new Map(loose.map((d) => [d, box(d)]));
    // Union-find over touching pairs, so a chain of touching pins becomes one group.
    const root = loose.map((_, i) => i);
    const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i]!)));
    for (let i = 0; i < loose.length; i++)
      for (let j = i + 1; j < loose.length; j++) if (touch(boxes.get(loose[i]!)!, boxes.get(loose[j]!)!)) root[find(i)] = find(j);
    const byRoot = new Map<number, typeof loose>();
    loose.forEach((d, i) => byRoot.set(find(i), [...(byRoot.get(find(i)) ?? []), d]));
    const merged = [...byRoot.values()]
      .filter((ms) => ms.length > 1)
      .map((ms) => ({
        n: ms.length,
        x: Math.round(ms.reduce((t, d) => t + d.x, 0) / ms.length),
        y: Math.round(ms.reduce((t, d) => t + d.y, 0) / ms.length),
        members: ms,
      }));
    // A numbered pin under the zoom buttons is not drawn, like a sign under a panel (judge, 19 Nov 2026).
    const underControls = (g: { x: number; y: number }) =>
      this.controls.some((c) => g.x - 12 < c.x + c.w + 2 && g.x + 12 > c.x - 2 && g.y - 25 < c.y + c.h + 2 && g.y > c.y - 2);
    const inGroup = new Set(merged.flatMap((g) => g.members));
    merged.splice(0, merged.length, ...merged.filter((g) => !underControls(g)));
    const solo = drawn.filter((d) => !inGroup.has(d));
    ctx.canvas.dataset.clusters = JSON.stringify(merged.map((g) => [g.x, g.y, g.n])); // read by e2e/map.spec.ts
    ctx.canvas.dataset.zoom = String(z);
    // Draw back to front: low-ranked dots first, then the numbered pins (over a neighbour's dot, so a tap on one reaches
    // it), then named signs, the selected sign last.
    const back = solo.reverse();
    for (const d of back) if (!d.full) this.drawSign(ctx, d.m, d.x, d.y, false, now, W - this.safe.right - 4);
    for (const g of merged) this.drawCluster(ctx, g.x, g.y, g.n);
    for (const d of back) if (d.full) this.drawSign(ctx, d.m, d.x, d.y, true, now, W - this.safe.right - 4);
  }

  /** A numbered pin for places too close to tell apart at this zoom. */
  private drawCluster(ctx: CanvasRenderingContext2D, x: number, y: number, n: number): void {
    const ink = '#2b2733';
    ctx.fillStyle = ink;
    ctx.fillRect(x - 1, y - 8, 2, 8);
    pxCircle(ctx, x, y - 13, 10, ink);
    pxCircle(ctx, x, y - 13, 9, '#fffaf0');
    ctx.fillStyle = ink;
    ctx.font = '700 12px "Pixelify Sans", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), x, y - 12);
    ctx.textAlign = 'start';
    this.hits.push({ id: `${CLUSTER}${x},${y}`, x: x - 12, y: y - 25, w: 24, h: 26 });
  }

  private michelinWidth(ctx: CanvasRenderingContext2D, m: Marker, small = false): number {
    ctx.font = small ? '700 11px "Pixelify Sans", ui-monospace, monospace' : '700 12px "Pixelify Sans", ui-monospace, monospace';
    return Math.ceil(ctx.measureText(michelinMark(m)!).width) + (small ? 6 : 10);
  }

  /** Stars: white on MICHELIN red. Bib: red on cream with a red edge, so the two never look alike. */
  private drawMichelin(ctx: CanvasRenderingContext2D, m: Marker, x: number, y: number, small: boolean): void {
    const w = this.michelinWidth(ctx, m, small);
    const h = small ? 13 : 14;
    const bib = m.michelin === 'bib';
    pxBox(ctx, x, y, w, h, MICHELIN_RED, bib ? '#fffaf0' : MICHELIN_RED);
    ctx.fillStyle = bib ? MICHELIN_RED : '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(michelinMark(m)!, x + (small ? 3 : 5), y + h / 2 + 1);
  }

  /** `right`: the screen x a pin's MICHELIN tag must stay left of (the screen edge or a panel). */
  private drawSign(ctx: CanvasRenderingContext2D, m: Marker, x: number, y: number, full: boolean, now: number, right: number): void {
    const sel = m.id === this.selected;
    const hov = m.id === this.hovered;
    const ink = '#2b2733';
    if (!full) {
      // A small pin: a coloured stud on a post.
      const r = sel || hov ? 6 : 5;
      ctx.fillStyle = ink;
      ctx.fillRect(x - 1, y - 8, 2, 8);
      pxCircle(ctx, x, y - 10, r + 1, ink);
      pxCircle(ctx, x, y - 10, r, m.dim ? '#d9d5df' : m.colour);
      ctx.fillStyle = '#ffffff88';
      ctx.fillRect(x - 2, y - 13, 2, 2);
      // MICHELIN stays visible zoomed out: a small red tag beside the stud, on its left when the right runs off screen.
      if (m.michelin && !m.dim) {
        const tw = this.michelinWidth(ctx, m, true);
        this.drawMichelin(ctx, m, x + r + 1 + tw > right ? x - r - 1 - tw : x + r + 1, y - 21, true);
      }
      this.hits.push({ id: m.id, x: x - 9, y: y - 20, w: 18, h: 22 });
      return;
    }
    ctx.font = '600 13px "Pixelify Sans", ui-monospace, monospace';
    const name = m.name;
    const nw = Math.ceil(ctx.measureText(name).width);
    ctx.font = '500 12px "Pixelify Sans", ui-monospace, monospace';
    const bw = Math.ceil(ctx.measureText(m.badge).width) + 10;
    const mw = m.michelin ? this.michelinWidth(ctx, m) + 4 : 0;
    const w = nw + mw + bw + 20;
    const h = 22;
    const bob = sel && !this.reducedMotion ? bobAt(now) : 0;
    const left = Math.round(x - w / 2);
    const top = y - 32 + bob;
    // Post and shadow.
    ctx.fillStyle = ink;
    ctx.fillRect(x - 1, top + h, 2, 10 - bob);
    ctx.fillStyle = '#2b273340';
    ctx.fillRect(left + 2, top + 3, w, h);
    // Board with notched corners.
    pxBox(ctx, left, top, w, h, ink, m.dim ? '#f1eee8' : '#fffaf0');
    // Status stud, name, badge.
    pxCircle(ctx, left + 10, top + h / 2, 4, m.dim ? '#d9d5df' : m.colour);
    ctx.fillStyle = m.dim ? DIM_INK : ink; // 4.5:1 or more on the dimmed board (#8b8794 was 3.0:1)
    ctx.font = '600 13px "Pixelify Sans", ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, left + 18, top + h / 2 + 1);
    if (m.michelin) this.drawMichelin(ctx, m, left + 18 + nw + 4, top + 4, false);
    const edge = m.dim ? '#c9c5cf' : m.colour;
    pxBox(ctx, left + 18 + nw + mw + 4, top + 4, bw, h - 8, edge, m.hollow ? '#fffaf0' : edge);
    ctx.fillStyle = ink; // dark violet on every badge: white on green was 2.8:1
    ctx.font = '500 12px "Pixelify Sans", ui-monospace, monospace';
    ctx.fillText(m.badge, left + 18 + nw + mw + 9, top + h / 2 + 1);
    if (sel || hov) {
      ctx.strokeStyle = sel ? '#ffcf4a' : '#2b273380';
      ctx.lineWidth = 2;
      ctx.strokeRect(left - 3, top - 3, w + 6, h + 6);
    }
    this.hits.push({ id: m.id, x: left, y: top, w, h: h + 10 });
  }

  // ── input ────────────────────────────────────────────────────────────────

  private hitAt(clientX: number, clientY: number): string | null {
    const r = this.canvas.getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top;
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i]!;
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h.id;
    }
    return null;
  }

  private bindInput(): void {
    const el = this.canvas;
    const pointers = new Map<number, { x: number; y: number }>();
    let moved = 0;
    let pinch: { d: number; z: number } | null = null;
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = 0;
      this.target = null;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), z: this.cam.z };
      }
    });
    el.addEventListener('pointermove', (e) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) {
        const id = this.hitAt(e.clientX, e.clientY);
        if (id !== this.hovered) {
          this.hovered = id;
          el.style.cursor = id ? 'pointer' : 'grab';
          this.dirty = true;
        }
        return;
      }
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2 && pinch) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        this.cam.z = Math.max(ZOOMS[0]!, Math.min(ZOOMS.at(-1)!, (pinch.z * d) / pinch.d));
        moved += 10;
      } else {
        this.cam = this.clamp({ x: this.cam.x - dx / this.cam.z, y: this.cam.y - dy / this.cam.z, z: this.cam.z });
        moved += Math.abs(dx) + Math.abs(dy);
      }
      el.style.cursor = 'grabbing';
      this.dirty = true;
      this.onCamera(this.cam);
    });
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pinch && pointers.size < 2) {
        pinch = null;
        // Settle on the nearest crisp zoom.
        const near = ZOOMS.reduce((a, b) => (Math.abs(Math.log(b / this.cam.z)) < Math.abs(Math.log(a / this.cam.z)) ? b : a));
        this.zoomTo(near);
        return;
      }
      el.style.cursor = this.hovered ? 'pointer' : 'grab';
      if (moved < 6 && e.type === 'pointerup') {
        const id = this.hitAt(e.clientX, e.clientY);
        if (id?.startsWith(CLUSTER)) {
          this.zoomBy(1, { x: e.clientX, y: e.clientY });
          return;
        }
        this.selected = id;
        this.onSelect(id);
        this.dirty = true;
      }
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        // Trackpads send many small steps: add them up, one zoom step per notch.
        this.wheelAcc += e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
        if (Math.abs(this.wheelAcc) < 60) return;
        this.zoomBy(this.wheelAcc < 0 ? 1 : -1, { x: e.clientX, y: e.clientY });
        this.wheelAcc = 0;
      },
      { passive: false },
    );
    el.addEventListener('dblclick', (e) => this.zoomBy(1, { x: e.clientX, y: e.clientY }));
  }

  /** Keyboard panning, for people who do not use a mouse. */
  pan(dx: number, dy: number): void {
    const z = this.target?.z ?? this.cam.z;
    this.flyTo((this.target?.x ?? this.cam.x) + dx / z, (this.target?.y ?? this.cam.y) + dy / z, z);
  }
}

function pxCircle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, colour: string): void {
  ctx.fillStyle = colour;
  for (let y = -r; y <= r; y++) {
    const half = Math.floor(Math.sqrt(r * r - y * y + r * 0.6));
    ctx.fillRect(Math.round(cx - half), Math.round(cy + y), half * 2, 1);
  }
}

/** A box with 2 px borders and notched corners, the house style of every panel and sign. */
export function pxBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, border: string, fill: string): void {
  ctx.fillStyle = border;
  ctx.fillRect(x + 2, y, w - 4, h);
  ctx.fillRect(x, y + 2, w, h - 4);
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  ctx.fillStyle = fill;
  ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
}
