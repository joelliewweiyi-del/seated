// Types mirror the server's JSON. Kept by hand: the API is small.

export interface Restaurant {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
  platform: string;
  custom: boolean;
  supported: boolean;
  canAutoBook: boolean;
  hot: number | null;
  hotWhy: string | null;
}

export interface Sighting {
  id: number;
  watchId: number;
  date: string;
  time: string;
  bookingUrl: string;
  firstSeenAt: string;
  lastSeenAt: string;
  goneAt: string | null;
  notified: number; // 0 = not pushed yet, 1 = loud push, 2 = quiet or no push
}

export interface Watch {
  id: number;
  restaurantId: string;
  partySize: number;
  dateFrom: string | null;
  dateTo: string | null;
  weekdays: number[] | null;
  timeFrom: string;
  timeTo: string;
  autoBook: boolean;
  status: 'watching' | 'paused' | 'booked';
  createdAt: string;
  restaurant: (Restaurant & { lastCheckedAt: string | null; lastError: string | null }) | null;
  openTables: Sighting[];
}

export interface Booking {
  id: number;
  watchId: number | null;
  restaurantName: string;
  date: string;
  time: string;
  partySize: number;
  status: 'booked' | 'needs_payment' | 'uncertain' | 'failed';
  reference: string | null;
  paymentUrl: string | null;
  error: string | null;
  createdAt: string;
  source: 'seated' | 'you';
}

export interface Settings {
  ntfyServer: string;
  ntfyTopic: string;
  guestFirstName: string;
  guestLastName: string;
  guestEmail: string;
  guestPhone: string;
}

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

export interface State {
  radar: {
    running: boolean;
    lastReport: TickReport | null;
    nextCheckAt: string | null;
    pollSeconds: number;
    horizonDays: number;
    autoBookEnabled: boolean;
    demo: boolean;
    today: string;
  };
  watches: Watch[];
  recent: Array<Sighting & { restaurantName: string; partySize: number | null }>;
  bookings: Booking[];
  settings: Settings;
}

export type EventKind = 'listed' | 'opened' | 'reopened' | 'taken' | 'error' | 'recovered' | 'gap';

export interface Board {
  dates: string[];
  rows: Array<{
    id: string;
    name: string;
    platform: string;
    hot: number | null;
    hotWhy: string | null;
    lastError: string | null;
    lastCheckedAt: string | null;
    cells: Array<{ date: string; times: string[]; bookingUrl: string | null; known: boolean }>;
    free: number;
    unknown: number;
    everySeconds: number;
    lastChange: { at: string; kind: EventKind; date: string; time: string } | null;
  }>;
  feed: Array<{
    id: number;
    at: string;
    kind: EventKind;
    restaurantId: string;
    restaurantName: string;
    partySize: number | null;
    date: string | null;
    time: string | null;
    detail: string | null;
  }>;
  lastCheckAt: string | null;
  nextCheckAt: string | null;
  running: boolean;
}

export interface Stats {
  days: number;
  since: string;
  restaurants: Array<{
    id: string;
    name: string;
    platform: string;
    openings: number;
    gone: number;
    medianMinutes: number | null;
    fastestMinutes: number | null;
    everySeconds: number;
    tooSlow: boolean;
  }>;
  loudAlerts: number;
  bookedBySeated: number;
  bookedByYou: number;
}

export type WatchDraft = Pick<
  Watch,
  'restaurantId' | 'partySize' | 'dateFrom' | 'dateTo' | 'weekdays' | 'timeFrom' | 'timeTo' | 'autoBook'
>;

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    // X-Seated proves the request comes from this dashboard, not from another website.
    headers: { 'X-Seated': '1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  state: () => call<State>('GET', '/state'),
  board: () => call<Board>('GET', '/board'),
  stats: (days = 7) => call<Stats>('GET', `/stats?days=${days}`),
  gotIt: (watchId: number, date: string, time: string) => call<Booking>('POST', `/watches/${watchId}/got-it`, { date, time }),
  restaurants: () => call<Restaurant[]>('GET', '/restaurants'),
  addRestaurant: (b: { name: string; link: string; city?: string }) => call<Restaurant>('POST', '/restaurants', b),
  createWatch: (w: WatchDraft) => call<Watch>('POST', '/watches', w),
  updateWatch: (id: number, patch: Partial<WatchDraft> & { status?: 'watching' | 'paused' }) =>
    call<Watch>('PATCH', `/watches/${id}`, patch),
  deleteWatch: (id: number) => call<void>('DELETE', `/watches/${id}`),
  notBooked: (id: number) => call<{ ok: true }>('POST', `/bookings/${id}/not-booked`),
  check: () => call<TickReport>('POST', '/check'),
  saveSettings: (s: Partial<Settings>) => call<Settings>('PUT', '/settings', s),
  testPush: () => call<{ ok: true }>('POST', '/settings/test-push'),
};
