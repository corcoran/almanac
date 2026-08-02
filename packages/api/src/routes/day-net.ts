import type { Connection } from "@almanac/core/db";
import { computeDayNet } from "@almanac/core/signals";
import { currentUserDate } from "@almanac/core/types";

/**
 * Recompute the snapshotted NET for every user-local day an intake event
 * touched. Pass the event's anchor timestamp(s):
 *
 *   - POST   → the created event's timestamp (one day).
 *   - PATCH  → the old and new timestamps (recomputes both; dedup'd when the
 *              edit kept the event on the same user-day).
 *   - DELETE → the removed event's timestamp (one day).
 *
 * Buckets each ISO timestamp to its user-local day via `currentUserDate`
 * (honoring DAY_START_HOUR + DST — never a UTC `slice`), then calls
 * `computeDayNet` once per distinct day. Shared by the meals and alcohol
 * routes, the only two intake write-paths that feed NET.
 */
export function recomputeNetForEvent(
  db: Connection,
  userId: number,
  tz: string,
  ...timestamps: string[]
): void {
  const days = new Set(timestamps.map((ts) => currentUserDate(new Date(ts), tz)));
  for (const day of days) computeDayNet(db, userId, day, tz);
}
