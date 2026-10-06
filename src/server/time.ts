// All dates in Seated are restaurant-local strings: "YYYY-MM-DD" and "HH:mm".
// Every restaurant we support is in the Netherlands, so local means Europe/Amsterdam.
// Never derive a calendar date with toISOString(): that gives the UTC date, which is
// a day early for slots after midnight local time (the v1 booking bug).

export const TIME_ZONE = 'Europe/Amsterdam';

const dateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Local calendar date of an instant, e.g. 2026-10-06T22:30Z -> "2026-10-07". */
export function localDate(instant: Date): string {
  return dateFmt.format(instant);
}

/** Local wall-clock time of an instant, "HH:mm". */
export function localTime(instant: Date): string {
  return timeFmt.format(instant);
}

/** Adds whole days to a "YYYY-MM-DD" string. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** ISO weekday of a "YYYY-MM-DD" string: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

/** "HH:mm" -> minutes since midnight. */
export function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-09", "19:30" -> "Fri 9 Oct 19:30". */
export function slotLabel(date: string, time?: string): string {
  const [, m, d] = date.split('-').map(Number) as [number, number, number];
  const label = `${WEEKDAYS[isoWeekday(date) - 1]} ${d} ${MONTHS[m - 1]}`;
  return time ? `${label} ${time}` : label;
}
