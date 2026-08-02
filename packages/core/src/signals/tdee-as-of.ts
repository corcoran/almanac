import type { Connection } from "../db/connection.js";
import { addDaysIso, currentUserDate } from "../domain/user-day.js";
import { getUntrackedDays } from "../repos/untracked-periods.repo.js";
import { findUserById } from "../repos/users.repo.js";
import { computeTDEE, type TDEE } from "./tdee.js";

/**
 * Faithful past-date TDEE: every input array is UPPER-bounded to `<= asOf`, so a
 * weigh-in or meal logged after the snapshot date can never leak into a
 * historical TDEE. `computeTDEE` itself only lower-bounds its trailing window —
 * it trusts the caller to pre-filter the future out. That's the bug this exists
 * to close: NET(day D) = intake(D) − computeTdeeAsOf(asOf = D−1) must be
 * reproducible regardless of what gets logged later.
 *
 * The lower bound is a generous 60-day reach (the longest window computeTDEE
 * can consume, plus slack for the trend-weight ramp). Meals/alcohol are bucketed
 * to user-local days via `currentUserDate` so an evening event for a non-UTC
 * user lands on the day it belongs to, matching the window loop in computeTDEE.
 */
export function computeTdeeAsOf(db: Connection, userId: number, asOf: string, tz: string): TDEE {
  const user = findUserById(db, userId);
  if (!user) throw new Error(`computeTdeeAsOf: user ${userId} not found`);

  const lowerBound = addDaysIso(asOf, -60);

  // body_weights.measured_on is stored user-local (YYYY-MM-DD), so a direct
  // string compare is the correct bound — no UTC bucketing needed.
  const bodyWeights = db
    .prepare(
      `SELECT measured_on, weight_kg FROM body_weights
       WHERE user_id = ? AND measured_on >= ? AND measured_on <= ?
       ORDER BY measured_on`,
    )
    .all(userId, lowerBound, asOf) as Array<{ measured_on: string; weight_kg: number }>;

  // Meals/alcohol store UTC timestamps. Fetch with a ±1-day UTC margin so no
  // edge event is dropped by SQL's UTC truncation, then bucket each row to its
  // user-local day and keep only those within (lowerBound, asOf]. This makes the
  // asOf upper edge EXACT — a 9pm-local meal on asOf stays in, a 9pm-local meal
  // the day after asOf stays out.
  const rawMeals = db
    .prepare(
      `SELECT eaten_at, kcal FROM meals
       WHERE user_id = ? AND date(eaten_at) >= ? AND date(eaten_at) <= ?`,
    )
    .all(userId, addDaysIso(lowerBound, -1), addDaysIso(asOf, 1)) as Array<{
    eaten_at: string;
    kcal: number;
  }>;
  const meals = rawMeals.filter((m) => {
    const day = currentUserDate(new Date(m.eaten_at), tz);
    return day > lowerBound && day <= asOf;
  });

  const rawAlcohol = db
    .prepare(
      `SELECT started_at, est_kcal FROM alcohol_sessions
       WHERE user_id = ? AND date(started_at) >= ? AND date(started_at) <= ?`,
    )
    .all(userId, addDaysIso(lowerBound, -1), addDaysIso(asOf, 1)) as Array<{
    started_at: string;
    est_kcal: number;
  }>;
  const alcoholSessions = rawAlcohol.filter((a) => {
    const day = currentUserDate(new Date(a.started_at), tz);
    return day > lowerBound && day <= asOf;
  });

  const untrackedDays = getUntrackedDays(db, userId, lowerBound, asOf);

  return computeTDEE({
    asOf,
    tz,
    bodyWeights,
    meals,
    alcoholSessions,
    user: {
      dob: user.dob,
      height_cm: user.height_cm,
      sex: user.sex,
      latestWeightKg: bodyWeights[bodyWeights.length - 1]?.weight_kg ?? null,
      activity_level: user.activity_level,
    },
    untrackedDays,
  });
}
