// Renders the launch film of the map (Joel, 23 Nov 2026: "100x better"; 24 Nov 2026: "its friday night. you have no
// reservation. what should you do? whip out seated.food, find avail spots in one look in a fun map") frame by frame: a virtual clock drives the map,
// so every frame is sharp and the camera moves at an even 60 fps. Read data.json from the Blob store once (never poll
// seated.food), save it as $F/data-film.json, start a demo server on :4330 (`PORT=4330 npx tsx src/server/main.ts --demo`
// after `npm run build`), then: F=<out dir> node scripts/map-film.mjs. Encode: ffmpeg -framerate 60 -i $F/frames/%05d.png
// -c:v libx264 -crf 16 -pix_fmt yuv420p film.mp4. The story: Friday, no reservation, the map, one hard-to-get place free
// (HERO, default gitane; it must be free on the coming Friday in the snapshot), its Book button, the end card. Rendered on
// a Friday itself, the map reads "tonight" and the card shows times.
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
  #film .story { left: 50%; top: 50%; transform: translate(-50%, -50%); text-align: left; background: none; box-shadow: none; width: 640px; }
  #film .story p { margin: 0; font-size: 54px; line-height: 1.25; font-weight: 600; min-height: 68px; }
  #film .story p.teal { color: #0f766e; }
  #film .story i { display: inline-block; width: 4px; height: 46px; background: #2b2733; vertical-align: -6px; margin-left: 4px; font-style: normal; }
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
  el.innerHTML = `<div class="veil" id="v" style="opacity:0"></div><div class="panel title" id="t"></div><div class="panel story" id="s"></div><div class="panel cap" id="c"></div><div class="panel end" id="e"></div>
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

const HERO = process.env.HERO ?? 'gitane';
const at = (id) => page.evaluate((id) => { const m = window.seatedMap.markers.find((x) => x.id === id); return m ? { x: m.ax, y: m.ay } : null; }, id);
const hero = await at(HERO);
const mid = await at('kaagman-kortekaas'); // by the Dam: the middle of the canal belt
if (!hero || !mid) throw new Error(`no sign for ${HERO} or kaagman-kortekaas in the snapshot: pick another HERO`);

// The coming Friday (today on a Friday), its index in the snapshot, the free count and the hero's state that day.
const fri = await page.evaluate(() => {
  const now = new Date();
  const add = (5 - now.getDay() + 7) % 7;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + add);
  return { add, date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` };
});
const facts = await page.evaluate(async ({ date, hero }) => {
  const d = await (await fetch('/map/data.json')).json();
  const i = Math.round((Date.parse(date) - Date.parse(d.start)) / 864e5);
  const seated = d.guides.find((g) => g.id === 'seated');
  const pool = d.restaurants.filter((r) => !seated || seated.picks?.includes(r.id) || r.g?.includes('seated'));
  const h = d.restaurants.find((r) => r.id === hero);
  return { i, free: pool.filter((r) => r.d[i] === 'o').length, hero: h.d[i], name: h.name, why: h.why, times: h.t?.[date] ?? [] };
}, { date: fri.date, hero: HERO });
if (facts.hero !== 'o') throw new Error(`${HERO} is not free on Friday ${fri.date} in this snapshot (${facts.hero}): pick another HERO`);
const tonight = fri.add === 0;

// Camera keys (world pixels).
const C0 = { x: mid.x + 600, y: mid.y - 300, z: 0.125 };       // the whole city
const C1 = { x: 11128, y: 5212, z: 0.15 };                      // the canal belt where most signs stand (19 at this zoom)
const CH = { x: hero.x + 520, y: hero.y - 40, z: 0.25 };        // the hero left of centre, clear of the card
const C5 = { x: mid.x + 300, y: mid.y - 200, z: 0.125 };

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
    show('s', ui.s, ui.sa ?? 0);
    $('v').style.opacity = String(ui.veil ?? 0);
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

const UI = (o = {}) => ({ t: null, ta: 0, c: null, ca: 0, e: null, ea: 0, s: null, sa: 0, cur: null, ring: null, top: 0, side: 0, ...o });
const fade = (t, a, b, f = 0.35) => clamp01(Math.min((t - a) / f, (b - t) / f));
const secs = (s) => Math.round(s * FPS);
const ringAt = (p, t, t0) => (p && t >= t0 && t < t0 + 0.45 ? { x: p.x, y: p.y, s: 10 + (t - t0) * 120, a: 1 - (t - t0) / 0.45 } : null);
const tap = (from, to, t, t0, t1) => { const m = ease(clamp01((t - t0) / (t1 - t0))); return { x: lerp(from.x, to.x, m), y: lerp(from.y, to.y, m) }; };

// The map shows Friday from the first frame: tap the day while the bar is hidden.
if (!tonight) {
  const ok = await page.evaluate(() => { const b = [...document.querySelectorAll('.topbar button')].find((x) => x.textContent.trim() === 'Fri'); b?.click(); return !!b; });
  if (!ok) throw new Error('no Fri button in the top bar: the film needs the quick days (wide screen)');
}

// Scene 1 (0 to 5 s): a cream screen, typed: Friday night. No reservation. Now what?
const LINES = [['Friday night.', 0.3], ['No reservation.', 1.5], ['Now what?', 2.9]];
const typed = (t) => LINES.map(([s, t0], i) => {
  const n = Math.max(0, Math.min(s.length, Math.floor((t - t0) * 22)));
  const caret = t >= t0 && (n < s.length || (i === LINES.length - 1 && Math.floor(t * 2.2) % 2 === 0)) && !(i < LINES.length - 1 && t >= LINES[i + 1][1]);
  return `<p${i === 2 ? ' class="teal"' : ''}>${s.slice(0, n)}${caret ? '<i></i>' : ''}</p>`;
}).join('');
for (let i = 0; i < secs(5); i++) {
  const t = i / FPS;
  await shoot({ cam: C0, ui: UI({ s: typed(t), sa: clamp01((4.7 - t) / 0.3), veil: 1 }) });
}

// Scene 2 (5 to 7 s): the veil lifts on the whole city, Friday already green; the bar comes in.
for (let i = 0; i < secs(2); i++) {
  const t = i / FPS;
  const k = ease(clamp01(t / 1.0));
  await shoot({ cam: camAt(C0, C1, ease(clamp01((t - 0.4) / 3.6)) * 0.4), ui: UI({ veil: 1 - k, top: clamp01((t - 0.9) / 0.5), c: `Open seated.food.`, ca: fade(t, 0.8, 2.2, 0.25) }) });
}

// Scene 3 (7 to 12 s): into the canal belt; one look, every free table.
const CAP3 = `<span class="dot"></span>One look: ${facts.free} places with a table for two${tonight ? ' tonight' : ' on Friday'}.<small>Green is free. Each sign reads the restaurant's own booking calendar.</small>`;
const c2start = camAt(C0, C1, 0.4 * ease(clamp01(1.6 / 3.6)));
for (let i = 0; i < secs(5); i++) {
  const t = i / FPS;
  await shoot({ cam: camAt(c2start, C1, ease(clamp01(t / 2.8))), ui: UI({ top: 1, c: CAP3, ca: fade(t, 0.3, 4.8, 0.3) }) });
}

// Scene 4 (12 to 19.5 s): over to the hard-to-get place, tap its sign, the card opens, tap Book.
const from4 = { x: W * 0.62, y: H * 0.8 };
const CAP4a = `${facts.name}. Usually booked months ahead.`;
const CAP4b = `Free on Friday. Book on their own page.`;
let opened = false, signAt = null, tgt = null, bookAt = null;
const T0 = 1.6, TC = 2.6, TB = 5.4; // camera arrives, tap the sign, tap Book
for (let i = 0; i < secs(7.5); i++) {
  const t = i / FPS;
  if (!signAt && t >= T0 + 0.05) {
    const hit = await page.evaluate((id) => window.seatedMap.hits.filter((h) => h.id === id).map((h) => ({ x: h.x, y: h.y, w: h.w, h: h.h })), HERO);
    if (!hit.length) throw new Error(`${HERO} has no sign: ` + JSON.stringify(await page.evaluate(() => ({ cam: window.seatedMap.cam, hits: window.seatedMap.hits.map((h) => h.id + '@' + Math.round(h.x) + ',' + Math.round(h.y)) }))));
    signAt = { x: hit[0].x + Math.min(hit[0].w / 2, 30), y: hit[0].y + hit[0].h / 2 };
  }
  if (!opened && t >= TC) {
    opened = true;
    // The map would fly there itself, fast; the film takes its target and eases there instead.
    tgt = await page.evaluate((id) => { const v = window.seatedMap; v.onSelect(id); const t = v.target ?? v.cam; return { x: t.x, y: t.y, z: t.z }; }, HERO);
  }
  if (opened && t >= TC + 0.6 && t < TC + 1.4) {
    // Scroll the card until its Book button is in sight.
    const k = ease(clamp01((t - TC - 0.6) / 0.7));
    await page.evaluate((k) => {
      const s = document.querySelector('.card-scroll');
      const b = [...document.querySelectorAll('.side a, .side button')].find((x) => /^Book/.test(x.textContent.trim()));
      if (!s || !b) return;
      if (s.__to == null) s.__to = Math.max(0, Math.min(s.scrollHeight - s.clientHeight, b.getBoundingClientRect().bottom - s.getBoundingClientRect().bottom + s.scrollTop + 16));
      s.scrollTop = k * s.__to;
    }, k);
  }
  if (opened && !bookAt && t >= TC + 1.4) {
    bookAt = await page.evaluate(() => {
      const b = [...document.querySelectorAll('.side a, .side button')].find((x) => /^Book/.test(x.textContent.trim()));
      if (!b) return null;
      const r0 = b.getBoundingClientRect();
      if (r0.bottom > innerHeight || r0.top < 0) return { off: r0.top };
      const r = b.getBoundingClientRect();
      return { x: r.x + Math.min(r.width / 2, 60), y: r.y + r.height / 2 };
    });
    if (!bookAt || bookAt.off != null) throw new Error(`the Book button of ${HERO} is missing or off screen: ${JSON.stringify(bookAt)}`);
  }
  let cur = null;
  if (t >= 0.3 && t < TC + 0.5) cur = signAt ? tap(from4, signAt, t, T0, TC - 0.15) : from4;
  else if (bookAt && t >= TC + 1.5 && t < TB + 0.9) cur = tap(signAt, bookAt, t, TC + 1.5, TB - 0.15);
  await shoot({
    cam: tgt ? camAt(CH, tgt, ease(clamp01((t - TC) / 1.4))) : camAt(C1, CH, ease(clamp01(t / T0))),
    ui: UI({
      top: 1,
      side: opened ? clamp01((t - TC) / 0.25) : 0,
      cur,
      ring: ringAt(signAt, t, TC) ?? ringAt(bookAt, t, TB),
      c: t < 4.6 ? CAP4a : CAP4b,
      ca: t < 4.6 ? fade(t, TC + 0.4, 4.5, 0.25) : fade(t, 4.7, 7.4, 0.25),
    }),
  });
}

// Scene 5 (19.5 to 25.5 s): the card closes, the camera pulls out over a green city, the end card.
const C4 = { ...tgt };
const icon = await page.evaluate(() => document.querySelector('link[rel=icon]').href);
const END = `<img src="${icon}" alt=""><b>seated.food</b><span>Friday night, sorted.</span>`;
let closed = false;
for (let i = 0; i < secs(6); i++) {
  const t = i / FPS;
  if (!closed && t >= 0.35) { closed = true; await page.evaluate(() => { const v = window.seatedMap; v.onSelect(null); v.target = null; }); }
  const ea = clamp01((t - 3.3) / 0.45);
  await shoot({ cam: camAt(C4, C5, ease(clamp01((t - 0.2) / 3.4))), ui: UI({ top: clamp01(1 - t / 0.35), side: closed ? 0 : clamp01(1 - t / 0.35), e: END, ea, veil: ea * 0.55 }) });
}

console.log(JSON.stringify({ frames: frame, zoomCtl, fri, facts }));
await b.close();
