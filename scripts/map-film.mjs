// Renders the launch film of the map (Joel, 23 Nov 2026: "100x better") frame by frame: a virtual clock drives the map,
// so every frame is sharp and the camera moves at an even 60 fps. Read data.json from the Blob store once (never poll
// seated.food), save it as $F/data-film.json, start a demo server on :4330 (`PORT=4330 npx tsx src/server/main.ts --demo`
// after `npm run build`), then: F=<out dir> node scripts/map-film.mjs. Encode: ffmpeg -framerate 60 -i $F/frames/%05d.png
// -c:v libx264 -crf 16 -pix_fmt yuv420p film.mp4. The camera keys suit the data of 23 Nov 2026 (Flore free on Saturday).
import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';

const F = process.env.F;
const BASE = process.env.BASE ?? 'http://127.0.0.1:4330';
const ONLY = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null; // frames to write, for a quick look
const FPS = 60;
const W = 960, H = 540;

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => {
  localStorage.setItem('seated.map.you', JSON.stringify({ answers: {}, key: null, welcomed: true }));
  localStorage.setItem('seated.map.hello', JSON.stringify({ seen: true }));
  // The virtual clock: the map's loop runs only when the film steps it.
  let t = 1000;
  let id = 0;
  const q = new Map();
  performance.now = () => t;
  window.requestAnimationFrame = (cb) => (q.set(++id, cb), id);
  window.cancelAnimationFrame = (i) => q.delete(i);
  window.__film = {
    step(ms) {
      t += ms;
      const cbs = [...q.values()];
      q.clear();
      for (const cb of cbs) cb(t);
    },
  };
});
const page = await ctx.newPage();
await page.route('**/map/data.json', (r) => r.fulfill({ path: `${F}/data-film.json`, contentType: 'application/json' }));
await page.route('**/map-api/**', (r) => r.abort());
await page.goto(`${BASE}/map/?lens=seated`);
// The map starts only as the clock runs: step it until the signs are in and every image is loaded.
for (let i = 0; ; i++) {
  const ok = await page.evaluate(() => { window.__film.step(1000 / 60); const v = window.seatedMap; return !!v && v.markers?.length > 0 && v.waiting === 0; });
  if (ok && i > 120) break;
  if (i > 3000) throw new Error('the map did not start: no signs after 3000 steps');
  await page.waitForTimeout(10);
}

// Our layer on top: titles, captions, a pixel cursor. Same cream panels and pixel font as the map.
await page.addStyleTag({
  content: `
  .side, .topbar, .zoom, .map-controls, .nudge { transition: none !important; }
  #film { position: fixed; inset: 0; pointer-events: none; z-index: 9999; font-family: var(--px, 'Pixelify Sans'), monospace; color: #2b2733; }
  #film .panel { position: absolute; background: #fffaf0; padding: 14px 20px 16px;
    box-shadow: 0 -2px 0 0 #2b2733, 0 2px 0 0 #2b2733, -2px 0 0 0 #2b2733, 2px 0 0 0 #2b2733, 0 8px 0 0 rgba(29,26,36,.25); }
  #film .title { left: 50%; top: 50%; transform: translate(-50%, -50%); text-align: center; padding: 22px 34px 24px; }
  #film .title b { display: block; font-size: 44px; line-height: 1.1; font-weight: 600; }
  #film .title span { display: block; font-size: 22px; margin-top: 10px; color: #0f766e; }
  #film .cap { left: 28px; bottom: 44px; font-size: 26px; line-height: 1.2; max-width: 560px; }
  #film .cap small { display: block; font-family: system-ui, sans-serif; font-size: 15px; margin-top: 6px; color: #625d6b; }
  #film .veil { inset: 0; position: absolute; background: #fffaf0; }
  #film .end { white-space: nowrap; left: 50%; top: 50%; transform: translate(-50%, -50%); text-align: center; padding: 26px 44px 28px; }
  #film .end img { width: 64px; height: 64px; image-rendering: pixelated; display: block; margin: 0 auto 10px; }
  #film .end b { display: block; font-size: 56px; line-height: 1; }
  #film .end span { display: block; font-size: 22px; margin-top: 12px; color: #0f766e; }
  #film .dot { display: inline-block; width: 18px; height: 18px; background: #3fae5f; box-shadow: 0 0 0 2px #2b2733; margin-right: 10px; vertical-align: -1px; }
  #film .cur { position: absolute; width: 24px; height: 36px; image-rendering: pixelated; }
  #film .ring { position: absolute; width: 10px; height: 10px; border: 3px solid #0f766e; border-radius: 50%; transform: translate(-50%, -50%); }
  `,
});
await page.evaluate(() => {
  const el = document.createElement('div');
  el.id = 'film';
  // A 12 x 18 pixel arrow, ink outline and cream fill.
  const rows = [
    'X...........', 'XX..........', 'XcX.........', 'XccX........', 'XcccX.......', 'XccccX......', 'XcccccX.....',
    'XccccccX....', 'XcccccccX...', 'XccccccccX..', 'XcccccXXXXX.', 'XccXccX.....', 'XcX.XccX....', 'XX..XccX....',
    'X....XccX...', '.....XccX...', '......XX....', '............',
  ];
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 18" shape-rendering="crispEdges">`;
  rows.forEach((r, y) => [...r].forEach((ch, x) => {
    if (ch !== '.') svg += `<rect x="${x}" y="${y}" width="1" height="1" fill="${ch === 'X' ? '#2b2733' : '#fffaf0'}"/>`;
  }));
  svg += '</svg>';
  el.innerHTML = `<div class="veil" id="v" style="opacity:0"></div><div class="panel title" id="t"></div><div class="panel cap" id="c"></div><div class="panel end" id="e"></div>
    <div class="ring" id="r"></div><img class="cur" id="k" src="data:image/svg+xml;base64,${btoa(svg)}">`;
  document.body.appendChild(el);
});

// Hide the chrome we bring in later.
const set = (fn, arg) => page.evaluate(fn, arg);
await set(() => {
  for (const s of ['.side', '.topbar', '.zoom, .controls, .map-controls']) document.querySelectorAll(s).forEach((n) => (n.style.opacity = '0'));
});
const zoomCtl = await page.evaluate(() => {
  // The zoom buttons: hidden for the film (the credit stays).
  const btns = [...document.querySelectorAll('button')].filter((b) => ['+', '−', '-', '⌂'].includes(b.textContent.trim()) || /zoom|home/i.test(b.getAttribute('aria-label') ?? ''));
  btns.forEach((b) => (b.style.visibility = 'hidden'));
  return btns.length;
});

const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const lerp = (a, b, k) => a + (b - a) * k;
const camAt = (a, b, k) => k >= 1 ? { ...b } : k <= 0 ? { ...a } : ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: Math.exp(lerp(Math.log(a.z), Math.log(b.z), k)) });

const flore = await page.evaluate(() => { const m = window.seatedMap.markers.find((x) => x.id === 'flore'); return { x: m.ax, y: m.ay }; });

// Camera keys (world pixels). The canal belt sits around Flore.
const C0 = { x: flore.x + 900, y: flore.y - 500, z: 0.125 };
const C1 = { x: flore.x + 300, y: flore.y - 150, z: 0.19 };
const C2 = { x: 11128 - 260, y: 5212 + 90, z: 0.16 };
const C3 = { x: 11128 + 220, y: 5212 - 60, z: 0.15 };
const C5 = { x: flore.x + 200, y: flore.y - 200, z: 0.125 };

let frame = 0;
let manual = true;
const out = `${F}/frames`;
if (!ONLY) { rmSync(out, { recursive: true, force: true }); }
mkdirSync(out, { recursive: true });

async function shoot(state) {
  await page.evaluate(({ cam, manual, ui }) => {
    const v = window.seatedMap;
    if (manual && cam) {
      v.target = null;
      v.cam = cam;
      v.dirty = true;
      v.onCamera(v.cam);
    }
    const $ = (id) => document.getElementById(id);
    const show = (id, html, a) => { const n = $(id); if (html != null) n.innerHTML = html; n.style.opacity = String(a); n.style.display = a > 0 ? '' : 'none'; };
    show('t', ui.t, ui.ta);
    show('c', ui.c, ui.ca);
    show('e', ui.e, ui.ea);
    $('v').style.opacity = String((ui.veil ?? 0) * 0.55);
    const k = $('k');
    k.style.display = ui.cur ? '' : 'none';
    if (ui.cur) { k.style.left = `${ui.cur.x}px`; k.style.top = `${ui.cur.y}px`; }
    const r = $('r');
    r.style.display = ui.ring ? '' : 'none';
    if (ui.ring) { r.style.left = `${ui.ring.x}px`; r.style.top = `${ui.ring.y}px`; r.style.width = r.style.height = `${ui.ring.s}px`; r.style.opacity = String(ui.ring.a); }
    document.querySelectorAll('.topbar').forEach((n) => (n.style.opacity = String(ui.top)));
    document.querySelectorAll('.side').forEach((n) => (n.style.opacity = String(ui.side)));
    window.__film.step(1000 / 60);
  }, { cam: state.cam, manual, ui: state.ui });
  // Every image the view needs is in before the frame is taken: no half-drawn tiles.
  await page.waitForFunction(() => window.seatedMap.waiting === 0, null, { timeout: 30000, polling: 30 }).catch(() => {});
  await page.evaluate(() => window.__film.step(0));
  if (!ONLY || ONLY.includes(frame)) await page.screenshot({ path: `${out}/${String(frame).padStart(5, '0')}.png`, animations: 'disabled', caret: 'hide' });
  frame++;
}

const UI = (o = {}) => ({ t: null, ta: 0, c: null, ca: 0, e: null, ea: 0, cur: null, ring: null, top: 0, side: 0, ...o });
const fade = (t, a, b, f = 0.35) => clamp01(Math.min((t - a) / f, (b - t) / f));
const secs = (s) => Math.round(s * FPS);

// The screen point of a world point under a camera.
const screenOf = (p, cam) => ({ x: (p.x - cam.x) * cam.z + W / 2, y: (p.y - cam.y) * cam.z + H / 2 });

// Scene 1 (0 to 4.2 s): the whole city, a title.
const T1 = `<b>Every good table in Amsterdam.</b><span>On one map.</span>`;
for (let i = 0; i < secs(4.2); i++) {
  const t = i / FPS;
  await shoot({ cam: camAt(C0, C1, ease(clamp01(t / 4.2))), ui: UI({ t: T1, ta: fade(t, 0.2, 3.9, 0.4) }) });
}

// Scene 2 (4.2 to 8.2 s): into the canal belt. Monday night: everything full.
const CAP2 = `Monday night: nothing left.<small>Every sign is a restaurant, read from its own booking calendar.</small>`;
for (let i = 0; i < secs(4); i++) {
  const t = i / FPS;
  await shoot({ cam: camAt(C1, C2, ease(clamp01(t / 2.6))), ui: UI({ c: CAP2, ca: fade(t, 1.4, 3.9, 0.3), top: clamp01((t - 2.2) / 0.5) }) });
}

// Scene 3 (8.2 to 13 s): the cursor taps Sat; the signs turn green while the camera drifts along the belt.
const sat = await page.evaluate(() => { const b = [...document.querySelectorAll('.topbar button')].find((x) => x.textContent.trim() === 'Sat'); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
const from = { x: W * 0.62, y: H * 0.7 };
let clicked = false;
const CAP3 = `<span class="dot"></span>Saturday: 43 tables for two.`;
for (let i = 0; i < secs(4.8); i++) {
  const t = i / FPS;
  const m = ease(clamp01(t / 1.0));
  const cur = { x: lerp(from.x, sat.x, m), y: lerp(from.y, sat.y, m) };
  if (!clicked && t >= 1.15) {
    clicked = true;
    await page.mouse.click(sat.x, sat.y);
  }
  const ring = t >= 1.15 && t < 1.6 ? { x: sat.x, y: sat.y, s: 10 + (t - 1.15) * 120, a: 1 - (t - 1.15) / 0.45 } : null;
  await shoot({
    cam: camAt(C2, C3, ease(clamp01((t - 1.4) / 3.4))),
    ui: UI({ top: 1, cur: t < 2.2 ? cur : null, ring, c: CAP3, ca: fade(t, 1.7, 4.7, 0.3) }),
  });
}

// Scene 4 (13 to 20.4 s): in one step toward Flore, the cursor taps its sign; the card opens and scrolls to its calendar.
const C3b = { x: flore.x + 520, y: flore.y - 40, z: 0.25 };
const from4 = { x: W * 0.35, y: H * 0.78 };
const CAP4a = `Two MICHELIN stars. Saturday. Free.`;
const CAP4b = `Nine weeks of their calendar,<br>read about every 15 minutes.`;
let opened = false;
let signAt = null;
let tgt = null;
const T0 = 1.0, TC = 2.0; // camera arrives, click
for (let i = 0; i < secs(7.4); i++) {
  const t = i / FPS;
  if (!signAt && t >= T0 + 0.05) {
    const hit = await page.evaluate(() => window.seatedMap.hits.filter((h) => h.id === 'flore').map((h) => ({ x: h.x, y: h.y, w: h.w, h: h.h })));
    if (!hit.length) throw new Error('Flore has no sign: ' + JSON.stringify(await page.evaluate(() => ({ cam: window.seatedMap.cam, hits: window.seatedMap.hits.map((h) => h.id + '@' + Math.round(h.x) + ',' + Math.round(h.y)) }))));
    signAt = { x: hit[0].x + Math.min(hit[0].w / 2, 30), y: hit[0].y + hit[0].h / 2 };
  }
  if (!opened && t >= TC) {
    opened = true;
    // The map would fly there itself, fast; the film takes its target and eases there instead.
    tgt = await page.evaluate(() => { const v = window.seatedMap; v.onSelect('flore'); const t = v.target ?? v.cam; return { x: t.x, y: t.y, z: t.z }; });
  }
  if (opened) {
    await page.evaluate((k) => { const s = document.querySelector('.card-scroll'); if (s) s.scrollTop = k * (s.scrollHeight - s.clientHeight) * 0.75; }, ease(clamp01((t - 4.4) / 1.6)));
  }
  const m = signAt ? ease(clamp01((t - T0) / (TC - T0 - 0.15))) : 0;
  const cur = t < TC + 0.6 ? (signAt ? { x: lerp(from4.x, signAt.x, m), y: lerp(from4.y, signAt.y, m) } : from4) : null;
  const ring = signAt && t >= TC && t < TC + 0.45 ? { x: signAt.x, y: signAt.y, s: 10 + (t - TC) * 120, a: 1 - (t - TC) / 0.45 } : null;
  await shoot({
    cam: tgt ? camAt(C3b, tgt, ease(clamp01((t - TC) / 1.4))) : camAt(C3, C3b, ease(clamp01(t / T0))),
    ui: UI({
      top: 1,
      side: opened ? clamp01((t - TC) / 0.25) : 0,
      cur: t >= 0.2 ? cur : null,
      ring,
      c: t < 4.6 ? CAP4a : CAP4b,
      ca: t < 4.6 ? fade(t, TC + 0.4, 4.5, 0.25) : fade(t, 4.7, 7.3, 0.25),
    }),
  });
}

// Scene 5 (19.4 to 24 s): the card closes, the camera pulls out over a green city, the end card.
const C4 = { ...tgt };
const icon = await page.evaluate(() => document.querySelector('link[rel=icon]').href);
const END = `<img src="${icon}" alt=""><b>seated.food</b><span>Free tables in Amsterdam, on one map.</span>`;
let closed = false;
for (let i = 0; i < secs(6.2); i++) {
  const t = i / FPS;
  if (!closed && t >= 0.35) { closed = true; await page.evaluate(() => { const v = window.seatedMap; v.onSelect(null); v.target = null; }); }
  const ea = clamp01((t - 3.5) / 0.45);
  await shoot({ cam: camAt(C4, C5, ease(clamp01((t - 0.2) / 3.4))), ui: UI({ top: clamp01(1 - t / 0.35), side: closed ? 0 : clamp01(1 - t / 0.35), e: END, ea, veil: ea }) });
}

console.log(JSON.stringify({ frames: frame, zoomCtl, flore }));
await b.close();
