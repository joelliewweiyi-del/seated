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
- `GET /availability/{uid}/monthWeeks/{month}/{year}/{party}/en` returns a status code per day. The meaning of the codes has not been decoded yet (0 had open slots, 2 = past). This could cut requests a lot.
- `GET /restaurant/{uid}/status`: the `live` flag is **not** a bookability signal. Many bookable restaurants report `live: false`.
- Deep link (checked in Chrome, Oct 2026): `https://widget.formitable.com/side/en/{uid}/book?partysize=N&date=YYYY-MM-DD&time={minutes}`.
- Booking: `GET /product/{uid}/search/{slot.time}/{party}/en` for the product, then `POST /booking/{uid}`. The payload is in `formitable.ts`. It booked real tables in June 2026.
- Risk: restaurants are migrating to Zenchef (the status endpoint shows a `zenchefId`). Toscanini already returns no slots. A Zenchef reader is the most important next platform.

### Tebi

- Reads need no captcha. Base `https://live.tebi.co/api/reservations-guest/ledgers/{uid}`, headers `Tebi-Version-Code: 1680400`, Origin and Referer `https://live.tebi.co`.
- `GET /reservation-dates/{YYYY-MM-DD}?groupSize=N` gives `timeslots[{ time, availabilityType }]`.
- Seeded ledger ids rotate and then return `400 invalid ledger id`. Refresh with `GET https://live.tebi.co/api/widget/{oldUid}` (Referer = restaurant site); the 302 `Location` holds the new id.
- Writes need reCAPTCHA v3. Do not try to get around it.

## History

- v1 (Feb to Mar 2026): multi-user booking bot (NestJS, Postgres, BullMQ, Twilio). Booking bugs and Tebi's captcha sank it.
- v2 "Radar" (Mar 2026): alerts plus deep links instead of bookings.
- "Lite" (Jun 2026): single-user rewrite with SQLite and ntfy; it booked real tables. Never committed until it was archived on the branch `archive/seated-lite`.
- v3 (Oct 2026, this code): clean rebuild for personal use and open source.
