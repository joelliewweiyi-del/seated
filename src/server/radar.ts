import { LOUD, QUIET, type EventKind, type RadarEvent, type RestaurantRow, type Sighting, type Store, type Watch } from './db.js';
import type { Guest, Platform, Slot } from './platforms/types.js';
import type { Notifier } from './notify.js';
import { datesForWatch, matchingSlots } from './match.js';
import { localDate, localTime, slotLabel } from './time.js';

/** A table that closes and reopens within this window is a flicker, not news: no second push. */
export const QUIET_REOPEN_MS = 15 * 60_000;

/**
 * Backstop for a platform read that never answers. Each request has its own fetch timeout; this
 * catches anything that still hangs, so one silent call cannot stop every later check.
 */
export const READ_LIMIT_MS = 45_000;

function limited<T>(work: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what}: no answer in ${READ_LIMIT_MS / 1000} s`)), READ_LIMIT_MS);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

export interface RadarOptions {
  store: Store;
  platforms: Record<string, Platform>;
  notifier: Notifier;
  horizonDays: number;
  autoBookEnabled: boolean;
  /** Base seconds between reads of one restaurant. Scarce restaurants are read more often, plentiful ones less. */
  pollSeconds?: number;
  now?: () => Date;
}

/** No restaurant is ever read more often than this, whatever the settings. Be polite to small restaurants. */
export const POLITE_FLOOR_SECONDS = 60;

/** A watch with this many open tables or fewer is scarce: a new table there is real news. */
export const SCARCE_TABLES = 2;

/**
 * How long to wait between reads of one restaurant. Scarce restaurants (few open tables) are read often,
 * because a cancellation there is gone in minutes. Plentiful ones are read rarely: one more table is not news.
 * A restaurant that fails to answer is read less often, so Seated does not add to its trouble.
 */
export function pollInterval(openTables: number, failing: boolean, pollSeconds: number): number {
  const factor = failing ? 2 : openTables <= SCARCE_TABLES ? 0.5 : openTables <= 10 ? 1 : 2.5;
  return Math.max(POLITE_FLOOR_SECONDS, Math.round(pollSeconds * factor)) * 1000;
}

/** One auto-booking per this window, across all watches: Seated never books a week of dinners in one night. */
export const AUTOBOOK_WINDOW_MS = 24 * 60 * 60_000;

export interface TickReport {
  startedAt: string;
  finishedAt: string;
  watches: number;
  restaurants: number;
  requests: number;
  failedRequests: number;
  newTables: number;
  tablesTaken: number;
  bookings: number;
}

interface Fresh {
  sighting: Sighting;
  slot: Slot;
}

/** The fields that decide which slots match. */
const criteria = (w: Watch) =>
  JSON.stringify([w.partySize, w.dateFrom, w.dateTo, w.weekdays, w.timeFrom, w.timeTo, w.autoBook]);

const byDateTime = (a: { date: string; time: string }, b: { date: string; time: string }) =>
  `${a.date}|${a.time}`.localeCompare(`${b.date}|${b.time}`);

/** "Wed 7 Oct 19:00–20:30 (7 times), Thu 8 Oct 19:30" for the push body. */
export function summarize(slots: Array<{ date: string; time: string }>, maxDays = 3): string {
  const days = new Map<string, string[]>();
  for (const s of [...slots].sort(byDateTime)) days.set(s.date, [...(days.get(s.date) ?? []), s.time]);
  const lines = [...days].slice(0, maxDays).map(([date, times]) =>
    times.length === 1 ? slotLabel(date, times[0]) : `${slotLabel(date, times[0])}–${times.at(-1)} (${times.length} times)`,
  );
  const more = days.size > maxDays ? `\n+${days.size - maxDays} more days` : '';
  return lines.join('\n') + more;
}

/**
 * The radar. One `tick()` checks every active watch once:
 *   1. read availability, once per (restaurant, date, party size)
 *   2. keep `sightings` in step: new open tables are added, vanished ones closed
 *   3. auto-book (if the user opted in) and push an alert for tables not yet pushed
 */
export class Radar {
  lastReport: TickReport | null = null;
  private busy: Promise<TickReport> | null = null;
  private readonly now: () => Date;

  constructor(private readonly o: RadarOptions) {
    this.now = o.now ?? (() => new Date());
  }

  get running(): boolean {
    return this.busy !== null;
  }

  /**
   * When the running check last finished a restaurant (or started), or null. A long check is fine while it moves:
   * with many failing restaurants one check can take ten minutes. Many minutes without progress means it hangs.
   */
  progressAt: string | null = null;

  /**
   * Runs one check of the restaurants that are due (see `pollInterval`), or of all of them with `all`.
   * If a check is already running, returns that one instead of starting a second.
   */
  tick({ all = false }: { all?: boolean } = {}): Promise<TickReport> {
    if (!this.busy) {
      this.progressAt = this.now().toISOString();
      this.busy = this.run(all).finally(() => {
        this.busy = null;
        this.progressAt = null;
      });
    }
    return this.busy;
  }

  /** Milliseconds between reads of this restaurant right now. */
  intervalFor(restaurantId: string): number {
    const { store } = this.o;
    const open = store
      .listWatches('watching')
      .filter((w) => w.restaurantId === restaurantId)
      .reduce((n, w) => n + store.openSightings(w.id).length, 0);
    const failing = Boolean(store.getRestaurant(restaurantId)?.lastError);
    return pollInterval(open, failing, this.o.pollSeconds ?? 120);
  }

  /** Logs a stretch of time in which Seated did not check (process stopped, computer asleep). */
  noteGap(from: string, to: string, reason: string): void {
    const minutes = Math.round((Date.parse(to) - Date.parse(from)) / 60_000);
    const span = minutes >= 90 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
    const detail = `${reason} for ${span}, ${localTime(new Date(from))}–${localTime(new Date(to))}`;
    this.o.store.addEvent({ at: to, kind: 'gap', restaurantId: '*', watchId: null, partySize: null, date: null, time: null, detail });
  }

  private async run(all: boolean): Promise<TickReport> {
    const { store } = this.o;
    const startedAt = this.now().toISOString();
    const report: TickReport = {
      startedAt,
      finishedAt: startedAt,
      watches: 0,
      restaurants: 0,
      requests: 0,
      failedRequests: 0,
      newTables: 0,
      tablesTaken: 0,
      bookings: 0,
    };

    for (const b of store.unnotifiedBookings()) await this.sendBookingNotice(b.id);

    const byRestaurant = new Map<string, Watch[]>();
    for (const w of store.listWatches('watching')) {
      byRestaurant.set(w.restaurantId, [...(byRestaurant.get(w.restaurantId) ?? []), w]);
    }

    for (const [restaurantId, watches] of byRestaurant) {
      const restaurant = store.getRestaurant(restaurantId);
      const platform = restaurant ? this.o.platforms[restaurant.platform] : undefined;
      if (!restaurant) continue;
      const last = restaurant.lastCheckedAt ? Date.parse(restaurant.lastCheckedAt) : 0;
      if (!all && this.now().getTime() - last < this.intervalFor(restaurantId)) continue; // not due yet
      if (!platform || !restaurant.platformUid) {
        store.markChecked(restaurantId, this.now().toISOString(), 'Seated cannot read this platform yet');
        continue;
      }
      report.restaurants++;
      const errors: string[] = [];
      const cache = new Map<string, Slot[] | Error>();
      // Two failed requests in a row: the restaurant is down or slow. Stop reading it until the next check,
      // instead of waiting out one timeout per day. Days not read keep their open tables, like any failed read.
      let failedInARow = 0;
      const down = () => failedInARow >= 2;
      // One calendar call per party size, covering the dates of every watch on this restaurant.
      const calendar = new Map<number, Set<string> | Error>();
      const calendarFor = async (partySize: number): Promise<Set<string> | null> => {
        if (!platform.openDates) return null;
        if (!calendar.has(partySize)) {
          const today = localDate(this.now());
          const all = [
            ...new Set(
              watches.filter((w) => w.partySize === partySize).flatMap((w) => datesForWatch(w, today, this.o.horizonDays)),
            ),
          ].sort();
          report.requests++;
          try {
            calendar.set(partySize, all.length ? await limited(platform.openDates(restaurant, all, partySize), 'calendar') : new Set());
            failedInARow = 0;
          } catch (err) {
            failedInARow++;
            report.failedRequests++;
            errors.push(`calendar: ${err instanceof Error ? err.message : err}`);
            calendar.set(partySize, err instanceof Error ? err : new Error(String(err)));
          }
        }
        const result = calendar.get(partySize)!;
        return result instanceof Error ? null : result; // on a failed calendar, read every day
      };

      for (const watch of watches) {
        report.watches++;
        const today = localDate(this.now());

        // Safety net: a watch that already holds a table must never book again.
        if (store.hasLiveBooking(watch.id, today)) {
          store.updateWatch(watch.id, { status: 'booked' });
          continue;
        }

        const checked = new Set<string>();
        const found: Slot[] = [];
        const dates = datesForWatch(watch, today, this.o.horizonDays);
        // Cheap pre-check where the platform has one: skip days its calendar says are empty.
        const worth = dates.length > 0 ? await calendarFor(watch.partySize) : null;
        for (const date of dates) {
          const key = `${date}|${watch.partySize}`;
          if (worth && !worth.has(date) && !cache.has(key)) cache.set(key, []); // calendar says no tables
          let result = cache.get(key);
          if (!result && down()) continue; // not read this check: unknown, so leave this date's sightings alone
          if (!result) {
            report.requests++;
            try {
              result = await limited(platform.getSlots(restaurant, date, watch.partySize), date);
              failedInARow = 0;
            } catch (err) {
              failedInARow++;
              result = err instanceof Error ? err : new Error(String(err));
              report.failedRequests++;
              errors.push(`${date}: ${result.message}`);
            }
            cache.set(key, result);
            this.progressAt = this.now().toISOString(); // one read done: the check is moving
          }
          if (result instanceof Error) continue; // unknown, so leave this date's sightings alone
          checked.add(date);
          found.push(...matchingSlots(watch, result));
        }

        // The user may have paused or removed the watch while we were reading.
        const current = store.getWatch(watch.id);
        if (!current || current.status !== 'watching') continue;
        // If the user edited the watch meanwhile, `found` used the old criteria. Skip; the next check uses the new ones.
        if (criteria(current) !== criteria(watch)) continue;

        const wanted = new Set(datesForWatch(current, today, this.o.horizonDays));
        const { fresh, created, taken, scarce } = this.sync(current, restaurant, platform, today, wanted, checked, found);
        report.newTables += created;
        report.tablesTaken += taken.length;
        report.bookings += await this.act(current, restaurant, platform, fresh, found, today, scarce);
        // Only tables the user was loudly told about: "the table we told you about is gone, don't bother".
        const told = taken.filter((s) => s.notified === LOUD);
        if (told.length) await this.sendTakenNotice(current, restaurant, told);
      }

      const at = this.now().toISOString();
      const error = errors.length ? `${errors.length} failed: ${errors[0]}` : null;
      // Log only the change of state, not every failing check.
      if (error && !restaurant.lastError) store.addEvent({ ...this.blankEvent(at, 'error', restaurantId), detail: error });
      if (!error && restaurant.lastError) store.addEvent(this.blankEvent(at, 'recovered', restaurantId));
      store.markChecked(restaurantId, at, error);
      this.progressAt = at;
    }

    report.finishedAt = this.now().toISOString();
    // A tick with nothing due is not a check: it neither moves the heartbeat nor fills the log.
    if (report.restaurants > 0) {
      this.lastReport = report;
      store.addCheck(report);
    }
    return report;
  }

  /**
   * Brings the watch's sightings in line with what we just saw.
   * Returns the open tables that still need a push (new ones, and earlier ones whose push failed).
   */
  private sync(
    watch: Watch,
    restaurant: RestaurantRow,
    platform: Platform,
    today: string,
    wanted: Set<string>,
    checked: Set<string>,
    found: Slot[],
  ): { fresh: Fresh[]; created: number; taken: Sighting[]; scarce: boolean } {
    const { store } = this.o;
    const now = this.now();
    const nowIso = now.toISOString();
    const pending = new Map(found.map((s) => [`${s.date}|${s.time}`, s]));
    const fresh: Fresh[] = [];
    const taken: Sighting[] = [];
    const event = (kind: 'listed' | 'opened' | 'reopened' | 'taken', date: string, time: string) =>
      store.addEvent({ ...this.blankEvent(nowIso, kind, restaurant.id), watchId: watch.id, partySize: watch.partySize, date, time });
    // Days already read without error. A table on any other day is not news: it was open before we could see it.
    const known = store.watchCheckedDates(watch.id);
    // Few open tables before this check: a new one is real news, so it gets a loud push.
    const scarce = store.openSightings(watch.id).length <= SCARCE_TABLES;

    for (const s of store.openSightings(watch.id)) {
      const key = `${s.date}|${s.time}`;
      const slot = pending.get(key);
      if (slot) {
        store.touchSighting(s.id, nowIso);
        pending.delete(key);
        if (!s.notified) fresh.push({ sighting: s, slot });
      } else if (s.date < today || checked.has(s.date) || !wanted.has(s.date)) {
        // Gone, past, or no longer wanted after the user edited the watch.
        store.closeSighting(s.id, nowIso);
        // Only a table that vanished from a day we just read, before its time, was taken by someone.
        const expired = s.date < today || (s.date === today && s.time <= localTime(now));
        if (!expired && checked.has(s.date) && wanted.has(s.date)) {
          event('taken', s.date, s.time);
          taken.push(s);
        }
      }
    }

    let created = 0;
    for (const slot of pending.values()) {
      const previous = store.lastSighting(watch.id, slot.date, slot.time);
      const url = platform.bookingUrl(restaurant, slot.date, slot.time, watch.partySize);
      const sighting = store.addSighting(watch.id, slot.date, slot.time, url, nowIso);
      created++;
      event(!known.has(slot.date) ? 'listed' : previous?.goneAt ? 'reopened' : 'opened', slot.date, slot.time);
      const flicker =
        previous?.goneAt && previous.notified && now.getTime() - Date.parse(previous.goneAt) < QUIET_REOPEN_MS;
      // The first read of a new watch: these tables were open before the user started watching. The dashboard
      // shows them; a push would be noise (it once sent 13 loud pushes in a minute).
      const firstRead = known.size === 0;
      if (flicker) store.markNotified([sighting.id], previous.notified === LOUD ? LOUD : QUIET); // covered by the earlier push
      else if (firstRead) store.markNotified([sighting.id], QUIET);
      else fresh.push({ sighting, slot });
    }
    const stillKnown = [...new Set([...known, ...checked])].filter((d) => d >= today && wanted.has(d)).sort();
    store.setWatchCheckedDates(watch.id, stillKnown);
    return { fresh: fresh.sort((a, b) => byDateTime(a.slot, b.slot)), created, taken, scarce };
  }

  private blankEvent(at: string, kind: EventKind, restaurantId: string): Omit<RadarEvent, 'id'> {
    return { at, kind, restaurantId, watchId: null, partySize: null, date: null, time: null, detail: null };
  }

  /** A quiet push when a table the user was told about is taken. Informational, so a failed push is not retried. */
  private async sendTakenNotice(watch: Watch, restaurant: RestaurantRow, taken: Sighting[]): Promise<void> {
    await this.o.notifier.send({
      title: taken.length === 1 ? `Gone: ${restaurant.name}` : `${taken.length} tables gone: ${restaurant.name}`,
      body: `${watch.partySize} people
${summarize(taken)}`,
      priority: 'low',
      tags: ['x'],
    });
  }

  /** Auto-books if allowed, then pushes the tables that need a push. Returns tables booked (0 or 1). */
  private async act(
    watch: Watch,
    restaurant: RestaurantRow,
    platform: Platform,
    fresh: Fresh[],
    found: Slot[],
    today: string,
    scarce: boolean,
  ): Promise<number> {
    const { store, notifier } = this.o;
    let note = '';

    if (watch.autoBook && this.o.autoBookEnabled && platform.book) {
      // Any matching table that is bookable now and that we have not tried before. This also
      // catches a table that was already open but only now became auto-bookable.
      const untried = [...found].sort(byDateTime).filter((s) => s.autoBookable && !store.bookingAttempted(watch.id, s.date, s.time));
      // One table per evening: skip evenings that already have one, so another evening can still be booked.
      const candidate = untried.find((s) => !store.hasBookingOn(s.date));
      const guest = this.guest();
      if (candidate && !guest) {
        note = 'Auto-book is on, but your name, email and phone are missing in Settings.';
      } else if (!candidate && untried.length > 0) {
        note = 'Not auto-booked: you already have a table that evening.';
      } else if (candidate && store.autoBookingsSince(new Date(this.now().getTime() - AUTOBOOK_WINDOW_MS).toISOString()) > 0) {
        note = 'Not auto-booked: Seated already booked a table in the last 24 hours. Book this one yourself if you want it.';
      } else if (candidate && guest && !store.hasLiveBooking(watch.id, today)) {
        const outcome = await this.book(watch, restaurant, platform, candidate, guest);
        if (outcome === 'booked') return 1;
        if (outcome === 'uncertain') {
          note = 'Auto-book got no clear answer, so this watch is paused. Check your email.';
        } else {
          if (fresh.length === 0) {
            // The table was pushed before, so there is no alert to attach this to. Tell the user anyway.
            await notifier.send({ title: `Auto-book failed: ${restaurant.name}`, body: outcome.error, priority: 'high', tags: ['warning'] });
            return 0;
          }
          note = `Auto-book failed: ${outcome.error}`;
        }
      }
    }

    if (fresh.length === 0) return 0;
    const slots = fresh.map((f) => f.slot);
    // Loud only where a table is scarce. One more table at a restaurant with plenty free is a quiet note.
    const loud = scarce || note !== '';
    const sent = await notifier.send({
      title: fresh.length === 1 ? `Table open: ${restaurant.name}` : `${fresh.length} tables open: ${restaurant.name}`,
      body: `${watch.partySize} people\n${summarize(slots)}${note ? `\n${note}` : ''}`,
      url: fresh[0]!.sighting.bookingUrl,
      priority: loud ? 'max' : 'low',
      tags: ['fork_and_knife'],
    });
    // Unsent pushes stay pending, so the next check tries again while the table is still open.
    if (sent) store.markNotified(fresh.map((f) => f.sighting.id), loud ? LOUD : QUIET);
    return 0;
  }

  /**
   * Books one slot. 'uncertain' has already been pushed to the user as its own notice.
   * The attempt is saved as 'uncertain' BEFORE the request goes out. If Seated dies mid-request,
   * that row still blocks a second booking and tells the user to check their email.
   */
  private async book(
    watch: Watch,
    restaurant: RestaurantRow,
    platform: Platform,
    slot: Slot,
    guest: Guest,
  ): Promise<'booked' | 'uncertain' | { error: string }> {
    const { store } = this.o;
    const { date, time } = slot;
    const attempt = store.addBooking({
      watchId: watch.id,
      restaurantId: restaurant.id,
      restaurantName: restaurant.name,
      date,
      time,
      partySize: watch.partySize,
      status: 'uncertain',
      reference: null,
      paymentUrl: null,
      error: 'Seated stopped while booking',
      createdAt: this.now().toISOString(),
    });
    const result = await platform.book!(restaurant, date, time, watch.partySize, guest);

    if (result.ok) {
      store.updateBooking(attempt.id, {
        status: result.paymentUrl ? 'needs_payment' : 'booked',
        reference: result.reference,
        paymentUrl: result.paymentUrl,
        error: null,
      });
      store.updateWatch(watch.id, { status: 'booked' });
      store.closeAllSightings(watch.id, this.now().toISOString());
      await this.sendBookingNotice(attempt.id);
      return 'booked';
    }
    if (result.uncertain) {
      // A booking may exist. Stop this watch so we never book twice; the user checks their email.
      store.updateBooking(attempt.id, { error: result.error });
      store.updateWatch(watch.id, { status: 'paused' });
      await this.sendBookingNotice(attempt.id);
      return 'uncertain';
    }
    store.updateBooking(attempt.id, { status: 'failed', error: result.error });
    return { error: result.error };
  }

  /** Tells the user about a booking. Marks it told only when the push went out, so it is retried. */
  private async sendBookingNotice(bookingId: number): Promise<void> {
    const { store, notifier } = this.o;
    const b = store.listBookings(500).find((x) => x.id === bookingId);
    if (!b || b.notified) return;
    const when = `${slotLabel(b.date, b.time)} · ${b.partySize} people`;
    const email = store.getSettings().guestEmail;
    const notice =
      b.status === 'needs_payment'
        ? {
            title: `Held: ${b.restaurantName}. Pay the deposit to confirm`,
            body: `${when}\nThe table is held until you pay. Tap to pay.`,
            url: b.paymentUrl ?? undefined,
            priority: 'max' as const,
            tags: ['credit_card'],
          }
        : b.status === 'booked'
          ? {
              title: `Booked: ${b.restaurantName}`,
              body: `${when}\nReference ${b.reference}. The confirmation goes to ${email}.`,
              priority: 'high' as const,
              tags: ['white_check_mark'],
            }
          : {
              title: `Check your email: ${b.restaurantName}`,
              body: `${when}\nSeated tried to book this table but got no clear answer. It may be booked. The watch is paused.`,
              priority: 'max' as const,
              tags: ['warning'],
            };
    if (await notifier.send(notice)) store.markBookingNotified(b.id);
  }

  private guest(): Guest | null {
    const s = this.o.store.getSettings();
    if (!s.guestFirstName || !s.guestLastName || !s.guestEmail || !s.guestPhone) return null;
    return { firstName: s.guestFirstName, lastName: s.guestLastName, email: s.guestEmail, phone: s.guestPhone };
  }
}
