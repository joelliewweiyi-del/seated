# Contributing to Seated

Thank you for helping. Seated is small on purpose: one Node process, one SQLite file, no build step for the server. Please keep it that way.

## Set up

```bash
npm install
npx playwright install chromium   # once, for the end-to-end tests
npm run demo                      # dashboard with fake restaurants at http://127.0.0.1:4310
```

For live reload, run `npm run dev` and open http://localhost:5173.

## Before you open a pull request

```bash
npm run typecheck
npm test            # unit tests, no network
npm run test:e2e    # browser tests against the demo server, no network
```

All three must pass. CI runs the same commands.

## Rules

1. **Never test against real restaurants in a loop.** Use the demo platform (`src/server/platforms/demo.ts`) or a fake `fetch`, as in `test/formitable.test.ts`. For a one-off live look, `npm run peek` is fine.
2. **Never make a real booking from a test.** A test booking is a no-show at a real restaurant.
3. **Platform code stays in `src/server/platforms/`.** The radar only knows the `Platform` interface in `types.ts`.
4. **Dates are restaurant-local strings**: `"2026-10-09"` and `"19:30"`. Never derive a date with `toISOString()`; use `localDate()` from `time.ts`.
5. **Tests say why.** Name a test after the behaviour a user would notice, for example "pushes once when a table opens, then stays quiet".

## Adding a booking platform

1. Create `src/server/platforms/<name>.ts` that returns a `Platform` (see `formitable.ts`).
2. `getSlots()` must throw on errors. An empty array means "no tables", and the radar treats the two differently.
3. Only add `book()` if the platform allows it without a captcha or other bot check. Never work around one.
4. Register it in `src/server/platforms/index.ts` (both `createPlatforms` and `demoPlatforms`) and give it a name in `src/shared/platforms.ts`.
5. Add tests with a fake `fetch` and a fixture taken from one real answer. Strip tokens and personal data from the fixture.

Good next platforms: **TableCheck** and **TheFork**. The search box marks restaurants Seated cannot read yet.

To find out which system a restaurant uses: `npx tsx scripts/detect.ts https://restaurant.nl`. Some sites load their widget with JavaScript only; open those in a browser and watch the network requests.

## Adding restaurants to the list

Edit [data/restaurants.json](data/restaurants.json). Each entry needs a unique `id`, a `platform`, and the platform's id for the restaurant (`platformUid`). For Formitable, the id is the 8-character code in the restaurant website's booking widget (`data-restaurant="…"`).
