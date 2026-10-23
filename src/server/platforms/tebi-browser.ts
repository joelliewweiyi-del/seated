import type { BookResult, Guest } from './types.js';

// Books a Tebi table through Tebi's own booking page in Chrome (Joel's decision, 23 Oct 2026).
// Tebi has no way to book without its reCAPTCHA, so Seated fills the guest page like a person would
// and lets the page run the captcha. Seated never fakes, reuses or hides from the captcha.
// The page's test ids were read from the live widget on 23 Oct 2026 (Tebi release 1.92).

const BOOKING_PAGE = 'https://live.tebi.co/ecom/reservations';
const STEP_MS = 10_000;
const ANSWER_MS = 30_000;

/** Bar seats are not a table. Joel wants a seat at a table (23 Oct 2026). */
const NOT_A_TABLE = /\bbar\b|cocktail|counter|toog/i;
/** Money on a page whose option has no deposit is unexpected, so Seated stops. */
const MONEY = /€|aanbetaling|vooruitbeta|deposit|prepay|creditcard|credit card/i;
const WAITLIST = /wachtlijst|waitlist/i;

/** One seating option at one time, as Tebi's API describes it. */
export interface TebiOption {
  name: string;
  status: string; // Available | Waitlist | ...
  /** The deposit for the whole party, in cents. 0 when there is none. */
  depositCents: number;
  currency: string;
}

const euros = (cents: number) => `€${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

/**
 * Joins `reservation-options` (status and deposit per service) with `reservation-settings`
 * (the service names, which the page uses in its button test ids).
 */
export function readOptions(optionsBody: unknown, settingsBody: unknown, time: string): TebiOption[] {
  const names = new Map<string, string>();
  for (const s of (settingsBody as { services?: { id?: string; name?: string }[] })?.services ?? []) {
    if (s?.id && typeof s.name === 'string') names.set(s.id, s.name.trim());
  }
  const options = (optionsBody as { options?: Record<string, unknown>[] })?.options ?? [];
  return options
    .filter((o) => o.startTime === time && typeof o.serviceId === 'string' && names.has(o.serviceId))
    .map((o) => {
      const price = o.totalPrepaymentPrice as { minorUnits?: number; currencyCode?: string } | null | undefined;
      return {
        name: names.get(o.serviceId as string)!,
        status: String(o.status),
        depositCents: Number(price?.minorUnits ?? 0) || 0,
        currency: price?.currencyCode ?? 'EUR',
      };
    });
}

/**
 * True when this `reservation-options` URL answers exactly our date, time and party size.
 * The deposit covers the whole party, so a list for another party size could break the limit.
 */
export function isOurOptions(url: URL, date: string, time: string, partySize: number): boolean {
  const q = url.searchParams;
  return (
    url.pathname.endsWith('/reservation-options') &&
    q.get('date') === date &&
    q.get('startTime') === time &&
    q.get('groupSize') === String(partySize)
  );
}

/** Why Seated skips this option, or null when it may book it. */
function skipReason(o: TebiOption, maxDepositCents: number): string | null {
  if (o.status !== 'Available') return o.status.toLowerCase();
  if (NOT_A_TABLE.test(o.name)) return 'bar seat';
  if (o.depositCents > 0 && o.currency !== 'EUR') return `deposit in ${o.currency}`;
  if (o.depositCents > maxDepositCents) return `${euros(o.depositCents)} deposit, limit ${euros(maxDepositCents)}`;
  return null;
}

/** The first available table seat with a deposit within the limit, or null. */
export function chooseOption(options: TebiOption[], maxDepositCents: number): TebiOption | null {
  return options.find((o) => skipReason(o, maxDepositCents) === null) ?? null;
}

/** Why no option was chosen, for the push: "Restaurant (€20 deposit, limit €0), Bar (bar seat)". */
export function whyNone(options: TebiOption[], maxDepositCents: number): string {
  return options.map((o) => `${o.name} (${skipReason(o, maxDepositCents)})`).join(', ') || 'no options';
}

/** Why Seated must not submit this page, or null when it may. */
export function refusal(pageText: string, depositCents: number): string | null {
  if (WAITLIST.test(pageText)) return 'Tebi offers only the waitlist for this time';
  if (depositCents === 0 && MONEY.test(pageText)) return 'Tebi asks for money that its option list did not show';
  return null;
}

/** Tebi's phone field has a fixed +31 prefix, so it takes the nine digits after it. */
export function dutchPhone(phone: string): string | null {
  const m = phone.replace(/[\s()-]/g, '').match(/^(?:\+31|0031|0)(\d{9})$/);
  return m ? m[1]! : null;
}

/**
 * Reads Tebi's answer to the one create request. `status` is null when no answer came.
 * A clear refusal (4xx with reasons) means no booking exists. Anything unclear is `uncertain`.
 * With a deposit, Tebi holds the table until it is paid; `paymentUrl` is the page where you pay.
 */
export function readAnswer(status: number | null, body: string, paymentUrl: string | null = null): BookResult {
  if (status === null) return { ok: false, uncertain: true, error: 'No answer from Tebi after submitting' };
  let data: Record<string, unknown> | null = null;
  try {
    data = JSON.parse(body) as Record<string, unknown>;
  } catch {
    // Not JSON: handled by the status checks below.
  }
  if (status >= 200 && status < 300) {
    const reservation = data?.reservation as Record<string, unknown> | undefined;
    if (!reservation) return { ok: false, uncertain: true, error: 'Tebi accepted the request but sent no reservation' };
    const ref = reservation.id ?? reservation.reference ?? reservation.reservationNumber;
    const reference = ref ? String(ref) : 'Tebi';
    if (data?.paymentPageInput) {
      if (!paymentUrl) return { ok: false, uncertain: true, error: 'Tebi holds the table until the deposit is paid, but Seated found no payment link' };
      return { ok: true, reference, paymentUrl };
    }
    return { ok: true, reference, paymentUrl: null };
  }
  if (status >= 400 && status < 500) {
    const reasons = Array.isArray(data?.validation) ? (data.validation as { key?: string }[]).map((v) => v.key).filter(Boolean) : [];
    const why = reasons.length ? reasons.join(', ') : String(data?.message ?? body.slice(0, 120));
    return { ok: false, error: `Tebi refused the booking (${status}): ${why}` };
  }
  return { ok: false, uncertain: true, error: `Tebi answered ${status} after submitting` };
}

/** The month header on Tebi's date page, for example "oktober 2026". */
export function monthLabel(date: string): string {
  const [y, m] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, 15)).toLocaleDateString('nl-NL', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

type Answer = { status: number | null; body: string };

/** Books one table on Tebi's booking page. Never throws: every outcome is a BookResult. */
export async function bookInBrowser(
  uid: string,
  date: string,
  time: string,
  partySize: number,
  guest: Guest,
  maxDepositCents = 0,
): Promise<BookResult> {
  const phone = dutchPhone(guest.phone);
  if (!phone) return { ok: false, error: 'Tebi auto-book needs a Dutch phone number (+31) in Settings' };

  let browser;
  try {
    const { chromium } = await import('playwright-core');
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  } catch (e) {
    return { ok: false, error: `Could not start Chrome: ${(e as Error).message.split('\n')[0]}` };
  }
  let submitted = false;
  let step = 'open the booking page';
  try {
    const page = await (await browser.newContext({ locale: 'nl-NL', timezoneId: 'Europe/Amsterdam' })).newPage();
    page.setDefaultTimeout(STEP_MS);

    // Double-booking guard: exactly one write may reach Tebi's reservation API, and only after
    // Seated pressed submit. Every other write to it is blocked.
    let answer: Promise<Answer> | null = null;
    await page.route('**/api/reservations-guest/**', async (route) => {
      const method = route.request().method();
      if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return route.continue();
      if (!submitted || answer) return route.abort();
      answer = route
        .fetch({ timeout: ANSWER_MS })
        .then(async (res) => {
          const body = await res.text();
          await route.fulfill({ response: res, body }).catch(() => {});
          return { status: res.status(), body };
        })
        .catch(async () => {
          await route.abort().catch(() => {});
          return { status: null, body: '' };
        });
      await answer;
    });

    // The page's own reads tell which service each button is, and its deposit.
    let settingsBody: unknown = null;
    let optionsBody: unknown = null;
    page.on('response', async (res) => {
      const url = new URL(res.url());
      if (res.request().method() !== 'GET' || !res.ok()) return;
      if (url.pathname.endsWith('/reservation-settings')) settingsBody = await res.json().catch(() => null);
      if (isOurOptions(url, date, time, partySize)) optionsBody = await res.json().catch(() => null);
    });

    await page.goto(`${BOOKING_PAGE}/${uid}`, { waitUntil: 'networkidle', timeout: 30_000 });

    step = 'choose the party size';
    const party = page.getByTestId('widget-reserve-groupsize-selector');
    if (!(await party.innerText()).includes(`${partySize} `)) {
      await party.click();
      await page.getByTestId(`widget-reserve-groupsize-button-${partySize}`).click();
      const confirm = page.getByTestId('widget-reserve-groupsize-confirm-continue');
      if (await confirm.isVisible().catch(() => false)) await confirm.click();
    }

    step = 'choose the date';
    // Some restaurants show one combined "date and time" button instead of two (Café Parlotte, Oct 2026).
    const dateButton = page.getByTestId('widget-reserve-date-selector');
    await ((await dateButton.count()) ? dateButton : page.getByTestId('widget-reserve-datetime-selector')).click();
    const dialog = page.locator('[role=dialog]');
    for (let i = 0; i < 3 && !(await dialog.locator('h2', { hasText: monthLabel(date) }).count()); i++) {
      await page.getByTestId('widget-reserve-date-button-next-month').click();
    }
    const day = page.getByTestId(`widget-reserve-date-day-${Number(date.slice(8))}`);
    if ((await day.getAttribute('data-disabled')) === 'true') return { ok: false, error: 'Tebi shows this date as fully booked' };
    await day.click();

    step = 'choose the time';
    // After a date the time list sometimes opens by itself and sometimes not.
    const timeButton = page.getByTestId(`widget-reserve-time-button-${time}`);
    const listOpened = await timeButton.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true, () => false);
    if (!listOpened) await page.getByTestId('widget-reserve-time-selector').click();
    if (!(await timeButton.count())) return { ok: false, error: `Tebi does not offer ${time} on this date` };
    await timeButton.click();

    step = 'choose the seating';
    const optionButtons = page.locator('button[data-testid^="widget-reserve-option-"]');
    await optionButtons.first().waitFor();
    const options = readOptions(optionsBody, settingsBody, time);
    const option = chooseOption(options, maxDepositCents);
    if (!option) return { ok: false, error: `No table Seated may book at ${time}: ${whyNone(options, maxDepositCents)}` };
    const buttonNames = await optionButtons.evaluateAll((bs) =>
      bs.map((b) => (b.getAttribute('data-testid') ?? '').replace('widget-reserve-option-', '').trim()),
    );
    const index = buttonNames.indexOf(option.name);
    if (index < 0) return { ok: false, error: `Tebi shows no button for "${option.name}"` };
    await optionButtons.nth(index).click();

    // Options with a description open a detail page first, with its own continue button.
    step = 'open the guest page';
    const firstName = page.locator('input[name=firstName]');
    const details = page.getByTestId('widget-reserve-details-button');
    await firstName.or(details).first().waitFor();
    let why = refusal(await page.innerText('body'), option.depositCents);
    if (why) return { ok: false, error: why };
    if (await details.isVisible().catch(() => false)) {
      await details.click();
      await firstName.waitFor();
      why = refusal(await page.innerText('body'), option.depositCents);
      if (why) return { ok: false, error: why };
    }
    step = 'fill in the guest details';
    await firstName.fill(guest.firstName);
    await page.locator('input[name=lastName]').fill(guest.lastName);
    await page.locator('input[name=email]').fill(guest.email);
    await page.locator('input[name=phone]').fill(phone);

    step = 'submit';
    submitted = true;
    await page.locator('button[type=submit]').click();
    const deadline = Date.now() + ANSWER_MS + 5_000;
    while (!answer && Date.now() < deadline) await page.waitForTimeout(250);
    if (!answer) return { ok: false, uncertain: true, error: 'Seated pressed submit but saw no request to Tebi' };
    const { status, body } = await (answer as Promise<Answer>);
    // With a deposit, the page moves to the new reservation with a payment token. That page is the payment link.
    let paymentUrl: string | null = null;
    if (option.depositCents > 0 && status !== null && status < 300) {
      paymentUrl = await page.waitForURL(/[?&]token=/, { timeout: 15_000 }).then(() => page.url(), () => null);
    }
    return readAnswer(status, body, paymentUrl);
  } catch (e) {
    const msg = (e as Error).message.split('\n')[0];
    // Before submit nothing was sent, so a failure there is a clear "not booked".
    return submitted
      ? { ok: false, uncertain: true, error: `Tebi page failed after submit: ${msg}` }
      : { ok: false, error: `Tebi page failed at "${step}": ${msg}` };
  } finally {
    await browser.close().catch(() => {});
  }
}
