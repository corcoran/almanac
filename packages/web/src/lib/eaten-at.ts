import { addDaysIso } from "@almanac/core/types";
import { DAY_START_HOUR } from "./user-day.js";

/**
 * Compose a naive-local `eaten_at` (no Z) from an `HH:MM` time and the viewed
 * day's `YYYY-MM-DD`, honoring the 4am day-start rollover.
 *
 * A time before DAY_START_HOUR (4am) belongs to the NEXT calendar morning of the
 * viewed day's 4am→4am window, so it composes onto `viewedDate + 1` — otherwise
 * the write path's 4am-rollover re-buckets it back onto the previous day. Times
 * ≥4am compose on `viewedDate` as-is. A blank/malformed time guards to noon so
 * the resulting string is always well-formed (never `${date}T:00`).
 */
export function composeEatenAt(time: string, viewedDate: string): string {
  const hhmm = /^\d{2}:\d{2}$/.test(time) ? time : "12:00";
  const hour = Number(hhmm.slice(0, 2));
  const calendarDate = hour < DAY_START_HOUR ? addDaysIso(viewedDate, 1) : viewedDate;
  return `${calendarDate}T${hhmm}:00`;
}
