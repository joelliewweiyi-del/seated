// Prime time: dinner for two on Fridays and Saturdays, when the hardest tables are hardest to get.
// Shared by the server (live board) and the dashboard (one-tap watch), so both mean the same thing.

export const PRIME = {
  partySize: 2,
  weekdays: [5, 6],
  timeFrom: '18:30',
  timeTo: '21:30',
  dateFrom: null,
  dateTo: null,
  autoBook: false,
};

interface WatchLike {
  status: string;
  partySize: number;
  weekdays: number[] | null;
  timeFrom: string;
  timeTo: string;
  dateFrom: string | null;
  dateTo: string | null;
}

/** True if this watch already covers everything the one-tap prime watch would. */
export function coversPrime(w: WatchLike): boolean {
  const days = w.weekdays ?? [1, 2, 3, 4, 5, 6, 7];
  return (
    w.status === 'watching' &&
    w.dateFrom === null && // the prime watch is open-ended, so only an open-ended watch covers it
    w.dateTo === null &&
    w.partySize === PRIME.partySize &&
    PRIME.weekdays.every((d) => days.includes(d)) &&
    w.timeFrom <= PRIME.timeFrom &&
    w.timeTo >= PRIME.timeTo
  );
}

/** ISO weekday of a "YYYY-MM-DD" date, 1 = Monday. */
const weekday = (date: string) => ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;

export const isPrimeDay = (date: string) => PRIME.weekdays.includes(weekday(date));

export const isPrime = (date: string, time: string) => isPrimeDay(date) && time >= PRIME.timeFrom && time <= PRIME.timeTo;
