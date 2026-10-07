import { expect, test, type Page } from '@playwright/test';

// One demo server, one in-memory database: these steps build on each other.
test.describe.configure({ mode: 'serial' });

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/screens/${name}.png`, fullPage: true });

async function today(page: Page): Promise<string> {
  const res = await page.request.get('/api/state');
  return (await res.json()).radar.today as string;
}

/** The next date on the given ISO weekday (1 = Mon), at least `minDays` ahead. */
function nextWeekday(from: string, weekday: number, minDays = 1): string {
  const d = new Date(`${from}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + minDays);
  while (((d.getUTCDay() + 6) % 7) + 1 !== weekday) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function openTable(page: Page, restaurantId: string, date: string, time: string) {
  await page.request.post('/api/demo/open', { data: { restaurantId, date, time }, headers: { 'X-Seated': '1' } });
}

async function closeTable(page: Page, restaurantId: string, date: string, time: string) {
  await page.request.post('/api/demo/close', { data: { restaurantId, date, time }, headers: { 'X-Seated': '1' } });
}

/** Presses "Check now" and waits until the check has run and the page has reloaded its state. */
async function checkNow(page: Page) {
  const checked = page.waitForResponse((r) => r.url().endsWith('/api/check'));
  await page.getByRole('button', { name: 'Check now' }).click();
  await checked;
  await page.waitForResponse((r) => r.url().endsWith('/api/state'));
}

test('a new user sees an empty radar with one clear next step', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('No watches yet')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add your first watch' })).toBeVisible();
  await shot(page, '01-empty');
});

test('adding a watch: pick a restaurant, set party and days, start watching', async ({ page }) => {
  await page.goto('/#/add');
  await expect(page.getByRole('button', { name: /Café de Klepel/ })).toBeVisible(); // the list has loaded
  await shot(page, '02-add-list');
  // Restaurants on booking systems Seated cannot read yet are listed but cannot be picked.
  await page.getByLabel('Search restaurants').fill('Ciel Bleu');
  await expect(page.getByRole('button', { name: /Ciel Bleu/ })).toBeDisabled();

  await page.getByLabel('Search restaurants').fill('klepel');
  await page.getByRole('button', { name: /Café de Klepel/ }).click();
  await expect(page.getByTestId('picked')).toHaveText('Café de Klepel');

  await page.getByRole('button', { name: 'More people' }).click();
  await page.getByRole('button', { name: 'More people' }).click();
  await expect(page.getByTestId('party-size')).toHaveText('4 people');

  for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Sun']) await page.getByRole('button', { name: day, exact: true }).click();
  await shot(page, '03-add-form');
  await page.getByRole('button', { name: 'Start watching' }).click();

  await expect(page).toHaveURL(/#\/$/);
  const row = page.getByTestId('watch-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Café de Klepel');
  await expect(row).toContainText(/4 people\s*·\s*Fri, Sat\s*·\s*18:30–21:00/);
  await expect(page.getByTestId('summary')).toContainText('No matching tables open right now');
});

test('when a matching table opens, it shows under "Open now" with a pre-filled booking link', async ({ page }) => {
  const friday = nextWeekday(await today(page), 5);
  await openTable(page, 'cafe-de-klepel', friday, '19:30');
  await openTable(page, 'cafe-de-klepel', friday, '17:00'); // outside the time window: must not show
  await page.goto('/');
  await checkNow(page);

  const open = page.getByTestId('open-table');
  await expect(open).toHaveCount(1);
  await expect(open).toContainText('19:30');
  const href = await open.getByRole('link', { name: 'Book now →' }).getAttribute('href');
  expect(href).toContain(`date=${friday}`);
  expect(href).toContain('partysize=4');
  await expect(page.getByTestId('summary')).toContainText('1 matching table is open right now');
  await shot(page, '04-open-table');
});

test('when the table is taken, it moves to "Recently gone" with how long it lasted', async ({ page }) => {
  const friday = nextWeekday(await today(page), 5);
  await closeTable(page, 'cafe-de-klepel', friday, '19:30');
  await page.goto('/');
  await checkNow(page);
  await expect(page.getByTestId('open-table')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Recently gone' })).toBeVisible();
  await expect(page.getByText(/open for/)).toBeVisible();
});

test('pause and resume a watch', async ({ page }) => {
  await page.goto('/');
  const row = page.getByTestId('watch-row');
  await row.getByRole('button', { name: 'Pause' }).click();
  await expect(row).toContainText('Paused');
  await row.getByRole('button', { name: 'Resume' }).click();
  await expect(row).toContainText('Watching');
});

test('adding an unknown restaurant explains what went wrong', async ({ page }) => {
  await page.goto('/#/add');
  await page.getByRole('button', { name: 'Restaurant not on the list?' }).click();
  await page.getByLabel('Name').fill('Nowhere');
  await page.getByLabel('Website or Formitable link').fill('not a link');
  await page.getByRole('button', { name: 'Add restaurant' }).click();
  await expect(page.getByText(/No Formitable booking widget found/)).toBeVisible();
});

test('settings: make a private push topic and save it', async ({ page }) => {
  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Generate' }).click();
  await expect(page.getByLabel('ntfy topic')).toHaveValue(/^seated-[0-9a-f]{16}$/);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  await shot(page, '05-settings');
});

test('auto-book stays locked until the guest details are filled in, then books one table', async ({ page }) => {
  await page.goto('/#/add');
  await page.getByLabel('Search restaurants').fill('gertrude');
  await page.getByRole('button', { name: /^Gertrude/ }).click();
  await expect(page.getByLabel(/Book it for me/)).toBeDisabled();

  await page.goto('/#/settings');
  await page.getByLabel('First name').fill('Ada');
  await page.getByLabel('Last name').fill('Lovelace');
  await page.getByLabel('Email').fill('ada@example.com');
  await page.getByRole('textbox', { name: /^Phone/ }).fill('+31600000000');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');

  await page.goto('/#/add');
  await page.getByLabel('Search restaurants').fill('gertrude');
  await page.getByRole('button', { name: /^Gertrude/ }).click();
  await page.getByLabel(/Book it for me/).check();
  await page.getByRole('button', { name: 'Start watching' }).click();
  await expect(page).toHaveURL(/#\/$/);

  const date = nextWeekday(await today(page), 3);
  await openTable(page, 'gertrude', date, '19:00');
  await openTable(page, 'gertrude', date, '20:00');
  await checkNow(page);
  await expect(page.getByRole('heading', { name: 'Your tables' })).toBeVisible();
  await expect(page.getByText('Booked by Seated', { exact: true })).toHaveCount(1);
  const bookedRow = page.getByTestId('watch-row').filter({ hasText: 'Gertrude' });
  await expect(bookedRow).toContainText('Booked');

  // A second check must not book a second table.
  await checkNow(page);
  await expect(page.getByText('Booked by Seated', { exact: true })).toHaveCount(1);
  await shot(page, '06-booked');
});

test('remove asks once, inline, then removes', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('watch-row').first()).toBeVisible(); // count only after the page has loaded
  const before = await page.getByTestId('watch-row').count();
  const row = page.getByTestId('watch-row').first();
  await row.getByRole('button', { name: 'Remove' }).click();
  await row.getByRole('button', { name: 'Yes, remove' }).click();
  await expect(page.getByTestId('watch-row')).toHaveCount(before - 1);
});

test('the radar works on a phone-sized screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const friday = nextWeekday(await today(page), 6);
  await page.goto('/#/add');
  await page.getByLabel('Search restaurants').fill('feline');
  await page.getByRole('button', { name: /Bistro Féline/ }).click();
  await page.getByRole('button', { name: 'Start watching' }).click();
  await openTable(page, 'bistro-feline', friday, '19:00');
  await checkNow(page);
  await expect(page.getByTestId('open-table')).toBeVisible();
  await shot(page, '07-mobile');
  await page.goto('/#/add');
  await shot(page, '08-mobile-add');
});

test('Tebi restaurants can be watched, but Seated explains it cannot book them for you', async ({ page }) => {
  await page.goto('/#/add');
  await page.getByLabel('Search restaurants').fill('bacalar');
  await page.getByRole('button', { name: /Bacalar/ }).click();
  await expect(page.getByLabel(/Book it for me/)).toBeDisabled();
  await expect(page.getByText(/Tebi protects its booking form with a captcha/)).toBeVisible();
});

test('the hot list ranks the hardest tables and watches Friday and Saturday dinners in one tap', async ({ page }) => {
  await page.goto('/#/hot');
  const rows = page.getByTestId('hot-row');
  await expect(rows.first()).toBeVisible();
  // Nearly impossible restaurants come first.
  await expect(rows.first().getByLabel('Nearly impossible')).toBeVisible();
  await shot(page, '09-hot-list');

  const gitane = rows.filter({ has: page.getByText('Gitane', { exact: true }) });
  await gitane.getByRole('button', { name: /Watch Friday and Saturday dinners/ }).click();
  await expect(gitane.getByText('Watching')).toBeVisible();

  // Restaurants on other systems say why they cannot be watched.
  const notYet = page.getByRole('region', { name: /Not supported yet/ });
  await expect(notYet.getByTestId('hot-row').filter({ hasText: 'Ciel Bleu' })).toContainText('TableCheck');

  await page.goto('/');
  await expect(page.getByTestId('watch-row').filter({ hasText: 'Gitane' })).toContainText(/Fri, Sat\s*·\s*18:30–21:30/);
});

test('the hot list fits a small phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/#/hot');
  await expect(page.getByTestId('hot-row').first()).toBeVisible();
  // Nothing may stick out sideways at 360px, including the four-item header.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await shot(page, '10-mobile-hot');
});

test('the live board updates by itself when a table opens or is taken, without a reload', async ({ page }) => {
  await page.goto('/#/live');
  await expect(page.getByTestId('live-status')).toContainText('Live');
  // Gitane got a Friday-and-Saturday watch from the hot list test above.
  const gitane = page.getByTestId('board-row').filter({ hasText: 'Gitane' });
  await expect(gitane.getByTestId('free')).toHaveText('0');

  const friday = nextWeekday(await today(page), 5);
  const check = () => page.request.post('/api/check', { headers: { 'X-Seated': '1' } });
  await openTable(page, 'gitane', friday, '19:30');
  await check(); // from outside the page: only the live stream can tell the page
  await expect(gitane.getByTestId('free')).toHaveText('1');
  await expect(page.getByTestId('feed-row').filter({ hasText: 'Gitane' }).first()).toContainText('Opened');
  await expect(gitane.getByRole('link', { name: /Gitane, .*1 free, book/ })).toHaveAttribute('href', new RegExp(`date=${friday}`));
  await shot(page, '11-live');

  await closeTable(page, 'gitane', friday, '19:30');
  await check();
  await expect(gitane.getByTestId('free')).toHaveText('0');
  await expect(page.getByTestId('feed-row').filter({ hasText: 'Gitane' }).first()).toContainText('Taken');
});

test('the live board fits a small phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/#/live');
  await expect(page.getByTestId('board-row').first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await shot(page, '12-mobile-live');
});

test('"I got it" records a table you booked yourself, stops the watch, and counts it as a win', async ({ page }) => {
  const saturday = nextWeekday(await today(page), 6);
  await page.goto('/');
  await openTable(page, 'gitane', saturday, '20:00');
  await checkNow(page);
  const table = page.getByTestId('open-table').filter({ hasText: 'Gitane' });
  await table.getByRole('button', { name: 'I got it' }).click();
  await table.getByRole('button', { name: 'No' }).click(); // asks first, because it stops the watch
  await expect(page.getByTestId('watch-row').filter({ hasText: 'Gitane' })).not.toContainText('Booked');
  await table.getByRole('button', { name: 'I got it' }).click();
  await table.getByRole('button', { name: 'Yes' }).click();
  await expect(page.getByText('Booked by you', { exact: true })).toHaveCount(1);
  await expect(page.getByTestId('watch-row').filter({ hasText: 'Gitane' })).toContainText('Booked');
  await shot(page, '13-got-it');

  // The Live page counts it, next to how fast Gitane's tables went.
  await page.goto('/#/live');
  await expect(page.getByTestId('funnel')).toContainText('1 booked by you');
  await expect(page.getByTestId('stats').getByText('Gitane')).toBeVisible();
  await shot(page, '14-live-stats');
});
