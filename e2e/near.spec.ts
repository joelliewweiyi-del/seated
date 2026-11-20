import { expect, test, type Browser, type Page } from '@playwright/test';

// Where you are (Joel, 15 Nov 2026; on load since 20 Nov 2026): the map flies to you as it opens, your character stands
// where you are, and Near me lists what is closest first.
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

test('on load the map flies to where you are, with no card first; the list keeps its usual order', async ({ browser }) => {
  // Joel, 20 Nov 2026: "When I load the page I want to be immediately transported to my location".
  const page = await visitor(browser);
  await page.context().grantPermissions(['geolocation']);
  // As on an iPhone: the permission reads "prompt" though the browser would allow it, so nothing may wait for "granted".
  await page.addInitScript(() => {
    navigator.permissions.query = () => Promise.resolve({ state: 'prompt' } as PermissionStatus);
  });
  await page.goto('/map/');
  await expect(page.locator('.list-head h2')).toBeVisible();
  // Your character (no character yet: the grey silhouette) stands where you are, in the middle after the flight.
  await expect.poll(() => silhouette(page), { timeout: 5000 }).toBeGreaterThan(20);
  await expect(page.locator('.where')).toHaveCount(0);
  await expect(page.locator('.list-head .sum')).not.toContainText('nearest first');
  await shot(page, '21-where-you-are');
  // Near me lists what is closest first: you stand at Choux.
  await page.locator('.chip', { hasText: 'Near me' }).click();
  await expect(page.locator('.list-head .sum')).toContainText('nearest first');
  await expect(page.locator('.rows li').first()).toContainText('Choux');
  await expect(page.locator('.rows li').first()).toContainText('1 min by bike');
  await page.context().close();
});

test('refused on load changes nothing; Near me then counts from the Dam; a link to a restaurant keeps its card', async ({ browser }) => {
  const page = await visitor(browser); // no permission: the browser says no
  await page.goto('/map/');
  await expect(page.locator('.list-head h2')).toBeVisible();
  await expect(page.locator('.note')).toHaveCount(0);
  expect(await silhouette(page)).toBe(0);
  await page.locator('.chip', { hasText: 'Near me' }).click();
  await expect(page.locator('.note')).toContainText('from the Dam');
  await page.context().grantPermissions(['geolocation']);
  const id = await page.evaluate(async () => (await (await fetch('/map/data.json')).json()).restaurants.at(-1).id);
  await page.goto(`/map/?r=${id}`);
  await expect(page.locator('.card h2')).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page.locator('.card h2')).toBeVisible();
  await page.context().close();
});

test('on a phone Near me opens the list half-height, you in the map above it', async ({ browser }) => {
  const page = await visitor(browser, { phone: true });
  await page.context().grantPermissions(['geolocation']);
  await page.goto('/map/');
  await expect.poll(() => silhouette(page), { timeout: 5000 }).toBeGreaterThan(20);
  await page.locator('.head-toggle').click();
  await page.locator('.chip', { hasText: 'Near me' }).click();
  await expect(page.locator('.rows li').first()).toContainText('Choux');
  await expect(page.locator('.rows li').first()).toBeInViewport();
  // Half the screen, not all of it: your character stands in the map above the list (Joel, 19 Nov 2026).
  const side = (await page.locator('.side').boundingBox())!;
  expect(side.height).toBeLessThanOrEqual(844 * 0.47);
  // The rows come first: the nearest three show in full, over the search and chips.
  for (let i = 0; i < 3; i++) await expect(page.locator('.rows li').nth(i)).toBeInViewport({ ratio: 1 });
  await expect.poll(() => silhouette(page, side.y), { timeout: 5000 }).toBeGreaterThan(20);
  await shot(page, '23-where-phone-list');
  await page.context().close();
});
