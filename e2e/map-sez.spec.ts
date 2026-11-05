import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { World, type SezManifest } from '../src/map/world';
import type { MapData, MapRestaurant } from '../src/map/data';

const manifest = JSON.parse(
  readFileSync('src/map/public/sez/manifest.json', 'utf8'),
) as SezManifest;
const world = new World(manifest);
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9X8AAAAASUVORK5CYII=',
  'base64',
);

function restaurant(id: string, roof: number | null): MapRestaurant {
  return {
    id, name: id, roof, michelin: null,
    lat: 52.3731, lng: 4.8926, area: 'Centrum', kind: 'bistro',
    platform: 'Fixture', site: null, hot: null, why: null,
    readable: true, d: 'o'.repeat(63), t: {}, book: {},
    link: 'https://fixture.example', win: 30, readAt: null,
  };
}

type View = {
  cam: { x: number; y: number; z: number };
  target: unknown;
  pending(): number;
  markerScreen(id: string): { x: number; y: number } | null;
};

async function settled(page: Page) {
  await page.waitForFunction(() => {
    const view = (window as unknown as { seatedMap?: View }).seatedMap;
    return view && view.pending() === 0 && !view.target;
  });
}

async function camera(page: Page) {
  return page.evaluate(() =>
    ({ ...(window as unknown as { seatedMap: View }).seatedMap.cam }));
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const data: MapData = {
    v: 1, generatedAt: '2026-11-05T12:00:00Z',
    city: 'Amsterdam', partySize: 2, start: '2026-11-05', days: 63,
    restaurants: [
      restaurant('Roof fixture', 27.5),
      restaurant('Default fixture', null),
      restaurant('Zero fixture', 0),
      {
        ...restaurant('Outside fixture', null),
        lat: 52.3807, lng: 5.0055,
      },
    ],
  };
  await page.route('**/map/data.json', (route) => route.fulfill({ json: data }));
  await page.route('**/sez/manifest.json', (route) => route.fulfill({ json: manifest }));
  await page.route(/\/sez\/[^/]+\/.*\.png$/, (route) =>
    route.fulfill({ contentType: 'image/png', body: png }));
});

// Spec 7: both footer and About dialog provide the art and sponsorship links.
test('credits sezlab and links to sponsorship in both locations', async ({ page }) => {
  await page.goto('/map/');
  await settled(page);
  const footer = page.locator('footer');
  await expect(footer.locator('a[href="https://sezlab.dev/amsterdam"]')).toBeVisible();
  await expect(footer.locator('a[href="https://github.com/sponsors/sezkus"]')).toBeVisible();

  await page.getByRole('button', { name: 'How it works' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('a[href="https://sezlab.dev/amsterdam"]')).toBeVisible();
  await expect(dialog.locator('a[href="https://github.com/sponsors/sezkus"]')).toBeVisible();
});
