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
2. **Keep live requests small.** `npm run peek` once is fine. No loops against real restaurants. Esra (Tebi) is a two-person shop: the radar watches it like any restaurant (Joel's choice, Oct 2026), but never use it as a test target (no peeks, no verify runs, no build loops; the CLI refuses it).
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
npx tsx scripts/verify-radar.ts   # compare the radar's open tables with a direct read (skips Esra)
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
- **Restaurants are moving to Zenchef, and the old Formitable calendar stays online, frozen.** On 7 Oct 2026 De Kas showed 41 free tables on Formitable and none on Zenchef. The status endpoint's `zenchefId` marks a moved restaurant. `formitable.ts` checks it once a day and refuses to read or book a restaurant that has one (a failed re-check keeps the last answer). `scripts/migrate-zenchef.ts --city Amsterdam --write` moves restaurants whose Zenchef calendar shows open days; it moved 16 in Amsterdam. Toscanini looked "migrated" but had in fact moved to Tebi; check for that first.
- Auto-book refuses any product with a deposit, price, prepayment or no-show fee (`moneyInvolved()`).

### Tebi

- Reads need no captcha. Base `https://live.tebi.co/api/reservations-guest/ledgers/{uid}`, headers `Tebi-Version-Code: 1680400`, Origin and Referer `https://live.tebi.co`.
- `GET /reservation-dates/{YYYY-MM-DD}?groupSize=N` gives `timeslots[{ time, availabilityType }]`.
- `GET /reservation-months/{YYYY-MM}?groupSize=N` gives `[{ date, availability: Available|Waitlist|Unavailable }]`; `openDates()` uses it so only Available days get a slot read.
- Seeded ledger ids rotate and then return `400 invalid ledger id`. Refresh with `GET https://live.tebi.co/api/widget/{oldUid}` (Referer = restaurant site); the 302 `Location` holds the new id. `tebi.ts` does this on any 400 and saves the new id through `onUidChange`.
- Restaurant websites embed a **widget token** (`data-widget-token="…"` on `widget-manager.js`). It is not the ledger id: resolve it with the same `/api/widget/{token}` redirect.
- The booking page `https://live.tebi.co/ecom/reservations/{uid}` reads no date or party from the link (only `serviceId`), so Tebi links cannot be pre-filled.
- Tebi is also a till and web shop: a `tebi.co` link on a site does not prove Tebi takes the bookings.
- Writes need reCAPTCHA v3. Do not try to get around it.

### Zenchef

- Read-only, plain GETs on `https://bookings-middleware.zenchef.com`: `getAvailabilitiesSummary?restaurantId&date_begin&date_end` (which days have shifts) and `getAvailabilities` (slots).
- Party size is not a parameter: each shift and slot lists `possible_guests`. A slot is open only if neither it nor its shift is closed or full and the party fits.
- A `202` answer is an AWS WAF challenge, not data: it counts as a failed read. Never obtain or forge the WAF token.
- Deep link: `https://bookings.zenchef.com/results?rid&pid=1001&pax&day`. It has no time parameter.

### SevenRooms

- Read-only: `https://www.sevenrooms.com/api-yoa/availability/ng/widget/range`, with the venue slug as uid. One call covers up to 3 days (7 is refused). Only `book` times in an open shift are tables; `request` times are not.
- Deep link `explore/{slug}/reservations/create/search/?date&party_size&start_time` pre-fills date, party and time.

### Guestplan

- Read-only: `POST https://api.guestplan.com/api/v2/getAvailability` with `Authorization: AccessKey <key>`. The key is public: every site embeds it (`_gstpln.accessKey`, sometimes URL-encoded).
- uid is `<accessKey>:<accountId>`: one key can cover several restaurants. A time is a table only when it is open online and bookable for the party.
- The widget link cannot be pre-filled. Never fake its `rwg_token`.

## Restaurant data

- `data/restaurants.json`: `hot` (1 to 3) and `hotWhy` mark the hard-to-book list (40 Amsterdam restaurants, 29 readable; 35 researched 6 Oct 2026 from Time Out, Amsterdam Foodie, Your Little Black Book, Michelin and others; Weinlokal Stern, Kamer, KID, September and Bacalar added by Joel on 7 Oct, scored from Seated's own reads).
- On 6 Oct 2026, 29 restaurants listed as Formitable had moved to Tebi; they were switched with ids resolved from their websites.
- `scripts/detect.ts <url>` finds the booking system on a website.

## Radar behaviour

- **Scarcity polling.** Each restaurant has its own interval: `pollInterval()` in `radar.ts`. ≤ 2 open tables: 0.5 × `POLL_SECONDS`; ≤ 10: 1 ×; more: 2.5 ×; failing: 2 ×. Never under 60 s (`POLITE_FLOOR_SECONDS`). The loop wakes every ~15 s and reads only what is due; "Check now" reads all.
- **Breaker.** Two failed requests in a row skip the restaurant for the rest of the check. Each read has a 45 s backstop.
- **Push hygiene.** A first read of a day is silent (`listed`). A loud push (max) only when the watch had ≤ 2 open tables (`SCARCE_TABLES`); otherwise silent (low). "Gone:" goes only for tables that got a loud push. `sightings.notified`: 0 pending, 1 `LOUD`, 2 `QUIET`.
- **Auto-book guards** (on top of hard rule 5): one table per evening across watches (`hasBookingOn`), at most one auto-booking per 24 h (`autoBookingsSince`), never when money is involved. "I got it" (`POST /api/watches/:id/got-it`) records a booking with source `you` and stops the watch.
- **Platform switch.** `seedRestaurants` returns restaurants whose platform changed; their watches close their sightings quietly and start fresh. A uid change alone does not reset (Tebi rotates ids).
- **Health.** `GET /api/health` (no password needed) is 503 when no check finished within max(6 min, slowest interval + 1 min) and no check is making progress, or a check made no progress for 5 min. `HEALTHCHECK_URL` gets a ping at most once a minute. `scripts/watchdog.mjs` (Windows task every 5 min, installed by `windows-autostart.ps1`) restarts Seated and pushes once per outage. Downtime is logged as `gap` events.

## Activity log

- `events` holds every change: `listed` (open before Seated could see it: first read of a day, or a day that just came into range), `opened`, `reopened`, `taken` (gone from a day that was read without error, before its time), `error` and `recovered` (state changes only), and `gap` (Seated was not running or the computer slept; restaurant `*`).
- `checks` holds one row per check, so a quiet log can be told apart from a stopped radar.
- Editing, pausing or resuming a watch closes its open tables quietly and forgets its read days (`checked_dates`), so the next check starts fresh.
- `GET /api/stats`: openings per restaurant, how long they stayed free (median), and whether they go faster than Seated reads (`tooSlow`). No page shows it since the one-screen redesign.
- **The dashboard is one screen** (Joel, 7 Oct 2026): the watch list (`WatchListPage.tsx`, `GET /api/board`) plus Settings. The header search (`Search.tsx`) is the only way to add a restaurant: + Watch creates the prime watch. The board ranks restaurants with a prime-time watch (`src/shared/prime.ts`: Thu, Fri and Sat, 18:30–21:30, 2 people) by free tables and shows only the coming Thursday, Friday and Saturday. Do not add pages or nav back without Joel asking. `GET /api/live` is a server-sent event stream: one `change` message per logged event or finished check, so the page never polls. A day never read shows `?`, not "full".

## History

- v1 (Feb to Mar 2026): multi-user booking bot (NestJS, Postgres, BullMQ, Twilio). Booking bugs and Tebi's captcha sank it.
- v2 "Radar" (Mar 2026): alerts plus deep links instead of bookings.
- "Lite" (Jun 2026): single-user rewrite with SQLite and ntfy; it booked real tables. Never committed until it was archived on the branch `archive/seated-lite`.
- v3 (Oct 2026, this code): clean rebuild for personal use and open source.
