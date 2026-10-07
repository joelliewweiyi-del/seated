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
  notified: boolean;
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

export type EventKind = 'listed' | 'opened' | 'reopened' | 'taken' | 'error' | 'recovered';

export interface Activity {
  events: Array<{
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
  checks: Array<Pick<TickReport, 'startedAt' | 'finishedAt' | 'restaurants' | 'requests' | 'failedRequests' | 'newTables' | 'tablesTaken'> & { id: number }>;
  restaurants: Array<{ id: string; name: string; platform: string; lastCheckedAt: string | null; lastError: string | null; openNow: number }>;
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
  activity: () => call<Activity>('GET', '/activity'),
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
