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
/** Any money on the page means Seated stops: a deposit, a prepayment or a card hold. */
const MONEY = /€|aanbetaling|vooruitbeta|deposit|prepay|creditcard|credit card/i;
const WAITLIST = /wachtlijst|waitlist/i;

export interface TebiOption {
  name: string;
  disabled: boolean;
}

/** The first open option that is a seat at a table, or null. */
export function chooseOption(options: TebiOption[]): TebiOption | null {
  return options.find((o) => !o.disabled && !NOT_A_TABLE.test(o.name)) ?? null;
}

/** Why Seated must not submit this guest page, or null when it may. */
export function refusal(pageText: string): string | null {
  if (WAITLIST.test(pageText)) return 'Tebi offers only the waitlist for this time';
  if (MONEY.test(pageText)) return 'Tebi asks for a deposit or payment for this table';
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
 */
export function readAnswer(status: number | null, body: string): BookResult {
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
    if (data?.paymentPageInput) return { ok: false, uncertain: true, error: 'Tebi made the reservation but asks for a payment' };
    const ref = reservation.id ?? reservation.reference ?? reservation.reservationNumber;
    return { ok: true, reference: ref ? String(ref) : 'Tebi', paymentUrl: null };
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
export async function bookInBrowser(uid: string, date: string, time: string, partySize: number, guest: Guest): Promise<BookResult> {
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
    const options = await optionButtons.evaluateAll((bs) =>
      bs.map((b) => ({ name: (b.getAttribute('data-testid') ?? '').replace('widget-reserve-option-', '').trim(), disabled: (b as HTMLButtonElement).disabled })),
    );
    const option = chooseOption(options);
    if (!option) return { ok: false, error: `No table at ${time}, only: ${options.map((o) => o.name).join(', ')}` };
    await optionButtons.nth(options.indexOf(option)).click();

    // Options with a description open a detail page first, with its own continue button.
    step = 'open the guest page';
    const firstName = page.locator('input[name=firstName]');
    const details = page.getByTestId('widget-reserve-details-button');
    await firstName.or(details).first().waitFor();
    let why = refusal(await page.innerText('body'));
    if (why) return { ok: false, error: why };
    if (await details.isVisible().catch(() => false)) {
      await details.click();
      await firstName.waitFor();
      why = refusal(await page.innerText('body'));
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
    return readAnswer(status, body);
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
