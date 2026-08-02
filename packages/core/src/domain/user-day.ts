/**
 * The hour-of-day (in the user's profile timezone) at which the calendar "day"
 * rolls over. A 2am snack belongs to yesterday; a 5am coffee belongs to today.
 * Not user-configurable for now — promote to a column if a real need surfaces.
 */
export const DAY_START_HOUR = 4;

/**
 * Compute the UTC instants bracketing a user-local "day" for `date` in `tz`.
 * The window runs from `date @ DAY_START_HOUR tz` to `(date + 1) @ DAY_START_HOUR tz`,
 * both in UTC. A 02:00 local-time event on the next calendar day still falls inside.
 */
export function userDayWindow(date: string, tz: string): { startUtc: Date; endUtc: Date } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m)
    throw new Error(`userDayWindow: invalid date ${JSON.stringify(date)} — expected YYYY-MM-DD`);
  validateDateParts(Number(m[1]), Number(m[2]), Number(m[3]), date);
  const startUtc = wallTimeToUtc(date, DAY_START_HOUR, 0, tz);
  const endUtc = wallTimeToUtc(addDaysIso(date, 1), DAY_START_HOUR, 0, tz);
  return { startUtc, endUtc };
}

/**
 * Parse an MCP-input timestamp into UTC. Accepts:
 *   - ISO 8601 with offset (`...-04:00` or `...Z`) — used as-is.
 *   - Naked datetime (`YYYY-MM-DDTHH:MM[:SS]`) — interpreted in `tz`.
 *   - Date-only (`YYYY-MM-DD`) — interpreted as `00:00:00` in `tz`.
 *
 * Throws a clear error on malformed input or out-of-range components rather than
 * silently rolling forward (e.g. `2026-13-45` → `2027-02-14`) the way `Date.UTC`
 * does. This keeps MCP-fed data correct and gives callers actionable feedback.
 */
export function parseLogTimestamp(input: string, tz: string): Date {
  // ISO with explicit offset or Z — let Date parse it.
  if (/Z$|[+-]\d{2}:\d{2}$/.test(input)) {
    const d = new Date(input);
    if (Number.isNaN(d.getTime())) {
      throw new Error(`parseLogTimestamp: invalid ISO-with-offset input ${JSON.stringify(input)}`);
    }
    return d;
  }
  // Date-only: YYYY-MM-DD
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (dateOnlyMatch) {
    const [, y, m, d] = dateOnlyMatch;
    validateDateParts(Number(y), Number(m), Number(d), input);
    return wallTimeToUtc(input, 0, 0, tz, 0);
  }
  // Naked datetime: YYYY-MM-DDTHH:MM[:SS]
  const dtMatch = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(input);
  if (dtMatch) {
    const [, y, m, d, hh, mm, ss] = dtMatch;
    validateDateParts(Number(y), Number(m), Number(d), input);
    const secNum = ss ? Number(ss) : 0;
    validateTimeParts(Number(hh), Number(mm), secNum, input);
    return wallTimeToUtc(`${y}-${m}-${d}`, Number(hh), Number(mm), tz, secNum);
  }
  throw new Error(
    `parseLogTimestamp: cannot parse ${JSON.stringify(input)} — expected YYYY-MM-DD or YYYY-MM-DDTHH:MM[:SS] (optionally with Z or ±HH:MM offset)`,
  );
}

function validateDateParts(y: number, m: number, d: number, input: string): void {
  if (m < 1 || m > 12)
    throw new Error(`parseLogTimestamp: month out of range in ${JSON.stringify(input)}`);
  if (d < 1 || d > 31)
    throw new Error(`parseLogTimestamp: day out of range in ${JSON.stringify(input)}`);
  // Catch month-specific overflow (e.g. Feb 30).
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    throw new Error(`parseLogTimestamp: invalid calendar date in ${JSON.stringify(input)}`);
  }
}

function validateTimeParts(hh: number, mm: number, ss: number, input: string): void {
  if (hh < 0 || hh > 23)
    throw new Error(`parseLogTimestamp: hour out of range in ${JSON.stringify(input)}`);
  if (mm < 0 || mm > 59)
    throw new Error(`parseLogTimestamp: minute out of range in ${JSON.stringify(input)}`);
  if (ss < 0 || ss > 59)
    throw new Error(`parseLogTimestamp: second out of range in ${JSON.stringify(input)}`);
}

/**
 * Returns the user-day calendar date (YYYY-MM-DD in `tz`) that `at` belongs to,
 * applying the DAY_START_HOUR rollover. A UTC instant before 4am local maps to
 * the previous calendar day.
 */
export function currentUserDate(at: Date, tz: string): string {
  // Shift the instant backward by DAY_START_HOUR hours, then format in tz.
  const shifted = new Date(at.getTime() - DAY_START_HOUR * 3_600_000);
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return dtf.format(shifted); // en-CA → "YYYY-MM-DD"
}

function wallTimeToUtc(date: string, hour: number, minute: number, tz: string, second = 0): Date {
  // Strategy: build a naive UTC instant from the wall components, then ask Intl
  // what wall-time *that UTC instant* renders to in `tz`. The difference is the
  // actual offset (handles DST + arbitrary zones via the runtime's tz database).
  // `date` is a YYYY-MM-DD string by contract; parse the parts explicitly so
  // they are `number` by construction (no destructure → no non-null assertion).
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  const naive = Date.UTC(y, m - 1, d, hour, minute, second);
  const offsetMs = tzOffsetMs(new Date(naive), tz);
  return new Date(naive - offsetMs);
}

function tzOffsetMs(at: Date, tz: string): number {
  // Returns offsetMs such that localWallTime = utcInstant + offsetMs.
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(at).map((p) => [p.type, p.value]));
  // en-US can return "24" for midnight under hour12:false — modulo guards that.
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - at.getTime();
}

export function addDaysIso(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
