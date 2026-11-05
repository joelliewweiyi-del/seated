// Draws the city on a canvas: a far-away overview, chunks of painted tiles near by (cached, two levels of
// detail), little lives on the streets and canals, and a sign over every restaurant.
import type { FromWorker, ToWorker } from './chunk-worker';
import { MARGIN, N, paintChunk } from './chunks';
import { hash, mix, Pix } from './pix';
import { overviewColour, PAL, type Special } from './paint';
import { F, HEAD, T, TH, TW, World } from './world';

export interface Marker {
  id: string;
  name: string;
  tx: number;
  ty: number;
  /** Anchor at zoom 1: the top of the restaurant's building. */
  ax: number;
  ay: number;
  colour: string;
  /** Short text on the sign: "3 free", "full", "opens 5 Nov". */
  badge: string;
  /** Higher draws first and keeps its label when signs crowd. */
  rank: number;
  dim: boolean;
}

const OVERVIEW = 8; // world pixels per overview pixel
const ZOOMS = [0.125, 0.25, 0.5, 1, 2, 3, 4];
const MAX_L1 = 56;
const MAX_L2 = 180;

type ChunkKey = number;
const keyOf = (cx: number, cy: number) => cx * 4096 + cy;

interface Agent {
  kind: 'bike' | 'walker' | 'boat' | 'tram' | 'ferry';
  x: number;
  y: number;
  /** Direction as a unit step on the grid. */
  dx: number;
  dy: number;
  /** 0..1 along the current tile step. */
  t: number;
  speed: number;
  colour: string;
  seed: number;
}

export class MapView {
  readonly ctx: CanvasRenderingContext2D;
  /** Camera centre in world pixels (zoom 1) and zoom (CSS pixels per world pixel). */
  cam = { x: 0, y: 0, z: 0.25 };
  private target: { x: number; y: number; z: number } | null = null;
  private dpr = 1;
  private overview: HTMLCanvasElement | null = null;
  private l1 = new Map<ChunkKey, HTMLCanvasElement>();
  private l2 = new Map<ChunkKey, HTMLCanvasElement>();
  /** Chunks the current view still needs, nearest first. Rebuilt every frame, so a fly-over never paints stale ones. */
  private queue: Array<{ cx: number; cy: number; level: 1 | 2 }> = [];
  private workers: Worker[] = [];
  private busy = new Map<Worker, number>();
  private inflight = new Set<string>();
  private jobs = new Map<number, { key: ChunkKey; level: 1 | 2; version: number; id: string }>();
  private versions = new Map<ChunkKey, number>();
  private jobId = 0;
  private specials = new Map<number, Special>();
  private chunkOfSpecial = new Map<number, ChunkKey>();
  private markers: Marker[] = [];
  private hits: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];
  private agents: Agent[] = [];
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
    const dam = world.tileOf(52.3702, 4.8952);
    const centre = world.screenOf(dam.x, dam.y);
    this.cam = { x: centre.sx, y: centre.sy, z: 0.5 };
    this.home = { ...this.cam };
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.buildOverview();
    this.startWorkers();
    this.bindInput();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.loop();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    for (const w of this.workers) w.terminate();
  }

  // ── public ───────────────────────────────────────────────────────────────

  setMarkers(markers: Marker[]): void {
    this.markers = markers;
    this.dirty = true;
  }

  /** Restaurant storefronts for the chosen day. Only chunks whose storefront changed are painted again. */
  setSpecials(next: Map<number, Special>): void {
    const changed = new Set<ChunkKey>();
    const same = (a?: Special, b?: Special) => a?.awning === b?.awning && a?.lit === b?.lit;
    for (const idx of new Set([...this.specials.keys(), ...next.keys()])) {
      if (same(this.specials.get(idx), next.get(idx))) continue;
      const x = idx % this.world.cols;
      const y = Math.floor(idx / this.world.cols);
      changed.add(keyOf(Math.floor(x / N), Math.floor(y / N)));
    }
    this.specials = next;
    for (const k of changed) {
      this.l1.delete(k);
      this.l2.delete(k);
      this.versions.set(k, (this.versions.get(k) ?? 0) + 1);
    }
    this.dirty = true;
  }

  /** Back to the first view. */
  reset(z?: number): void {
    this.flyTo(this.home.x, this.home.y, z ?? this.home.z);
  }

  setHomeZoom(z: number): void {
    this.home.z = z;
    this.cam.z = z;
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

  /** Top of the building on a tile, at zoom 1. */
  anchorOf(tx: number, ty: number): { ax: number; ay: number } {
    const { sx, sy } = this.world.screenOf(tx, ty);
    return { ax: sx, ay: sy + TH / 2 - this.world.heightPx(tx, ty) - 4 };
  }

  /** Chunks still to paint for the current view. Tests wait for 0. */
  pending(): number {
    return this.queue.filter((j) => !(j.level === 1 ? this.l1 : this.l2).has(keyOf(j.cx, j.cy))).length + this.inflight.size;
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
    const alive = !this.reducedMotion && this.cam.z >= 0.75;
    if (alive) this.stepAgents(dt);
    const worked = this.work(now);
    if (this.dirty || moving || alive || worked) this.draw(now);
    this.dirty = false;
  };

  /** Hands visible chunks to the painter workers (or paints on this thread when there are none). */
  private work(start: number): boolean {
    let did = false;
    for (const job of this.queue) {
      const id = `${job.cx},${job.cy},${job.level}`;
      if (this.inflight.has(id)) continue;
      const k = keyOf(job.cx, job.cy);
      if ((job.level === 1 ? this.l1 : this.l2).has(k)) continue;
      if (this.workers.length) {
        const free = this.workers.find((w) => (this.busy.get(w) ?? 0) < 2);
        if (!free) break;
        const jobId = ++this.jobId;
        this.jobs.set(jobId, { key: k, level: job.level, version: this.versions.get(k) ?? 0, id });
        this.inflight.add(id);
        this.busy.set(free, (this.busy.get(free) ?? 0) + 1);
        const [x0, y0, size] = [job.cx * N - MARGIN, job.cy * N - MARGIN, N + MARGIN * 2];
        const bytes = this.world.slice(x0, y0, size, size).buffer as ArrayBuffer;
        free.postMessage(
          { type: 'paint', id: jobId, cx: job.cx, cy: job.cy, level: job.level, specials: this.specialsIn(job.cx, job.cy), slice: { x0, y0, w: size, h: size, bytes } } satisfies ToWorker,
          [bytes],
        );
      } else {
        if (performance.now() - start > 10) break;
        const pix = paintChunk(this.world, job.cx, job.cy, new Map(this.specialsIn(job.cx, job.cy)), job.level);
        this.store(k, job.level, pix.toCanvas());
        did = true;
      }
    }
    return did;
  }

  private specialsIn(cx: number, cy: number): Array<[number, Special]> {
    const out: Array<[number, Special]> = [];
    for (const [idx, sp] of this.specials) {
      const x = idx % this.world.cols;
      const y = Math.floor(idx / this.world.cols);
      if (Math.floor(x / N) === cx && Math.floor(y / N) === cy) out.push([idx, sp]);
    }
    return out;
  }

  private store(k: ChunkKey, level: 1 | 2, img: HTMLCanvasElement): void {
    const cache = level === 1 ? this.l1 : this.l2;
    cache.set(k, img);
    if (cache.size > (level === 1 ? MAX_L1 : MAX_L2)) cache.delete(cache.keys().next().value!);
    this.dirty = true;
  }

  private startWorkers(): void {
    const count = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
    try {
      for (let i = 0; i < count; i++) {
        const w = new Worker(new URL('./chunk-worker.ts', import.meta.url), { type: 'module' });
        w.postMessage({ type: 'init', meta: this.world.meta } satisfies ToWorker);
        w.onmessage = (e: MessageEvent<FromWorker>) => {
          const r = e.data;
          const job = this.jobs.get(r.id);
          this.jobs.delete(r.id);
          this.busy.set(w, Math.max(0, (this.busy.get(w) ?? 1) - 1));
          if (!job) return;
          this.inflight.delete(job.id);
          if ((this.versions.get(job.key) ?? 0) !== job.version) return; // the storefronts changed meanwhile
          const c = document.createElement('canvas');
          c.width = r.w;
          c.height = r.h;
          c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(r.buffer), r.w, r.h), 0, 0);
          this.store(job.key, job.level, c);
        };
        w.onerror = () => {
          this.workers = this.workers.filter((x) => x !== w);
        };
        this.workers.push(w);
      }
    } catch {
      this.workers = [];
    }
  }

  private buildOverview(): void {
    const w = this.world;
    const ow = Math.ceil(w.width / OVERVIEW);
    const oh = Math.ceil(w.height / OVERVIEW);
    const p = new Pix(ow, oh);
    const bg = PAL.water;
    for (let py = 0; py < oh; py++) {
      for (let px = 0; px < ow; px++) {
        // Four samples per pixel, averaged: one point per pixel turns the dense city into noise.
        const at = (fx: number, fy: number) => {
          const t = w.tileAt((px + fx) * OVERVIEW, (py + fy) * OVERVIEW);
          const x = Math.floor(t.x);
          const y = Math.floor(t.y);
          return w.inside(x, y) ? overviewColour(w, x, y) : bg;
        };
        p.data[py * ow + px] = mix(mix(at(0.25, 0.25), at(0.75, 0.25), 0.5), mix(at(0.25, 0.75), at(0.75, 0.75), 0.5), 0.5);
      }
    }
    this.overview = p.toCanvas();
  }

  private draw(now: number): void {
    const { ctx, canvas, cam, dpr } = this;
    const W = canvas.width / dpr;
    const H = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#6cb4c4';
    ctx.fillRect(0, 0, W, H);
    const z = cam.z;
    const toX = (wx: number) => (wx - cam.x) * z + W / 2;
    const toY = (wy: number) => (wy - cam.y) * z + H / 2;

    // Overview underneath everything: it shows while chunks are being painted, and alone when far away.
    if (this.overview) {
      ctx.imageSmoothingEnabled = z < OVERVIEW / 8 / 2;
      ctx.drawImage(this.overview, toX(0), toY(0), this.overview.width * OVERVIEW * z, this.overview.height * OVERVIEW * z);
      ctx.imageSmoothingEnabled = false;
    }

    if (z >= 0.3) {
      const level: 1 | 2 = z >= 0.75 ? 1 : 2;
      const cache = level === 1 ? this.l1 : this.l2;
      const corners = [
        this.world.tileAt(cam.x - W / 2 / z, cam.y - H / 2 / z),
        this.world.tileAt(cam.x + W / 2 / z, cam.y - H / 2 / z),
        this.world.tileAt(cam.x - W / 2 / z, cam.y + (H / 2 + HEAD) / z),
        this.world.tileAt(cam.x + W / 2 / z, cam.y + (H / 2 + HEAD) / z),
      ];
      const minX = Math.floor(Math.min(...corners.map((c) => c.x)) / N) - 1;
      const maxX = Math.floor(Math.max(...corners.map((c) => c.x)) / N) + 1;
      const minY = Math.floor(Math.min(...corners.map((c) => c.y)) / N) - 1;
      const maxY = Math.floor(Math.max(...corners.map((c) => c.y)) / N) + 1;
      const todo: Array<{ cx: number; cy: number; d: number }> = [];
      for (let s = minX + minY; s <= maxX + maxY; s++) {
        for (let cx = minX; cx <= maxX; cx++) {
          const cy = s - cx;
          if (cy < minY || cy > maxY) continue;
          if (cx < 0 || cy < 0 || cx * N >= this.world.cols || cy * N >= this.world.rows) continue;
          const x0 = cx * N;
          const y0 = cy * N;
          const left = this.world.screenOf(x0, y0 + N - 1).sx - TW / 2;
          const top = (x0 + y0) * (TH / 2);
          const sx = toX(left);
          const sy = toY(top);
          const sw = N * TW * z;
          const sh = (N * TH + HEAD) * z;
          if (sx > W || sy > H || sx + sw < 0 || sy + sh < 0) continue;
          const img = cache.get(keyOf(cx, cy));
          if (img) {
            ctx.drawImage(img, Math.round(sx), Math.round(sy), Math.round(sw), Math.round(sh));
            // LRU: touch.
            cache.delete(keyOf(cx, cy));
            cache.set(keyOf(cx, cy), img);
          } else {
            // While it is painted, the other level stands in: much closer to the real thing than the overview.
            const other = (level === 1 ? this.l2 : this.l1).get(keyOf(cx, cy));
            if (other) ctx.drawImage(other, Math.round(sx), Math.round(sy), Math.round(sw), Math.round(sh));
            todo.push({ cx, cy, d: Math.hypot(sx + sw / 2 - W / 2, sy + sh / 2 - H / 2) });
          }
        }
      }
      // Paint the chunks nearest the centre first.
      todo.sort((a, b) => a.d - b.d);
      this.queue = todo.map((t) => ({ cx: t.cx, cy: t.cy, level }));
      if (level === 1) {
        this.drawGlints(ctx, now, toX, toY, W, H);
        this.drawAgents(ctx, now, toX, toY);
      }
    } else {
      this.queue = [];
    }
    this.drawMarkers(ctx, toX, toY, W, H, now);
  }

  // ── water glints and agents ─────────────────────────────────────────────

  private drawGlints(ctx: CanvasRenderingContext2D, now: number, toX: (x: number) => number, toY: (y: number) => number, W: number, H: number): void {
    if (this.reducedMotion) return;
    const z = this.cam.z;
    const c0 = this.world.tileAt(this.cam.x - W / 2 / z, this.cam.y - H / 2 / z);
    const c1 = this.world.tileAt(this.cam.x + W / 2 / z, this.cam.y + H / 2 / z);
    const span = Math.ceil(Math.hypot(c1.x - c0.x, c1.y - c0.y));
    const mid = this.world.tileAt(this.cam.x, this.cam.y);
    ctx.fillStyle = '#d8f1f3';
    const phase = Math.floor(now / 700);
    for (let k = 0; k < 140; k++) {
      const x = Math.floor(mid.x + (hash(k, phase, 1) - 0.5) * span);
      const y = Math.floor(mid.y + (hash(k, phase, 2) - 0.5) * span);
      if (this.world.terrain(x, y) !== T.water || this.world.flags(x, y) & F.bridge) continue;
      const { sx, sy } = this.world.screenOf(x + hash(k, 3), y + hash(k, 4));
      ctx.fillRect(Math.round(toX(sx)), Math.round(toY(sy)), Math.max(1, 3 * z), Math.max(1, z));
    }
  }

  private spawn(kind: Agent['kind']): Agent | null {
    const W = this.canvas.width / this.dpr;
    const H = this.canvas.height / this.dpr;
    const z = this.cam.z;
    for (let tries = 0; tries < 40; tries++) {
      const t = this.world.tileAt(this.cam.x + (Math.random() - 0.5) * (W / z), this.cam.y + (Math.random() - 0.5) * (H / z));
      const x = Math.floor(t.x);
      const y = Math.floor(t.y);
      if (!this.canWalk(kind, x, y)) continue;
      const dirs = DIRS.filter(([dx, dy]) => this.canWalk(kind, x + dx, y + dy));
      if (!dirs.length) continue;
      const [dx, dy] = dirs[Math.floor(Math.random() * dirs.length)]!;
      const colours = kind === 'boat' ? ['#2f4a3c', '#7a4b2a', '#3b4f6b', '#e9e1cf'] : ['#d9534f', '#3c6e8f', '#e6b33a', '#5b8f4e', '#7a5aa6', '#2b2733'];
      return {
        kind,
        x,
        y,
        dx,
        dy,
        t: Math.random(),
        // Cells per second: cells are 4 m, so a bike does about 5 m/s.
        speed: { bike: 1.4, walker: 0.45, boat: 0.35, tram: 1.1, ferry: 0.5 }[kind] * 4 * (0.8 + Math.random() * 0.4),
        colour: colours[Math.floor(Math.random() * colours.length)]!,
        seed: Math.random() * 1000,
      };
    }
    return null;
  }

  private canWalk(kind: Agent['kind'], x: number, y: number): boolean {
    const t = this.world.terrain(x, y);
    const f = this.world.flags(x, y);
    if (!this.world.inside(x, y) || this.world.isBuilt(x, y)) return false;
    switch (kind) {
      case 'bike':
        return t === T.street || t === T.road || !!(f & F.bridge);
      case 'walker':
        return t === T.street || t === T.square || t === T.park || t === T.pavement || !!(f & F.bridge);
      case 'boat':
        return t === T.water && !(f & (F.ferry | F.bridge));
      case 'tram':
        return !!(f & F.tram);
      case 'ferry':
        return !!(f & F.ferry);
    }
  }

  private stepAgents(dt: number): void {
    const small = this.canvas.clientWidth < 700;
    const want = small ? { bike: 12, walker: 8, boat: 5, tram: 2, ferry: 1 } : { bike: 26, walker: 18, boat: 10, tram: 3, ferry: 2 };
    for (const kind of Object.keys(want) as Array<Agent['kind']>) {
      const have = this.agents.filter((a) => a.kind === kind).length;
      for (let i = have; i < want[kind]; i++) {
        const a = this.spawn(kind);
        if (a) this.agents.push(a);
        else break;
      }
    }
    const W = this.canvas.width / this.dpr;
    const H = this.canvas.height / this.dpr;
    const z = this.cam.z;
    this.agents = this.agents.filter((a) => {
      a.t += a.speed * dt;
      while (a.t >= 1) {
        a.t -= 1;
        a.x += a.dx;
        a.y += a.dy;
        const options = DIRS.filter(([dx, dy]) => this.canWalk(a.kind, a.x + dx, a.y + dy) && !(dx === -a.dx && dy === -a.dy));
        const ahead = options.find(([dx, dy]) => dx === a.dx && dy === a.dy);
        const pick = ahead && Math.random() < 0.8 ? ahead : options[Math.floor(Math.random() * options.length)];
        if (!pick) {
          a.dx = -a.dx;
          a.dy = -a.dy;
        } else [a.dx, a.dy] = pick;
      }
      const { sx, sy } = this.world.screenOf(a.x + 0.5 + a.dx * a.t, a.y + 0.5 + a.dy * a.t);
      const px = (sx - this.cam.x) * z + W / 2;
      const py = (sy - this.cam.y) * z + H / 2;
      return px > -200 && py > -200 && px < W + 200 && py < H + 200;
    });
  }

  private drawAgents(ctx: CanvasRenderingContext2D, now: number, toX: (x: number) => number, toY: (y: number) => number): void {
    const z = this.cam.z;
    const sorted = [...this.agents].sort((a, b) => a.x + a.y - (b.x + b.y));
    for (const a of sorted) {
      const { sx, sy } = this.world.screenOf(a.x + 0.5 + a.dx * a.t, a.y + 0.5 + a.dy * a.t);
      const X = Math.round(toX(sx));
      const Y = Math.round(toY(sy));
      const u = Math.max(1, Math.round(z));
      const frame = Math.floor(now / 160 + a.seed) % 2;
      const facingRight = a.dx > 0 || a.dy < 0;
      const px = (x: number, y: number, w: number, h: number, c: string) => {
        ctx.fillStyle = c;
        ctx.fillRect(X + (facingRight ? x : -x - w) * u, Y + y * u, w * u, h * u);
      };
      if (a.kind === 'walker') {
        px(-1, -7, 2, 2, '#f1c7a5');
        px(-1, -5, 2, 3, a.colour);
        px(frame ? -1 : 0, -2, 1, 2, '#3a3440');
        px(frame ? 0 : -1, -2, 1, 1, '#3a3440');
      } else if (a.kind === 'bike') {
        px(-4, -1, 2, 2, '#2b2733');
        px(2, -1, 2, 2, '#2b2733');
        px(-2, -3, 4, 1, a.colour);
        px(-1, -8, 2, 2, '#f1c7a5');
        px(-1, -6, 2, 3, frame ? a.colour : '#2b2733');
      } else if (a.kind === 'boat') {
        px(-7, -2, 14, 3, a.colour);
        px(-6, -1, 12, 1, '#ffffff33');
        px(-3, -5, 6, 3, '#f4efe4');
        px(-2, -4, 1, 1, '#3f5466');
        px(1, -4, 1, 1, '#3f5466');
        px(-9 + frame, 1, 3, 1, '#d8f1f3');
      } else if (a.kind === 'tram') {
        px(-12, -9, 24, 8, '#f4f1ea');
        px(-12, -5, 24, 2, '#2d6fb5');
        px(-10, -8, 4, 2, '#3f5466');
        px(-4, -8, 4, 2, '#3f5466');
        px(2, -8, 4, 2, '#3f5466');
        px(8, -8, 3, 2, '#3f5466');
        px(-12, -1, 24, 1, '#2b2733');
      } else {
        px(-14, -6, 28, 6, '#f4f1ea');
        px(-14, -2, 28, 2, '#2d6fb5');
        px(-6, -10, 12, 4, '#f4f1ea');
        px(-4, -9, 2, 2, '#3f5466');
        px(1, -9, 2, 2, '#3f5466');
      }
    }
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
      const showName = z >= 0.5 || m.id === this.selected || m.id === this.hovered || (z >= 0.25 && m.rank >= 300);
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

const DIRS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

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
