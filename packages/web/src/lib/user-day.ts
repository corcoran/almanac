/**
 * Timezone-aware "what calendar date is it for the user?" helpers.
 *
 * The macros / body-weight / sleep range stores all need to compute
 * "today" and "N days ago" as YYYY-MM-DD strings in the user's local
 * timezone, not UTC. These two pure functions back that out using
 * built-in `Intl.DateTimeFormat` — no date-fns or tz library needed.
 */

/**
 * The hour-of-day (in the user's timezone) at which the calendar "day" rolls
 * over. A 2am snack belongs to yesterday; a 5am coffee belongs to today.
 *
 * MUST stay in lockstep with the backend's DAY_START_HOUR
 * (packages/core/src/domain/user-day.ts). If they drift, the frontend's
 * "today" disagrees with the backend's for the gap hours after midnight,
 * which misaligns every date-keyed view (meals, macros, sleep, weight).
 */
export const DAY_START_HOUR = 4;

/**
 * Return the user-day YYYY-MM-DD string for `at` in the given IANA timezone,
 * applying the DAY_START_HOUR rollover so an instant before that hour maps to
 * the previous calendar day. Mirrors the backend's currentUserDate. Uses
 * `en-CA` locale, which renders ISO-style `YYYY-MM-DD` directly.
 */
export function currentUserDate(at: Date, timezone: string): string {
  const shifted = new Date(at.getTime() - DAY_START_HOUR * 3_600_000);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(shifted); // "YYYY-MM-DD"
}

/**
 * Format an instant as a naive-local `YYYY-MM-DDTHH:MM:SS` wall-clock string in
 * the given IANA timezone — no `Z`, no offset. This is the format the backend's
 * `parseLogTimestamp` interprets in the user's timezone (applying DAY_START_HOUR
 * when it buckets), so event timestamps the client stamps client-side
 * (e.g. a workout's `started_at`) land on the user's actual day.
 *
 * Sending `new Date().toISOString()` (UTC with `Z`) instead is the bug this
 * avoids: for a user west of UTC, an evening instant is already "tomorrow" in
 * UTC, and the API trusts the `Z` verbatim — so the event buckets a day ahead.
 *
 * Unlike `currentUserDate`, this does NOT apply the 4am rollover: it returns the
 * true wall-clock time. The rollover is the backend's job at bucket time.
 */
export function nowNaiveLocal(at: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  // en-CA renders "YYYY-MM-DD, HH:MM:SS"; reshape to the naive ISO form.
  // hourCycle quirk: some engines emit "24" for midnight — normalize to "00".
  const parts = fmt.formatToParts(at);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}:${get("second")}`;
}

/**
 * Return the YYYY-MM-DD for N calendar days before `at`, computed in
 * the given timezone. `daysAgo === 0` is the same calendar day as `at`.
 *
 * Caveat: this is a wall-clock subtraction (N * 86_400_000 ms), so on a
 * DST transition day the shifted instant can be off by ~1 hour — but the
 * resulting date component is still correct unless `at` is within ~1 hour
 * of midnight on a DST boundary. For "what calendar date was N days ago
 * in the user's timezone?", this is the standard trick.
 */
export function daysAgoUserDate(at: Date, daysAgo: number, timezone: string): string {
  const shifted = new Date(at.getTime() - daysAgo * 86_400_000);
  return currentUserDate(shifted, timezone);
}

/**
 * Return the YYYY-MM-DD for N calendar days AFTER `at`, computed in the
 * given timezone. Mirror of `daysAgoUserDate` for forward-shifts.
 *
 * Used by the sleep + body-weights range loaders: those repos treat the
 * `to` query param as an EXCLUSIVE upper bound (slept_on/measured_on <
 * to), so to include today's row in the window we pass tomorrow as `to`.
 * Macros use inclusive semantics and don't need this.
 *
 * Same DST caveat as `daysAgoUserDate`.
 */
export function daysAhead(at: Date, days: number, timezone: string): string {
  const shifted = new Date(at.getTime() + days * 86_400_000);
  return currentUserDate(shifted, timezone);
}
