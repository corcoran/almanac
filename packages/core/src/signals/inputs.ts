import type { Connection } from "../db/connection.js";
import type { NutritionPhase, PhaseType, TdeeSource } from "../domain/nutrition.js";
import { addDaysIso, currentUserDate, userDayWindow } from "../domain/user-day.js";
import { findActivePhase } from "../repos/nutrition-phases.repo.js";
import { findStepLogByDate } from "../repos/step-logs.repo.js";
import { getUntrackedDays } from "../repos/untracked-periods.repo.js";
import { findUserById } from "../repos/users.repo.js";
import { WORKOUT_KCAL_PER_MIN } from "./avg-activity.js";
import { computeDailyTarget, type DailyTargetOutput } from "./daily-target.js";
import { computeTDEE, type TDEE } from "./tdee.js";

/**
 * Shared db→signal input assembly. These helpers are the single source of truth
 * for *how* a computed signal's inputs are gathered from the database, so the
 * dashboard routes (`/v1/signals/tdee`, `/v1/signals/macros`) and the
 * accomplishment detectors compute against an identical definition. Lifting the
 * assembly here makes the "identical to the dashboard" guarantee structural
 * rather than comment-enforced — if the accounting changes (food/alcohol split,
 * the 6×duration workout-kcal fallback, snapshotted-steps source, TDEE window),
 * it changes in one place and every caller moves together.
 */

/**
 * Assemble the TDEE input from the db and run `computeTDEE`: 60d of weigh-ins,
 * 30d of meals/alcohol, untracked-day exclusion. The window ends on the last
 * COMPLETED day (`asOf = today − 1`) so a half-logged in-progress day doesn't
 * perturb the live displayed number. The `date(col) >= ? AND <= ?` bounds are
 * coarse multi-week range edges — CLAUDE.md permits the UTC slop there (only
 * per-day attribution must be user-local; the window loop sums only dates it
 * iterates, all `<= asOf`).
 *
 * Callers: the `/v1/signals/tdee` route and the `tdee_measured` detector.
 */
export function computeTdeeForUser(db: Connection, userId: number, now: Date): TDEE {
  const user = findUserById(db, userId);
  if (!user) throw new Error(`user ${userId} not found`);
  const today = currentUserDate(now, user.timezone);
  // The live displayed TDEE excludes the in-progress day: a half-logged "today"
  // would otherwise pull the intake average (and the weight-window endpoints)
  // off the user's real trajectory. End the back-calc window on the last
  // COMPLETED day. (The NET path uses computeTdeeAsOf(D−1), already a completed
  // day, and is unaffected.)
  const asOf = addDaysIso(today, -1);
  const bodyWeights = db
    .prepare(
      `SELECT measured_on, weight_kg FROM body_weights
       WHERE user_id = ? AND measured_on >= ? AND measured_on <= ? ORDER BY measured_on`,
    )
    .all(userId, addDaysIso(asOf, -60), asOf) as Array<{
    measured_on: string;
    weight_kg: number;
  }>;
  const meals = db
    .prepare(
      `SELECT eaten_at, kcal FROM meals WHERE user_id = ? AND date(eaten_at) >= ? AND date(eaten_at) <= ?`,
    )
    .all(userId, addDaysIso(asOf, -30), asOf) as Array<{ eaten_at: string; kcal: number }>;
  const alcoholSessions = db
    .prepare(
      `SELECT started_at, est_kcal FROM alcohol_sessions WHERE user_id = ? AND date(started_at) >= ? AND date(started_at) <= ?`,
    )
    .all(userId, addDaysIso(asOf, -30), asOf) as Array<{ started_at: string; est_kcal: number }>;
  return computeTDEE({
    asOf,
    tz: user.timezone,
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
    untrackedDays: getUntrackedDays(db, userId, addDaysIso(asOf, -60), asOf),
  });
}

/** An active phase with the four nullable TDEE-refactor fields proven non-null. */
export type ReadyPhase = NutritionPhase & {
  phase_type: PhaseType;
  tdee_at_phase_start: number;
  tdee_source: TdeeSource;
  deficit_kcal: number;
};

/**
 * A user-day's intake totals, with the food/alcohol split surfaced separately
 * (the two `kcal_from_*` fields sum to `kcal`). Matches the macros route's
 * `day_totals` shape exactly so it can be returned verbatim.
 */
export type DayTotals = {
  kcal: number;
  protein_g: number;
  carb_g: number;
  fat_g: number;
  kcal_from_food: number;
  kcal_from_alcohol: number;
};

/**
 * Result of assembling a single user-day's daily-target inputs. `totals` and
 * `mealCount` are present in EVERY branch (they don't depend on a phase) so a
 * caller can render intake even with no active phase. The phase fork is exposed
 * rather than resolved so each caller decides how to handle a missing or
 * incomplete phase:
 *   - `no_phase`        — user has no active phase.
 *   - `phase_incomplete`— active phase is missing the TDEE-refactor fields
 *                         (a data-integrity issue). The macros route throws 500;
 *                         the adherence detector treats it as "not a streak day".
 *   - `ready`           — `dayTarget` is the computed daily-target block; apply
 *                         the "no intake → not a streak day" rule via `mealCount`.
 */
export type DailyTargetForDate =
  | { kind: "no_phase"; totals: DayTotals; mealCount: number }
  | { kind: "phase_incomplete"; phaseId: number; totals: DayTotals; mealCount: number }
  | {
      kind: "ready";
      phase: ReadyPhase;
      dayTarget: DailyTargetOutput;
      totals: DayTotals;
      mealCount: number;
    };

/**
 * Assemble and compute a single user-day's daily target, reusing the exact
 * accounting the macros route (`computeForDate`) performs: user-day-windowed
 * meals/alcohol/workouts/cardio + snapshotted steps, with the 6×duration
 * workout-kcal fallback, fed to `computeDailyTarget`.
 *
 * Returns a discriminated union (see `DailyTargetForDate`) so the throw-vs-null
 * fork on an incomplete phase stays at the call site.
 */
export function computeDailyTargetForDate(
  db: Connection,
  userId: number,
  tz: string,
  date: string,
): DailyTargetForDate {
  const { startUtc, endUtc } = userDayWindow(date, tz);
  const startIso = startUtc.toISOString();
  const endIso = endUtc.toISOString();

  const meals = db
    .prepare(
      `SELECT kcal, protein_g, carb_g, fat_g FROM meals
       WHERE user_id = ? AND eaten_at >= ? AND eaten_at < ?`,
    )
    .all(userId, startIso, endIso) as Array<{
    kcal: number;
    protein_g: number;
    carb_g: number;
    fat_g: number;
  }>;
  const alcohol = db
    .prepare(
      `SELECT est_kcal FROM alcohol_sessions
       WHERE user_id = ? AND started_at >= ? AND started_at < ?`,
    )
    .all(userId, startIso, endIso) as Array<{ est_kcal: number }>;

  // Split food and alcohol so consumers see them separately; the two
  // `kcal_from_*` fields sum to `kcal` exactly.
  const kcal_from_food = meals.reduce((s, m) => s + m.kcal, 0);
  const kcal_from_alcohol = alcohol.reduce((s, a) => s + a.est_kcal, 0);
  const intake_protein_g = meals.reduce((s, m) => s + m.protein_g, 0);
  const intake_carb_g = meals.reduce((s, m) => s + m.carb_g, 0);
  const intake_fat_g = meals.reduce((s, m) => s + m.fat_g, 0);
  const totals: DayTotals = {
    kcal: kcal_from_food + kcal_from_alcohol,
    protein_g: intake_protein_g,
    carb_g: intake_carb_g,
    fat_g: intake_fat_g,
    kcal_from_food,
    kcal_from_alcohol,
  };
  const mealCount = meals.length;

  const phase = findActivePhase(db, userId);
  if (!phase) return { kind: "no_phase", totals, mealCount };
  if (
    phase.phase_type == null ||
    phase.tdee_at_phase_start == null ||
    phase.tdee_source == null ||
    phase.deficit_kcal == null
  ) {
    return { kind: "phase_incomplete", phaseId: phase.id, totals, mealCount };
  }
  const ready: ReadyPhase = {
    ...phase,
    phase_type: phase.phase_type,
    tdee_at_phase_start: phase.tdee_at_phase_start,
    tdee_source: phase.tdee_source,
    deficit_kcal: phase.deficit_kcal,
  };

  const workouts = db
    .prepare(
      `SELECT est_kcal, duration_min FROM workouts
       WHERE user_id = ? AND started_at >= ? AND started_at < ?`,
    )
    .all(userId, startIso, endIso) as Array<{
    est_kcal: number | null;
    duration_min: number | null;
  }>;
  const cardioSessions = db
    .prepare(
      `SELECT est_kcal FROM cardio_sessions
       WHERE user_id = ? AND started_at >= ? AND started_at < ?`,
    )
    .all(userId, startIso, endIso) as Array<{ est_kcal: number }>;

  // Pre-sum cardio + workout kcal with the same 6×duration fallback today.ts /
  // signals.ts apply, so all composites use the same accounting rules.
  const cardio_kcal = cardioSessions.reduce((s, c) => s + c.est_kcal, 0);
  let workout_kcal = 0;
  for (const w of workouts) {
    if (w.est_kcal != null) workout_kcal += w.est_kcal;
    else if (w.duration_min != null)
      workout_kcal += Math.round(w.duration_min * WORKOUT_KCAL_PER_MIN);
  }
  // Steps for the requested date: snapshotted est_kcal (weight-aware at write).
  const stepLog = findStepLogByDate(db, userId, date);
  const steps_kcal = stepLog?.est_kcal ?? 0;

  const dayTarget = computeDailyTarget({
    phase: {
      phase_type: ready.phase_type,
      tdee_at_phase_start: ready.tdee_at_phase_start,
      tdee_source: ready.tdee_source,
      deficit_kcal: ready.deficit_kcal,
      daily_kcal_target: ready.daily_kcal_target,
      base_protein_g: ready.base_protein_g,
      base_carb_g: ready.base_carb_g,
      base_fat_g: ready.base_fat_g,
    },
    intake: {
      kcal: totals.kcal,
      protein_g: intake_protein_g,
      carb_g: intake_carb_g,
      fat_g: intake_fat_g,
    },
    cardio_kcal,
    workout_kcal,
    steps_kcal,
  });

  return { kind: "ready", phase: ready, dayTarget, totals, mealCount };
}
