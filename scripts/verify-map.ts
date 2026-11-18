/**
 * Front-end check of the public map, the way a visitor sees it: every art x screen x state, a screenshot each, then
 * checks in code (fog, signs on fog, your character over a sign, panels and text, page errors, the link after a reload)
 * and, with --judge, one headless Opus judge over the screenshots. Exit 1 when anything fails.
 *
 *   npm run verify:map                      # build, demo server, code checks
 *   npm run verify:map -- --judge           # plus the Opus judge (CLAUDE.md Rule 16: one judge, headless)
 *   npm run verify:map -- --no-build --out test-results/verify/x
 *
 * Demo data only (CLAUDE.md hard rule 2): it starts its own demo server and never calls seated.food.
 * scripts/verify-map-loop.sh runs it in rounds and lets Claude fix what it finds.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';

const PORT = 4398;
const BASE = `http://127.0.0.1:${PORT}/map/`;
const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const OUT = resolve(args.includes('--out') ? args[args.indexOf('--out') + 1]! : `test-results/verify/${new Date().toISOString().replace(/[:.]/g, '-')}`);

/** Weteringschans: south of the canal belt, where Joel stood on 18 Nov 2026 when ?art=ours showed him fog. */
const HERE = { latitude: 52.3598, longitude: 4.8896 };
const SCREENS = [
  { name: '1440', width: 1440, height: 900, mobile: false },
  { name: '1024', width: 1024, height: 768, mobile: false },
  { name: '390', width: 390, height: 844, mobile: true },
];
type State = 'start' | 'near' | 'card' | 'reload';
const STATES: State[] = ['start', 'near', 'card', 'reload'];
const ARTS = existsSync('dist/map/canal/manifest.json') || existsSync('src/map/public/canal/manifest.json') ? ['his', 'ours'] : ['his'];

export interface Finding {
  shot: string;
  check: string;
  severity: 'high' | 'medium' | 'low';
  what: string;
}

/** The share of the open map (not under a panel) that is fog, and the signs that stand on fog. Runs in the page. */
function probeCanvas() {
  const FOG = new Set(['168,164,188', '187,183,203', '206,203,218', '227,225,234']); // FOG_TONES in render.ts
  type V = {
    canvas: HTMLCanvasElement;
    safe: { top: number; right: number; bottom: number; left: number };
    markers: Array<{ id: string; name: string }>;
    hits: Array<{ id: string; x: number; y: number; w: number; h: number }>;
    you: { x: number; y: number } | null;
    cam: { x: number; y: number; z: number };
    markerScreen(id: string): { x: number; y: number } | null;
  };
  const v = (window as unknown as { seatedMap: V }).seatedMap;
  const c = v.canvas;
  const r = c.getBoundingClientRect();
  const k = c.width / r.width;
  const { data } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
  const isFog = (x: number, y: number) => {
    const i = (Math.round(y * k) * c.width + Math.round(x * k)) * 4;
    return FOG.has(`${data[i]},${data[i + 1]},${data[i + 2]}`);
  };
  const s = v.safe;
  const x0 = s.left, x1 = r.width - s.right, y0 = s.top, y1 = r.height - s.bottom;
  let fog = 0, all = 0;
  for (let y = y0; y < y1; y += 4) for (let x = x0; x < x1; x += 4) (all++, isFog(x, y) && fog++);
  const inHit = (x: number, y: number) => v.hits.some((h) => x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h);
  const onFog: string[] = [];
  for (const m of v.markers) {
    const p = v.markerScreen(m.id);
    if (!p || p.x < x0 + 20 || p.x > x1 - 20 || p.y < y0 + 20 || p.y > y1 - 20) continue;
    let f = 0, n = 0;
    for (let dy = 2; dy <= 22; dy += 4) for (let dx = -20; dx <= 20; dx += 4) {
      if (inHit(p.x + dx, p.y + dy)) continue;
      n++;
      if (isFog(p.x + dx, p.y + dy)) f++;
    }
    if (n >= 10 && f / n >= 0.7) onFog.push(m.name);
  }
  // Your character (drawYou: a 38 px plate above the point) over a restaurant's sign.
  let youOver: string[] = [];
  if (v.you) {
    const yx = (v.you.x - v.cam.x) * v.cam.z + r.width / 2, yy = (v.you.y - v.cam.y) * v.cam.z + r.height / 2;
    const box = { x: yx - 19, y: yy - 47, w: 38, h: 41 };
    youOver = v.hits
      .filter((h) => h.x < box.x + box.w && h.x + h.w > box.x && h.y < box.y + box.h && h.y + h.h > box.y)
      .map((h) => v.markers.find((m) => m.id === h.id)?.name ?? h.id);
  }
  return { fogShare: all ? fog / all : 0, onFog, youOver, signs: v.hits.length };
}

/** Panels and text: the page wider than the screen, panels on top of each other, text cut off. Runs in the page. */
function probeDom() {
  const out: string[] = [];
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push(`page is ${document.documentElement.scrollWidth}px wide on a ${innerWidth}px screen`);
  const shown = (e: Element) => {
    const b = e.getBoundingClientRect();
    const st = getComputedStyle(e);
    return b.width > 0 && b.height > 0 && st.visibility !== 'hidden' && st.display !== 'none' ? b : null;
  };
  const panels = ['.topbar', '.side', '.foot', '.toast', '.dialog', '.pop']
    .flatMap((sel) => [...document.querySelectorAll(sel)].map((e) => ({ sel, b: shown(e) })))
    .filter((p): p is { sel: string; b: DOMRect } => !!p.b);
  for (let i = 0; i < panels.length; i++) {
    const a = panels[i]!;
    if (a.b.right > innerWidth + 1 || a.b.left < -1) out.push(`${a.sel} runs off the screen (${Math.round(a.b.left)}..${Math.round(a.b.right)} of ${innerWidth})`);
    for (const p of panels.slice(i + 1)) {
      const w = Math.min(a.b.right, p.b.right) - Math.max(a.b.left, p.b.left);
      const h = Math.min(a.b.bottom, p.b.bottom) - Math.max(a.b.top, p.b.top);
      if (w > 4 && h > 4) out.push(`${a.sel} and ${p.sel} overlap by ${Math.round(w)}x${Math.round(h)}px`);
    }
  }
  for (const e of document.querySelectorAll<HTMLElement>('body *')) {
    if (!e.childNodes.length || ![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())) continue;
    const st = getComputedStyle(e);
    if (st.overflowX === 'visible' && st.textOverflow !== 'ellipsis') continue;
    const b = shown(e);
    if (!b || b.width <= 1 || b.height <= 1 || e.closest('[aria-hidden="true"]')) continue; // 1 px: text for screen readers only
    if (e.scrollWidth > e.clientWidth + 1) out.push(`text cut off: "${e.textContent!.trim().slice(0, 40)}"`);
  }
  return out;
}

async function settled(page: Page) {
  await page.waitForFunction(() => {
    const m = (window as unknown as { seatedMap?: { pending(): number; target: unknown } }).seatedMap;
    return !!m && m.pending() === 0 && !m.target;
  }, null, { timeout: 30_000 });
  await page.waitForTimeout(400);
}

async function scenario(browser: Browser, art: string, screen: (typeof SCREENS)[number], state: State): Promise<Finding[]> {
  const shot = `${art}-${screen.name}-${state}`;
  const findings: Finding[] = [];
  const add = (check: string, severity: Finding['severity'], what: string) => findings.push({ shot, check, severity, what });
  const ctx = await browser.newContext({
    viewport: { width: screen.width, height: screen.height },
    isMobile: screen.mobile,
    hasTouch: screen.mobile,
    reducedMotion: 'reduce',
    ...(state === 'near' ? { geolocation: HERE, permissions: ['geolocation'] } : {}),
  });
  await ctx.addInitScript('window.__name = (f) => f'); // tsx keeps function names with a helper the page lacks
  await ctx.addInitScript(() => {
    localStorage.setItem('seated.map.hello', JSON.stringify({ seen: true }));
    localStorage.setItem('seated.map.where', JSON.stringify({ asked: true }));
    localStorage.setItem('seated.map.you', JSON.stringify({ answers: {}, key: null, welcomed: true }));
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => add('page error', 'high', e.message));
  page.on('console', (m) => m.type() === 'error' && add('console error', 'medium', m.text()));
  try {
    await page.goto(`${BASE}${art === 'ours' ? '?art=ours' : ''}`);
    await settled(page);
    if (state === 'near') {
      // Joel's screen on 18 Nov 2026: location allowed and the Near me filter on.
      if (screen.mobile) await page.locator('.list-head .row').click();
      await page.getByRole('button', { name: 'Near me' }).click();
      await settled(page);
    }
    if (state === 'card' || state === 'reload') {
      if (screen.mobile) await page.locator('.list-head .row').click(); // the phone's closed list: one line
      await page.locator('.rows .row').first().click();
      await settled(page);
    }
    if (state === 'reload') {
      const before = new URL(page.url()).searchParams;
      const name = await page.locator('.card h2, .card h3').first().innerText().catch(() => '');
      await page.reload();
      await settled(page);
      const after = new URL(page.url()).searchParams;
      for (const key of new Set([...before.keys(), ...after.keys()])) {
        if (before.get(key) !== after.get(key)) add('link after reload', 'high', `?${key} was "${before.get(key)}", after a reload "${after.get(key)}"`);
      }
      if (art === 'ours' && after.get('art') !== 'ours') add('link after reload', 'high', 'the link lost ?art=ours, so a reload shows the other art');
      const again = await page.locator('.card h2, .card h3').first().innerText().catch(() => '');
      if (name && again !== name) add('link after reload', 'high', `the card was "${name}", after a reload "${again || 'gone'}"`);
    }
    const c = await page.evaluate(probeCanvas);
    // Fog: most of the open map should be city. Joel's 18 Nov screen with ?art=ours was mostly fog.
    if (c.fogShare > 0.35) add('fog', state === 'near' ? 'high' : 'medium', `${Math.round(c.fogShare * 100)}% of the open map is fog`);
    if (c.onFog.length) add('signs on fog', 'high', `${c.onFog.length} restaurant(s) stand on fog: ${c.onFog.slice(0, 8).join(', ')}`);
    if (c.youOver.length) add('character over a sign', 'medium', `your character covers the sign of ${c.youOver.join(', ')}`);
    for (const d of await page.evaluate(probeDom)) add('layout', /off the screen|wide on/.test(d) ? 'high' : 'medium', d);
  } catch (e) {
    add('scenario', 'high', `the scenario did not finish: ${(e as Error).message.split('\n')[0]}`);
  }
  await page.screenshot({ path: join(OUT, `${shot}.png`) }).catch(() => {});
  await ctx.close();
  return findings;
}

function judge(shots: string[], code: Finding[]): Finding[] {
  const prompt = `You judge the public map of Seated (a pixel-art isometric Amsterdam with restaurant signs) as a visitor would.
Read every screenshot in ${OUT}: ${shots.map((s) => `${s}.png`).join(', ')}.
Names: <art>-<screen width>-<state>. art "his" is sezlab's city art (the default); "ours" is Seated's own canal-belt drawing (?art=ours).
States: start (first view), near (location allowed, standing at Weteringschans, the Near me filter on), card (a restaurant's card open), reload (card open, then the page reloaded).
The code checks already found: ${JSON.stringify(code.map((f) => `${f.shot}: ${f.what}`))}. Do not repeat them.
Look for what a visitor would call broken or ugly: signs or your character covering each other, signs standing in fog or on empty ground,
panels covering the map or each other, cut-off, overlapping or unreadable text, giant or black icons, missing or half-loaded art,
straight cut lines or seams in the city art, empty lists or cards, a layout that does not fit the screen.
Report only what you can see. Severity high = a visitor would think the site is broken; medium = clearly wrong; low = polish.
Answer with JSON only, no prose: {"findings":[{"shot":"<name>","severity":"high|medium|low","what":"<one sentence: what and where>"}]}`;
  const r = spawnSync('claude', ['-p', '--model', 'opus', '--allowedTools', 'Read', '--add-dir', OUT], { input: prompt, encoding: 'utf8', timeout: 15 * 60_000 });
  const json = r.stdout?.match(/\{[\s\S]*\}/)?.[0];
  if (r.status !== 0 || !json) {
    return [{ shot: '-', check: 'judge', severity: 'high', what: `the Opus judge gave no answer (exit ${r.status}): run claude -p once by hand to see why; ${(r.stderr || '').slice(0, 200)}` }];
  }
  const parsed = JSON.parse(json) as { findings: Array<Omit<Finding, 'check'>> };
  return parsed.findings.map((f) => ({ ...f, check: 'judge' }));
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  if (!flag('--no-build')) {
    const b = spawnSync('npx', ['vite', 'build', '-c', 'vite.map.config.ts'], { stdio: 'inherit' });
    if (b.status !== 0) throw new Error('the map build failed: fix the build (npx vite build -c vite.map.config.ts) first');
  }
  const server: ChildProcess = spawn('npx', ['tsx', '--disable-warning=ExperimentalWarning', 'src/server/main.ts', '--demo'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
    detached: true,
  });
  const stop = () => {
    try {
      process.kill(-server.pid!);
    } catch {
      /* already gone */
    }
  };
  try {
    for (let i = 0; ; i++) {
      if (await fetch(`http://127.0.0.1:${PORT}/api/state`).then((r) => r.ok, () => false)) break;
      if (i > 120) throw new Error(`the demo server did not answer on :${PORT} in 60 s: is the port taken? (lsof -i :${PORT})`);
      await new Promise((r) => setTimeout(r, 500));
    }
    const browser = await chromium.launch();
    const findings: Finding[] = [];
    const shots: string[] = [];
    for (const art of ARTS) for (const screen of SCREENS) for (const state of STATES) {
      shots.push(`${art}-${screen.name}-${state}`);
      findings.push(...(await scenario(browser, art, screen, state)));
      process.stdout.write('.');
    }
    await browser.close();
    process.stdout.write('\n');
    if (flag('--judge')) findings.push(...judge(shots, findings));
    const failing = findings.filter((f) => f.severity !== 'low');
    writeFileSync(join(OUT, 'report.json'), JSON.stringify({ out: OUT, arts: ARTS, shots, failing: failing.length, findings }, null, 2));
    for (const f of findings) console.log(`${f.severity.padEnd(6)} ${f.shot.padEnd(18)} ${f.check}: ${f.what}`);
    console.log(`${shots.length} screens, ${failing.length} failing finding(s). Report: ${join(OUT, 'report.json')}`);
    process.exitCode = failing.length ? 1 : 0;
  } finally {
    stop();
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(2);
});
