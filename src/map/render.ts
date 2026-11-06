// Draws the map on a canvas: the city (sezlab's images, the level that fits the zoom, loaded as the view needs them)
// and a sign over every restaurant.
import { World } from './world';

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
  dim: boolean;
}

/** Crisp zooms: at each one the chosen image level is shown at a whole multiple of its pixels. */
const ZOOMS = [0.125, 0.25, 0.5, 1, 2, 3, 4];
const MAX_IMAGES = 48;
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

/**
 * The fog-over-art mask: opaque where the art is transparent, and also on art within a ragged distance of it or of
 * the image's edge. The distance limit follows smooth noise, so the fringe has the shape of cloud, in whole pixels.
 */
export function fogEdgeIndex(alpha: Uint8Array, w: number, h: number, reach = FOG_REACH): Uint8Array {
  const dist = new Uint8Array(w * h).fill(255);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < w * h; i++) {
    const x = i % w;
    const y = (i / w) | 0;
    if (!alpha[i]) dist[i] = 0;
    else if (x === 0 || y === 0 || x === w - 1 || y === h - 1) dist[i] = 1;
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
  for (let i = 0; i < w * h; i++) {
    const x = i % w;
    const y = (i / w) | 0;
    const n = 0.5 + 0.25 * Math.sin(x * 0.03 + Math.sin(y * 0.02) * 2) + 0.25 * Math.sin(y * 0.026 + Math.sin(x * 0.013) * 2);
    out[i] = dist[i]! <= Math.round(1 + n * (reach - 1)) ? 1 : 0;
  }
  return out;
}

function fogEdgeMask(img: HTMLImageElement): HTMLCanvasElement {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, w, h);
  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = data.data[i * 4 + 3]! > 0 ? 1 : 0;
  const fog = fogEdgeIndex(alpha, w, h);
  for (let i = 0; i < w * h; i++) {
    data.data.set(fog[i] ? [0, 0, 0, 255] : [0, 0, 0, 0], i * 4);
  }
  g.putImageData(data, 0, 0);
  return c;
}

interface Tile {
  img: HTMLImageElement;
  ok: boolean;
  failed: boolean;
}

export class MapView {
  readonly ctx: CanvasRenderingContext2D;
  /** Camera centre in world pixels and zoom (CSS pixels per world pixel). */
  cam = { x: 0, y: 0, z: 0.25 };
  target: { x: number; y: number; z: number } | null = null;
  private fog: CanvasPattern | null = null;
  /** Where fog covers the art's edge, one pixel per overview pixel (built once the overview has loaded). */
  private fogMask: HTMLCanvasElement | null = null;
  private fogScratch: HTMLCanvasElement | null = null;
  private dpr = 1;
  private overview: Tile;
  private tiles = new Map<string, Tile>();
  /** Images the current view shows but has not got yet. Tests wait for 0. */
  private waiting = 0;
  private markers: Marker[] = [];
  /** Where you are, in world pixels, when "Near me" knows it. */
  private you: { x: number; y: number } | null = null;
  private hits: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];
  private raf = 0;
  private dirty = true;
  private last = performance.now();
  selected: string | null = null;
  hovered: string | null = null;
  onSelect: (id: string | null) => void = () => {};
  onCamera: (cam: { x: number; y: number; z: number }) => void = () => {};
  reducedMotion = false;
  /** Screen areas covered by panels: signs there shrink to pins. */
  safe = { top: 0, right: 0, bottom: 0, left: 0 };
  private home = { x: 0, y: 0, z: 0.5 };
  private wheelAcc = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly world: World,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    const dam = world.project(52.3731, 4.8926);
    this.cam = { x: dam.x, y: dam.y, z: 0.5 };
    this.home = { ...this.cam };
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.overview = this.load(world.level(2).url(0, 0));
    this.bindInput();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.loop();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
  }

  // ── public ───────────────────────────────────────────────────────────────

  setMarkers(markers: Marker[]): void {
    this.markers = markers;
    this.dirty = true;
  }

  setYou(p: { x: number; y: number } | null): void {
    this.you = p;
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
    return { x: Math.max(0, Math.min(this.world.width, p.x)), y: Math.max(0, Math.min(this.world.height, p.y)), z };
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
    return this.waiting + (this.overview.ok || this.overview.failed ? 0 : 1);
  }

  // ── frame ────────────────────────────────────────────────────────────────

  private resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
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
    const bobbing = (!!this.selected || !!this.you) && !this.reducedMotion;
    if (this.dirty || moving || bobbing) this.draw(now);
    this.dirty = false;
  };

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
   * His art ends in straight cuts in places (the edge of his images, the steps of his chunk grid). Fog reaches over
   * every edge of the art by a ragged few pixels, so the edge reads as cloud and not as a broken image. Drawn on top;
   * his images themselves are untouched.
   */
  private drawFogEdge(x: number, y: number, w: number, h: number): void {
    if (!this.fog || !this.overview.ok) return;
    this.fogMask ??= fogEdgeMask(this.overview.img);
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
    g.drawImage(this.fogMask, Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = this.fog;
    g.fillRect(0, 0, sc.width / dpr, sc.height / dpr);
    this.ctx.drawImage(sc, 0, 0, sc.width / dpr, sc.height / dpr);
  }

  private drawLevel(L: 'hi' | 0 | 1, toX: (x: number) => number, toY: (y: number) => number, W: number, H: number): number {
    const { span, has, url } = this.world.level(L);
    const z = this.cam.z;
    const x0 = Math.max(0, Math.floor((this.cam.x - W / 2 / z) / span));
    const y0 = Math.max(0, Math.floor((this.cam.y - H / 2 / z) / span));
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
        // Whole pixels, so neighbouring chunks meet without a seam.
        const sx = Math.round(toX(cx * span));
        const sy = Math.round(toY(cy * span));
        const ex = Math.round(toX(cx * span + (t.img.width / this.world.level(L).k)));
        const ey = Math.round(toY(cy * span + (t.img.height / this.world.level(L).k)));
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
    this.fog ??= ctx.createPattern(fogCanvas(), 'repeat');
    if (this.fog) {
      const tile = 256 * FOG_PX;
      const ox = ((((-cam.x * z + W / 2) * 0.5) % tile) + tile) % tile;
      const oy = ((((-cam.y * z + H / 2) * 0.5) % tile) + tile) % tile;
      this.fog.setTransform(new DOMMatrix().translate(Math.round(ox), Math.round(oy)).scale(FOG_PX));
      ctx.fillStyle = this.fog;
    } else ctx.fillStyle = FOG_TONES[2]!;
    ctx.fillRect(0, 0, W, H);
    const toX = (wx: number) => (wx - cam.x) * z + W / 2;
    const toY = (wy: number) => (wy - cam.y) * z + H / 2;

    // The overview underneath everything: it shows while chunks load, and alone when far away.
    if (this.overview.ok) {
      ctx.imageSmoothingEnabled = z < 0.125;
      ctx.drawImage(this.overview.img, Math.round(toX(0)), Math.round(toY(0)), Math.round(this.world.width * z), Math.round(this.world.height * z));
      ctx.imageSmoothingEnabled = false;
    }
    // The level whose pixels are at least as fine as the screen's, so images are only ever enlarged.
    let waiting = 0;
    if (z >= 1) {
      this.drawLevel(0, toX, toY, W, H); // under the sharpest: it fills where a sharp chunk is missing or loading
      waiting = this.drawLevel('hi', toX, toY, W, H);
    } else if (z >= 0.5) waiting = this.drawLevel(0, toX, toY, W, H);
    else if (z >= 0.25) waiting = this.drawLevel(1, toX, toY, W, H);
    this.waiting = waiting;
    this.drawFogEdge(toX(0), toY(0), this.world.width * z, this.world.height * z);
    if (this.you) this.drawYou(ctx, Math.round(toX(this.you.x)), Math.round(toY(this.you.y)), now);
    this.drawMarkers(ctx, toX, toY, W, H, now);
  }

  /** You are here: a blue dot with a ring that breathes (still when motion is reduced). */
  private drawYou(ctx: CanvasRenderingContext2D, x: number, y: number, now: number): void {
    const r = this.reducedMotion ? 9 : 8 + Math.round((Math.sin(now / 400) + 1) * 2);
    pxCircle(ctx, x, y, r, '#2d6fb544');
    pxCircle(ctx, x, y, 6, '#ffffff');
    pxCircle(ctx, x, y, 4, '#2d6fb5');
  }

  // ── signs ────────────────────────────────────────────────────────────────

  private drawMarkers(ctx: CanvasRenderingContext2D, toX: (x: number) => number, toY: (y: number) => number, W: number, H: number, now: number): void {
    this.hits = [];
    const z = this.cam.z;
    const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
    const overlaps = (r: { x: number; y: number; w: number; h: number }) =>
      placed.some((o) => r.x < o.x + o.w + 2 && r.x + r.w + 2 > o.x && r.y < o.y + o.h + 2 && r.y + r.h + 2 > o.y);
    const order = [...this.markers].sort((a, b) => {
      const pa = a.id === this.selected ? 1e9 : a.id === this.hovered ? 1e8 : a.rank;
      const pb = b.id === this.selected ? 1e9 : b.id === this.hovered ? 1e8 : b.rank;
      return pb - pa;
    });
    const drawn: Array<{ m: Marker; x: number; y: number; full: boolean }> = [];
    for (const m of order) {
      const x = Math.round(toX(m.ax));
      const y = Math.round(toY(m.ay));
      if (x < -120 || y < -60 || x > W + 120 || y > H + 60) continue;
      // Names from the city view in; zoomed further out only free places keep theirs. Crowded names shrink to pins.
      const showName = z >= 0.25 || m.id === this.selected || m.id === this.hovered || (z >= 0.125 && m.rank >= 300);
      const full = showName;
      ctx.font = '600 13px "Pixelify Sans", ui-monospace, monospace';
      const label = full ? `${m.name}  ${m.badge}` : m.badge;
      const tw = Math.ceil(ctx.measureText(label).width);
      const bw = full ? tw + 26 : Math.max(22, tw + 18);
      const rect = { x: x - bw / 2, y: y - 30, w: bw, h: 22 };
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
    // Draw back to front: low-ranked dots first, the selected sign last.
    for (const d of drawn.reverse()) this.drawSign(ctx, d.m, d.x, d.y, d.full, now);
  }

  private drawSign(ctx: CanvasRenderingContext2D, m: Marker, x: number, y: number, full: boolean, now: number): void {
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
      this.hits.push({ id: m.id, x: x - 9, y: y - 20, w: 18, h: 22 });
      return;
    }
    ctx.font = '600 13px "Pixelify Sans", ui-monospace, monospace';
    const name = m.name;
    const nw = Math.ceil(ctx.measureText(name).width);
    ctx.font = '500 12px "Pixelify Sans", ui-monospace, monospace';
    const bw = Math.ceil(ctx.measureText(m.badge).width) + 10;
    const w = nw + bw + 20;
    const h = 22;
    const bob = sel && !this.reducedMotion ? Math.round(Math.sin(now / 260) * 1.5) : 0;
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
    ctx.fillStyle = m.dim ? '#8b8794' : ink;
    ctx.font = '600 13px "Pixelify Sans", ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, left + 18, top + h / 2 + 1);
    pxBox(ctx, left + 18 + nw + 4, top + 4, bw, h - 8, m.dim ? '#c9c5cf' : m.colour, m.dim ? '#c9c5cf' : m.colour);
    ctx.fillStyle = '#ffffff';
    ctx.font = '500 12px "Pixelify Sans", ui-monospace, monospace';
    ctx.fillText(m.badge, left + 18 + nw + 9, top + h / 2 + 1);
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
