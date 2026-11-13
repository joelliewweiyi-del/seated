import { expect, test, type Browser, type Page } from '@playwright/test';

// The welcome (two questions, a profile, a character) and lists, on the demo server. Its API runs the real
// supabase/schema.sql in PGlite, so these never touch the real project. Every visitor gets its own browser
// context and its own address (X-Forwarded-For), as separate people on separate connections would.
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/screens/map-${name}.png` });
const run = Date.now().toString(36);
let ip = 10;

async function visitor(browser: Browser, opts: { phone?: boolean } = {}): Promise<Page> {
  const ctx = await browser.newContext({
    extraHTTPHeaders: { 'x-forwarded-for': `10.0.${run.length}.${ip++}` },
    ...(opts.phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : {}),
  });
  return ctx.newPage();
}

const welcome = (page: Page) => page.getByRole('dialog');

async function answer(page: Page, night: string, win: string) {
  await expect(welcome(page).getByRole('heading', { name: "What's the night?" })).toBeVisible();
  await welcome(page).getByRole('button', { name: new RegExp(`^${night}`) }).click();
  await expect(welcome(page).getByRole('heading', { name: 'What makes it a great dinner?' })).toBeVisible();
  await welcome(page).getByRole('button', { name: new RegExp(`^${win}`) }).click();
}

async function makeCharacter(page: Page, name: string): Promise<string> {
  await welcome(page).getByRole('button', { name: 'Make my character' }).click();
  await welcome(page).getByRole('button', { name: 'Next hair', exact: true }).click();
  await welcome(page).getByRole('button', { name: 'Next extra' }).click();
  await welcome(page).getByLabel('Name on your lists').fill(name);
  await welcome(page).getByRole('button', { name: 'Save my character' }).click();
  const key = welcome(page).getByLabel('Your Seated key');
  await expect(key).toHaveText(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);
  return (await key.innerText()).trim();
}

test('a first visit asks two questions, names a profile, puts free tables first, and shows the picks as a lens', async ({ browser }) => {
  const page = await visitor(browser);
  await page.goto('/map/');
  await expect(welcome(page).locator('.step-count')).toHaveText('1 of 2');
  await shot(page, '11-welcome');
  await answer(page, 'Date night', 'Natural wine');
  await expect(welcome(page).getByRole('heading', { name: 'Natural Wine Wanderer' })).toBeVisible();
  const badges = await welcome(page).locator('.picks .badge').evaluateAll((els) => els.map((e) => e.classList.contains('open')));
  expect(badges).toHaveLength(5);
  // Free tables first: once a row is not free, no free row follows.
  expect(badges.indexOf(false) === -1 || !badges.slice(badges.indexOf(false)).includes(true)).toBe(true);
  await shot(page, '12-profile');
  await welcome(page).getByRole('button', { name: 'Show my picks on the map' }).click();
  await expect(welcome(page)).toHaveCount(0);
  await expect(page.locator('.chip.lens')).toHaveText('For you');
  await expect(page.locator('.lens-line')).toContainText('Natural Wine Wanderer');
  await expect(page).toHaveURL(/[?&]lens=you(&|$)/);
  await expect(page.locator('.rows .nm')).toHaveCount(12);
  // The answers stay on this device: no welcome again, and the picks come back from the link.
  await page.reload();
  await expect(page.locator('.chip.lens')).toHaveText('For you');
  await expect(welcome(page)).toHaveCount(0);
  await page.context().close();
});

test('skipping leaves the map and the welcome never opens by itself again; a link to a restaurant never opens it', async ({ browser }) => {
  const page = await visitor(browser);
  await page.goto('/map/');
  await welcome(page).getByRole('button', { name: 'Skip, show me the map' }).click();
  // No character yet: the You button shows a grey silhouette, never an empty box.
  expect(await page.locator('.you-btn svg').boundingBox()).toMatchObject({ width: 28, height: 28 });
  await page.locator('.you-btn').screenshot({ path: 'test-results/screens/map-19-you-button.png', scale: 'css' });
  await expect(welcome(page)).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.list-head h2')).toBeVisible();
  await expect(welcome(page)).toHaveCount(0);
  // The You button brings the questions back.
  await page.getByRole('button', { name: 'You', exact: true }).click();
  await expect(welcome(page).getByRole('heading', { name: "What's the night?" })).toBeVisible();
  await page.context().close();

  const linked = await visitor(browser);
  await linked.goto('/map/?r=bacalar');
  await expect(linked.locator('.card h2')).toHaveText('Bacalar');
  await expect(welcome(linked)).toHaveCount(0);
  await linked.context().close();
});

test('a character: made once with a key, opened on another device with the key typed loosely, then deleted', async ({ browser }) => {
  const a = await visitor(browser);
  await a.goto('/map/');
  await answer(a, 'Something special', "The chef's menu");
  await expect(welcome(a).getByRole('heading', { name: 'Tasting Menu Chaser' })).toBeVisible();
  const key = await makeCharacter(a, `Ana ${run}`);
  await shot(a, '13-key');
  await welcome(a).getByRole('button', { name: 'Done' }).click();
  await expect(a.getByRole('button', { name: `You: Ana ${run}` })).toBeVisible();

  // Another device: no answers, no key. "Have an account?" with the key in lower case, spaces for dashes.
  const b = await visitor(browser);
  await b.goto('/map/');
  await welcome(b).getByRole('button', { name: 'Have an account? Use your key' }).click();
  await welcome(b).getByLabel('Your Seated key').fill(key.toLowerCase().replaceAll('-', ' '));
  await welcome(b).getByRole('button', { name: 'Open my character' }).click();
  // The answers came with the character, so it lands on the profile.
  await expect(welcome(b).getByRole('heading', { name: 'Tasting Menu Chaser' })).toBeVisible();
  await welcome(b).getByRole('button', { name: 'Close' }).click();
  await expect(b.getByRole('button', { name: `You: Ana ${run}` })).toBeVisible();

  // A wrong key says what to do.
  const c = await visitor(browser);
  await c.goto('/map/');
  await welcome(c).getByRole('button', { name: 'Have an account? Use your key' }).click();
  await welcome(c).getByLabel('Your Seated key').fill('AAAA-BBBB-CCCC-DDDD');
  await welcome(c).getByRole('button', { name: 'Open my character' }).click();
  await expect(welcome(c).locator('.trouble')).toContainText('No character has this key. Check the key for typos');
  await c.context().close();

  // Delete on B; A finds out on its next load and forgets the key.
  await b.getByRole('button', { name: `You: Ana ${run}` }).click();
  await b.getByRole('dialog').getByRole('button', { name: 'Delete my character' }).click();
  await b.getByRole('dialog').getByRole('button', { name: 'Delete for good' }).click();
  await expect(b.getByRole('button', { name: 'You', exact: true })).toBeVisible();
  await a.reload();
  await expect(a.getByRole('button', { name: 'You', exact: true })).toBeVisible();
  await a.context().close();
  await b.context().close();
});

test('lists: add places from their cards, see the list as a lens, share it in Community; three reports hide it', async ({ browser }) => {
  test.setTimeout(90_000);
  const maker = await visitor(browser);
  await maker.goto('/map/');
  await answer(maker, 'Date night', 'Natural wine');
  await makeCharacter(maker, `Bo ${run}`);
  await welcome(maker).getByRole('button', { name: 'Done' }).click();
  const names = await maker.evaluate(async () => (await (await fetch('/map/data.json')).json()).restaurants.slice(0, 3).map((r: { name: string }) => r.name));
  const title = `Dates ${run}`;
  for (const [i, n] of names.entries()) {
    await maker.getByLabel('Find a restaurant').fill(n);
    await maker.locator('.rows .row', { hasText: n }).first().click();
    await maker.locator('.card').getByRole('button', { name: '+ List' }).click();
    const pop = maker.getByRole('group', { name: 'Add to a list' });
    if (i === 0) {
      await pop.getByLabel('New list name').fill(title);
      await pop.getByRole('button', { name: 'Add' }).click();
    } else await pop.getByLabel(title).check();
    await expect(pop.getByLabel(title)).toBeChecked();
    if (i === 0) await shot(maker, '14-add-to-list');
    await maker.locator('.card').getByRole('button', { name: 'Close', exact: true }).click();
  }
  await maker.getByLabel('Find a restaurant').fill('');
  // In the picker: the list is yours and private; share it in Community.
  await maker.locator('.chip.lens').click();
  const picker = maker.getByRole('dialog');
  const mine = picker.getByRole('list', { name: 'Your lists' });
  await expect(mine.locator('.choice', { hasText: title })).toContainText('3 picks');
  await expect(mine.locator('.choice', { hasText: title })).toContainText('Only you');
  await mine.getByRole('button', { name: `Edit ${title}` }).click();
  await picker.getByText('Share it in Community').click();
  await picker.locator('.list-editor').getByRole('button', { name: 'Save' }).click();
  await expect(mine.locator('.choice', { hasText: title })).toContainText('In Community');
  await shot(maker, '15-your-lists');
  await mine.locator('.choice', { hasText: title }).click();
  await expect(maker.locator('.chip.lens')).toHaveText(title);
  await expect(maker.locator('.rows .nm')).toHaveCount(3);
  await expect(maker).toHaveURL(/[?&]list=[0-9a-f-]{36}(&|$)/);
  const link = maker.url();

  // Someone else sees it in Community, with the maker's name, and opens it by its link too.
  const fan = await visitor(browser);
  await fan.goto('/map/?lens=nobody');
  await fan.locator('.chip.lens').click();
  const community = fan.getByRole('dialog').getByRole('list', { name: 'Community lists' });
  await expect(community.locator('.choice', { hasText: title })).toContainText(`Bo ${run}`);
  await community.scrollIntoViewIfNeeded();
  await shot(fan, '16-community');
  await fan.keyboard.press('Escape');
  await fan.goto(link.replace(/^https?:\/\/[^/]+/, ''));
  await expect(fan.locator('.chip.lens')).toHaveText(title);
  await expect(fan.locator('.lens-line')).toContainText(`Bo ${run}`);
  await expect(fan.locator('.rows .nm')).toHaveCount(3);

  // Three people report it: it leaves Community.
  for (let i = 0; i < 3; i++) {
    const p = await visitor(browser);
    await p.goto('/map/?lens=nobody');
    await p.locator('.chip.lens').click();
    const list = p.getByRole('dialog').getByRole('list', { name: 'Community lists' });
    await list.getByRole('button', { name: `Report ${title}` }).click();
    await list.getByRole('button', { name: 'Report', exact: true }).click();
    await expect(list.getByText('Reported. Thanks.')).toBeVisible();
    await p.context().close();
  }
  const later = await visitor(browser);
  await later.goto('/map/?lens=nobody');
  await later.locator('.chip.lens').click();
  await expect(later.getByRole('dialog').locator('.community')).not.toContainText(title);
  await later.context().close();
  await fan.context().close();
  await maker.context().close();
});

test('on a phone the welcome and the character builder fit the screen', async ({ browser }) => {
  const page = await visitor(browser, { phone: true });
  await page.goto('/map/');
  await expect(welcome(page).getByRole('heading', { name: "What's the night?" })).toBeVisible();
  const wide = () => page.evaluate(() => document.documentElement.scrollWidth);
  expect(await wide()).toBeLessThanOrEqual(390);
  // Every control on the welcome is at least 40 px tall to a thumb, the text links and the You button too.
  const tall = () => page.evaluate(() => [...document.querySelectorAll('[role=dialog] button, .you-btn')].map((b) => [b.textContent?.trim() || b.getAttribute('aria-label'), Math.round(b.getBoundingClientRect().height)] as const).filter(([, h]) => h > 0 && h < 40));
  expect(await tall()).toEqual([]);
  await shot(page, '17-phone-welcome');
  await answer(page, 'Easy and good', 'A local spot');
  await expect(welcome(page).getByRole('heading', { name: 'Neighbourhood Regular' })).toBeVisible();
  await welcome(page).getByRole('button', { name: 'Make my character' }).click();
  await expect(welcome(page).getByRole('button', { name: 'Save my character' })).toBeVisible();
  expect(await wide()).toBeLessThanOrEqual(390);
  expect(await tall()).toEqual([]);
  await shot(page, '18-phone-character');
  await page.context().close();
});
