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
  await expect(page.locator('.daypill')).toHaveText(/^\w+day \d{1,2} \w{3}/);
  await expect(page.locator('.list-head h2')).toHaveText(/^\d+ with a table$/);
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
  await page.locator('.rows .row').first().click();
  await expect(page.locator('.card h2')).toBeVisible();
  await expect(page.locator('.card').getByRole('link', { name: /Book|Booking page/ })).toBeInViewport();
  await settled(page);
  await shot(page, '06-phone-card');
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
  const lens = page.getByLabel('Seen through a guide');
  await expect(lens.locator('option')).toHaveText(['Guides', 'Wide (3)', 'One (1)']);
  await lens.selectOption('wide');
  await expect(page.locator('.rows .nm')).toHaveCount(3);
  for (const n of names.slice(0, 3)) await expect(page.locator('.rows .nm', { hasText: n })).toHaveCount(1);
  await expect(page.locator('.list-head .sum')).toContainText('of 3 Wide picks');
  await expect(page.locator('.lens-line')).toContainText('Wide line in our words.');
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
  await page.locator('.lens-line').getByRole('button', { name: 'Every restaurant' }).click();
  await expect(page.locator('.rows .nm')).toHaveCount(names.length);
  await expect(page).not.toHaveURL(/lens=/);
  await page.goto('/map/?lens=nobody');
  await expect(page.locator('.rows .nm')).toHaveCount(names.length);
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

test('Noord is drawn beneath the city at far, mid and near zooms and across the IJ seam', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const failed: string[] = [];
  page.on('response', r => { if (/\/(ours|sez)\/.*\.png/.test(r.url()) && !r.ok()) failed.push(r.url()); });
  await page.goto('/map/?r=bacalar');
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
        let overlap=0;
        for(let i=0;i<alpha.length;i+=4) if(alpha[i+3]===255 && fog.has(`${actual[i]},${actual[i+1]},${actual[i+2]}`)) overlap++;
        return overlap;
      });
      expect(fogOverArt).toBe(0);
    }
    await shot(page, `noord-${name}`);
  }
  expect(failed).toEqual([]);
});
