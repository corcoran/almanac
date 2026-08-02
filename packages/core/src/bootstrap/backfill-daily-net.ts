import type { Connection } from "../db/connection.js";
import { currentUserDate } from "../domain/user-day.js";
import { computeDayNet } from "../signals/compute-day-net.js";

/**
 * One-time backfill: for every user, enumerate all distinct user-local days
 * that have at least one meal or alcohol session, then upsert the daily_net
 * snapshot for each. Days with no intake are left untouched (gap days stay
 * absent). Fully idempotent — safe to run multiple times.
 */
export function backfillDailyNet(db: Connection): { users: number; days: number } {
  const users = db.prepare("SELECT id, timezone FROM users").all() as Array<{
    id: number;
    timezone: string;
  }>;

  let dayCount = 0;
  let usersWithData = 0;

  for (const user of users) {
    const days = new Set<string>();

    const meals = db.prepare("SELECT eaten_at FROM meals WHERE user_id = ?").all(user.id) as Array<{
      eaten_at: string;
    }>;
    for (const m of meals) {
      days.add(currentUserDate(new Date(m.eaten_at), user.timezone));
    }

    const alcohol = db
      .prepare("SELECT started_at FROM alcohol_sessions WHERE user_id = ?")
      .all(user.id) as Array<{ started_at: string }>;
    for (const a of alcohol) {
      days.add(currentUserDate(new Date(a.started_at), user.timezone));
    }

    if (days.size > 0) usersWithData++;
    for (const day of days) {
      computeDayNet(db, user.id, day, user.timezone);
      dayCount++;
    }
  }

  return { users: usersWithData, days: dayCount };
}
