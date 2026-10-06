import type { Watch } from './db.js';
import type { Slot } from './platforms/types.js';
import { addDays, isoWeekday, toMinutes } from './time.js';

/** Hard cap on dates per watch per check, so one wide watch cannot flood a platform. */
export const MAX_DATES_PER_WATCH = 31;

/** The local dates one watch wants checked, earliest first. */
export function datesForWatch(watch: Watch, today: string, horizonDays: number): string[] {
  const from = watch.dateFrom && watch.dateFrom > today ? watch.dateFrom : today;
  const to = watch.dateTo ?? addDays(today, horizonDays - 1);
  const dates: string[] = [];
  for (let d = from; d <= to && dates.length < MAX_DATES_PER_WATCH; d = addDays(d, 1)) {
    if (!watch.weekdays || watch.weekdays.includes(isoWeekday(d))) dates.push(d);
  }
  return dates;
}

/** Open slots inside the watch's time window (both ends included), earliest first. */
export function matchingSlots(watch: Pick<Watch, 'timeFrom' | 'timeTo'>, slots: Slot[]): Slot[] {
  const from = toMinutes(watch.timeFrom);
  const to = toMinutes(watch.timeTo);
  return slots
    .filter((s) => s.open && toMinutes(s.time) >= from && toMinutes(s.time) <= to)
    .sort((a, b) => toMinutes(a.time) - toMinutes(b.time));
}
