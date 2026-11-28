import { expect, test, type Browser, type Page } from '@playwright/test';

// The welcome (choose your character: a scene, then a character), a character with a key, and lists, on the demo server. Its API runs the real
// supabase/schema.sql in PGlite, so these never touch the real project. Every visitor gets its own browser
// context and its own address (X-Forwarded-For), as separate people on separate connections would.
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/screens/map-${name}.png` });
const run = Date.now().toString(36);
let ip = 10;

/** Rows in the list, counting the places folded under "Book on their site (n)". */
async function listed(page: Page): Promise<number> {
  const fold = page.locator('.rows .fold[aria-expanded="false"]');
  const folded = (await fold.count()) ? Number((await fold.innerText()).match(/\((\d+)\)/)![1]) : 0;
  return (await page.locator('.rows .nm').count()) + folded;
}

async function visitor(browser: Browser, opts: { phone?: boolean } = {}): Promise<Page> {
  const ctx = await browser.newContext({
    extraHTTPHeaders: { 'x-forwarded-for': `10.0.${run.length}.${ip++}` },
    ...(opts.phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : {}),
  });
  // The location card (e2e/near.spec.ts) would sit over the map.
  await ctx.addInitScript(() => localStorage.setItem('seated.map.where', JSON.stringify({ asked: true })));
  return ctx.newPage();
}

const welcome = (page: Page) => page.getByRole('dialog');

/** Choose your character: the scene, then the character in it, then its list as it comes. The welcome closes on the map. */
async function choose(page: Page, scene: string, character: string) {
  await expect(welcome(page).getByRole('heading', { name: 'Choose your character' })).toBeVisible();
  await welcome(page).getByRole('button', { name: scene, exact: true }).click();
  await expect(welcome(page).getByRole('heading', { name: 'Who are you?' })).toBeVisible();
  await welcome(page).locator('.choice', { hasText: character }).click();
  await welcome(page).getByRole('button', { name: 'Show my list on the map' }).click();
  await expect(welcome(page)).toHaveCount(0);
}

/** Makes a character with a name and a key, from You. */
async function makeCharacter(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: 'You', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Make my character' }).click();
  await welcome(page).getByRole('button', { name: 'Next hair', exact: true }).click();
  await welcome(page).getByRole('button', { name: 'Next extra' }).click();
  await welcome(page).getByLabel('Name on your lists').fill(name);
  await welcome(page).getByRole('button', { name: 'Save my character' }).click();
  const key = welcome(page).getByLabel('Your Seated key');
  await expect(key).toHaveText(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);
  return (await key.innerText()).trim();
}

// Joel, 28 Nov 2026: "make it very easy for the user to keep their own list ... a screen with a suggested list and then
// a field where they can add a restaurant to that list and then have that be an ongoing process".
test('a first visit: choose your character, and your list starts as its picks; a field adds any restaurant, a card adds one in a tap, and the map shows the list', async ({ browser }) => {
  const page = await visitor(browser);
  await page.goto('/map/');
  await expect(welcome(page).getByRole('heading', { name: 'Choose your character' })).toBeVisible();
  await shot(page, '11-welcome');
  await welcome(page).getByRole('button', { name: 'Fashion', exact: true }).click();
  await shot(page, '12-characters');
  await welcome(page).locator('.choice', { hasText: 'Fashion Baddie' }).click();

  // Your list: her hand-picked places (taste.ts), without a character, a name or a key.
  await expect(welcome(page).getByRole('heading', { name: 'Your list' })).toBeVisible();
  const list = welcome(page).getByRole('list', { name: 'Your list', exact: true });
  await expect(list.locator('li')).toHaveCount(11);
  await expect(list.locator('li').first()).toContainText('Kamer');
  // The field finds any restaurant on the map by its name, accents or not; the new place leads the list.
  const field = welcome(page).getByLabel('Add a restaurant');
  await field.fill('elan');
  await welcome(page).getByRole('button', { name: 'Add Élan' }).click();
  await expect(list.locator('li').first()).toContainText('Élan');
  await expect(field).toHaveValue('');
  await expect(field).toBeFocused();
  await field.fill('bacal');
  await field.press('Enter'); // Enter takes the first name found
  await expect(list.locator('li').first()).toContainText('Bacalar');
  await field.fill('zzzz');
  await expect(welcome(page).locator('.mylist-rows.found')).toContainText('No restaurant with that name');
  await field.fill('');
  // A pick taken off stays on offer, and comes back in a tap.
  await list.getByRole('button', { name: 'Take Gitane off' }).click();
  await expect(list.locator('li')).toHaveCount(12);
  const offers = welcome(page).getByRole('list', { name: 'Suggested' });
  await expect(offers.locator('li')).toHaveText(/Gitane/);
  await shot(page, '12b-your-list');
  await offers.getByRole('button', { name: 'Add Gitane' }).click();
  await expect(offers).toHaveCount(0);
  await list.getByRole('button', { name: 'Take Gitane off' }).click();

  await welcome(page).getByRole('button', { name: 'Show my list on the map' }).click();
  await expect(welcome(page)).toHaveCount(0);
  await expect(page.locator('.chip.lens')).toHaveText('My list');
  // The You button and the chip wear the character's face.
  await expect(page.locator('.you-btn svg')).not.toHaveClass(/no-character/);
  await expect(page.locator('.chip.lens svg')).toBeVisible();
  await expect(page).toHaveURL(/[?&]lens=mine(&|$)/);
  await expect.poll(() => listed(page)).toBe(12);
  await shot(page, '12c-my-list-on-the-map');

  // It goes on: one tap on any card adds the place, and the list on the map follows.
  await page.getByLabel('Find a restaurant').fill('Zoldering');
  await page.locator('.hits .row', { hasText: 'Zoldering' }).first().click();
  const heart = page.locator('.card').getByRole('button', { name: 'My list' });
  await expect(heart).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.card').getByRole('button', { name: '+ List' })).toHaveCount(0); // named lists come with a character
  await heart.click();
  await expect(heart).toHaveAttribute('aria-pressed', 'true');
  await shot(page, '12d-card-my-list');
  await page.locator('.card').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByLabel('Find a restaurant').fill('');
  await expect.poll(() => listed(page)).toBe(13);

  // The list stays on this device: no welcome again, and it comes back from the link.
  await page.reload();
  await expect(page.locator('.chip.lens')).toHaveText('My list');
  await expect(welcome(page)).toHaveCount(0);
  await expect.poll(() => listed(page)).toBe(13);
  // Edit opens it again, with the place from the card on top; taking the last place off leaves every restaurant.
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(list.locator('li')).toHaveCount(13);
  await expect(list.locator('li').first()).toContainText('Zoldering');
  await page.keyboard.press('Escape');
  // The picker has it under "Your lists", with what is free today.
  await page.locator('.chip.lens').click();
  await expect(page.getByRole('dialog').getByRole('list', { name: 'My list', exact: true }).locator('.choice')).toContainText(/My list.*13 picks/s);
  await page.context().close();
});

test('your list without a character: empty, the picker opens it to be filled, and an empty list shows every restaurant', async ({ browser }) => {
  const page = await visitor(browser);
  await page.goto('/map/?lens=mine'); // somebody else's link to "my list": nothing on this device, so every restaurant
  await expect(page.locator('.chip.lens')).toHaveText('All places');
  await expect(welcome(page)).toHaveCount(0);
  await page.locator('.chip.lens').click();
  await page.getByRole('dialog').locator('.choice', { hasText: 'My list' }).click();
  await expect(welcome(page).getByRole('heading', { name: 'Your list' })).toBeVisible();
  await expect(welcome(page).getByText('Nothing on it yet.')).toBeVisible();
  await expect(welcome(page).getByRole('button', { name: 'Show my list on the map' })).toBeDisabled();
  await welcome(page).getByLabel('Add a restaurant').fill('scheeps');
  await welcome(page).getByRole('button', { name: 'Add Scheepskameel' }).click();
  await welcome(page).getByRole('button', { name: 'Show my list on the map' }).click();
  await expect(page.locator('.chip.lens')).toHaveText('My list');
  await expect.poll(() => listed(page)).toBe(1);
  // The last place off: the map is back to every restaurant.
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await welcome(page).getByRole('button', { name: 'Take Scheepskameel off' }).click();
  await welcome(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.chip.lens')).toHaveText('All places');
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
  // The You button brings the characters back.
  await page.getByRole('button', { name: 'You', exact: true }).click();
  await expect(welcome(page).getByRole('heading', { name: 'Choose your character' })).toBeVisible();
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
  await choose(a, 'Food', 'Tasting Menu Chaser');
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
  // The chosen character came with the key, so it lands on the map with its picks.
  await expect(welcome(b)).toHaveCount(0);
  await expect(b.locator('.chip.lens')).toHaveText('Tasting Menu Chaser');
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
  await choose(maker, 'Fashion', 'Fashion Baddie');
  await makeCharacter(maker, `Bo ${run}`);
  await welcome(maker).getByRole('button', { name: 'Done' }).click();
  await maker.goto('/map/?lens=all'); // every restaurant: the first three in the data need not be curated
  const names = await maker.evaluate(async () => (await (await fetch('/map/data.json')).json()).restaurants.slice(0, 3).map((r: { name: string }) => r.name));
  const title = `Dates ${run}`;
  for (const [i, n] of names.entries()) {
    await maker.getByLabel('Find a restaurant').fill(n);
    await maker.locator('.hits .row', { hasText: n }).first().click(); // the answers under the box; the list is away meanwhile
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

test('be a local: a ready-made Amsterdam character in one tap, with its line; a change makes it your own', async ({ browser }) => {
  const page = await visitor(browser);
  await page.goto('/map/');
  await choose(page, 'Food', 'Neighbourhood Regular');
  await page.getByRole('button', { name: 'You', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Make my character' }).click();
  const herring = welcome(page).locator('.local', { hasText: 'Herring eater' });
  await herring.click();
  await expect(herring).toHaveAttribute('aria-pressed', 'true');
  await expect(welcome(page).locator('.local-line')).toHaveText('Herring eater. Holds it by the tail. Onions, please.');
  await shot(page, '19-locals');
  await welcome(page).getByRole('button', { name: 'Next top' }).click();
  await expect(herring).toHaveAttribute('aria-pressed', 'false');
  await expect(welcome(page).locator('.local-line')).toHaveText('Or make your own below.');
  await welcome(page).locator('.local', { hasText: 'Canal skipper' }).click();
  await welcome(page).getByLabel('Name on your lists').fill(`Skip ${run}`);
  await welcome(page).getByRole('button', { name: 'Save my character' }).click();
  await expect(welcome(page).getByLabel('Your Seated key')).toBeVisible();
  await page.context().close();
});

test('on a phone the welcome and the character builder fit the screen, and the picks open as rows only', async ({ browser }) => {
  const page = await visitor(browser, { phone: true });
  await page.goto('/map/');
  await expect(welcome(page).getByRole('heading', { name: 'Choose your character' })).toBeVisible();
  const wide = () => page.evaluate(() => document.documentElement.scrollWidth);
  expect(await wide()).toBeLessThanOrEqual(390);
  // Every control on the welcome is at least 40 px tall to a thumb, the text links and the You button too.
  const tall = () => page.evaluate(() => [...document.querySelectorAll('[role=dialog] button, .you-btn')].map((b) => [b.textContent?.trim() || b.getAttribute('aria-label'), Math.round(b.getBoundingClientRect().height)] as const).filter(([, h]) => h > 0 && h < 40));
  expect(await tall()).toEqual([]);
  await shot(page, '17-phone-welcome');
  await welcome(page).getByRole('button', { name: 'Fashion', exact: true }).click();
  expect(await wide()).toBeLessThanOrEqual(390);
  expect(await tall()).toEqual([]);
  await welcome(page).locator('.choice', { hasText: 'Fashion Baddie' }).click();
  // Your list fits too, its way to the map in reach without scrolling.
  await expect(welcome(page).getByRole('heading', { name: 'Your list' })).toBeVisible();
  expect(await wide()).toBeLessThanOrEqual(390);
  expect(await tall()).toEqual([]);
  await expect(welcome(page).getByRole('button', { name: 'Show my list on the map' })).toBeInViewport({ ratio: 1 });
  await shot(page, '17c-phone-your-list');
  await welcome(page).getByRole('button', { name: 'Show my list on the map' }).click();
  // Her places as a half-height list of rows: no sum line, search or chips over the map.
  await expect(page.locator('.side.rows')).toBeVisible();
  await expect(page.locator('.side.rows .sum')).toBeHidden();
  await expect(page.locator('.side.rows .filters')).toBeHidden();
  await expect(page.locator('.side.rows .rows .row').first()).toBeVisible();
  const sheet = await page.locator('.side.rows').boundingBox();
  expect(sheet!.height).toBeLessThanOrEqual(844 * 0.5);
  await shot(page, '17b-phone-picks');
  await page.getByRole('button', { name: 'You', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Make my character' }).click();
  await expect(welcome(page).getByRole('button', { name: 'Save my character' })).toBeVisible();
  expect(await wide()).toBeLessThanOrEqual(390);
  expect(await tall()).toEqual([]);
  await shot(page, '18-phone-character');
  await page.context().close();
});
