/**
 * Map speed on a phone (Joel, 19 Nov 2026: "laggy on my chrome mobile", goal 10x). Chrome on the Mac's GPU at a
 * phone's 390x844, dpr 3, opened on a card (?r=gitane). Measures, per run:
 *   load      until every image is in and the camera is still, with the CPU slowed 4x; the longest main-thread freeze
 *   decoded   megabytes of decoded images the map holds (width x height x 4), and image megabytes downloaded
 *   idle      frames the map draws per second with the card open and nobody touching it
 *   cpu/frame main-thread ms of one frame while panning, CPU slowed 4x, at zoom 0.125, 0.5 and 2
 *   gpu/frame ms of one frame including the GPU (a 1-pixel read waits for it), CPU at full speed
 *   npx tsx scripts/map-perf.ts [base=http://127.0.0.1:4320/map/]
 */
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://127.0.0.1:4320/map/';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.addInitScript(`window.__lt = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ type: 'longtask', buffered: true });`);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
const t0 = Date.now();
await page.goto(`${base}?r=gitane`, { waitUntil: 'load' });
await page.waitForFunction('window.seatedMap && window.seatedMap.pending() === 0 && !window.seatedMap.target', null, { timeout: 120000, polling: 200 });
await page.waitForTimeout(1500); // the fog edge is built on the first frames
const loadMs = Date.now() - t0;
const freeze = Number(await page.evaluate('Math.round(Math.max(0, ...window.__lt))'));

const idle = Number(await page.evaluate(`new Promise((r) => { const v = window.seatedMap; let n = 0; const d = v.draw.bind(v);
  v.draw = (t) => { n++; d(t); }; setTimeout(() => { v.draw = d; r(n / 3); }, 3000); })`));

const frame = (z: number, gpu: boolean) => page.evaluate(`(async () => { const v = window.seatedMap; v.target = null; v.cam = { ...v.cam, z: ${z} };
  for (let i = 0; i < 40; i++) { v.cam = { ...v.cam, x: v.cam.x + 4 / ${z} }; v.draw(performance.now()); }
  v.cam = { ...v.cam, x: v.cam.x - 160 / ${z} };
  const t = Date.now(); while (v.pending() > 0 && Date.now() - t < 20000) await new Promise((r) => setTimeout(r, 100));
  for (let i = 0; i < 5; i++) { v.draw(performance.now()); await new Promise((r) => setTimeout(r, 50)); } // fog tiles built
  const g = v.canvas.getContext('2d'); g.getImageData(0, 0, 1, 1);
  const s = performance.now();
  for (let i = 0; i < 40; i++) { v.cam = { ...v.cam, x: v.cam.x + 4 / ${z} }; v.draw(performance.now()); ${gpu ? 'g.getImageData(0, 0, 1, 1);' : ''} }
  return (performance.now() - s) / 40; })()`).then(Number);
const cpu: Record<string, number> = {};
for (const z of [0.125, 0.5, 2]) cpu[z] = await frame(z, false);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
const gpu: Record<string, number> = {};
for (const z of [0.125, 0.5, 2]) gpu[z] = await frame(z, true);
const decoded = Number(await page.evaluate(`(() => { const v = window.seatedMap; let px = 0;
  const add = (img) => { if (img && img.naturalWidth) px += img.naturalWidth * img.naturalHeight; };
  for (const t of v.tiles.values()) if (t.ok) add(t.img);
  add(v.overview && v.overview.ok && v.overview.img); add(v.oursOverview && v.oursOverview.ok && v.oursOverview.img);
  const f = v.fogMask; if (f && f.width) px += f.width * f.height; if (f && f.tiles) px += [...f.tiles.values()].filter(Boolean).length * 128 * 128;
  return px * 4 / 1e6; })()`));
const bytes = Number(await page.evaluate(`performance.getEntriesByType('resource').filter((r) => /\\.png/.test(r.name)).reduce((a, r) => a + r.encodedBodySize, 0)`));
const r1 = (n: number) => (n < 10 ? n.toFixed(2) : n.toFixed(0));
console.log(`${base}
  load ${loadMs} ms, longest freeze ${freeze} ms (CPU 4x slower)
  images held ${decoded.toFixed(0)} MB decoded, ${(bytes / 1e6).toFixed(1)} MB downloaded
  idle ${idle.toFixed(1)} frames/s with a card open
  cpu/frame  z0.125 ${r1(cpu[0.125]!)}  z0.5 ${r1(cpu[0.5]!)}  z2 ${r1(cpu[2]!)} ms (CPU 4x slower)
  gpu/frame  z0.125 ${r1(gpu[0.125]!)}  z0.5 ${r1(gpu[0.5]!)}  z2 ${r1(gpu[2]!)} ms`);
console.log(JSON.stringify({ base, loadMs, freeze, decoded, mb: bytes / 1e6, idle, cpu, gpu }));
await browser.close();
