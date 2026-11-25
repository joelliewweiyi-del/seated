import { expect, test, type Page } from '@playwright/test';

// The public map on the demo server: fake calendars, no request to any restaurant.
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/screens/map-${name}.png` });

/** Waits until every chunk in view is painted and the camera stands still. */
/** Rows in the list, counting the places folded under "Book on their site (n)". */
async function listed(page: Page): Promise<number> {
  const fold = page.locator('.rows .fold[aria-expanded="false"]');
  const folded = (await fold.count()) ? Number((await fold.innerText()).match(/\((\d+)\)/)![1]) : 0;
  return (await page.locator('.rows .nm').count()) + folded;
}

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

// The host's one-time nudge would pop up over the map mid-test; it has its own test on a fresh page.
test.beforeEach(({ page }) =>
  page.addInitScript(() => {
    try {
      localStorage.setItem('seated.map.hello', JSON.stringify({ seen: true }));
      // The location card (e2e/near.spec.ts) would sit over the map.
      localStorage.setItem('seated.map.where', JSON.stringify({ asked: true }));
      // The welcome (choose your character) opens on a first visit; e2e/you.spec.ts covers it.
      if (!localStorage.getItem('seated.map.you')) localStorage.setItem('seated.map.you', JSON.stringify({ answers: {}, key: null, welcomed: true }));
    } catch {
      /* no storage: the nudge test covers it */
    }
  }),
);

test('the map opens on today with every readable restaurant and a list of who has a table', async ({ page }) => {
  await page.goto('/map/');
  await expect(page.getByRole('heading', { name: 'Seated' })).toBeVisible();
  await expect(page.locator('.daypill')).toHaveText(/^\w+day \d{1,2} \w{3}/);
  await expect(page.locator('.list-head h2')).toHaveText(/^\d+ free$/);
  await expect(page.locator('.dates')).toHaveCount(0); // the day strip opens on demand
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
  await expect(page.locator('.daypill')).toHaveText(new RegExp(`\\b${Number(date.slice(8))} `));
  await page.goto(`/map/?date=${date}`);
  await expect(page.locator('.daypill')).toHaveText(new RegExp(`\\b${Number(date.slice(8))} `));
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
  await page.getByRole('button', { name: 'How it works' }).click();
  await page.getByRole('button', { name: 'For restaurants' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'For restaurants' })).toBeVisible();
  await expect(dialog).toContainText('off the map within a day');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('on a phone the map, the day bar and the list sheet all fit, and the chrome stays small', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.addInitScript(() => localStorage.setItem('seated.map.you', JSON.stringify({ answers: {}, key: null, welcomed: true })));
  await page.goto('/map/');
  await expect(page.locator('.daypill')).toBeVisible();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
  // Closed, the top bar and the list sheet together leave at least 80% of the screen to the map (Joel, 6 Nov 2026).
  const chrome = await page.evaluate(() => {
    const h = (sel: string) => document.querySelector(sel)!.getBoundingClientRect().height;
    return h('.top') + h('.side > *') + h('.foot');
  });
  expect(chrome).toBeLessThan(844 * 0.2);
  await settled(page);
  await shot(page, '04-phone-home');
  // The day strip opens from the day, and a picked day closes it again.
  await page.locator('.daypill').click();
  await expect(page.locator('.dates')).toBeVisible();
  await shot(page, '05-phone-days');
  await page.locator('.day').nth(3).click();
  await expect(page.locator('.dates')).toHaveCount(0);
  await page.locator('.list-head .row').click();
  await expect(page.locator('.rows')).toBeVisible();
  await expect(page.locator('.sheet-toggle')).toHaveText('Show map');
  await shot(page, '06a-phone-list');
  // One scroll (Joel, 20 Nov 2026: the rows got two lines of a phone): search and chips scroll away, the count and
  // Show map stay on top, and the rows fill the sheet.
  await page.locator('.list').evaluate((e) => e.scrollBy(0, 400));
  await expect(page.locator('.list-head .row')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.search')).not.toBeInViewport();
  const shown = await page.locator('.rows li').evaluateAll((els) => {
    const box = document.querySelector('.list')!.getBoundingClientRect();
    return els.filter((e) => { const r = e.getBoundingClientRect(); return r.top >= box.top && r.bottom <= box.bottom; }).length;
  });
  expect(shown).toBeGreaterThanOrEqual(6);
  await shot(page, '06a-phone-list-scrolled');
  await page.locator('.list').evaluate((e) => e.scrollTo(0, 0));
  // The picker fits a phone: one column of lists, nothing wider than the screen.
  await page.locator('.chip.lens').click();
  await expect(page.getByRole('dialog').locator('.choice').first()).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await shot(page, '06b-phone-lists');
  await page.keyboard.press('Escape');
  await page.locator('.rows .row').first().click();
  await expect(page.locator('.card h2')).toBeVisible();
  await expect(page.locator('.card').getByRole('link', { name: /Book|Booking page/ })).toBeInViewport();
  // The small card: who, the times and Book, about a fifth of the screen (Joel, 25 Nov 2026: "it still takes up too
  // much real estate ... 40%"). Book stays whole in sight.
  expect((await page.locator('.side').boundingBox())!.height).toBeLessThanOrEqual(844 * 0.25);
  const book = (await page.locator('.card').getByRole('link', { name: /Book|Booking page/ }).boundingBox())!;
  expect(book.y + book.height).toBeLessThanOrEqual(844);
  await expect(page.locator('.card .cal')).toHaveCount(0);
  await settled(page);
  await shot(page, '06-phone-card');
  // More opens the whole card (calendar and all), half the screen as before.
  await page.locator('.card.mini .more').click();
  await expect(page.locator('.card .cal, .card .meta').first()).toBeAttached();
  expect((await page.locator('.side').boundingBox())!.height).toBeLessThanOrEqual(844 * 0.51);
  await shot(page, '06c-phone-card-more');
  await page.close();
});

test('picking a free time makes it the one to book: the Book button and its link follow it', async ({ page }) => {
  // One restaurant with two free times today and a Formitable link, which carries the time in minutes.
  await page.route('**/map/data.json', async (route) => {
    // Tomorrow, so no time has gone by yet whenever the test runs.
    const data = await (await route.fetch()).json();
    const day = new Date(Date.parse(`${data.start}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const r = data.restaurants[0];
    r.d = `${r.d[0]}o${r.d.slice(2)}`;
    r.t[day] = ['18:00', '20:30'];
    r.book[day] = `https://widget.formitable.com/side/en/abc12345/book?partysize=2&date=${day}&time=1080`;
    route.fulfill({ json: data });
  });
  await page.goto('/map/');
  const [id, day] = await page.evaluate(async () => {
    const d = await (await fetch('/map/data.json')).json();
    return [d.restaurants[0].id, new Date(Date.parse(`${d.start}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)];
  });
  await page.goto(`/map/?r=${id}&date=${day}`);
  const times = page.locator('.card .time');
  await expect(times).toHaveText(['18:00', '20:30']);
  // The badge on its sign and in the list: first to last free time, never a count ("2 times" read as times booked;
  // Joel, 20 Nov 2026).
  await page.goto(`/map/?lens=all&date=${day}`);
  const span = page.locator('.badge', { hasText: '18:00–20:30' });
  await span.scrollIntoViewIfNeeded();
  await expect(span).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/map-badge-span.png' });
  await page.goto(`/map/?r=${id}&date=${day}`);
  await expect(times.first()).toHaveAttribute('aria-pressed', 'true'); // the first free time until you pick
  await times.nth(1).click();
  await expect(times.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(times.first()).toHaveAttribute('aria-pressed', 'false');
  const book = page.locator('.card').getByRole('link', { name: /^Book 20:30 on/ });
  await expect(book).toHaveAttribute('href', /[?&]time=1230(&|$)/);
});

test('a guide lens: the list keeps its picks, the link keeps the lens, a card names its guides and switches lens', async ({ page }) => {
  // Two guides over the demo data: one picks the first three restaurants, the other only the first.
  await page.route('**/map/data.json', async (route) => {
    const data = await (await route.fetch()).json();
    const guide = (id: string, short: string) => ({ id, name: `${short} list`, short, by: 'x', url: `https://${id}.example/list`, date: '2026-01-01', line: `${short} line in our words.` });
    data.guides = [guide('wide', 'Wide'), guide('one', 'One')];
    data.restaurants.forEach((r: { g: string[] }, i: number) => (r.g = i < 3 ? ['wide'] : []));
    data.restaurants[0].g.push('one');
    route.fulfill({ json: data });
  });
  await page.goto('/map/');
  const names = await page.evaluate(async () => (await (await fetch('/map/data.json')).json()).restaurants.map((r: { name: string }) => r.name));
  // The Lists chip opens the picker: every restaurant first, then each guide, with its picks and how many are free.
  await page.locator('.chip.lens').click();
  const picker = page.getByRole('dialog');
  await expect(picker.getByRole('heading', { name: 'Where shall we eat?' })).toBeVisible();
  await expect(picker.locator('.choice .nm')).toHaveText(['Every restaurant', 'Wide', 'One']);
  const free = (await page.locator('.list-head h2').innerText()).match(/^(\d+)/)![1];
  await expect(picker.locator('.choice').nth(0)).toContainText(`${free} free · ${names.length} places`);
  await expect(picker.locator('.choice').nth(0)).toHaveAttribute('aria-pressed', 'true');
  await expect(picker.locator('.choice').nth(1)).toContainText(/\d+ free · 3 picks/);
  await expect(picker.locator('.choice').nth(2)).toContainText(/\d+ free · 1 pick$/);
  // A guide's own line is in the picker, out of the panel (Joel, 23 Nov 2026: the panel needs a serious pass).
  await expect(picker.locator('.choice').nth(1)).toContainText('Wide line in our words.');
  await shot(page, '07-lists');
  await picker.locator('.choice').nth(1).click();
  await expect(picker).toBeHidden();
  await expect(page.locator('.chip.lens')).toHaveText('Wide');
  await expect(page.locator('.rows .nm')).toHaveCount(3);
  for (const n of names.slice(0, 3)) await expect(page.locator('.rows .nm', { hasText: n })).toHaveCount(1);
  await expect(page.locator('.list-head .sum')).toContainText('of 3 Wide picks');
  await expect(page.locator('.list-head')).not.toContainText('Wide line in our words.');
  await expect(page.locator('.lens-line').getByRole('link', { name: /Their list/ })).toHaveAttribute('href', 'https://wide.example/list');
  await expect(page).toHaveURL(/[?&]lens=wide(&|$)/);
  // On the map every sign stays, and only the picks stay bright.
  const bright = () => page.evaluate(() => (window as unknown as { seatedMap: { markers: Array<{ dim: boolean }> } }).seatedMap.markers.filter((m) => !m.dim).length);
  await expect.poll(bright).toBe(3);
  expect(await page.evaluate(() => (window as unknown as { seatedMap: { markers: unknown[] } }).seatedMap.markers.length)).toBe(names.length);
  await settled(page);
  await shot(page, '08-lens');
  // The lens survives a reload from the link; an unknown lens is ignored.
  await page.reload();
  await expect(page.locator('.rows .nm')).toHaveCount(3);
  // The first pick's card names both guides; picking one shows the map through it.
  await page.locator('.rows .row', { hasText: names[0] }).click();
  const guides = page.locator('.card .guides');
  await expect(guides).toHaveText('In Wide · One');
  await guides.getByRole('button', { name: 'One' }).click();
  await expect(page.locator('.rows .nm')).toHaveCount(1);
  await expect(page).toHaveURL(/[?&]lens=one(&|$)/);
  await page.locator('.chip.lens').click();
  await page.getByRole('dialog').locator('.choice', { hasText: 'Every restaurant' }).click();
  await expect.poll(() => listed(page)).toBe(names.length);
  await expect(page).toHaveURL(/lens=all/); // every restaurant, kept in the link (no lens = the curated list)
  await page.goto('/map/?lens=nobody');
  await expect.poll(() => listed(page)).toBe(names.length);
});

test('the keyboard reaches the list past the date strip in a few steps, and arrow keys change the day', async ({ page }) => {
  await page.goto('/map/');
  await expect(page.locator('.list-head h2')).toBeVisible();
  // The day, the next day, Today, Fri, Sat (and New Year's Eve in December), How it works, then the list.
  let reached = false;
  for (let i = 0; i < 9 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => !!document.activeElement?.closest('.list'));
  }
  expect(reached).toBe(true);
  await page.locator('.daypill').click();
  const before = await page.locator('.day[aria-pressed="true"]').getAttribute('aria-label');
  await page.locator('.day[aria-pressed="true"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.day[aria-pressed="true"]')).not.toHaveAttribute('aria-label', before!);
  await expect(page.locator('.day[aria-pressed="true"]')).toBeFocused();
});

test('a card offers a mail link to report something wrong, named after the restaurant, when a contact is set', async ({ page }) => {
  await page.goto('/map/');
  await page.locator('.rows .row').first().click();
  const name = (await page.locator('.card h2').innerText()).trim();
  const link = page.locator('.card').getByRole('link', { name: 'Tell us' });
  // The e2e build has no VITE_MAP_CONTACT: then there is no link at all, never an empty mailto.
  if (!process.env.VITE_MAP_CONTACT) {
    await expect(link).toHaveCount(0);
    return;
  }
  await expect(link).toHaveAttribute('href', `mailto:${process.env.VITE_MAP_CONTACT}?subject=${encodeURIComponent(`Seated map: ${name}`)}`);
});

test('the picker takes a missing restaurant to a mail addressed to us, and only when a contact is set', async ({ page }) => {
  await page.goto('/map/');
  await page.locator('.chip.lens').click();
  const form = page.locator('.missing');
  // The e2e build may have no VITE_MAP_CONTACT: then there is no form at all, never an empty mailto.
  const contact = process.env.VITE_MAP_CONTACT;
  if (!contact) {
    await expect(form).toHaveCount(0);
    return;
  }
  const send = form.locator('a.btn');
  // Nothing to send until there is a name.
  await expect(send).toHaveAttribute('aria-disabled', 'true');
  await expect(send).not.toHaveAttribute('href');
  await form.getByLabel('Restaurant', { exact: true }).fill(' Café Test & Co ');
  await form.getByLabel(/Area or website/).fill('De Pijp');
  await expect(send).toHaveAttribute(
    'href',
    `mailto:${contact}?subject=${encodeURIComponent('Seated: please add Café Test & Co')}&body=${encodeURIComponent('Please add: Café Test & Co\nWhere: De Pijp\n\nSent from seated.food')}`,
  );
  // Leaving the page for a mail app is the browser's business; the thanks shows the address in case nothing opens.
  await send.evaluate((a) => a.addEventListener('click', (e) => e.preventDefault(), { once: true }));
  await send.click();
  await expect(form.locator('.sent')).toContainText(contact);
  await shot(page, '09-lists-missing');
});

test('once per device, a visitor who came by a link gets a nudge from the host a few seconds in, and Show me opens the characters', async ({ browser }) => {
  const page = await browser.newPage(); // no beforeEach here: a device that has never seen the nudge
  await page.addInitScript(() => localStorage.setItem('seated.map.where', JSON.stringify({ asked: true })));
  await page.clock.install();
  // A link (here to a lens) skips the welcome, so the nudge offers it later.
  await page.goto('/map/?lens=nobody');
  await expect(page.locator('.list-head h2')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.nudge')).toHaveCount(0);
  await page.clock.fastForward(6500);
  const nudge = page.locator('.nudge');
  await expect(nudge).toBeVisible();
  // It fades in over a quarter second; the screenshot waits for that.
  await nudge.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  await expect(nudge).toHaveCSS('opacity', '1');
  await shot(page, '10-nudge');
  await nudge.getByRole('button', { name: 'Show me' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Choose your character' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  // Seen once, never again on this device.
  await page.reload();
  await expect(page.locator('.list-head h2')).toBeVisible();
  await page.clock.fastForward(10_000);
  await expect(page.locator('.nudge')).toHaveCount(0);
  await page.close();
});

test('Noord is drawn at far, mid and near zooms and across the IJ seam, with fog only on a thin rim of the art', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const failed: string[] = [];
  page.on('response', r => { if (/\/(ours|sez)\/.*\.png/.test(r.url()) && !r.ok()) failed.push(r.url()); });
  await page.goto('/map/?art=sez&r=bacalar'); // his art with our Noord (ours is the default since 19 Nov 2026)
  await settled(page);
  await expect(page.locator('.card')).not.toContainText('Outside the drawn city');
  await page.keyboard.press('Escape');
  for (const [name, lat, lng, z] of [
    ['far', 52.391508, 4.904063, 0.125],
    ['mid', 52.391508, 4.904063, 0.5],
    ['near', 52.391508, 4.904063, 1],
    ['seam', 52.3838, 4.9025, 0.5],
  ] as const) {
    await page.evaluate(({ name, lat, lng, z }) => {
      const view = (window as unknown as { seatedMap: {
        world: { covers(lat: number, lng: number): boolean; project(lat: number, lng: number): { x: number; y: number } };
        setHome(x: number, y: number, z: number): void;
      } }).seatedMap;
      if (!view.world.covers(lat, lng)) throw new Error('Noord view is outside the art');
      const p = view.world.project(lat, lng);
      view.setHome(p.x + (name === 'near' ? 200 : 0), p.y + (name === 'near' ? -60 : 0), z);
    }, { name, lat, lng, z });
    await page.waitForTimeout(100); // let the requested frame discover its visible tiles
    await settled(page);
    expect(await page.locator('canvas').first().evaluate(c => (c as HTMLCanvasElement).getContext('2d')!.imageSmoothingEnabled)).toBe(false);
    expect(await page.evaluate(() => (window as unknown as { seatedMap: { cam: { z: number } } }).seatedMap.cam.z)).toBe(z);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    if (name === 'far') {
      // Independent screen-space oracle: compose only the two overview alpha images at the camera transform.
      // The old overlay hid occupied pixels here; test the actual final framebuffer, not just its mask helper.
      const fogOverArt = await page.evaluate(() => {
        const view = (window as unknown as { seatedMap: {
          cam: {x:number;y:number;z:number};
          canvas: HTMLCanvasElement;
          overview: {img:HTMLImageElement}; oursOverview: {img:HTMLImageElement};
          world: {width:number;height:number;ours:{levels:Array<{x:number;y:number;w:number;h:number;k:number}>}};
        } }).seatedMap;
        const {canvas,cam,world} = view, rect = canvas.getBoundingClientRect();
        const dpr = canvas.width / rect.width, mask = document.createElement('canvas');
        mask.width=canvas.width; mask.height=canvas.height;
        const g=mask.getContext('2d')!; g.setTransform(dpr,0,0,dpr,0,0); g.imageSmoothingEnabled=false;
        const x=(n:number)=>Math.round((n-cam.x)*cam.z+rect.width/2), y=(n:number)=>Math.round((n-cam.y)*cam.z+rect.height/2);
        const ext=world.ours.levels[2]!;
        g.drawImage(view.oursOverview.img,x(ext.x/ext.k),y(ext.y/ext.k),Math.round(ext.w/ext.k*cam.z),Math.round(ext.h/ext.k*cam.z));
        g.drawImage(view.overview.img,x(0),y(0),Math.round(world.width*cam.z),Math.round(world.height*cam.z));
        const alpha=g.getImageData(0,0,mask.width,mask.height).data;
        const actual=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;
        const fog=new Set(['168,164,188','187,183,203','206,203,218','227,225,234']);
        let overlap=0, art=0;
        for(let i=0;i<alpha.length;i+=4) if(alpha[i+3]===255) { art++; if(fog.has(`${actual[i]},${actual[i+1]},${actual[i+2]}`)) overlap++; }
        return { overlap, art };
      });
      // Fog lies over the edge of the art in a ragged band (8 Nov 2026), never over more than a thin rim of it.
      expect(fogOverArt.art).toBeGreaterThan(100_000);
      expect(fogOverArt.overlap / fogOverArt.art).toBeLessThan(0.1);
    }
    await shot(page, `noord-${name}`);
  }
  expect(failed).toEqual([]);
});

test('restaurants that stood on fog (15 Nov 2026) stand on drawn city, at mid and near zoom', async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const failed: string[] = [];
  page.on('response', r => { if (/\/(ours|sez)\/.*\.png/.test(r.url()) && !r.ok()) failed.push(r.url()); });
  for (const [id, lat, lng] of [['toet', 52.342644, 4.89258], ['showw', 52.337398, 4.892941], ['hotel-de-goudfazant', 52.384539, 4.928246]] as const) {
    await page.goto(`/map/?art=sez&r=${id}`);
    await settled(page);
    await expect(page.locator('.card')).not.toContainText('Outside the drawn city');
    await page.keyboard.press('Escape');
    for (const [name, z] of [['mid', 0.5], ['near', 1]] as const) {
      await page.evaluate(({ lat, lng, z }) => {
        const view = (window as unknown as { seatedMap: {
          world: { covers(lat: number, lng: number): boolean; project(lat: number, lng: number): { x: number; y: number } };
          setHome(x: number, y: number, z: number): void;
        } }).seatedMap;
        if (!view.world.covers(lat, lng)) throw new Error('restaurant stands outside the drawn city');
        const p = view.world.project(lat, lng);
        view.setHome(p.x, p.y, z);
      }, { lat, lng, z });
      await page.waitForTimeout(100); // let the requested frame discover its visible tiles
      await settled(page);
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await page.screenshot({ path: `test-results/screens/fog-${id}-${name}.png` });
    }
  }
  expect(failed).toEqual([]);
});

test("a critic's list: the card shows the score and year and links to the review", async ({ page }) => {
  await page.goto('/map/?r=choux');
  const guides = page.locator('.card .guides');
  await expect(guides).toContainText('Amsterdam critics');
  const note = guides.locator('a.note');
  await expect(note).toHaveText('10 (2025) ↗');
  await expect(note).toHaveAttribute('href', /^https:\/\/www\.parool\.nl\//);
  const [n, card] = await Promise.all([note.boundingBox(), page.locator('.card').boundingBox()]);
  expect(n!.x + n!.width).toBeLessThanOrEqual(card!.x + card!.width); // the score never runs out of the card
  await page.screenshot({ path: 'test-results/screens/map-critic-card.png' });
  await guides.getByRole('button', { name: 'Amsterdam critics' }).click();
  await expect(page).toHaveURL(/lens=mara-grimm/);
});

test('far out, the art below a cut-off overview still draws, not fog (Joel, 17 Nov 2026: a straight line, fog below)', async ({ page, browser }) => {
  // The share of fog-coloured pixels in the lower half of the map, at zoom 0.1 over the middle of his art, once everything has loaded.
  const fogShare = (p: typeof page) => p.evaluate(() => {
    type V = { cam: { x: number; y: number; z: number }; target?: { x: number; y: number; z: number }; dirty: boolean; waiting: number; ctx: CanvasRenderingContext2D; canvas: HTMLCanvasElement; overview: { ok: boolean } };
    const v = (window as unknown as { seatedMap: V }).seatedMap;
    for (const c of [v.cam, v.target]) if (c) Object.assign(c, { x: 8576, y: 5888, z: 0.1 });
    v.dirty = true;
    return new Promise<number>((done) => setTimeout(() => {
      if (!v.overview.ok || v.waiting > 0) return done(-1);
      const { width, height } = v.canvas;
      const d = v.ctx.getImageData(0, Math.round(height * 0.5), Math.round(width * 0.6), Math.round(height * 0.35)).data;
      const fog = ['#a8a4bc', '#bbb7cb', '#cecbda', '#e3e1ea'].map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (fog.some((f) => Math.abs(f[0]! - d[i]!) + Math.abs(f[1]! - d[i + 1]!) + Math.abs(f[2]! - d[i + 2]!) < 12)) n++;
      done(n / (d.length / 4));
    }, 400));
  });
  const settled = async (p: typeof page) => {
    await p.goto('/map/?art=sez');
    await expect(p.locator('.list-head h2')).toBeVisible();
    await expect.poll(() => fogShare(p), { timeout: 20_000 }).toBeGreaterThanOrEqual(0);
    return fogShare(p);
  };
  const whole = await settled(page);
  // Every copy of the overview arrives cut short, as on Joel's Windows screen, where it showed only its top part.
  const cut = await browser.newPage({ viewport: page.viewportSize()! });
  await cut.route(/\/sez\/\d+\/2\.png/, async (route) => {
    const res = await route.fetch();
    const body = await res.body();
    await route.fulfill({ response: res, body: body.subarray(0, Math.floor(body.length * 0.15)) });
  });
  const share = await settled(cut);
  await cut.screenshot({ path: 'test-results/screens/map-overview-cut-far.png' });
  expect(share).toBeLessThan(whole + 0.05);
  await cut.close();
});

test('a city overview cut short is fetched again past the cache, and fog is built only from a whole one (17 Nov 2026)', async ({ page }) => {
  const asked: string[] = [];
  await page.route(/\/sez\/\d+\/2\.png/, async (route) => {
    asked.push(route.request().url());
    const res = await route.fetch();
    const body = await res.body();
    // The first copy is cut short, as a dropped download is; the second is whole.
    await route.fulfill({ response: res, body: asked.length === 1 ? body.subarray(0, Math.floor(body.length * 0.4)) : body });
  });
  await page.goto('/map/?art=sez');
  await expect(page.locator('.list-head h2')).toBeVisible();
  await expect.poll(() => asked.length).toBe(2);
  expect(asked[1]).toContain('fresh=');
  await expect.poll(() => page.evaluate(() => {
    const v = (window as unknown as { seatedMap: { overview: { ok: boolean; alpha?: Uint8Array | null } } }).seatedMap;
    return v.overview.ok && !!v.overview.alpha;
  })).toBe(true);
});

test('MICHELIN stars and Bibs are red marks of their own: on the signs, on the pins zoomed out, and in the list', async ({ page }) => {
  await page.goto('/map/');
  await expect(page.locator('.list-head h2')).toBeVisible();
  // MICHELIN red (#b8322a) is used for nothing else on the canvas.
  const red = () =>
    page.locator('canvas').evaluate((c: HTMLCanvasElement) => {
      const { data } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
      let n = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] === 0xb8 && data[i + 1] === 0x32 && data[i + 2] === 0x2a) n++;
      return n;
    });
  await expect.poll(red, { timeout: 5000 }).toBeGreaterThan(200);
  await page.screenshot({ path: 'test-results/screens/map-24-michelin-signs.png' });
  // Zoomed far out, signs shrink to pins and the red tag stays.
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Zoom out' }).click();
  await expect.poll(red, { timeout: 5000 }).toBeGreaterThan(20);
  await page.screenshot({ path: 'test-results/screens/map-25-michelin-pins.png' });
  // In the list: stars white on red, a Bib red on cream.
  const star = page.locator('.rows .mk-michelin:not(.bib)').first();
  await expect(star).toHaveCSS('background-color', 'rgb(184, 50, 42)');
  await expect(star).toHaveCSS('color', 'rgb(255, 255, 255)');
  const bib = page.locator('.rows .mk-michelin.bib').first();
  await expect(bib).toHaveCSS('color', 'rgb(184, 50, 42)');
});

test('badges are readable and "no tables online" never looks like fully booked', async ({ page }) => {
  await page.goto('/map/');
  await expect(page.locator('.list-head h2')).toBeVisible();
  // Dark violet text on every badge (white on green was 2.8:1).
  const badge = page.locator('.rows .badge').first();
  await expect(badge).toHaveCSS('color', 'rgb(43, 39, 51)');
  // The legend, in How this works: "no tables online" is hollow (cream, rose edge); "fully booked" is solid red.
  await expect(page.locator('.list .key')).toHaveCount(0);
  await page.locator('.topbar .about').click();
  const none = page.locator('.key span', { hasText: 'no tables online' }).locator('.swatch');
  const full = page.locator('.key span', { hasText: 'fully booked' }).locator('.swatch');
  await expect(none).toHaveCSS('background-color', 'rgb(255, 250, 240)');
  await expect(full).toHaveCSS('background-color', 'rgb(224, 96, 76)');
});

// Joel, 23 Nov 2026: "that whole side panel ui/ux needs a serious pass". The list name and count share one line,
// the rarer filters sit under More, and places we cannot read fold into one line at the end.
test('the panel: the list and count on one line, rarer filters under More, unreadable places folded', async ({ page }) => {
  await page.route('**/map/data.json', async (route) => {
    const data = await (await route.fetch()).json();
    data.restaurants[0].readable = false;
    data.restaurants[0].d = data.restaurants[0].d.replace(/./g, '?');
    data.restaurants[0].g.push('seated');
    route.fulfill({ json: data });
  });
  await page.goto('/map/?lens=all');
  const top = page.locator('.list-top');
  await expect(top.locator('.chip.lens')).toHaveText('Every restaurant');
  await expect(top.locator('h2')).toHaveText(/^\d+ free$/);
  await expect(page.locator('.list-head .sum')).toContainText('read ');
  // More opens the second row of filters, and says how many of them are on.
  await expect(page.locator('.chip', { hasText: 'Hard to get' })).toHaveCount(0);
  await page.locator('.chip.more').click();
  await page.locator('.chip', { hasText: 'Hard to get' }).click();
  await expect(page.locator('.chip.more')).toContainText('More · 1');
  await page.locator('.chip', { hasText: 'Hard to get' }).click();
  // The unreadable place is folded: one line with the count, opened with a click.
  const fold = page.locator('.rows .fold');
  await expect(fold).toHaveText(/Book on their site \(\d+\)/);
  const n = Number((await fold.innerText()).match(/\((\d+)\)/)![1]);
  const rows = await page.locator('.rows .row').count();
  await fold.click();
  await expect(page.locator('.rows .row')).toHaveCount(rows + n);
  await expect(page.locator('.rows .fold')).toHaveAttribute('aria-expanded', 'true');
  // A search shows every match, folded or not.
  await page.locator('.rows .fold').click();
  await page.locator('.search').fill(await page.evaluate(async () => (await (await fetch('/map/data.json')).json()).restaurants[0].name));
  await expect(page.locator('.rows .fold')).toHaveCount(0);
  await expect(page.locator('.rows .row')).not.toHaveCount(0);
});

test('the map opens on the Seated curated list; Every restaurant shows all and the link keeps it', async ({ page }) => {
  await page.goto('/map/');
  const curated = await page.evaluate(async () => (await (await fetch('/map/data.json')).json()).restaurants.filter((r: { g: string[] }) => r.g.includes('seated')).length);
  expect(curated).toBeGreaterThan(50);
  await expect(page.locator('.list-head .sum')).toContainText(`of ${curated} Seated curated picks`);
  await expect(page.locator('.chip.lens')).toHaveText('Seated curated');
  expect(new URL(page.url()).search).toBe(''); // the default needs no link
  await page.locator('.chip.lens').click();
  await page.getByRole('dialog').locator('.choice', { hasText: 'Every restaurant' }).click();
  await expect(page.locator('.list-head .sum')).not.toContainText('Seated curated');
  await expect(page).toHaveURL(/lens=all/);
  await page.reload();
  await expect(page.locator('.chip.lens')).toHaveText('Every restaurant');
});

// Joel, 19 Nov 2026: "i want north to be north. like google maps". Our art, drawn north up, is the map; sezlab's
// (north-west up) only with ?art=sez. Its images are gitignored; the committed manifest is enough for the projection.
test('the map is north up: due north of the Dam stands straight above it, and the credit names 3DBAG', async ({ page }) => {
  const { readFileSync } = await import('node:fs');
  const { World } = await import('../src/map/world');
  const read = (f: string) => JSON.parse(readFileSync(f, 'utf8'));
  const world = new World(read('src/map/public/sez/manifest.json'), './sez/', read('src/map/public/canal/manifest.json'), './canal/', true);
  const dam = world.project(52.3731, 4.8926);
  const north = world.project(52.3831, 4.8926); // about 1.1 km due north
  const east = world.project(52.3731, 4.9086); // about 1.1 km due east
  expect(north.y).toBeLessThan(dam.y - 100); // up the screen
  expect(Math.abs(north.x - dam.x)).toBeLessThan(Math.abs(north.y - dam.y) * 0.05); // straight up, not north-west
  expect(east.x).toBeGreaterThan(dam.x + 100); // east is to the right
  expect(Math.abs(east.y - dam.y)).toBeLessThan(Math.abs(east.x - dam.x) * 0.6);
  await page.goto('/map/');
  await expect(page.locator('footer.foot')).toContainText('3DBAG');
  expect(new URL(page.url()).searchParams.get('art')).toBeNull(); // the default needs no parameter
});

test("?art=sez shows sezlab's art and stays in the link; an old ?art=ours link opens the default", async ({ page }) => {
  await page.goto('/map/?art=sez');
  await page.getByLabel('Find a restaurant').fill('Bacalar');
  await page.locator('.rows .row').filter({ hasText: 'Bacalar' }).click();
  await expect(page).toHaveURL(/[?&]r=bacalar/);
  await expect(page).toHaveURL(/[?&]art=sez/);
  await expect(page.locator('footer.foot')).toContainText('sezlab');
  await page.goto('/map/?art=ours');
  await expect(page.locator('footer.foot')).toContainText('3DBAG');
});

test('pins too close to tell apart merge into one numbered pin, and a tap on it zooms in there', async ({ page }) => {
  // Four full restaurants a few metres apart: zoomed far out they are pins on one spot.
  await page.route('**/map/data.json', async (route) => {
    const data = await (await route.fetch()).json();
    // Every place full, no stars or hot marks: far out none keeps its name, so no sign stands over the pins.
    for (const r of data.restaurants) {
      r.d = 'f'.repeat(r.d.length);
      r.michelin = null;
      r.hot = null;
    }
    // Four places off the default list (Seated curated): on it, a place keeps its name far out and the name covers the pins.
    const { readFileSync } = await import('node:fs');
    const curated = new Set(JSON.parse(readFileSync('data/map-guides.json', 'utf8')).picks.seated as string[]);
    const off = data.restaurants.filter((r: { id: string }) => !curated.has(r.id)).slice(0, 4);
    expect(off).toHaveLength(4);
    for (const [i, r] of off.entries()) {
      r.lat = 52.3731 + i * 0.00005; // the Dam: mid-screen far out
      r.lng = 4.8926;
    }
    data.restaurants = off; // only these four, so no other sign stands over them
    route.fulfill({ json: data });
  });
  await page.goto('/map/?lens=all');
  await settled(page);
  const canvas = page.locator('canvas.map');
  const clusters = async () => JSON.parse((await canvas.getAttribute('data-clusters')) ?? '[]') as Array<[number, number, number]>;
  const zoom = async () => Number(await canvas.getAttribute('data-zoom'));
  for (let i = 0; i < 6; i++) await page.locator('.zoom button').nth(1).click();
  await expect.poll(zoom).toBe(0.125); // the farthest step, settled
  await expect.poll(async () => (await clusters()).length).toBeGreaterThan(0);
  const [x, y, n] = (await clusters())[0]!;
  expect(n).toBe(4);
  await expect(page.locator('canvas.map')).toHaveCount(1);
  const before = await page.evaluate(() => location.search);
  await page.mouse.click(x, y - 13);
  // One step in, at the pin, and no restaurant opened.
  await expect.poll(zoom).toBe(0.25);
  await expect(page.locator('.card h2')).toHaveCount(0);
  expect(await page.evaluate(() => location.search)).toBe(before);
});

test('Share copies the link, and says what to do when the browser refuses (runtime walk, 19 Nov 2026)', async ({ browser }) => {
  for (const allowed of [true, false]) {
    const ctx = await browser.newContext(allowed ? { permissions: ['clipboard-read', 'clipboard-write'] } : {});
    await ctx.addInitScript((ok) => {
      localStorage.setItem('seated.map.you', JSON.stringify({ answers: {}, key: null, welcomed: true }));
      localStorage.setItem('seated.map.where', JSON.stringify({ asked: true }));
      if (!ok) Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) } });
      // A share function that refuses (as in a headless browser): Share falls back to copying.
      Object.defineProperty(navigator, 'share', { value: () => Promise.reject(new DOMException('no target', 'NotAllowedError')) });
    }, allowed);
    const page = await ctx.newPage();
    await page.goto('/map/?r=gitane');
    await page.locator('.card').getByRole('button', { name: 'Share' }).click();
    await expect(page.locator('.card .actions')).toContainText(allowed ? 'Link copied' : 'Copy the address bar');
    if (allowed) expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/[?&]r=gitane&date=/);
    await ctx.close();
  }
});

test('a walk-in place says walk in: no booking button, its website, no calendar (Bon Burger, 20 Nov 2026)', async ({ page }) => {
  await page.route('**/map/data.json', async (route) => {
    const data = await (await route.fetch()).json();
    const r = data.restaurants[0];
    Object.assign(r, { platform: 'walk-in', readable: false, d: '?'.repeat(r.d.length), t: {}, book: {}, site: 'https://example.org/', link: 'https://example.org/' });
    route.fulfill({ json: data });
  });
  await page.goto('/map/');
  const id = await page.evaluate(async () => (await (await fetch('/map/data.json')).json()).restaurants[0].id);
  await page.goto(`/map/?r=${id}&lens=all`);
  const card = page.locator('.card');
  await expect(card).toContainText('Walk-in only: no bookings, just go.');
  await expect(card).not.toContainText('unknown');
  await expect(card).toContainText('It takes no bookings: you walk in.');
  await expect(card.getByRole('link', { name: /Book|Booking page/ })).toHaveCount(0);
  await expect(card.getByRole('link', { name: 'Website' })).toHaveAttribute('href', 'https://example.org/');
  await expect(card.locator('.cal')).toHaveCount(0);
  await shot(page, '30-walk-in-card');
});
