# Seated

A personal table radar for restaurants that are hard to book.

You tell Seated where you want to eat, for how many people, and which evenings suit you. Seated checks the restaurant's booking system every two minutes. When a table opens that fits, your phone gets an alert. One tap opens the restaurant's own booking page with your date, time and party size filled in.

If you want, Seated can also book the table for you, in your name.

```
 You                    Seated                           Restaurant booking page
  │  "Klepel, 2 people,    │                                     │
  │   Fri or Sat, 19-21h"  │                                     │
  │───────────────────────>│  every ~2 min: any tables open? ───>│
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
| Formitable (Zenchef) | Yes | Opens pre-filled with date, time and party | Yes, opt-in |
| Tebi | Yes | Opens the restaurant's Tebi page | No: Tebi's booking form has a captcha, and Seated does not get around captchas |
| Zenchef, SevenRooms, Guestplan, TableCheck, TheFork | Not yet | | |

The list in [data/restaurants.json](data/restaurants.json) has 293 restaurants in the Netherlands, 115 in Amsterdam. 34 of them carry a hard-to-book score (1 to 3) from food guides and reviews, shown on the **Hot list** page. You can add any other Formitable restaurant from the dashboard by pasting its website.

### What we learned watching Amsterdam's hardest tables

On 6 October 2026 Seated read the 15 hardest-to-book restaurants it can watch (party of 2, dinner, next 14 days). Most had plenty of weekday tables. The scarce thing is **Friday and Saturday evening**: CUE, Rijsel and Toscanini had none, and Vuurtoreneiland had nothing at all. That is why the Hot list's one-tap watch covers Friday and Saturday dinners.

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
4. Go to **Add watch**, pick a restaurant and your evenings, and press **Start watching**.

Seated only checks while it runs. On a laptop, that means while the laptop is awake. To watch around the clock, run it on a small always-on machine (see [Hosting](#hosting)).

On Windows, this starts Seated in the background every time you log in:

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

## Auto-book

Auto-book is off by default. To use it:

1. Set `AUTOBOOK=true` in `.env` and restart.
2. Fill in your name, email and phone in **Settings**.
3. Tick **Book it for me** on a watch.

Seated then books the first table that fits and stops that watch. The restaurant sends its confirmation to your email. Some restaurants ask for a deposit; you then get an alert with the payment link.

Seated has three guards against booking twice:

- After a booking, the watch stops.
- A watch that already holds a future table is never booked again, even if you resume it.
- If the booking system does not answer clearly (for example, a timeout), Seated assumes the booking may exist. It pauses the watch and asks you to check your email.

**Only use auto-book for tables you will really use.** A no-show costs a small restaurant real money and takes the table from someone else.

## Configuration

Copy `.env.example` to `.env`. Every value is optional.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `4310` | Dashboard port |
| `HOST` | `127.0.0.1` | Listen address. Only change it together with `SEATED_PASSWORD`. |
| `SEATED_DB` | `data/seated.db` | SQLite file with your watches and settings |
| `POLL_SECONDS` | `120` | Seconds between checks. The minimum is 60. |
| `HORIZON_DAYS` | `14` | How far ahead an open-ended watch looks |
| `AUTOBOOK` | `false` | Master switch for auto-book |
| `SEATED_PASSWORD` | empty | Turns on basic auth (user `seated`) |

## Hosting

Seated is one Node process and one SQLite file. A small VPS, a Raspberry Pi, or a container platform with a persistent volume all work. There is a [Dockerfile](Dockerfile):

```bash
docker build -t seated .
docker run -d -p 4310:4310 -v seated-data:/app/var -e SEATED_PASSWORD=change-me seated
```

Set `SEATED_PASSWORD` whenever the dashboard is reachable from outside your own computer.

## How it works

```
src/server/
  main.ts          starts the server and the check loop
  radar.ts         one check: read slots, track open tables, alert or auto-book
  match.ts         which dates and slots fit a watch (pure functions)
  db.ts            SQLite (Node's built-in node:sqlite), schema made on start
  api.ts           JSON API for the dashboard
  notify.ts        ntfy alerts
  platforms/
    formitable.ts  read availability (month calendar first), build the booking link, book
    tebi.ts        read availability (month calendar first), refresh rotating ids, link
    demo.ts        fake platform for demo mode and tests
src/web/           React dashboard (Vite + Tailwind)
src/cli.ts         npm run peek
scripts/detect.ts  find which booking system a restaurant website uses
data/restaurants.json  curated restaurant list
```

Each check first reads the platform's month calendar (one request per month) and then reads only the days that can have a table. A typical check costs 1 to 5 requests per restaurant instead of 14. It reads every (restaurant, date, party size) once, however many watches share it. Seated keeps a record of every open table it sees and when it disappears. That gives the "Recently gone" list, which shows how fast tables go.

## Be a good guest

Seated reads the same public availability that a restaurant's booking page shows. Keep it that way:

- Do not lower `POLL_SECONDS` below 60.
- Do not run many copies against the same restaurants.
- Never use Seated to hold tables you do not plan to use, or to resell them.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The most useful next pieces are readers for **Zenchef**, **SevenRooms** and **Guestplan**: together they carry 12 of the 34 hardest Amsterdam restaurants.

## License

[MIT](LICENSE)
