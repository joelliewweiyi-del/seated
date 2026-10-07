# Seated

A personal table radar for restaurants that are hard to book.

You tell Seated where you want to eat, for how many people, and which evenings suit you. Seated reads the restaurant's booking system every one to five minutes. When a table opens that fits, your phone gets an alert. One tap opens the restaurant's own booking page, with your date, time and party size filled in where the booking system allows it.

If you want, Seated can also book the table for you, in your name.

```
 You                    Seated                           Restaurant booking page
  │  "Klepel, 2 people,    │                                     │
  │   Fri or Sat, 19-21h"  │                                     │
  │───────────────────────>│  every 1-5 min: any tables open? ──>│
  │                        │<──────────── 19:30 Friday is open ──│
  │<─ push: "Table open:   │                                     │
  │   Café de Klepel,      │                                     │
  │   Fri 9 Oct 19:30" ────│                                     │
  │  tap ──────────────────────────────────────── pre-filled ───>│  book in 20 seconds
```

## Why

The hard part of getting a table is not booking it. Booking takes 30 seconds. The hard part is knowing that a table opened, before someone else does. Seated does the watching.

## What works today

| Booking system | Watch for tables | Link | Book for you |
|---|---|---|---|
| Formitable | Yes | Pre-filled: date, time, party | Yes, opt-in |
| Zenchef | Yes | Pre-filled: date, party | No |
| SevenRooms | Yes | Pre-filled: date, time, party | No |
| Tebi | Yes | The restaurant's Tebi page | No: its booking form has a captcha |
| Guestplan | Yes | The restaurant's Guestplan page | No |
| TableCheck, TheFork | Not yet | | |

Seated books only where a booking system allows it without a captcha or another bot check. It never works around one.

The list in [data/restaurants.json](data/restaurants.json) has 297 restaurants in the Netherlands, 119 in Amsterdam. 35 of them carry a hard-to-book score (1 to 3) from food guides and reviews. Seated can read 24 of those 35. They are on the **Hot list** page. You can add any other Formitable restaurant from the dashboard by pasting its website.

### What we learned watching Amsterdam's hardest tables

- **The scarce thing is Friday and Saturday evening.** On 6 October 2026 most hard-to-book restaurants had plenty of weekday tables. CUE, Rijsel and Toscanini had none on Friday or Saturday, and Vuurtoreneiland had nothing at all. That is why the Hot list's one-tap watch covers Friday and Saturday dinners.
- **Formitable restaurants are moving to Zenchef, and the old calendar stays online.** Zenchef owns Formitable. A restaurant that moved keeps a Formitable calendar that no longer takes bookings, so it looks empty. On 7 October 2026 De Kas showed 41 free tables on Formitable and none on Zenchef. 16 Amsterdam restaurants had moved. Seated now refuses to read a Formitable calendar that names a Zenchef id. `scripts/migrate-zenchef.ts` moves such restaurants in the list.

## Run it

You need Node.js 22.13 or later.

```bash
git clone <this repo>
cd seated
npm install
npm start
```

Open http://127.0.0.1:4310. Then:

1. Go to **Settings** and press **Generate** to make a private alert topic.
2. Install the free [ntfy](https://ntfy.sh) app on your phone and subscribe to that topic.
3. Press **Save and send test alert**. Your phone should buzz.
4. Go to **Add watch**, pick a restaurant and your evenings, and press **Start watching**. Or go to **Hot** and watch Friday and Saturday dinners at a hard-to-book restaurant in one tap.

The **Live** page shows the hot restaurants you watch, ranked by free Friday and Saturday tables, and a feed of every table that opens or is taken. It updates by itself.

Seated only checks while it runs. On a laptop, that means while the laptop is awake. To watch around the clock, run it on a small always-on machine (see [Hosting](#hosting)).

On Windows, this starts Seated in the background every time you log in. It also adds a watchdog task: every 5 minutes it asks Seated whether it is still checking, restarts it if not, and pushes a note to your phone.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows-autostart.ps1          # on
powershell -ExecutionPolicy Bypass -File scripts\windows-autostart.ps1 -Remove  # off
```

### Try it without touching real restaurants

```bash
npm run demo
```

Demo mode uses fake restaurants and a database that lives only in memory. Nothing leaves your computer. It is the best way to explore the dashboard or work on the code.

### Observe without alerts (research mode)

```bash
SEATED_DB=data/observe.db PORT=4311 npx tsx src/server/main.ts --observe
```

Observe mode checks real restaurants and records every table that opens and closes, but never pushes and never books. Use it to learn how a restaurant releases tables before you rely on alerts.

### Check one restaurant from the terminal

```bash
npm run peek -- klepel          # party of 2, next 7 days
npm run peek -- "bistro feline" 4 10
```

## Which alerts buzz

An alert is only useful if it is rare. Seated pushes loudly only when a table opens at a restaurant that had **two or fewer** open tables for that watch. Everything else is logged on the Live page, and some of it goes to your phone as a silent notification.

| What happened | Push |
|---|---|
| A table opens where almost nothing was free | Loud |
| A table opens where many tables are already free | Silent |
| A new watch finds tables that were already open | None (they are listed, not "new") |
| A table you were alerted about is taken | Silent: "Gone: …" |
| Seated was not running for a while | None. The Live page shows the gap. |

## How often Seated looks

Seated reads each restaurant on its own schedule. It looks more often where tables are scarce, because those tables go fastest.

| Open tables for your watches | Read every (with `POLL_SECONDS=120`) |
|---|---|
| 0 to 2 | 1 min |
| 3 to 10 | 2 min |
| more than 10 | 5 min |
| the last reads failed | 4 min |

Nothing is ever read more often than once a minute. After two failed requests in a row, Seated skips that restaurant for the rest of the check. The **Live** page shows, per restaurant, how long its tables stay free. If they go faster than Seated looks, it says so.

## Auto-book

Auto-book is off by default. To use it:

1. Set `AUTOBOOK=true` in `.env` and restart.
2. Fill in your name, email and phone in **Settings**.
3. Tick **Book it for me** on a watch.

Seated then books the first table that fits and stops that watch. The restaurant sends its confirmation to your email.

Seated has these guards against bookings you did not want:

- After a booking, the watch stops.
- A watch that already holds a future table is never booked again, even if you resume it.
- If the booking system does not answer clearly (for example, a timeout), Seated assumes the booking may exist. It pauses the watch and asks you to check your email.
- Seated books at most one table per evening, across all watches.
- Seated makes at most one automatic booking in 24 hours.
- Seated never books a table that asks for a deposit, a prepayment or a no-show fee. It alerts you instead.

When you book a table yourself, tap **I got it** on the open table. Seated stops the watch and counts the table as a win.

**Only use auto-book for tables you will really use.** A no-show costs a small restaurant real money and takes the table from someone else.

## Configuration

Copy `.env.example` to `.env`. Every value is optional.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `4310` | Dashboard port |
| `HOST` | `127.0.0.1` | Listen address. Only change it together with `SEATED_PASSWORD`. |
| `SEATED_DB` | `data/seated.db` | SQLite file with your watches and settings |
| `POLL_SECONDS` | `120` | Base time between reads of one restaurant. Seated adjusts it per restaurant (see above). The minimum is 60. |
| `HORIZON_DAYS` | `14` | How far ahead an open-ended watch looks |
| `AUTOBOOK` | `false` | Master switch for auto-book |
| `SEATED_PASSWORD` | empty | Turns on basic auth (user `seated`) |
| `HEALTHCHECK_URL` | empty | A URL that Seated calls after each check, for example from [healthchecks.io](https://healthchecks.io). If the calls stop, that service alerts you. |

## Hosting

Seated is one Node process and one SQLite file. A small VPS, a Raspberry Pi, or a container platform with a persistent volume all work.

With Docker Compose ([docker-compose.yml](docker-compose.yml)):

```bash
SEATED_PASSWORD=change-me docker compose up -d
```

Or with plain Docker ([Dockerfile](Dockerfile)):

```bash
docker build -t seated .
docker run -d --restart unless-stopped -p 4310:4310 -v seated-data:/app/var -e SEATED_PASSWORD=change-me seated
```

Set `SEATED_PASSWORD` whenever the dashboard is reachable from outside your own computer.

`GET /api/health` answers `200` while Seated checks on time, and `503` when the last check is more than 6 minutes old or a check hangs. It needs no password, so uptime monitors and Docker can use it. The Docker image has a `HEALTHCHECK` on it.

## How it works

```
src/server/
  main.ts          starts the server and the check loop (wakes every ~15 s, reads restaurants that are due)
  radar.ts         one check: read slots, track open tables, alert or auto-book
  match.ts         which dates and slots fit a watch (pure functions)
  db.ts            SQLite (Node's built-in node:sqlite), schema made on start
  api.ts           JSON API for the dashboard, the live board and the health check
  notify.ts        ntfy alerts
  platforms/
    index.ts       the list of booking systems
    formitable.ts  read (month calendar first), refuse calendars that moved to Zenchef, link, book
    zenchef.ts     read (summary first), link
    sevenrooms.ts  read (3-day ranges), link
    tebi.ts        read (month calendar first), refresh rotating ids, link
    guestplan.ts   read (day list first), link
    demo.ts        fake platform for demo mode and tests
src/shared/        code that the server and the dashboard share
src/web/           React dashboard (Vite + Tailwind)
src/cli.ts         npm run peek
scripts/
  detect.ts            find which booking system a restaurant website uses
  migrate-zenchef.ts   move restaurants that left Formitable for Zenchef
  watchdog.mjs         restart Seated when it stops checking (Windows task)
data/restaurants.json  curated restaurant list
```

Each read first asks the platform's calendar which days can have a table, then reads only those days. It reads every (restaurant, date, party size) once, however many watches share it. Seated keeps a record of every open table it sees and when it disappears. That gives the "Recently gone" list and the Live feed, which show how fast tables go.

## Be a good guest

Seated reads the same public availability that a restaurant's booking page shows. Keep it that way:

- Do not lower `POLL_SECONDS` below 60. Seated will not read one restaurant more often than once a minute anyway.
- Do not run many copies against the same restaurants.
- Never work around a captcha, a bot check or a firewall. If a booking system blocks Seated, leave that restaurant out.
- Read the terms of each booking system before you rely on it. You are responsible for how you use Seated.
- Never use Seated to hold tables you do not plan to use, or to resell them.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Useful next pieces:

- Readers for **TableCheck** and **TheFork**.
- Platform ids for the hot restaurants Seated cannot read yet: Bolenius, Ciel Bleu, Daalder, Gartine, Hatsune, Motief, Roef, Satkara, Tsunarié and Wils. Tacite blocks automated reads; leave it out.
- Restaurant lists for other cities.

## License

[MIT](LICENSE)
