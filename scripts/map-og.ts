// Makes the share card (og.jpg, 1200 x 630; a JPEG so WhatsApp, which drops large images, still shows it) that X, WhatsApp and others show for a seated.food link: the built map
// with today's signs, the panels hidden, and one line of our own text. Run by scripts/map-deploy.sh after the build.
//   npx tsx scripts/map-og.ts [dist/map]
// The card holds sezlab's city art, so it is written into the build only (dist/, gitignored), never into the repo.
// It serves the build from memory with the live data.json, and never writes a data.json into dist/map: a file there
// would shadow the /data.json rewrite to the Blob store and freeze the public map.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from '@playwright/test';

const dir = process.argv[2] ?? 'dist/map';
const DATA_URL = 'https://seated.food/data.json';
const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml',
};

const data = await (await fetch(DATA_URL)).text();
if (!data.startsWith('{')) throw new Error(`${DATA_URL} did not answer with JSON`);

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  if (path === '/data.json') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(data);
    return;
  }
  const file = normalize(join(dir, path.endsWith('/') ? `${path}index.html` : path));
  if (!file.startsWith(normalize(dir)) || !existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(await readFile(file));
});
await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
const port = (server.address() as { port: number }).port;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => {
    const m = (window as unknown as { seatedMap?: { pending(): number; target: unknown } }).seatedMap;
    return !!m && m.pending() === 0 && !m.target;
  }, null, { timeout: 60_000 });
  // One step closer than the opening view: fewer signs, each big enough to read in a small preview.
  await page.evaluate(() => (window as unknown as { seatedMap: { zoomBy(n: number): void } }).seatedMap.zoomBy(1));
  await page.waitForFunction(() => {
    const m = (window as unknown as { seatedMap?: { pending(): number; target: unknown } }).seatedMap;
    return !!m && m.pending() === 0 && !m.target;
  }, null, { timeout: 60_000 });
  // The panels go; one plain line of ours goes on.
  await page.addStyleTag({
    content: `.top, .side, .foot, .zoom, .toast { display: none !important; }
      .og { position: absolute; left: 32px; bottom: 32px; padding: 18px 30px 18px 24px; background: #fffaf0; color: #2b2733;
        font: 600 44px/1.1 'Pixelify Sans', monospace; box-shadow: 0 -3px 0 #2b2733, 0 3px 0 #2b2733, -3px 0 0 #2b2733,
        3px 0 0 #2b2733, 0 9px 0 rgba(43,39,51,.25); }
      .og small { display: block; margin-top: 8px; font: 600 26px/1.2 system-ui, sans-serif; color: #0f766e; }`,
  });
  await page.evaluate(() => {
    const el = document.createElement('div');
    el.className = 'og';
    el.innerHTML = 'Which Amsterdam restaurants<br>still have a table for two?<small>seated.food</small>';
    document.body.appendChild(el);
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(dir, 'og.jpg'), type: 'jpeg', quality: 88 });
  console.log(`wrote ${join(dir, 'og.jpg')}`);
} finally {
  await browser.close();
  server.close();
}
