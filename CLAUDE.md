# Seated: rules for coding agents

Seated is a personal table radar. It watches restaurant booking systems and alerts the user's phone (ntfy) the moment a matching table opens, with a pre-filled booking link. Optionally it books the table (Formitable through its API, Tebi through its booking page in Chrome). Read [README.md](README.md) for the product and [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow.

## Stage

**Pilot (personal use)**, since October 2026. One user (Joel) runs it locally. The next stage is a small group of friends, then open source. Name the stage when you propose work, and say so when a change skips one.

The **public map** is **live at https://seated.food** since 6 Nov 2026 (Joel's go), and in **Pilot**: public, one owner (Joel), no users measured yet. Host: Vercel project `seated-map` in team `joelliewweiyi-dels-projects`; `www.seated.food` redirects to it. `data.json` comes from the Vercel Blob store `seated-map` (fra1), which the radar on the Mac mini fills after each census (token: 1Password `bara-dev/seated-map-blob`, read by the launchd job). Deploy with `VITE_MAP_CONTACT=hello@seated.food scripts/map-deploy.sh --prod`: every CLI deploy of this project lands on the public site, also with `--environment preview` (5 Nov 2026), so there is no private preview: check locally first (`npm run test:e2e`, screenshots).

**seated.food** (registered at Namecheap, 9 Mar 2026; DNS in Cloudflare, account Joelliewweiyi@gmail.com): two CNAMEs (`@`, `www`) to Vercel, Cloudflare proxy off. Mail: Cloudflare Email Routing, `hello@seated.food` and a catch-all forward to joel@baratech.nl. The Railway records of Seated v1 and Namecheap's mail forwarding were removed on 6 Nov 2026 (backup of the old records in that day's session). A Cloudflare API token (`bara-dev/cloudflare`, full access) expires 13 Nov 2026.

## Shape

- One Node process (`src/server/main.ts`) runs the HTTP API, serves the built dashboard, and runs the check loop.
- One SQLite file through Node's built-in `node:sqlite`. The schema is created on start in `db.ts`. There is no ORM and no migration tool. To change a table, add an idempotent `ALTER` in `Store`'s constructor.
- React dashboard in `src/web` (Vite + Tailwind v4). The server serves `dist/web`.
- Public map in `src/map` (its own Vite build, `vite.map.config.ts`). The server serves `dist/map` at `/map` and its data at `/map/data.json`.
- No queue, no Redis, no auth library. Keep it that way unless a real need appears.
- **The map's one backend: Supabase project `seated`** (ref `vczosuhhqvzombqtlscc`, org Joel AI, free plan, eu-central-1; 13 Nov 2026) holds map characters and lists, nothing of the radar. `supabase/schema.sql` is the whole schema: tables in the private schema `seated` (not exposed, RLS on, no policies), and only the nine `SECURITY DEFINER` functions in `public` are granted to `anon`. The browser calls them through PostgREST with the publishable key (`deploy/map/api.json`, public by design). `scripts/map-deploy.sh` applies the schema first (`scripts/api-schema.ts`, Management API, token from 1Password `bara-dev/Supabase CLI`). The demo server answers the same calls at `/map-api/rpc/:fn` from the same SQL in PGlite (`seatedApiDev.ts`), so tests never touch the real project. A schema change is an idempotent edit of `schema.sql`. The free plan pauses after 7 idle days: the radar pings `community_lists` once a day (`pingMapApi`).

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
npm run dev:map     # the map with hot reload, data from the demo server on :4310
npx tsx scripts/map-census.ts [db] [out.json]   # one real census (~110 restaurants, ~3 min); not in a loop
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

### Map design language (`src/map` only)

The city is sezlab's art; everything on top of it is ours (Joel, 5 Nov 2026). Never copy a game's name, art, characters or avatars.

- **City art: sezlab.dev/amsterdam by sezlab, used with his permission (Joel, 5 Nov 2026).** `scripts/map-sez-sync.ts` copies his images into `src/map/public/sez/<version>/` (gitignored: his art, not ours to put in the repo) and writes `sez/manifest.json` (committed: version, projection, chunk lists, a coverage mask). Credit him in the corner credit and the About dialog, with his sponsors link. Never edit his images. When his version changes, run the sync again; the map follows. Option C (his viewer code) needs a licence from him first.
- Our own art (signs, rooms, panels) is drawn in code by a software rasterizer (`pix.ts`): hard pixels, no anti-aliasing. Shown with `image-rendering: pixelated` at whole zoom steps only (`ZOOMS` in `render.ts`): at each one his images are shown at a whole multiple of their pixels.
- His projection (`world.ts`): RD New metres from his origin, `PX = (x + y)/sqrt 2`, `PY = (x - y)/(2 sqrt 2) - h * 0.866`, north-west up. One world pixel is one pixel of his sharpest images. Signs stand on the roof: the restaurant's 3DBAG roof height (`roof` in `data/map-places.json`).
- Outlines and shadows are dark violet (`#2b2733`, `darken()` mixes toward `#1d1a24`), never black. Rooms and signs keep to this.
- **Chrome stays small** (Joel, 6 Nov 2026: "the top and bottom blocks are huge on mobile", "why is the screen so messy"). One slim top bar: brand, `‹ day ›` pill, quick days (wide screens), How it works. The 63-day strip opens from the day pill. No footer bar: a small corner credit (sezlab with his sponsors link, OpenStreetMap). On a phone the closed list is one line ("N with a table" and List). An e2e test keeps the closed chrome under 20% of a phone screen.
- Panels: cream `#fffaf0`, square corners notched with four offset 2 px box-shadows (`.px`) and a soft 6 px drop below. Pixelify Sans for headings, numbers and buttons; the system font for running text.
- Status colours (`STATUS_COLOUR` in `data.ts`): free green `#3fae5f`, full red `#e0604c`, closed grey `#8f8a99`, not bookable yet lavender `#8c7bd8`, unknown light grey. They colour the signs, the list badges and the calendar.
- Primary teal `#0f766e`, the same as the dashboard's copper token.
- People are round heads on simple bodies. No faces from any game.

## Platform knowledge

### Formitable (now owned by Zenchef)

- API base: `https://widget-api.formitable.com/api`. Send a Chrome User-Agent, `Referer: https://widget.formitable.com/`, and `ft-returnurl: <restaurant website>`.
- `GET /availability/{uid}/day/{YYYY-MM-DD}/{party}/en` returns slots: `timeString` (local), `time` (UTC instant), `status` (`AVAILABLE`, `SHORT`, `WAITLIST`, `SOLD_OUT`), `minutes` since local midnight.
- `GET /availability/{uid}/monthWeeks/{month}/{year}/{party}/en` returns a status code per day. Validated on 119 days at 31 restaurants (Oct 2026): code 0 had open tables 61 of 62 times; codes 1, 3 and 6 never did; 2 = past, 5 = today when nothing is left. `openDates()` skips only those known-empty codes.
- Many restaurants load the Formitable widget with JavaScript only (Gitane, Massalia). HTML detection misses them; a headless browser sees the `widget-api.formitable.com/api/restaurant/{uid}` request.
- A dead Formitable widget can stay on a site after a move to Tebi (Alba). It answers with no availability. Check the site for a Tebi token before calling a restaurant "fully booked".
- **A switched-off calendar answers code 1 on every day** ("No availability at this time. Please try again later." in the widget), with no `zenchefId`. On 5 Nov 2026, 16 Amsterdam restaurants did; most had moved (Marie and Badcuyp to SevenRooms, Helling 7 to Tebi, Entrepot, Oriental City to Guestplan, Sinne, MOS and Het Bosch to Frank, The White Room to TableCheck). `calendar()` calls 28+ days of only code 1 unknown, not full. Find where the site's Reserve button goes now (`scripts/map-verify.ts` and a browser look).
- `GET /restaurant/{uid}/status`: the `live` flag is **not** a bookability signal. Many bookable restaurants report `live: false`.
- Deep link (checked in Chrome, Oct 2026): `https://widget.formitable.com/side/en/{uid}/book?partysize=N&date=YYYY-MM-DD&time={minutes}`.
- Booking: `GET /product/{uid}/search/{slot.time}/{party}/en` for the product, then `POST /booking/{uid}`. The payload is in `formitable.ts`. It booked real tables in June 2026.
- **Restaurants are moving to Zenchef, and the old Formitable calendar stays online, frozen.** On 7 Oct 2026 De Kas showed 41 free tables on Formitable and none on Zenchef. The status endpoint's `zenchefId` marks a moved restaurant. `formitable.ts` checks it once a day and refuses to read or book a restaurant that has one (a failed re-check keeps the last answer). `scripts/migrate-zenchef.ts --city Amsterdam --write` moves restaurants whose Zenchef calendar shows open days; it moved 16 in Amsterdam. Toscanini looked "migrated" but had in fact moved to Tebi; check for that first.
- Auto-book refuses any product with a deposit, price, prepayment or no-show fee (`moneyInvolved()`). `AUTOBOOK_MAX_DEPOSIT` applies to Tebi only.

### Tebi

- Reads need no captcha. Base `https://live.tebi.co/api/reservations-guest/ledgers/{uid}`, headers `Tebi-Version-Code: 1680400`, Origin and Referer `https://live.tebi.co`.
- `GET /reservation-dates/{YYYY-MM-DD}?groupSize=N` gives `timeslots[{ time, availabilityType }]`.
- `GET /reservation-months/{YYYY-MM}?groupSize=N` gives `[{ date, availability: Available|Waitlist|Unavailable }]`; `openDates()` uses it so only Available days get a slot read.
- Seeded ledger ids rotate and then return `400 invalid ledger id`. Refresh with `GET https://live.tebi.co/api/widget/{oldUid}` (Referer = restaurant site); the 302 `Location` holds the new id. `tebi.ts` does this on any 400 and saves the new id through `onUidChange`. A restart re-seeds the id in `data/restaurants.json`, so copy refreshed ids from the database into it now and then (18 had rotated by 5 Nov 2026; Wolf Atelier's map link was a blank page).
- Restaurant websites embed a **widget token** (`data-widget-token="…"` on `widget-manager.js`). It is not the ledger id: resolve it with the same `/api/widget/{token}` redirect.
- The booking page `https://live.tebi.co/ecom/reservations/{uid}` reads no date or party from the link (only `serviceId`), so Tebi links cannot be pre-filled.
- Tebi is also a till and web shop: a `tebi.co` link on a site does not prove Tebi takes the bookings.
- Writes need reCAPTCHA v3. Seated books through Tebi's own booking page in headless Chrome (`tebi-browser.ts`, Joel's decision, 23 Oct 2026), so the page runs the captcha as for any guest. Never fake, reuse or hide from the captcha (no stealth flags, no token tricks).
- The booker reads `reservation-settings` (service names, the button test ids) and `reservation-options` (status and `totalPrepaymentPrice` for the whole party per service). It picks the first `Available` option that is not a bar or counter seat and whose deposit is at most `AUTOBOOK_MAX_DEPOSIT` (default 0). It refuses a waitlist, and money on a page whose option showed none, and lets exactly one write reach the reservation API after it presses submit. Test ids (`widget-reserve-*`) were read on 23 Oct 2026. The create answer is `{ reservation, paymentPageInput, problem }`; a refusal is a 4xx with `validation[].key` (for example `NothingAvailable`).
- The page has two layouts: separate date and time buttons, or one combined `widget-reserve-datetime-selector` (Café Parlotte). Options with a description open a detail page first, with `widget-reserve-details-button` to continue. An error names the step that failed.
- Deposits are common. On 23 Oct 2026, every dinner option for the next evening at KID, Bacalar, Café Parlotte, Scheepskameel and Weinlokal Stern asked one (€10 to €35 per guest), so the booker refused them all. With a deposit, Tebi answers with `paymentPageInput` and moves the page to the reservation with `?token=`. That URL is the payment link: the booking is `needs_payment`, and the push opens it. Seated never pays. How long Tebi holds an unpaid table is not yet known.
- Not yet proven: whether Tebi's reCAPTCHA accepts the headless browser. The first real booking settles it.

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

### Frank (meetfrank.app)

- Read-only, plain GETs on `https://api.workspace.meetfrank.app/widget-api/{widgetId}/`: `time-slots/month?month&year&number_of_people` (whole weeks; `available`, `waitlist` = full, `unavailable` = no table) and `time-slots/day?date&number_of_people` (times with the restaurant's own offset). Without an `Accept-Language` header it answers 400.
- The widget id is the uuid in `widget.workspace.meetfrank.app/{id}/open`; a site's Reserve button points at `#frank-app-open`. Sinne, Bolenius, MOS, Het Bosch and Sea Palace use it (Nov 2026). Many offer paid tickets next to tables (Sinne: €40 deposit menu).
- The link cannot be pre-filled.

## Restaurant data

- `data/restaurants.json`: `hot` (1 to 3) and `hotWhy` mark the hard-to-book list (40 Amsterdam restaurants, 29 readable; 35 researched 6 Oct 2026 from Time Out, Amsterdam Foodie, Your Little Black Book, Michelin and others; Weinlokal Stern, Kamer, KID, September and Bacalar added by Joel on 7 Oct, scored from Seated's own reads).
- On 6 Oct 2026, 29 restaurants listed as Formitable had moved to Tebi; they were switched with ids resolved from their websites.
- `scripts/detect.ts <url>` finds the booking system on a website. It reads HTML only: Frank, Formitable's JavaScript-only widgets and Tebi tokens added by script need a browser look.
- **Guides** (`data/map-guides.json`): press lists of Amsterdam restaurants, read by hand (names only; `line` is one line in our own words, never their text), with each guide's picks as Seated ids. On the map a guide is a lens (the "Lists" picker, `?lens=<id>`): the list keeps its picks, the map dims the rest, a card names the guides that pick it. A guide needs `MIN_GUIDE_PICKS` (3) on the map to be listed. A creator's list (Instagram, a blog) becomes a lens only after the creator says yes (Joel, 6 Nov 2026). On 7 Nov 2026, 22 bookable places from these lists were added (`scripts/detect.ts` on their sites, then one calendar read each).
- **Lists picker** (`picker.tsx`, Joel, 10 Nov 2026): the Lists chip opens a dialog where a small pixel host asks "Where shall we eat?": every restaurant and each guide, with its picks and how many are free that day, plus a "Missing a place?" form that opens a mail to `VITE_MAP_CONTACT` (no form without it). Once per device (`seated.map.hello` in localStorage), 6 s in, a nudge from the host points at it. No login yet: Joel chose list first, login as a later step (server, user store and vendor still to choose).
- **MICHELIN** (`data/map-michelin.json`): every Amsterdam restaurant with stars or a Bib Gourmand in the 2026 guide (announced 5 Oct 2026; 34 places, 15 added on 5 Nov), each with two or more press sources. Read by hand from press coverage. Never script guide.michelin.com: its robots.txt forbids automated access and asks for a licence. The Selected list (no star, no Bib) is not in Seated for that reason. The Green Star is being phased out during 2026 (Mindful Voices replaces it), so Seated does not show it. Kept apart from `map-places.json` so placing restaurants again never drops one; `loadPlaces()` merges them.

## Radar behaviour

- **Scarcity polling.** Each restaurant has its own interval: `pollInterval()` in `radar.ts`. ≤ 2 open tables: 0.5 × `POLL_SECONDS`; ≤ 10: 1 ×; more: 2.5 ×; failing: 2 ×. Never under 60 s (`POLITE_FLOOR_SECONDS`). The loop wakes every ~15 s and reads only what is due; "Check now" reads all.
- **Breaker.** Two failed requests in a row skip the restaurant for the rest of the check. Each read has a 45 s backstop.
- **Push hygiene.** A first read of a day is silent (`listed`). A loud push (max) only when the watch had ≤ 2 open tables (`SCARCE_TABLES`); otherwise silent (low). "Gone:" goes only for tables that got a loud push. `sightings.notified`: 0 pending, 1 `LOUD`, 2 `QUIET`. **Quiet hours** (`QUIET_HOURS`, default 00:00–08:00 Amsterdam): no table pushes; the tables stay pending (0) and are pushed when the window ends, if still open. Scarcity counts only tables already pushed, so a held table is still news at 08:00.
- **Auto-book guards** (on top of hard rule 5): one table per evening across watches (`hasBookingOn`), at most one auto-booking per 24 h (`autoBookingsSince`), never when money is involved, except a Tebi deposit up to `AUTOBOOK_MAX_DEPOSIT` that you pay from the push. "I got it" (`POST /api/watches/:id/got-it`) records a booking with source `you` and stops the watch.
- **Platform switch.** `seedRestaurants` returns restaurants whose platform changed; their watches close their sightings quietly and start fresh. A uid change alone does not reset (Tebi rotates ids).
- **Health.** `GET /api/health` (no password needed) is 503 when no check finished within max(6 min, slowest interval + 1 min) and no check is making progress, or a check made no progress for 5 min. `HEALTHCHECK_URL` gets a ping at most once a minute. `scripts/watchdog.mjs` (Windows task every 5 min, installed by `windows-autostart.ps1`) restarts Seated and pushes once per outage. Since 21 Oct 2026 Seated runs on the Mac mini instead: launchd job `sh.seated.radar` (`~/Library/LaunchAgents`) starts it at login and restarts it when it exits; the Windows tasks are disabled. No watchdog runs on the Mac yet, so a Seated that hangs without exiting is not restarted. Downtime is logged as `gap` events.

## Activity log

- `events` holds every change: `listed` (open before Seated could see it: first read of a day, or a day that just came into range), `opened`, `reopened`, `taken` (gone from a day that was read without error, before its time), `error` and `recovered` (state changes only), and `gap` (Seated was not running or the computer slept; restaurant `*`).
- `checks` holds one row per check, so a quiet log can be told apart from a stopped radar.
- Editing, pausing or resuming a watch closes its open tables quietly and forgets its read days (`checked_dates`), so the next check starts fresh.
- `GET /api/stats`: openings per restaurant, how long they stayed free (median), and whether they go faster than Seated reads (`tooSlow`). No page shows it since the one-screen redesign.
- **The dashboard is one screen** (Joel, 7 Oct 2026): the watch list (`WatchListPage.tsx`, `GET /api/board`) plus Settings. The header search (`Search.tsx`) is the only way to add a restaurant: + Watch creates the prime watch. The board ranks restaurants with a prime-time watch (`src/shared/prime.ts`: Thu, Fri and Sat, 18:30–21:30, 2 people) by free tables and shows only the coming Thursday, Friday and Saturday. Do not add pages or nav back without Joel asking. `GET /api/live` is a server-sent event stream: one `change` message per logged event or finished check, so the page never polls. A day never read shows `?`, not "full".

## Public map

- **Noord and the gaps are ours:** Seated’s old cell painter fills where sezlab’s art has no pixels (Noord; Oost, the Indische Buurt and Watergraafsmeer since 8 Nov 2026), cut to his gaps plus a 128-world-pixel strip over his edge, where his art fades out in a dither (`gapMask`, `UNDER_HIS_EDGE`); drawn on top of his art there, never elsewhere, and never editing his images; rebuild `src/map/public/ours/` with `npx tsx scripts/map-noord.ts` (sequential open-data downloads cached in `.cache/`, warm builds offline). See `docs/map-noord.md`.

- **Census** (`census.ts`): every `MAP_CENSUS_MINUTES` after the last pass ended (default 15, floor 10, ±10%, first run 90 s after start; Joel, 5 Nov 2026) one `calendar()` read per Amsterdam restaurant, for 2 people, from today to the end of the month of day 63. Slot reads only for open days in the next 3 days. One restaurant at a time, 45 s backstop each. A failed read keeps the last answer (`census_reads.error`); a successful one replaces all days from today, so a day it leaves out is unknown. A move to another system forgets the old days (`seedRestaurants`).
- **`Platform.calendar()`** answers `open`, `full`, `closed` or `none` per day; a day left out is unknown. Tebi, Formitable and Zenchef use their month calls; Guestplan its day list; SevenRooms reads only 21 days (7 calls), so later days show unknown ("Book on their site").
- **Day codes** in `data.json`: `o` free, `f` full, `c` closed, `n` none, `l` later (after the last bookable day: the calendar has not opened that far), `?` unknown. `win` is the booking window in days; the card shows "opens about" = day − `win`. The extra days to month end stop a sold-out end of the window from reading as `l` (Vuurtoreneiland, 4 Nov 2026).
- The radar's own sightings for 2 people override the census for that day.
- **Never on the map:** Esra (hard rule 2, also in `data/map-optout.json`), anything in `map-optout.json`, restaurants outside Amsterdam or without a calendar. `data.json` carries only restaurant facts and calendar states, never settings, watches, bookings or guest details (`test/mapData.test.ts`).
- **City:** his art covers the centre inside the ring, not all of Amsterdam (his RD box 118.5-125 km x 484.5-490 km, cut to the city's outline). A restaurant outside the combined sezlab and Seated Noord art (18 of 138 on 6 Nov 2026, computed from the repository’s Amsterdam restaurant list and `World.covers`) gets its sign standing on the fog at ground level, and its card says so (`World.covers`, from the mask); the camera may go out to every restaurant. The fog edge stays clear around every restaurant (`FOG_CLEAR`). `data/map-places.json` holds each restaurant's coordinates, area, room kind and roof height (`scripts/map-places.ts`: PDOK, then Nominatim, then `MANUAL`/`FIXED`; roofs from the 3DBAG WFS).
- **Rendering:** his overview image underneath, then the chunk level that is never smaller than the screen (zoom >= 1: his sharpest over his 1/2 level; 0.5: 1/2; 0.25: 1/4; below: the overview), loaded as the view needs them, 48 kept. Signs are drawn in screen space and kept clear of the panels (`view.safe`). His trams, boats and night mode are his code, not images: not in this map. Outside both drawings: our pixel fog (`fogTile` in `render.ts`, four flat tones), under the art and, drawn after it, over a ragged band along the edge of both, found from both overviews' alpha (`fogEdgeIndex`, `FOG_REACH`). Joel, 6 Nov 2026: the blank looked broken; 8 Nov 2026: fog in straight-cut boxes over Oost looked broken too.
- **You: two questions, a profile, a character, lists** (Joel, 13 Nov 2026). A plain first visit opens the welcome (`welcome.tsx`): two questions (`taste.ts` `QUESTIONS`), then one of six profiles (`PROFILES`: highest dot product over axis norm) and five picks (top 12 by fit, free tables first). A link with `?r=`, `?lens=` or `?list=` never opens it; Skip or an answer marks it seen (`seated.map.you` in localStorage). Answers stay on the device until you make a character (`avatar.tsx`: our own 16 x 16 pixel bust, no game art). A character is the account: no email, no password. Its 16-character key (Crockford base32, only its sha256 stored, typed loosely) is shown once and on request, and opens it on another device. Lists: 20 per character, 50 places each, private until shared in Community (shown with 3+ places). Places in your lists pull your profile (`tasteOf`). Three distinct reporters (key, else hashed IP) hide a list for good. 10 new characters per IP per hour. Delete removes the character and its lists at once.
- Before you call a map change done: `npm run test:e2e` and review the `map-*` screenshots in a subagent.

## History

- v1 (Feb to Mar 2026): multi-user booking bot (NestJS, Postgres, BullMQ, Twilio). Booking bugs and Tebi's captcha sank it.
- v2 "Radar" (Mar 2026): alerts plus deep links instead of bookings.
- "Lite" (Jun 2026): single-user rewrite with SQLite and ntfy; it booked real tables. Never committed until it was archived on the branch `archive/seated-lite`.
- v3 (Oct 2026, this code): clean rebuild for personal use and open source.
