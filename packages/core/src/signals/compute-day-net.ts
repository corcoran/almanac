import type { Connection } from "../db/connection.js";
import { addDaysIso, userDayWindow } from "../domain/user-day.js";
import { deleteDailyNet, upsertDailyNet } from "../repos/daily-net.repo.js";
import { computeTdeeAsOf } from "./tdee-as-of.js";

type TdeeFn = (
  db: Connection,
  userId: number,
  asOf: string,
  tz: string,
) => { kcal: number; basis: "profile_baseline" | "measured_intake" };

/**
 * Recompute and persist the NET snapshot for a single user-local day:
 * NET(day) = intake(day, user-local) − computeTdeeAsOf(asOf = day−1).
 *
 * Every meal/alcohol write path calls this after mutating a day's intake. The
 * intake sum is user-local (via `userDayWindow`), matching `computeForDate`. If
 * the day has zero intake — e.g. the user deleted their last meal — the row is
 * DELETED rather than written as a meaningless net, so a never-tracked day and a
 * fully-deleted day look identical (no row).
 *
 * `tdeeFn` is injectable for tests; production callers use the default.
 */
export function computeDayNet(
  db: Connection,
  userId: number,
  day: string,
  tz: string,
  tdeeFn: TdeeFn = computeTdeeAsOf,
): void {
  const { startUtc, endUtc } = userDayWindow(day, tz);
  const startIso = startUtc.toISOString();
  const endIso = endUtc.toISOString();

  const food = db
    .prepare(
      `SELECT COALESCE(SUM(kcal), 0) AS s FROM meals
       WHERE user_id = ? AND eaten_at >= ? AND eaten_at < ?`,
    )
    .get(userId, startIso, endIso) as { s: number };
  const booze = db
    .prepare(
      `SELECT COALESCE(SUM(est_kcal), 0) AS s FROM alcohol_sessions
       WHERE user_id = ? AND started_at >= ? AND started_at < ?`,
    )
    .get(userId, startIso, endIso) as { s: number };
  const intake = Math.round(food.s + booze.s);

  if (intake === 0) {
    deleteDailyNet(db, userId, day);
    return;
  }

  const tdee = tdeeFn(db, userId, addDaysIso(day, -1), tz);
  upsertDailyNet(db, {
    user_id: userId,
    on_date: day,
    net_kcal: intake - tdee.kcal,
    intake_kcal: intake,
    tdee_used: tdee.kcal,
    tdee_basis: tdee.basis,
  });
}
