# Seated: rules for coding agents

Seated is a personal table radar. It watches restaurant booking systems and alerts the user's phone (ntfy) the moment a matching table opens, with a pre-filled booking link. Optionally it books the table (Formitable only). Read [README.md](README.md) for the product and [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow.

## Stage

**Pilot (personal use)**, since October 2026. One user (Joel) runs it locally. The next stage is a small group of friends, then open source. Name the stage when you propose work, and say so when a change skips one.

## Shape

- One Node process (`src/server/main.ts`) runs the HTTP API, serves the built dashboard, and runs the check loop.
- One SQLite file through Node's built-in `node:sqlite`. The schema is created on start in `db.ts`. There is no ORM and no migration tool. To change a table, add an idempotent `ALTER` in `Store`'s constructor.
- React dashboard in `src/web` (Vite + Tailwind v4). The server serves `dist/web`.
- No queue, no Redis, no auth library. Keep it that way unless a real need appears.

## Hard rules

1. **No real bookings in tests, ever.** Use `platforms/demo.ts` or a fake `fetch`.
2. **Keep live requests small.** `npm run peek` once is fine. No loops against real restaurants. Never poll Esra (Tebi) at all; it is a two-person shop.
3. **Platform code only in `src/server/platforms/`.**
4. **Dates are restaurant-local strings** (`YYYY-MM-DD`, `HH:mm`). Use `localDate()`; never `toISOString().slice(0, 10)` for a calendar date.
5. **Double-booking guards stay**: the watch stops after a booking, `hasLiveBooking` blocks re-booking, and an unclear booking outcome (`uncertain`) pauses the watch. Each has a test in `test/radar.test.ts`. Never weaken one.
6. **`getSlots()` throws on errors.** An empty array means "no tables". The radar keeps open tables open on errors, so a blip does not cause a repeat alert.
7. **Every change request carries `X-Seated: 1`.** The API refuses POST/PATCH/PUT/DELETE without it, and without a password it only answers requests addressed to localhost. This stops other websites from creating auto-book watches through the user's browser. Never remove either check.
8. **Never commit personal data.** `.env` and `*.db` are ignored. Joel's old data is in `~/.seated-archive/`, outside the repo.

## Commands

```bash
npm run demo        # fake restaurants, in-memory DB, http://127.0.0.1:4310
# observe mode: real restaurants, records tables, never pushes or books
SEATED_DB=data/observe.db PORT=4311 npx tsx src/server/main.ts --observe
npm start           # real mode, data/seated.db
npm run peek -- klepel
npm run typecheck && npm test && npm run test:e2e
```

## Frontend changes

After any change to `src/web`, run `npm run test:e2e`. It saves full-page screenshots to `test-results/screens/`. Review them in a subagent (never read the images in the main session) before you call the change done.

### Design language

Warm and restrained, like a concierge, not a SaaS dashboard.

- Canvas `#FAF9F7`, ink `#1c1917`, warm stone greys, primary copper-600 `#0f766e` (hover copper-700 `#115e59`).
- 3px copper stripe at the top of the page.
- Cards: `rounded-xl border border-stone-200`, no shadows. Buttons and inputs: `rounded-lg`.
- Status edge: a 3px bar on the left of a row. Teal = watching, amber = open table, green = booked, red = problem, grey = paused (`edge-*` classes in `styles.css`).
- Badges: monospace, uppercase, pill-shaped.
- Section labels: `text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500`.
- No gradients, no colour-coded stat cards, no uniform rounding.

## Platform knowledge

### Formitable (now owned by Zenchef)

- API base: `https://widget-api.formitable.com/api`. Send a Chrome User-Agent, `Referer: https://widget.formitable.com/`, and `ft-returnurl: <restaurant website>`.
- `GET /availability/{uid}/day/{YYYY-MM-DD}/{party}/en` returns slots: `timeString` (local), `time` (UTC instant), `status` (`AVAILABLE`, `SHORT`, `WAITLIST`, `SOLD_OUT`), `minutes` since local midnight.
- `GET /availability/{uid}/monthWeeks/{month}/{year}/{party}/en` returns a status code per day. Validated on 119 days at 31 restaurants (Oct 2026): code 0 had open tables 61 of 62 times; codes 1, 3 and 6 never did; 2 = past, 5 = today when nothing is left. `openDates()` skips only those known-empty codes.
- Many restaurants load the Formitable widget with JavaScript only (Gitane, Massalia). HTML detection misses them; a headless browser sees the `widget-api.formitable.com/api/restaurant/{uid}` request.
- A dead Formitable widget can stay on a site after a move to Tebi (Alba). It answers with no availability. Check the site for a Tebi token before calling a restaurant "fully booked".
- `GET /restaurant/{uid}/status`: the `live` flag is **not** a bookability signal. Many bookable restaurants report `live: false`.
- Deep link (checked in Chrome, Oct 2026): `https://widget.formitable.com/side/en/{uid}/book?partysize=N&date=YYYY-MM-DD&time={minutes}`.
- Booking: `GET /product/{uid}/search/{slot.time}/{party}/en` for the product, then `POST /booking/{uid}`. The payload is in `formitable.ts`. It booked real tables in June 2026.
- Risk: restaurants are migrating to Zenchef (the status endpoint shows a `zenchefId`). Toscanini looked "migrated" but had in fact moved to Tebi; check for that first. A Zenchef reader is the most important next platform.

### Tebi

- Reads need no captcha. Base `https://live.tebi.co/api/reservations-guest/ledgers/{uid}`, headers `Tebi-Version-Code: 1680400`, Origin and Referer `https://live.tebi.co`.
- `GET /reservation-dates/{YYYY-MM-DD}?groupSize=N` gives `timeslots[{ time, availabilityType }]`.
- `GET /reservation-months/{YYYY-MM}?groupSize=N` gives `[{ date, availability: Available|Waitlist|Unavailable }]`; `openDates()` uses it so only Available days get a slot read.
- Seeded ledger ids rotate and then return `400 invalid ledger id`. Refresh with `GET https://live.tebi.co/api/widget/{oldUid}` (Referer = restaurant site); the 302 `Location` holds the new id. `tebi.ts` does this on any 400 and saves the new id through `onUidChange`.
- Restaurant websites embed a **widget token** (`data-widget-token="…"` on `widget-manager.js`). It is not the ledger id: resolve it with the same `/api/widget/{token}` redirect.
- The booking page `https://live.tebi.co/ecom/reservations/{uid}` reads no date or party from the link (only `serviceId`), so Tebi links cannot be pre-filled.
- Tebi is also a till and web shop: a `tebi.co` link on a site does not prove Tebi takes the bookings.
- Writes need reCAPTCHA v3. Do not try to get around it.

## Restaurant data

- `data/restaurants.json`: `hot` (1 to 3) and `hotWhy` mark the hard-to-book list (34 Amsterdam restaurants, researched 6 Oct 2026 from Time Out, Amsterdam Foodie, Your Little Black Book, Michelin and others).
- On 6 Oct 2026, 29 restaurants listed as Formitable had moved to Tebi; they were switched with ids resolved from their websites.
- `scripts/detect.ts <url>` finds the booking system on a website.

## History

- v1 (Feb to Mar 2026): multi-user booking bot (NestJS, Postgres, BullMQ, Twilio). Booking bugs and Tebi's captcha sank it.
- v2 "Radar" (Mar 2026): alerts plus deep links instead of bookings.
- "Lite" (Jun 2026): single-user rewrite with SQLite and ntfy; it booked real tables. Never committed until it was archived on the branch `archive/seated-lite`.
- v3 (Oct 2026, this code): clean rebuild for personal use and open source.
