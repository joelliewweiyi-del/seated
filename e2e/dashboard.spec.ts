import { expect, test, type Page } from '@playwright/test';

// One demo server, one in-memory database: these steps build on each other.
test.describe.configure({ mode: 'serial' });

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/screens/${name}.png`, fullPage: true });

async function today(page: Page): Promise<string> {
  const res = await page.request.get('/api/state');
  return (await res.json()).radar.today as string;
}

/** The next Thursday, Friday or Saturday from tomorrow on: never in the past, and always one of the three evenings shown. */
function nextEvening(from: string): string {
  const d = new Date(`${from}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  while (![4, 5, 6].includes(((d.getUTCDay() + 6) % 7) + 1)) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10); // a UTC-noon date: toISOString gives the same calendar day
}

async function openTable(page: Page, restaurantId: string, date: string, time: string) {
  await page.request.post('/api/demo/open', { data: { restaurantId, date, time }, headers: { 'X-Seated': '1' } });
}

async function closeTable(page: Page, restaurantId: string, date: string, time: string) {
  await page.request.post('/api/demo/close', { data: { restaurantId, date, time }, headers: { 'X-Seated': '1' } });
}

/** A check started from outside the page: only the live stream can tell the page about it. */
const checkFromOutside = (page: Page) => page.request.post('/api/check', { headers: { 'X-Seated': '1' } });

test('a new user sees an empty watch list with one clear next step', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Watch list' })).toBeVisible();
  await expect(page.getByText('No restaurants yet')).toBeVisible();
  await expect(page.getByLabel('Find a restaurant')).toBeVisible();
  await shot(page, '01-empty');
});

test('search finds a restaurant and watches Thursday to Saturday dinners in one tap', async ({ page }) => {
  await page.goto('/');
  const search = page.getByLabel('Find a restaurant');
  await search.fill('gitane');
  const result = page.getByTestId('search-result').filter({ hasText: 'Gitane' });
  await result.getByRole('button', { name: /Watch Thursday to Saturday dinners/ }).click();
  await expect(result.getByText('Watching')).toBeVisible();
  await shot(page, '02-search');

  // A restaurant Seated cannot read says so, instead of offering a watch.
  await search.fill('ciel bleu');
  await expect(page.getByTestId('search-result').filter({ hasText: 'Ciel Bleu' })).toContainText('Cannot read yet');
  await search.press('Escape');

  // The watch list shows the restaurant, with exactly three evenings: the coming Thursday, Friday and Saturday.
  const row = page.getByTestId('board-row').filter({ hasText: 'Gitane' });
  await expect(row).toBeVisible();
  const board = await (await page.request.get('/api/board')).json();
  expect(board.dates).toHaveLength(3);
  await expect(row.getByTestId('free')).toHaveText('0');
});

test('when a table opens or is taken, the watch list changes by itself, with a link to book', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('live-status')).toContainText('Live');
  const gitane = page.getByTestId('board-row').filter({ hasText: 'Gitane' });
  const evening = nextEvening(await today(page));

  await openTable(page, 'gitane', evening, '19:30');
  await checkFromOutside(page);
  await expect(gitane.getByTestId('free')).toHaveText('1');
  await expect(gitane.getByRole('link', { name: /Gitane, .*1 free, book/ })).toHaveAttribute('href', new RegExp(`date=${evening}`));
  await expect(page.getByTestId('feed-row').filter({ hasText: 'Gitane' }).first()).toContainText('Opened');
  await shot(page, '03-open-table');

  await closeTable(page, 'gitane', evening, '19:30');
  await checkFromOutside(page);
  await expect(gitane.getByTestId('free')).toHaveText('0');
  await expect(page.getByTestId('feed-row').filter({ hasText: 'Gitane' }).first()).toContainText('Taken');
});

test('remove asks once, inline, then removes', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Find a restaurant').fill('massalia');
  await page.getByTestId('search-result').filter({ hasText: 'Massalia' }).getByRole('button', { name: /Watch/ }).click();
  await page.getByLabel('Find a restaurant').press('Escape');
  const row = page.getByTestId('board-row').filter({ hasText: 'Massalia' });
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: 'Remove Restobar Massalia' }).click();
  await row.getByRole('button', { name: 'No' }).click();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Remove Restobar Massalia' }).click();
  await row.getByRole('button', { name: 'Yes, remove' }).click();
  await expect(row).toHaveCount(0);
  await expect(page.getByTestId('board-row').filter({ hasText: 'Gitane' })).toBeVisible(); // only that one went
});

test('settings: make a private push topic and save it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Generate' }).click();
  await expect(page.getByLabel('ntfy topic')).toHaveValue(/^seated-[0-9a-f]{16}$/);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  await shot(page, '04-settings');
});

test('the watch list and search fit a small phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  await expect(page.getByTestId('board-row').first()).toBeVisible();
  await shot(page, '05-mobile');
  await page.getByLabel('Find a restaurant').fill('bar');
  await expect(page.getByTestId('search-result').first()).toBeVisible();
  // Nothing may stick out sideways at 360px.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await shot(page, '06-mobile-search');
});
