import { expect, test, type Browser, type Page } from '@playwright/test';

// Where you are (Joel, 15 Nov 2026): on a first visit the host asks to use your location; yes puts your character on
// the map where you stand and opens the list nearest first. The browser's own question only follows a tap.
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/screens/map-${name}.png` });
const CHOUX = { latitude: 52.377548, longitude: 4.907157 }; // data/map-places.json (Graham's Kitchen until it left Seated curated, 17 Nov 2026)

async function visitor(browser: Browser, opts: { phone?: boolean } = {}): Promise<Page> {
  const ctx = await browser.newContext({
    geolocation: CHOUX,
    reducedMotion: 'reduce', // the character stops bobbing, so its pixels can be counted
    ...(opts.phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : {}),
  });
  await ctx.addInitScript(() => {
    localStorage.setItem('seated.map.hello', JSON.stringify({ seen: true }));
    localStorage.setItem('seated.map.you', JSON.stringify({ answers: {}, key: null, welcomed: true }));
  });
  return ctx.newPage();
}

/** Pixels of the no-character silhouette's outline colour (#6e6878) in the middle of the map, or, with `above`, in
 *  the whole map above that screen height (CSS pixels). */
const silhouette = (page: Page, above?: number) =>
  page.locator('canvas').evaluate((c: HTMLCanvasElement, above?: number) => {
    const ctx = c.getContext('2d')!;
    const k = c.width / c.clientWidth;
    const { data } = above
      ? ctx.getImageData(0, 0, c.width, Math.round(above * k))
      : ctx.getImageData(Math.round(c.width / 2) - 200, Math.round(c.height / 2) - 200, 400, 400);
    let n = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] === 0x6e && data[i + 1] === 0x68 && data[i + 2] === 0x78) n++;
    return n;
  }, above);

test('a first visit asks for your location; Show me puts you on the map and lists what is closest first', async ({ browser }) => {
  const page = await visitor(browser);
  await page.goto('/map/');
  const card = page.locator('.where');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Your location stays on this page');
  await shot(page, '20-where-card');
  const before = await silhouette(page);
  await page.context().grantPermissions(['geolocation']); // what the browser's own question does on "Allow"
  await card.getByRole('button', { name: 'Show me' }).click();
  await expect(card).toHaveCount(0);
  // The list opens nearest first: you stand at Choux.
  await expect(page.locator('.list-head .sum')).toContainText('nearest first');
  await expect(page.locator('.rows li').first()).toContainText('Choux');
  await expect(page.locator('.rows li').first()).toContainText('1 min by bike');
  // Your character (no character yet: the grey silhouette) stands where you are, in the middle after the flight.
  await expect.poll(async () => (await silhouette(page)) - before, { timeout: 5000 }).toBeGreaterThan(20);
  await shot(page, '21-where-you-are');
  // Asked once: the card does not come back.
  await page.reload();
  await expect(page.locator('.list-head h2')).toBeVisible();
  await expect(page.locator('.where')).toHaveCount(0);
  await page.context().close();
});

test('Not now keeps the card away; once the browser allows it, the map finds you without asking', async ({ browser }) => {
  const page = await visitor(browser);
  await page.goto('/map/');
  await page.locator('.where').getByRole('button', { name: 'Not now' }).click();
  await expect(page.locator('.where')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.list-head h2')).toBeVisible();
  await expect(page.locator('.where')).toHaveCount(0);
  // Allowed in this browser (as after an earlier yes): you are placed on load, the list keeps its usual order.
  const before = await silhouette(page);
  await page.context().grantPermissions(['geolocation']);
  await page.reload();
  await expect(page.locator('.list-head h2')).toBeVisible();
  await expect.poll(async () => (await silhouette(page)) - before, { timeout: 5000 }).toBeGreaterThan(20);
  await expect(page.locator('.list-head .sum')).not.toContainText('nearest first');
  await page.context().close();
});

test('on a phone the card sits above the list bar and Show me opens the list', async ({ browser }) => {
  const page = await visitor(browser, { phone: true });
  await page.goto('/map/');
  const card = page.locator('.where');
  await expect(card).toBeVisible();
  const box = (await card.boundingBox())!;
  const bar = (await page.locator('.list-head').boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(bar.y);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await shot(page, '22-where-phone');
  await page.context().grantPermissions(['geolocation']);
  await card.getByRole('button', { name: 'Show me' }).click();
  await expect(page.locator('.rows li').first()).toContainText('Choux');
  await expect(page.locator('.rows li').first()).toBeInViewport();
  // Half the screen, not all of it: your character stands in the map above the list (Joel, 19 Nov 2026).
  const side = (await page.locator('.side').boundingBox())!;
  expect(side.height).toBeLessThanOrEqual(844 * 0.47);
  // The rows come first: the nearest three show in full, over the search and chips.
  await shot(page, '23-where-phone-list');
  for (let i = 0; i < 3; i++) await expect(page.locator('.rows li').nth(i)).toBeInViewport({ ratio: 1 });
  await expect.poll(() => silhouette(page, side.y), { timeout: 5000 }).toBeGreaterThan(20);
  await shot(page, '23-where-phone-list');
  await page.context().close();
});
