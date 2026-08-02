import { parseLogTimestamp, userDayWindow } from "@almanac/core/types";
import { z } from "zod";

/** Path-param schema for any `/:id` route. Coerces string → integer. */
export const IdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/**
 * Collapse a TimestampRangeQuery into the `{from, to}` UTC-ISO shape the repos
 * already understand. If `from_date`/`to_date` (YYYY-MM-DD) are present they win
 * and are resolved against the user's profile timezone:
 *   - `from_date` → user-day's start UTC (inclusive lower bound)
 *   - `to_date`   → next user-day's start UTC (exclusive upper bound)
 * So `from_date=X&to_date=X` selects a single user-day. Falls back to raw
 * `from`/`to` ISO timestamps when no date-only fields are supplied.
 */
export function resolveDateRange(
  query: { from?: string; to?: string; from_date?: string; to_date?: string },
  user: { timezone: string },
): { from?: string; to?: string } {
  if (query.from_date !== undefined || query.to_date !== undefined) {
    const fromIso = query.from_date
      ? userDayWindow(query.from_date, user.timezone).startUtc.toISOString()
      : undefined;
    const toIso = query.to_date
      ? userDayWindow(query.to_date, user.timezone).endUtc.toISOString()
      : undefined;
    return { from: fromIso, to: toIso };
  }
  return { from: query.from, to: query.to };
}

/**
 * Normalize a log-route body's timestamp field to a UTC ISO string in `tz`:
 *   - ISO with offset (`...-04:00`) or `Z` → used as the explicit instant.
 *   - Naked datetime (`YYYY-MM-DDTHH:MM[:SS]`) → interpreted in `tz`.
 *   - Date-only (`YYYY-MM-DD`) → 00:00:00 in `tz`.
 * Returns a new object with `[field]` replaced; never mutates the input.
 */
export function normalizeTimestamp<B extends Record<string, unknown>, K extends keyof B & string>(
  body: B,
  field: K,
  tz: string,
): B {
  const raw = body[field];
  if (typeof raw !== "string") return body;
  return { ...body, [field]: parseLogTimestamp(raw, tz).toISOString() };
}
