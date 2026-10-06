import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Restaurant } from './platforms/types.js';

export type WatchStatus = 'watching' | 'paused' | 'booked';

export interface Watch {
  id: number;
  restaurantId: string;
  partySize: number;
  dateFrom: string | null; // null = today
  dateTo: string | null; // null = today + horizon
  weekdays: number[] | null; // ISO 1 = Mon ... 7 = Sun; null = any day
  timeFrom: string;
  timeTo: string;
  autoBook: boolean;
  status: WatchStatus;
  createdAt: string;
}

export type WatchInput = Omit<Watch, 'id' | 'status' | 'createdAt'>;

export interface Sighting {
  id: number;
  watchId: number;
  date: string;
  time: string;
  bookingUrl: string;
  firstSeenAt: string;
  lastSeenAt: string;
  goneAt: string | null;
  notified: boolean;
}

// uncertain: the platform did not answer clearly; a booking may exist. Treated as live.
export type BookingStatus = 'booked' | 'needs_payment' | 'uncertain' | 'failed';

export interface Booking {
  id: number;
  watchId: number | null;
  restaurantId: string;
  restaurantName: string;
  date: string;
  time: string;
  partySize: number;
  status: BookingStatus;
  reference: string | null;
  paymentUrl: string | null;
  error: string | null;
  createdAt: string;
  /** The user has been told about this booking. Unsent notices are retried every check. */
  notified: boolean;
}

export interface Settings {
  ntfyServer: string;
  ntfyTopic: string;
  guestFirstName: string;
  guestLastName: string;
  guestEmail: string;
  guestPhone: string;
}

export interface RestaurantRow extends Restaurant {
  custom: boolean;
  lastCheckedAt: string | null;
  lastError: string | null;
}

const DEFAULT_SETTINGS: Settings = {
  ntfyServer: 'https://ntfy.sh',
  ntfyTopic: '',
  guestFirstName: '',
  guestLastName: '',
  guestEmail: '',
  guestPhone: '',
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS restaurants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  platform_uid TEXT,
  website TEXT,
  city TEXT,
  address TEXT,
  custom INTEGER NOT NULL DEFAULT 0,
  last_checked_at TEXT,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS watches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id),
  party_size INTEGER NOT NULL,
  date_from TEXT,
  date_to TEXT,
  weekdays TEXT,
  time_from TEXT NOT NULL,
  time_to TEXT NOT NULL,
  auto_book INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'watching',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sightings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  watch_id INTEGER NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  booking_url TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  gone_at TEXT,
  notified INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS sightings_watch ON sightings(watch_id, date, time);
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  watch_id INTEGER REFERENCES watches(id) ON DELETE SET NULL,
  restaurant_id TEXT NOT NULL,
  restaurant_name TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  party_size INTEGER NOT NULL,
  status TEXT NOT NULL,
  reference TEXT,
  payment_url TEXT,
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

type Row = Record<string, unknown>;

const toRestaurant = (r: Row): RestaurantRow => ({
  id: r.id as string,
  name: r.name as string,
  platform: r.platform as string,
  platformUid: (r.platform_uid as string | null) ?? null,
  website: (r.website as string | null) ?? null,
  city: (r.city as string | null) ?? null,
  address: (r.address as string | null) ?? null,
  hot: (r.hot as number | null) ?? null,
  hotWhy: (r.hot_why as string | null) ?? null,
  custom: r.custom === 1,
  lastCheckedAt: (r.last_checked_at as string | null) ?? null,
  lastError: (r.last_error as string | null) ?? null,
});

const toWatch = (r: Row): Watch => ({
  id: r.id as number,
  restaurantId: r.restaurant_id as string,
  partySize: r.party_size as number,
  dateFrom: (r.date_from as string | null) ?? null,
  dateTo: (r.date_to as string | null) ?? null,
  weekdays: r.weekdays ? (r.weekdays as string).split(',').map(Number) : null,
  timeFrom: r.time_from as string,
  timeTo: r.time_to as string,
  autoBook: r.auto_book === 1,
  status: r.status as WatchStatus,
  createdAt: r.created_at as string,
});

const toSighting = (r: Row): Sighting => ({
  id: r.id as number,
  watchId: r.watch_id as number,
  date: r.date as string,
  time: r.time as string,
  bookingUrl: r.booking_url as string,
  firstSeenAt: r.first_seen_at as string,
  lastSeenAt: r.last_seen_at as string,
  goneAt: (r.gone_at as string | null) ?? null,
  notified: r.notified === 1,
});

const toBooking = (r: Row): Booking => ({
  id: r.id as number,
  watchId: (r.watch_id as number | null) ?? null,
  restaurantId: r.restaurant_id as string,
  restaurantName: r.restaurant_name as string,
  date: r.date as string,
  time: r.time as string,
  partySize: r.party_size as number,
  status: r.status as BookingStatus,
  reference: (r.reference as string | null) ?? null,
  paymentUrl: (r.payment_url as string | null) ?? null,
  error: (r.error as string | null) ?? null,
  notified: r.notified === 1,
  createdAt: r.created_at as string,
});

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
    this.addColumnIfMissing('bookings', 'notified', 'INTEGER NOT NULL DEFAULT 0');
    this.addColumnIfMissing('restaurants', 'hot', 'INTEGER');
    this.addColumnIfMissing('restaurants', 'hot_why', 'TEXT');
  }

  // ── restaurants ──────────────────────────────────────────────────────────

  /** Loads the curated list. Updates curated rows, never touches custom ones. */
  seedRestaurants(list: Restaurant[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO restaurants (id, name, platform, platform_uid, website, city, address, hot, hot_why, custom)
      VALUES (:id, :name, :platform, :platformUid, :website, :city, :address, :hot, :hotWhy, 0)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, platform = excluded.platform, platform_uid = excluded.platform_uid,
        website = excluded.website, city = excluded.city, address = excluded.address,
        hot = excluded.hot, hot_why = excluded.hot_why
      WHERE restaurants.custom = 0`);
    this.db.exec('BEGIN');
    for (const r of list) {
      stmt.run({
        id: r.id,
        name: r.name,
        platform: r.platform,
        platformUid: r.platformUid,
        website: r.website,
        city: r.city,
        address: r.address,
        hot: r.hot ?? null,
        hotWhy: r.hotWhy ?? null,
      });
    }
    this.db.exec('COMMIT');
  }

  addCustomRestaurant(r: Restaurant): RestaurantRow {
    this.db
      .prepare(
        `INSERT INTO restaurants (id, name, platform, platform_uid, website, city, address, custom)
         VALUES (:id, :name, :platform, :platformUid, :website, :city, :address, 1)`,
      )
      .run({ id: r.id, name: r.name, platform: r.platform, platformUid: r.platformUid, website: r.website, city: r.city, address: r.address });
    return this.getRestaurant(r.id)!;
  }

  listRestaurants(): RestaurantRow[] {
    return this.db.prepare('SELECT * FROM restaurants ORDER BY name COLLATE NOCASE').all().map(toRestaurant);
  }

  getRestaurant(id: string): RestaurantRow | undefined {
    const row = this.db.prepare('SELECT * FROM restaurants WHERE id = ?').get(id);
    return row ? toRestaurant(row) : undefined;
  }

  findRestaurantByUid(platform: string, uid: string): RestaurantRow | undefined {
    const row = this.db
      .prepare('SELECT * FROM restaurants WHERE platform = ? AND platform_uid = ?')
      .get(platform, uid);
    return row ? toRestaurant(row) : undefined;
  }

  /** Saves a platform id that changed (Tebi rotates them). */
  updateRestaurantUid(restaurantId: string, uid: string): void {
    this.db.prepare('UPDATE restaurants SET platform_uid = ? WHERE id = ?').run(uid, restaurantId);
  }

  markChecked(restaurantId: string, at: string, error: string | null): void {
    this.db
      .prepare('UPDATE restaurants SET last_checked_at = ?, last_error = ? WHERE id = ?')
      .run(at, error, restaurantId);
  }

  // ── watches ──────────────────────────────────────────────────────────────

  listWatches(status?: WatchStatus): Watch[] {
    const rows = status
      ? this.db.prepare('SELECT * FROM watches WHERE status = ? ORDER BY id').all(status)
      : this.db.prepare('SELECT * FROM watches ORDER BY id').all();
    return rows.map(toWatch);
  }

  getWatch(id: number): Watch | undefined {
    const row = this.db.prepare('SELECT * FROM watches WHERE id = ?').get(id);
    return row ? toWatch(row) : undefined;
  }

  createWatch(input: WatchInput, now: string): Watch {
    const result = this.db
      .prepare(
        `INSERT INTO watches (restaurant_id, party_size, date_from, date_to, weekdays, time_from, time_to, auto_book, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'watching', ?)`,
      )
      .run(
        input.restaurantId,
        input.partySize,
        input.dateFrom,
        input.dateTo,
        input.weekdays ? input.weekdays.join(',') : null,
        input.timeFrom,
        input.timeTo,
        input.autoBook ? 1 : 0,
        now,
      );
    return this.getWatch(Number(result.lastInsertRowid))!;
  }

  updateWatch(id: number, patch: Partial<WatchInput & { status: WatchStatus }>): Watch | undefined {
    const current = this.getWatch(id);
    if (!current) return undefined;
    const next = { ...current, ...patch };
    this.db
      .prepare(
        `UPDATE watches SET party_size = ?, date_from = ?, date_to = ?, weekdays = ?, time_from = ?, time_to = ?,
         auto_book = ?, status = ? WHERE id = ?`,
      )
      .run(
        next.partySize,
        next.dateFrom,
        next.dateTo,
        next.weekdays ? next.weekdays.join(',') : null,
        next.timeFrom,
        next.timeTo,
        next.autoBook ? 1 : 0,
        next.status,
        id,
      );
    return this.getWatch(id);
  }

  deleteWatch(id: number): boolean {
    return Number(this.db.prepare('DELETE FROM watches WHERE id = ?').run(id).changes) > 0;
  }

  // ── sightings ────────────────────────────────────────────────────────────

  openSightings(watchId: number): Sighting[] {
    return this.db
      .prepare('SELECT * FROM sightings WHERE watch_id = ? AND gone_at IS NULL ORDER BY date, time')
      .all(watchId)
      .map(toSighting);
  }

  /** The most recent sighting of one slot for one watch, open or gone. */
  lastSighting(watchId: number, date: string, time: string): Sighting | undefined {
    const row = this.db
      .prepare('SELECT * FROM sightings WHERE watch_id = ? AND date = ? AND time = ? ORDER BY id DESC LIMIT 1')
      .get(watchId, date, time);
    return row ? toSighting(row) : undefined;
  }

  addSighting(watchId: number, date: string, time: string, bookingUrl: string, now: string): Sighting {
    const result = this.db
      .prepare(
        `INSERT INTO sightings (watch_id, date, time, booking_url, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(watchId, date, time, bookingUrl, now, now);
    return toSighting(this.db.prepare('SELECT * FROM sightings WHERE id = ?').get(result.lastInsertRowid)!);
  }

  touchSighting(id: number, now: string): void {
    this.db.prepare('UPDATE sightings SET last_seen_at = ? WHERE id = ?').run(now, id);
  }

  closeSighting(id: number, now: string): void {
    this.db.prepare('UPDATE sightings SET gone_at = ? WHERE id = ? AND gone_at IS NULL').run(now, id);
  }

  closeAllSightings(watchId: number, now: string): void {
    this.db.prepare('UPDATE sightings SET gone_at = ? WHERE watch_id = ? AND gone_at IS NULL').run(now, watchId);
  }

  markNotified(ids: number[]): void {
    const stmt = this.db.prepare('UPDATE sightings SET notified = 1 WHERE id = ?');
    for (const id of ids) stmt.run(id);
  }

  recentSightings(limit: number): Sighting[] {
    return this.db.prepare('SELECT * FROM sightings ORDER BY id DESC LIMIT ?').all(limit).map(toSighting);
  }

  // ── bookings ─────────────────────────────────────────────────────────────

  /** Idempotent schema change for databases made by an older version. */
  private addColumnIfMissing(table: string, column: string, type: string): void {
    const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }

  addBooking(b: Omit<Booking, 'id' | 'notified'>): Booking {
    const result = this.db
      .prepare(
        `INSERT INTO bookings (watch_id, restaurant_id, restaurant_name, date, time, party_size, status, reference, payment_url, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        b.watchId,
        b.restaurantId,
        b.restaurantName,
        b.date,
        b.time,
        b.partySize,
        b.status,
        b.reference,
        b.paymentUrl,
        b.error,
        b.createdAt,
      );
    return toBooking(this.db.prepare('SELECT * FROM bookings WHERE id = ?').get(result.lastInsertRowid)!);
  }

  updateBooking(id: number, patch: Partial<Pick<Booking, 'status' | 'reference' | 'paymentUrl' | 'error'>>): Booking | undefined {
    const current = this.db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
    if (!current) return undefined;
    const next = { ...toBooking(current), ...patch };
    this.db
      .prepare('UPDATE bookings SET status = ?, reference = ?, payment_url = ?, error = ? WHERE id = ?')
      .run(next.status, next.reference, next.paymentUrl, next.error, id);
    return toBooking(this.db.prepare('SELECT * FROM bookings WHERE id = ?').get(id)!);
  }

  markBookingNotified(id: number): void {
    this.db.prepare('UPDATE bookings SET notified = 1 WHERE id = ?').run(id);
  }

  /** Bookings the user still has to hear about. */
  unnotifiedBookings(): Booking[] {
    return this.db
      .prepare(`SELECT * FROM bookings WHERE notified = 0 AND status IN ('booked', 'needs_payment', 'uncertain') ORDER BY id`)
      .all()
      .map(toBooking);
  }

  listBookings(limit = 50): Booking[] {
    return this.db.prepare('SELECT * FROM bookings ORDER BY id DESC LIMIT ?').all(limit).map(toBooking);
  }

  /** True if Seated already tried to book this slot for this watch, whatever the outcome. Never try twice. */
  bookingAttempted(watchId: number, date: string, time: string): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM bookings WHERE watch_id = ? AND date = ? AND time = ? LIMIT 1')
      .get(watchId, date, time);
    return row !== undefined;
  }

  /** Marks an unclear booking as "not booked" once the user has checked. Only works on 'uncertain'. */
  resolveUncertainBooking(id: number): boolean {
    const result = this.db
      .prepare(`UPDATE bookings SET status = 'failed' WHERE id = ? AND status = 'uncertain'`)
      .run(id);
    return Number(result.changes) > 0;
  }

  /** True if this watch already holds a table today or later. Guards against double booking. */
  hasLiveBooking(watchId: number, today: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 FROM bookings WHERE watch_id = ? AND status IN ('booked', 'needs_payment', 'uncertain') AND date >= ? LIMIT 1`,
      )
      .get(watchId, today);
    return row !== undefined;
  }

  // ── settings ─────────────────────────────────────────────────────────────

  getSettings(): Settings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>;
    const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return { ...DEFAULT_SETTINGS, ...stored } as Settings;
  }

  saveSettings(patch: Partial<Settings>): Settings {
    const stmt = this.db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    );
    for (const [key, value] of Object.entries(patch)) {
      if (key in DEFAULT_SETTINGS && typeof value === 'string') stmt.run(key, value.trim());
    }
    return this.getSettings();
  }
}
