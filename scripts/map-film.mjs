// Renders the launch film of the map (Joel, 23 Nov 2026: "100x better"; 24 Nov 2026: "its friday night. you have no
// reservation. what should you do? whip out seated.food, find avail spots in one look in a fun map") frame by frame: a virtual clock drives the map,
// so every frame is sharp and the camera moves at an even 60 fps. Read data.json from the Blob store once (never poll
// seated.food), save it as $F/data-film.json, start a demo server on :4330 (`PORT=4330 npx tsx src/server/main.ts --demo`
// after `npm run build`), then: F=<out dir> node scripts/map-film.mjs. Encode: ffmpeg -framerate 60 -i $F/frames/%05d.png
// -vf scale=1920:1080:flags=lanczos -c:v libx264 -crf 16 -pix_fmt yuv420p film.mp4 (frames are 3840 x 2160; with
// FORMAT=phone 1440 x 2560, scale=1080:1920). The story: Friday, no reservation, the map, one hard-to-get place free
// (HERO, default gitane; it must be free on the coming Friday in the snapshot), its Book button, the end card. Rendered on
// a Friday itself, the map reads "tonight" and the card shows times.
import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';

const F = process.env.F;
const BASE = process.env.BASE ?? 'http://127.0.0.1:4330';
const ONLY = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null; // frames to write, for a quick look
const FPS = 60;
// FORMAT=phone: 9:16 in the map's phone layout (Joel, 24 Nov 2026: "show on mobile"); 360 x 640 CSS px at 4x,
// scaled to 1080 x 1920. Otherwise 16:9 desktop, 960 x 540 at 4x, scaled to 1920 x 1080.
const PHONE = process.env.FORMAT === 'phone';
const [W, H] = PHONE ? [360, 640] : [960, 540];

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 4 });
await ctx.addInitScript(() => {
  window.__maxDpr = 4; // drawn at 4x, scaled down to 1920: half-pixel motion, no stair steps (Joel, 24 Nov 2026: "so laggy")
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
// The coming Friday (today on a Friday) goes in the link, so the map opens on it in either layout.
const today0 = new Date();
const friAdd = (5 - today0.getDay() + 7) % 7;
const friDay = new Date(today0.getFullYear(), today0.getMonth(), today0.getDate() + friAdd);
const FRI = `${friDay.getFullYear()}-${String(friDay.getMonth() + 1).padStart(2, '0')}-${String(friDay.getDate()).padStart(2, '0')}`;
await page.goto(`${BASE}/map/?lens=seated${friAdd ? `&date=${FRI}` : ''}`);
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
  #film .cap { left: 28px; bottom: 44px; font-size: 26px; line-height: 1.2; max-width: 500px; }
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
  #film.phone .story { width: 330px; }
  #film.phone .story p { font-size: 29px; min-height: 40px; white-space: nowrap; }
  #film.phone .story i { height: 28px; }
  #film.phone .cap { left: 14px; right: 14px; max-width: none; bottom: 64px; font-size: 21px; padding: 12px 16px 14px; }
  #film.phone .cap.top { top: 64px; bottom: auto; }
  #film.phone .end { padding: 22px 26px 24px; }
  #film.phone .end b { font-size: 40px; }
  #film.phone .end span { font-size: 19px; }
  /* Gen Z captions (Joel, 24 Nov 2026: "GEN Z VIBES"): big bold words that pop in one by one, emoji stickers. */
  #film .pop { position: absolute; left: 0; right: 0; text-align: center; transform: translateY(-50%); padding: 0 22px;
    font: 900 50px/1.02 -apple-system, 'SF Pro Display', 'Helvetica Neue', system-ui, sans-serif; letter-spacing: -0.03em; color: #fff;
    text-shadow: 0 3px 0 #2b2733, 0 -2px 0 #2b2733, 3px 0 0 #2b2733, -3px 0 0 #2b2733, 2px 2px 0 #2b2733, -2px 2px 0 #2b2733, 0 10px 24px rgba(29,26,36,.5); }
  #film .pop div { margin: 0.06em 0; }
  #film .pop span { display: inline-block; transform-origin: 50% 70%; }
  #film .pop .hl { color: #5fd47e; }
  #film .pop.dark { color: #2b2733; text-shadow: none; }
  #film .pop.dark .hl { color: #0f766e; }
  #film.phone .pop { font-size: 42px; }
  #film .stk { position: absolute; font-size: 88px; line-height: 1; transform-origin: 50% 50%; filter: drop-shadow(0 6px 10px rgba(29,26,36,.35)); }
  #film.phone .stk { font-size: 72px; }
  #film .ring { position: absolute; width: 10px; height: 10px; border: 3px solid #0f766e; border-radius: 50%; transform: translate(-50%, -50%); }
  `,
});
await page.evaluate(() => {
  const el = document.createElement('div');
  el.id = 'film';
  if (innerWidth <= 640) el.className = 'phone';
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
  el.innerHTML = `<div class="veil" id="v" style="opacity:0"></div><div class="panel title" id="t"></div><div class="panel story" id="s"></div><div class="pop" id="p"></div><div class="stk" id="g"></div><div class="panel cap" id="c"></div><div class="panel end" id="e"></div>
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
  return { i, free: pool.filter((r) => r.d[i] === 'o').length, hero: h.d[i], name: h.name, why: h.why, michelin: h.michelin, times: h.t?.[date] ?? [] };
}, { date: fri.date, hero: HERO });
if (facts.hero !== 'o') throw new Error(`${HERO} is not free on Friday ${fri.date} in this snapshot (${facts.hero}): pick another HERO`);
const tonight = fri.add === 0;

// Camera keys (world pixels).
const C0 = PHONE ? { x: mid.x + 200, y: mid.y - 100, z: 0.125 } : { x: mid.x + 600, y: mid.y - 300, z: 0.125 }; // the whole city
const C1 = PHONE ? { x: 11128 - 150, y: 5212 + 40, z: 0.15 } : { x: 11128, y: 5212, z: 0.15 }; // the canal belt, most signs
// The hero: left of centre on a wide screen, clear of the card; high on a phone, clear of the sheet that comes up.
const CH = PHONE ? { x: hero.x, y: hero.y + (0.18 * H) / 0.25, z: 0.25 } : { x: hero.x + 520, y: hero.y - 40, z: 0.25 };
const C5 = PHONE ? { x: mid.x + 150, y: mid.y - 60, z: 0.125 } : { x: mid.x + 300, y: mid.y - 200, z: 0.125 };

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
    $('c').classList.toggle('top', !!ui.ctop);
    show('e', ui.e, ui.ea);
    show('s', ui.s, ui.sa ?? 0);
    const p = $('p');
    p.style.display = ui.pop ? '' : 'none';
    if (ui.pop) { p.innerHTML = ui.pop.html; p.style.top = ui.pop.top; p.classList.toggle('dark', !!ui.pop.dark); p.style.right = ui.pop.right ?? '0'; }
    const g = $('g');
    g.style.display = ui.stk ? '' : 'none';
    if (ui.stk) { g.textContent = ui.stk.emoji; g.style.left = ui.stk.x; g.style.top = ui.stk.y; g.style.transform = `translate(-50%, -50%) rotate(${ui.stk.r}deg) scale(${ui.stk.s})`; }
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

const UI = (o = {}) => ({ t: null, ta: 0, c: null, ca: 0, e: null, ea: 0, s: null, sa: 0, cur: null, ring: null, top: 0, side: 0, pop: null, stk: null, ...o });
/** Overshoot easing: a word or sticker pops past its size and settles. */
const backOut = (k) => 1 + 2.70158 * Math.pow(k - 1, 3) + 1.70158 * Math.pow(k - 1, 2);
/** A caption shown from t0 to t1, its words popping in one by one; a word written *word is green. */
function pop(lines, t, t0, t1, top, o = {}) {
  if (t < t0 || t > t1) return null;
  let i = 0;
  const out = clamp01((t1 - t) / 0.15);
  const html = lines.map((line) => `<div>${line.split(' ').map((w) => {
    const hl = w.startsWith('*');
    const dt = t - t0 - 0.08 * i++;
    const k = clamp01(dt / 0.3);
    const sc = dt <= 0 ? 0.3 : 0.3 + 0.7 * backOut(k);
    return `<span${hl ? ' class="hl"' : ''} style="opacity:${dt <= 0 ? 0 : Math.min(1, k * 3) * out};transform:scale(${sc.toFixed(3)})">${hl ? w.slice(1) : w}</span>`;
  }).join(' ')}</div>`).join('');
  return { html, top, ...o };
}
/** An emoji sticker that pops in tilted at (x, y) from t0 to t1. */
const sticker = (emoji, t, t0, t1, x, y, r) => (t < t0 || t > t1 ? null : { emoji, x, y, r, s: (0.3 + 0.7 * backOut(clamp01((t - t0) / 0.3))) * clamp01((t1 - t) / 0.15) });
const fade = (t, a, b, f = 0.35) => clamp01(Math.min((t - a) / f, (b - t) / f));
const secs = (s) => Math.round(s * FPS);
const ringAt = (p, t, t0) => (p && t >= t0 && t < t0 + 0.45 ? { x: p.x, y: p.y, s: 10 + (t - t0) * 120, a: 1 - (t - t0) / 0.45 } : null);
const tap = (from, to, t, t0, t1) => { const m = ease(clamp01((t - t0) / (t1 - t0))); return { x: lerp(from.x, to.x, m), y: lerp(from.y, to.y, m) }; };

// The cut (Joel, 24 Nov 2026: "GEN Z VIBES", fast): about 18 s. Captions pop word by word; stickers pop in tilted.
const TOPCAP = PHONE ? '22%' : '20%';
const FREE_WHEN = tonight ? 'tonight' : 'rn';

// Scene 1 (0 to 3.4 s): cream screen, three beats.
for (let i = 0; i < secs(3.4); i++) {
  const t = i / FPS;
  await shoot({
    cam: C0,
    ui: UI({
      veil: 1,
      pop: pop(["it's friday", 'night'], t, 0.15, 1.25, '45%', { dark: true }) ?? pop(['no rez.'], t, 1.3, 2.25, '45%', { dark: true }) ?? pop(["we're", '*cooked'], t, 2.3, 3.35, '45%', { dark: true }),
      stk: sticker('💀', t, 2.65, 3.35, PHONE ? '72%' : '62%', PHONE ? '60%' : '62%', 12),
    }),
  });
}

// Scene 2 (3.4 to 5 s): the city snaps in on Friday.
for (let i = 0; i < secs(1.6); i++) {
  const t = i / FPS;
  const k = ease(clamp01(t / 0.45));
  await shoot({
    cam: camAt(C0, C1, ease(clamp01(t / 3.4))), // one move from here into the belt
    ui: UI({ veil: 1 - k, top: clamp01((t - 0.3) / 0.3), pop: pop(['wait.', 'seated.food'], t, 0.35, 1.6, TOPCAP), stk: sticker('👀', t, 0.75, 1.6, PHONE ? '82%' : '64%', PHONE ? '14%' : '30%', -10) }),
  });
}

// Scene 3 (5 to 8.2 s): into the canal belt; every green sign is a free table.
for (let i = 0; i < secs(3.2); i++) {
  const t = i / FPS;
  await shoot({
    cam: camAt(C0, C1, ease(clamp01((t + 1.6) / 3.4))),
    ui: UI({ top: 1, pop: pop([`${facts.free} tables`, `*free ${FREE_WHEN}`], t, 0.5, 2.0, TOPCAP) ?? pop(['no cap.'], t, 2.05, 3.15, TOPCAP), stk: sticker('🍽️', t, 0.95, 2.0, PHONE ? '80%' : '66%', PHONE ? '30%' : '28%', 8) }),
  });
}

// Scene 4 (8.2 to about 14.6 s): snap to the hard-to-get place, tap it, a dinner time, Book.
const from4 = PHONE ? { x: W * 0.72, y: H * 0.7 } : { x: W * 0.62, y: H * 0.8 };
const DINNER = facts.times.find((x) => x >= '17:00') ?? null; // none read yet: Book alone
const NAME = facts.name.toLowerCase();
let opened = false, signAt = null, tgt = null, timeAt = null, bookAt = null, picked = false;
const T0 = 0.9, TC = 1.5; // camera arrives, tap the sign
const TS = TC + 1.1; // the card has been seen; it scrolls
const TT = TS + 1.0; // tap the dinner time
const TB = DINNER ? TT + 0.9 : TS + 1.1; // tap Book
const CAPTOP = PHONE ? '27%' : '20%';
const CAPRIGHT = PHONE ? '0' : '380px'; // clear of the wide card
const findBook = () => page.evaluate(() => {
  const b = [...document.querySelectorAll('.side a, .side button')].find((x) => /^Book/.test(x.textContent.trim()));
  if (!b) return null;
  const r = b.getBoundingClientRect();
  if (r.bottom > innerHeight || r.top < 0) return { off: r.top };
  return { x: r.x + Math.min(r.width / 2, 60), y: r.y + r.height / 2, label: b.textContent.trim() };
});
for (let i = 0; i < secs(TB + 1.0); i++) {
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
  if (opened && t >= TS && t < TS + 0.6) {
    const k = ease(clamp01((t - TS) / 0.5));
    await page.evaluate(({ k, hm }) => {
      const s = document.querySelector('.card-scroll');
      const b = [...document.querySelectorAll('.side a, .side button')].find((x) => /^Book/.test(x.textContent.trim()));
      const tb = hm && [...document.querySelectorAll('.side button')].find((x) => x.textContent.trim() === hm);
      if (!s || !b) return;
      const sr = s.getBoundingClientRect();
      // With a time: that button a little above the middle of what the card shows. Without: Book in sight.
      const want = tb ? tb.getBoundingClientRect().top - sr.top + s.scrollTop - s.clientHeight * 0.4 : b.getBoundingClientRect().bottom - sr.bottom + s.scrollTop + 16;
      if (s.__to == null) s.__to = Math.max(0, Math.min(s.scrollHeight - s.clientHeight, want));
      s.scrollTop = k * s.__to;
    }, { k, hm: DINNER });
  }
  if (opened && DINNER && !timeAt && t >= TS + 0.62) {
    timeAt = await page.evaluate((hm) => {
      const b = [...document.querySelectorAll('.side button')].find((x) => x.textContent.trim() === hm);
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return r.bottom > innerHeight || r.top < 0 ? { off: r.top } : { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, DINNER);
    if (!timeAt || timeAt.off != null) throw new Error(`the ${DINNER} button of ${HERO} is missing or off screen: ${JSON.stringify(timeAt)}`);
  }
  if (DINNER && !picked && t >= TT) {
    picked = true;
    await page.evaluate((hm) => [...document.querySelectorAll('.side button')].find((x) => x.textContent.trim() === hm).click(), DINNER);
  }
  if (opened && !bookAt && t >= (DINNER ? TT + 0.1 : TS + 0.62)) {
    bookAt = await findBook();
    if (!bookAt || bookAt.off != null) throw new Error(`the Book button of ${HERO} is missing or off screen: ${JSON.stringify(bookAt)}`);
    if (DINNER && !bookAt.label.includes(DINNER)) throw new Error(`Book does not follow the picked time: "${bookAt.label}"`);
  }
  let cur = null;
  if (t >= 0.2 && t < TC + 0.4) cur = signAt ? tap(from4, signAt, t, T0 - 0.1, TC - 0.12) : from4;
  else if (DINNER && timeAt && t >= TS + 0.65 && t < TT + 0.25) cur = tap(signAt, timeAt, t, TS + 0.65, TT - 0.12);
  else if (bookAt && t >= (DINNER ? TT + 0.25 : TS + 0.65) && t < TB + 0.7) cur = tap(DINNER ? timeAt : signAt, bookAt, t, DINNER ? TT + 0.25 : TS + 0.65, TB - 0.12);
  const capTop = opened ? CAPTOP : TOPCAP;
  const capRight = opened ? CAPRIGHT : '0';
  await shoot({
    cam: tgt ? camAt(CH, tgt, ease(clamp01((t - TC) / 0.9))) : camAt(C1, CH, ease(clamp01(t / T0))),
    ui: UI({
      top: 1,
      side: opened ? clamp01((t - TC) / 0.2) : 0,
      cur,
      ring: ringAt(signAt, t, TC) ?? ringAt(DINNER ? timeAt : null, t, TT) ?? ringAt(bookAt, t, TB),
      pop:
        pop([`${NAME}.`, 'impossible', 'to book'], t, 0.25, TS + 0.55, capTop, { right: capRight }) ??
        pop([DINNER ? `friday ${DINNER}??` : 'friday??', '*FREE'], t, TS + 0.6, TB - 0.05, opened && PHONE ? '19%' : capTop, { right: capRight }) ??
        pop(['booked.', '*ate.'], t, TB, TB + 1.0, opened && PHONE ? '19%' : capTop, { right: capRight }),
      stk: sticker('🔥', t, 0.55, TS + 0.55, PHONE ? '82%' : '58%', PHONE ? '16%' : '12%', 10) ?? sticker('😭', t, TT - 0.3, TB - 0.05, PHONE ? '83%' : '58%', PHONE ? '16%' : '12%', -12) ?? sticker('✅', t, TB + 0.1, TB + 1.0, PHONE ? '80%' : '58%', PHONE ? '16%' : '12%', 8),
    }),
  });
}

// Scene 5 (about 14.6 to 18 s): the card goes, a quick pull out, the end card pops.
const C4 = { ...tgt };
const icon = await page.evaluate(() => document.querySelector('link[rel=icon]').href);
const END = `<img src="${icon}" alt=""><b>seated.food</b><span>friday night: secured</span>`;
let closed = false;
for (let i = 0; i < secs(3.4); i++) {
  const t = i / FPS;
  if (!closed && t >= 0.15) { closed = true; await page.evaluate(() => { const v = window.seatedMap; v.onSelect(null); v.target = null; }); }
  const k = clamp01((t - 1.2) / 0.35);
  await shoot({
    cam: camAt(C4, C5, ease(clamp01(t / 1.4))),
    ui: UI({ top: clamp01(1 - t / 0.2), side: closed ? 0 : clamp01(1 - t / 0.2), e: END, ea: Math.min(1, k * 2), veil: k * 0.6, stk: sticker('✨', t, 1.45, 3.4, PHONE ? '78%' : '62%', PHONE ? '40%' : '33%', 14) }),
  });
  // The end card pops with the same overshoot as the words.
  await page.evaluate((sc) => { const e = document.getElementById('e'); e.style.transform = `translate(-50%, -50%) scale(${sc})`; }, t < 1.2 ? 0.3 : 0.3 + 0.7 * backOut(clamp01((t - 1.2) / 0.35)));
}

console.log(JSON.stringify({ frames: frame, zoomCtl, fri, facts }));
await b.close();
