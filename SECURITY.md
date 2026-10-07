# Security

## Reporting a problem

Please report security problems privately, through GitHub's **Report a vulnerability** button on the Security tab of this repository. Do not open a public issue. You get an answer within a week.

## How Seated protects you

Seated runs on your own computer or server and holds your watches, your ntfy topic and, if you use auto-book, your name, email and phone number. It can book tables in your name. So the dashboard must answer only you.

- **Local by default.** Seated listens on `127.0.0.1`. Without `SEATED_PASSWORD`, the API answers only requests addressed to `localhost`, `127.0.0.1` or `[::1]`. This blocks DNS-rebinding attacks.
- **No changes from other websites.** Every request that changes something must carry the header `X-Seated: 1`. A form or a cross-site request from another website cannot add it, so a web page you visit cannot create an auto-book watch through your browser.
- **Password when hosted.** Set `SEATED_PASSWORD` whenever the dashboard is reachable from another machine. It turns on HTTP basic auth (user `seated`). Put Seated behind HTTPS in that case: basic auth sends the password with every request.
- **Health without a password.** `GET /api/health` answers without the password, so that uptime monitors can use it. It shows only the number of active watches and the time of the last check.
- **Auto-book is off** unless you set `AUTOBOOK=true`, and then only for watches where you tick it.
- **Your data stays local.** The SQLite file, `.env` and the watchdog state are in `.gitignore`. Seated sends your guest details only to the booking system, when it books for you.

## What Seated does not do

Seated never works around a captcha, a bot check or a web firewall on a booking system. A change that does is not accepted.
