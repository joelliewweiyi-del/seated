import { expect, test, type Page } from '@playwright/test';

// The public map on the demo server: fake calendars, no request to any restaurant.
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/screens/map-${name}.png` });

/** Waits until every chunk in view is painted and the camera stands still. */
async function settled(page: Page) {
  await page.waitForFunction(
    () => {
      const m = (window as unknown as { seatedMap?: { pending(): number; target: unknown } }).seatedMap;
      return !!m && m.pending() === 0 && !m.target;
    },
    null,
    { timeout: 30_000 },
  );
}

test('the map opens on today with every readable restaurant and a list of who has a table', async ({ page }) => {
  await page.goto('/map/');
  await expect(page.getByRole('heading', { name: 'Seated' })).toBeVisible();
  await expect(page.locator('.list-head h2')).toHaveText(/^\w+day \d{1,2} \w{3}$/);
  await expect(page.getByText(/of \d+ have a table for two/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Free only' })).toBeVisible();
  await settled(page);
  await shot(page, '01-home');
});

test('Esra never appears on the map (CLAUDE.md hard rule 2), and the data holds no personal details', async ({ page }) => {
  const res = await page.request.get('/map/data.json');
  const text = await res.text();
  expect(text).not.toContain('"esra"');
  for (const secret of ['demo@example.com', '+31600000000', 'Demo Guest']) expect(text).not.toContain(secret);
  await page.goto('/map/');
  await page.getByLabel('Find a restaurant').fill('esra');
  await expect(page.getByText('No restaurant matches that.')).toBeVisible();
});

test('picking a restaurant flies to it and opens its card with a link to its own booking page', async ({ page }) => {
  await page.goto('/map/');
  await page.getByLabel('Find a restaurant').fill('Bacalar');
  await page.locator('.rows .row').filter({ hasText: 'Bacalar' }).click();
  const card = page.locator('.card');
  await expect(card.getByRole('heading', { name: 'Bacalar' })).toBeVisible();
  await expect(card.locator('.state b')).toContainText(/:/);
  await expect(card.getByRole('link', { name: /Book|Booking page/ })).toHaveAttribute('href', /^https:\/\//);
  await expect(page).toHaveURL(/[?&]r=bacalar/);
  await settled(page);
  await shot(page, '02-card');
});

test('the card calendar changes the day for the whole map, and the link keeps it', async ({ page }) => {
  await page.goto('/map/?r=bacalar');
  const days = page.locator('.cal-grid button');
  await days.nth(9).click();
  await expect(page).toHaveURL(/[?&]date=\d{4}-\d{2}-\d{2}/);
  const date = new URL(page.url()).searchParams.get('date')!;
  await expect(page.locator('.day[aria-pressed="true"]')).toHaveCount(1);
  await page.goto(`/map/?date=${date}`);
  await expect(page.locator('.list-head h2')).toHaveText(new RegExp(`\\b${Number(date.slice(8))} `));
});

test('a closed day shows a closed room, and restaurants learn how to opt out', async ({ page }) => {
  // The demo calendar closes every restaurant on Mondays.
  await page.goto('/map/');
  const monday = await page.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
    return d.toLocaleDateString('en-CA');
  });
  await page.goto(`/map/?date=${monday}&r=bacalar`);
  await expect(page.locator('.card .state b')).toContainText('closed');
  await settled(page);
  await shot(page, '03-closed');
  await page.getByRole('button', { name: 'For restaurants' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'For restaurants' })).toBeVisible();
  await expect(dialog).toContainText('off the map within a day');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('on a phone the map, the date strip and the list sheet all fit', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto('/map/');
  await expect(page.locator('.dates')).toBeVisible();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
  await page.locator('.list-head .row').click();
  await expect(page.locator('.rows')).toBeVisible();
  await page.locator('.rows .row').first().click();
  await expect(page.locator('.card h2')).toBeVisible();
  await expect(page.locator('.card').getByRole('link', { name: /Book|Booking page/ })).toBeInViewport();
  await settled(page);
  await shot(page, '04-phone-card');
  await page.close();
});

test('picking a free time makes it the one to book: the Book button and its link follow it', async ({ page }) => {
  // One restaurant with two free times today and a Formitable link, which carries the time in minutes.
  await page.route('**/map/data.json', async (route) => {
    const data = await (await route.fetch()).json();
    const r = data.restaurants[0];
    r.d = `o${r.d.slice(1)}`;
    r.t[data.start] = ['18:00', '20:30'];
    r.book[data.start] = `https://widget.formitable.com/side/en/abc12345/book?partysize=2&date=${data.start}&time=1080`;
    route.fulfill({ json: data });
  });
  await page.goto('/map/');
  const id = await page.evaluate(async () => (await (await fetch('/map/data.json')).json()).restaurants[0].id);
  await page.goto(`/map/?r=${id}`);
  const times = page.locator('.card .time');
  await expect(times).toHaveText(['18:00', '20:30']);
  await expect(times.first()).toHaveAttribute('aria-pressed', 'true'); // the first free time until you pick
  await times.nth(1).click();
  await expect(times.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(times.first()).toHaveAttribute('aria-pressed', 'false');
  const book = page.locator('.card').getByRole('link', { name: /^Book 20:30 on/ });
  await expect(book).toHaveAttribute('href', /[?&]time=1230(&|$)/);
});

test('the keyboard reaches the list past the date strip in a few steps, and arrow keys change the day', async ({ page }) => {
  await page.goto('/map/');
  await expect(page.locator('.list-head h2')).toBeVisible();
  const before = await page.locator('.day[aria-pressed="true"]').getAttribute('aria-label');
  // Today, Fri, Sat (and New Year's Eve in December), the chosen day, the later-days button, then the list.
  let reached = false;
  for (let i = 0; i < 9 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => !!document.activeElement?.closest('.list'));
  }
  expect(reached).toBe(true);
  await page.locator('.day[aria-pressed="true"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.day[aria-pressed="true"]')).not.toHaveAttribute('aria-label', before!);
  await expect(page.locator('.day[aria-pressed="true"]')).toBeFocused();
});
