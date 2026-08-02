import type { Connection } from "../db/connection.js";
import { displayE1rm, kgToDisplayWeight, weightUnitLabel } from "../domain/units.js";
import { addDaysIso, currentUserDate } from "../domain/user-day.js";
import type { UnitSystem } from "../domain/users.js";
import {
  insertAccomplishment,
  listAllAccomplishments,
  listRecentAccomplishments,
  selectPriorBest,
  selectPriorBestForExercise,
  selectPriorBestSleepDensity,
} from "../repos/accomplishments.repo.js";
import { findActivePhase, listRecentlyEndedPhases } from "../repos/nutrition-phases.repo.js";
import { getUntrackedDays } from "../repos/untracked-periods.repo.js";
import { findUserById } from "../repos/users.repo.js";
import type {
  Accomplishment,
  AccomplishmentAggregates,
  AccomplishmentCode,
  AccomplishmentHistoryResponse,
  AccomplishmentsResponse,
} from "../schemas/accomplishments.js";
import {
  type AccomplishmentsConfig,
  DEFAULT_ACCOMPLISHMENTS_CONFIG,
} from "./accomplishments-config.js";
import { DEFAULT_SLEEP_CONFIG } from "./config.js";
import type { DailyTargetStatus } from "./daily-target.js";
import { computeDailyTargetForDate, computeTdeeForUser } from "./inputs.js";
import { computeSleepDebt } from "./sleep-debt.js";
import { computeTrendWeight } from "./trend-weight.js";

export type DetectedCandidate = {
  code: string;
  earned_on: string;
  // The milestone magnitude: the threshold tier for streaks (7/14/30…), the kg
  // count for weight_milestone, or 0 for non-tiered boolean wins (tdee_measured).
  value: number;
  // The dedup discriminator for the UNIQUE (user_id, code, dedup_key) constraint.
  // For weight_milestone this is `<phase_id>:<kg>` (per-phase: the same kg in a
  // different phase is a distinct win). For streak/tdee wins it is the threshold
  // value as a string — preserving lifetime/threshold dedup (one row per tier).
  dedup_key: string;
  message: string;
  details: Record<string, unknown>;
};

/** Epley estimated 1RM. At reps=1 this returns the weight exactly. */
function epleyE1rm(weightKg: number, reps: number): number {
  return weightKg * (1 + reps / 30);
}

/** Round to the nearest `step` kg (e.g. 0.5). */
function roundToStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/**
 * Turn a chronologically-ascending list of user-local day strings into
 * cumulative-count milestone candidates. For each tier N where the list has at
 * least N entries, the milestone is dated at the Nth entry (index N-1) — the
 * day the Nth qualifying log actually happened. `value` and `dedup_key` are the
 * tier (lifetime/threshold dedup, one row per tier).
 */
function countMilestones(
  code: string,
  daysAscending: readonly string[],
  tiers: readonly number[],
  messageFor: (tier: number) => string,
): DetectedCandidate[] {
  const out: DetectedCandidate[] = [];
  const total = daysAscending.length;
  for (const tier of tiers) {
    if (total < tier) continue;
    const earned_on = daysAscending[tier - 1];
    if (earned_on === undefined) continue; // unreachable given total >= tier
    out.push({
      code,
      earned_on,
      value: tier,
      dedup_key: String(tier),
      message: messageFor(tier),
      details: { total },
    });
  }
  return out;
}

/**
 * Pure detection — returns the full set of milestone candidates currently
 * satisfied for `userId` as of `now` (no writes). Each detector reuses an
 * existing signal's notion of "good" rather than inventing a parallel
 * threshold. `persistNewAccomplishments` (Task 6) turns this into idempotent
 * inserts; `prior_best` is attached later at read time (Task 7), not here.
 */
export function detectAccomplishments(
  db: Connection,
  userId: number,
  now: Date = new Date(),
  config: AccomplishmentsConfig = DEFAULT_ACCOMPLISHMENTS_CONFIG,
): DetectedCandidate[] {
  const user = findUserById(db, userId);
  if (!user) throw new Error(`user ${userId} not found`);
  const tz = user.timezone;
  const today = currentUserDate(now, tz);

  return [
    ...detectWeighInStreak(db, userId, today, config),
    ...detectTdeeMeasured(db, userId, today, now),
    ...detectTargetAdherenceStreak(db, userId, today, tz, config),
    ...detectWorkoutConsistency(db, userId, today, tz, config),
    ...detectWeightMilestone(db, userId, today),
    ...detectStrengthPr(db, userId, tz, config),
    ...detectPhaseCompletion(db, userId, today, config),
    ...detectPhaseHalfway(db, userId, today),
    ...detectWorkoutTotal(db, userId, tz, config),
    ...detectMealTotal(db, userId, tz, config),
    ...detectWeighInTotal(db, userId, config),
    ...detectVolumeTotal(db, userId, tz, config),
    ...detectSleepRecovery(db, userId, today, tz, config),
  ];
}

/**
 * Detect current milestone candidates and insert any not already present.
 * Returns the candidates that were newly inserted (deduped ones are dropped).
 * Idempotent: safe to call on every write — re-running inserts nothing new.
 */
export function persistNewAccomplishments(
  db: Connection,
  userId: number,
  now: Date = new Date(),
  config: AccomplishmentsConfig = DEFAULT_ACCOMPLISHMENTS_CONFIG,
): DetectedCandidate[] {
  const candidates = detectAccomplishments(db, userId, now, config);
  const inserted: DetectedCandidate[] = [];
  for (const c of candidates) {
    const row = insertAccomplishment(db, {
      user_id: userId,
      code: c.code,
      earned_on: c.earned_on,
      value: c.value,
      dedup_key: c.dedup_key,
      details_json: JSON.stringify(c.details),
    });
    if (row !== null) inserted.push(c);
  }
  return inserted;
}

/**
 * Lifetime workout count milestones. Each workout's `started_at` (ISO-UTC) is
 * bucketed to its user-local day before ordering, so an evening session lands
 * on the right day for a non-UTC user (CLAUDE.md). Backdated to the real Nth
 * workout via `countMilestones`.
 */
function detectWorkoutTotal(
  db: Connection,
  userId: number,
  tz: string,
  config: AccomplishmentsConfig,
): DetectedCandidate[] {
  const rows = db
    .prepare(`SELECT started_at FROM workouts WHERE user_id = ? ORDER BY started_at`)
    .all(userId) as Array<{ started_at: string }>;
  // Bucket each UTC timestamp to its user-local day, then sort: UTC ordering can
  // diverge from user-local day ordering for evening events, and countMilestones
  // requires chronologically-ascending days.
  const days = rows.map((r) => currentUserDate(new Date(r.started_at), tz)).sort();
  return countMilestones(
    "workout_total",
    days,
    config.workoutTotalTiers,
    (t) => `${t} workouts logged`,
  );
}

/**
 * Lifetime meal count milestones. Counts meal ROWS (not distinct days), each
 * `eaten_at` (ISO-UTC) bucketed to its user-local day before ordering, so an
 * evening meal lands on the right day for a non-UTC user (CLAUDE.md). Sorted
 * after bucketing because UTC ordering can diverge from user-local day ordering,
 * and `countMilestones` requires chronologically-ascending days. Backdated to
 * the real Nth meal.
 */
function detectMealTotal(
  db: Connection,
  userId: number,
  tz: string,
  config: AccomplishmentsConfig,
): DetectedCandidate[] {
  const rows = db
    .prepare(`SELECT eaten_at FROM meals WHERE user_id = ? ORDER BY eaten_at`)
    .all(userId) as Array<{ eaten_at: string }>;
  const days = rows.map((r) => currentUserDate(new Date(r.eaten_at), tz)).sort();
  return countMilestones("meal_total", days, config.mealTotalTiers, (t) => `${t} meals logged`);
}

/**
 * Lifetime weigh-in count milestones. `measured_on` is already user-local
 * YYYY-MM-DD (CLAUDE.md exception), so it is used directly — the SQL ORDER BY
 * already yields ascending user-local order; the `.sort()` is a harmless no-op
 * kept for uniformity with `detectWorkoutTotal`/`detectMealTotal`. Backdated to
 * the real Nth weigh-in.
 */
function detectWeighInTotal(
  db: Connection,
  userId: number,
  config: AccomplishmentsConfig,
): DetectedCandidate[] {
  const rows = db
    .prepare(`SELECT measured_on FROM body_weights WHERE user_id = ? ORDER BY measured_on`)
    .all(userId) as Array<{ measured_on: string }>;
  const days = rows.map((r) => r.measured_on).sort();
  return countMilestones(
    "weigh_in_total",
    days,
    config.weighInTotalTiers,
    (t) => `${t} weigh-ins logged`,
  );
}

/**
 * Lifetime volume (sum of reps × weight_kg over all weighted sets) milestones.
 * Sets carry no user_id — scoping is via the workouts.user_id parent join, the
 * same pattern the IDOR fix uses for nested entities. Bodyweight sets
 * (weight_kg IS NULL) are excluded. Walks sets in workout-started_at order,
 * accumulating; the tier's earned_on is the user-local day of the set that
 * first pushes the running total to/over the tier.
 *
 * Ordering is by `started_at` (UTC) deliberately — unlike the count detectors,
 * which bucket-then-sort by user-local day. Volume is a cumulative SUM built in
 * real time-order, and UTC instants ARE the true chronological order of when
 * sets happened, so the running total accumulates correctly. Only the *label*
 * of the crossing set's day is user-local (via `currentUserDate`); the walk
 * order itself must not be re-sorted by day (which would scramble within-day or
 * DST-edge ordering of the cumulative sum).
 */
function detectVolumeTotal(
  db: Connection,
  userId: number,
  tz: string,
  config: AccomplishmentsConfig,
): DetectedCandidate[] {
  const rows = db
    .prepare(
      `SELECT w.started_at AS started_at, s.reps AS reps, s.weight_kg AS weight_kg
       FROM sets s
       JOIN exercise_instances ei ON ei.id = s.exercise_instance_id
       JOIN workouts w ON w.id = ei.workout_id
       WHERE w.user_id = ? AND s.weight_kg IS NOT NULL
       ORDER BY w.started_at, s.id`,
    )
    .all(userId) as Array<{ started_at: string; reps: number; weight_kg: number }>;

  const tiers = [...config.volumeTotalKgTiers].sort((a, b) => a - b);
  const out: DetectedCandidate[] = [];
  let running = 0;
  let tierIdx = 0;
  for (const r of rows) {
    running += r.reps * r.weight_kg;
    while (tierIdx < tiers.length) {
      const tier = tiers[tierIdx];
      if (tier === undefined || running < tier) break;
      out.push({
        code: "volume_total",
        earned_on: currentUserDate(new Date(r.started_at), tz),
        value: tier,
        dedup_key: String(tier),
        message: `${tier.toLocaleString("en-US")} kg lifted`,
        details: { total_kg: Math.round(running) },
      });
      tierIdx += 1;
    }
  }
  return out;
}

function detectTdeeMeasured(
  db: Connection,
  userId: number,
  today: string,
  now: Date,
): DetectedCandidate[] {
  const tdee = computeTdeeForUser(db, userId, now);
  if (tdee.basis !== "measured_intake") return [];
  return [
    {
      code: "tdee_measured",
      earned_on: today,
      value: 0,
      dedup_key: "0",
      message: "Your TDEE is now measured from your real data",
      details: { kcal: tdee.kcal },
    },
  ];
}

function detectWeighInStreak(
  db: Connection,
  userId: number,
  today: string,
  config: AccomplishmentsConfig,
): DetectedCandidate[] {
  const floor = addDaysIso(today, -config.streakLookbackDays);
  // measured_on is stored as YYYY-MM-DD and is already user-local (per the
  // CLAUDE.md exceptions), so plain string compare + string date math is the
  // correct bucketing here — no UTC-window conversion needed.
  const rows = db
    .prepare(
      `SELECT DISTINCT measured_on AS d FROM body_weights
       WHERE user_id = ? AND measured_on >= ? AND measured_on <= ?
       ORDER BY measured_on DESC`,
    )
    .all(userId, floor, today) as { d: string }[];
  const days = new Set(rows.map((r) => r.d));

  // Count back from today while each consecutive day is present.
  let streak = 0;
  let cursor = today;
  while (days.has(cursor)) {
    streak += 1;
    cursor = addDaysIso(cursor, -1);
  }

  const out: DetectedCandidate[] = [];
  for (const threshold of config.weighInStreakDays) {
    if (streak >= threshold) {
      out.push({
        code: "weigh_in_streak",
        earned_on: today,
        value: threshold,
        dedup_key: String(threshold),
        message: `${threshold}-day weigh-in streak`,
        details: { streak_days: streak },
      });
    }
  }
  return out;
}

/**
 * The `observed.status` for a single user-day, reusing the exact daily-target
 * assembly the macros route (`computeForDate`) performs: user-day-windowed
 * meals/workouts/cardio + snapshotted steps, fed to `computeDailyTarget`. This
 * keeps the streak's notion of "on track" identical to the dashboard's grace
 * band — no parallel threshold.
 *
 * Returns `null` when there is no active phase OR when the day has no meals
 * logged. Zero intake would otherwise read as `on_track` on a cut (0 <= target
 * + grace), so a day with nothing logged must NOT count toward an adherence
 * streak — you can't be on-target with no intake recorded.
 */
function dailyTargetStatusFor(
  db: Connection,
  userId: number,
  date: string,
  tz: string,
): DailyTargetStatus | null {
  const result = computeDailyTargetForDate(db, userId, tz, date);
  // No active phase OR an incomplete phase → not a streak day. The macros route
  // throws 500 on `phase_incomplete` (data-integrity), but for an accomplishment
  // streak the deliberate fork is to skip the day rather than error.
  if (result.kind !== "ready") return null;
  // No intake logged for the day → not a streak day (see doc comment): zero
  // intake would read as on_track on a cut (0 <= target + grace).
  if (result.mealCount === 0) return null;
  return result.dayTarget.observed.status;
}

function detectTargetAdherenceStreak(
  db: Connection,
  userId: number,
  today: string,
  tz: string,
  config: AccomplishmentsConfig,
): DetectedCandidate[] {
  const untracked = getUntrackedDays(
    db,
    userId,
    addDaysIso(today, -config.streakLookbackDays),
    today,
  );
  const lookbackFloor = addDaysIso(today, -config.streakLookbackDays);
  let streak = 0;
  let cursor = today;
  while (cursor >= lookbackFloor) {
    if (untracked.has(cursor)) {
      // Untracked (vacation/sick/deload) days are skipped, not counted and not
      // a break — mirrors how nudges treat them.
      cursor = addDaysIso(cursor, -1);
      continue;
    }
    const status = dailyTargetStatusFor(db, userId, cursor, tz);
    if (status !== "on_track") break;
    streak += 1;
    cursor = addDaysIso(cursor, -1);
  }

  const out: DetectedCandidate[] = [];
  for (const t of config.targetAdherenceStreakDays) {
    if (streak >= t) {
      out.push({
        code: "target_adherence_streak",
        earned_on: today,
        value: t,
        dedup_key: String(t),
        message: `On target ${t} days running`,
        details: { streak_days: streak },
      });
    }
  }
  return out;
}

/** Whole days between two YYYY-MM-DD strings (`toIso - fromIso`). */
function daysBetweenIso(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.floor((b - a) / 86_400_000);
}

/**
 * Resistance-training consistency: consecutive 7-day weeks (counting back from
 * today) that each contain >= 1 resistance workout. "Resistance" is the
 * `workouts` table — cardio lives in `cardio_sessions` and does NOT count,
 * exactly the distinction `no_workout_streak` (day-status.ts) relies on.
 *
 * Each workout's `started_at` (ISO-UTC) is bucketed to its user-local day via
 * `currentUserDate` BEFORE grouping into a week index. UTC bucketing
 * (`date()`/`strftime`) would misattribute an evening session to the wrong day
 * — and thus the wrong week — for a non-UTC user (CLAUDE.md).
 */
function detectWorkoutConsistency(
  db: Connection,
  userId: number,
  today: string,
  tz: string,
  config: AccomplishmentsConfig,
): DetectedCandidate[] {
  const maxWeeks = config.workoutConsistencyWeeks.reduce((m, w) => Math.max(m, w), 0);
  if (maxWeeks === 0) return [];
  // Floor the SQL fetch at maxWeeks*7 days back. This is a coarse range lower
  // bound (CLAUDE.md tolerates UTC slop here); per-day attribution is done in
  // JS below via currentUserDate.
  const floor = addDaysIso(today, -(maxWeeks * 7 + 1));
  const rows = db
    .prepare(
      `SELECT started_at FROM workouts
       WHERE user_id = ? AND started_at >= ?`,
    )
    .all(userId, `${floor}T00:00:00Z`) as Array<{ started_at: string }>;

  // Week 0 = the 7 days ending today, week 1 = the prior 7, etc.
  const weeksWithWorkout = new Set<number>();
  for (const r of rows) {
    const day = currentUserDate(new Date(r.started_at), tz);
    const daysBack = daysBetweenIso(day, today);
    if (daysBack < 0) continue; // future-dated (shouldn't happen) — ignore
    weeksWithWorkout.add(Math.floor(daysBack / 7));
  }

  // Count consecutive weeks from index 0 that contain a workout.
  let weeks = 0;
  while (weeksWithWorkout.has(weeks)) weeks += 1;

  const out: DetectedCandidate[] = [];
  for (const t of config.workoutConsistencyWeeks) {
    if (weeks >= t) {
      out.push({
        code: "workout_consistency",
        earned_on: today,
        value: t,
        dedup_key: String(t),
        message: `${t}-week training streak`,
        details: { weeks },
      });
    }
  }
  return out;
}

/**
 * Sleep-recovery wins. Reuses the sleep-debt signal's `baselineHours` (8h) as
 * the notion of a "good" night — never a parallel threshold. Robust to sparse
 * logging by design: a DENSITY ratio ("M of the last N nights at baseline"),
 * not a consecutive streak, so an un-logged or short night merely fails to
 * count toward the numerator instead of breaking anything.
 *
 * Edge-triggered: fires only on the transition INTO the met state (met today,
 * not met yesterday), recomputed from the same fetch — keeping the detector
 * pure/stateless. dedup_key is the transition date so same-day write-hook
 * re-fires collapse to one row while a genuine re-entry on a later date is a
 * fresh win.
 *
 * `slept_on` is stored YYYY-MM-DD and is already user-local (CLAUDE.md
 * exceptions), so night-counting is a plain string-range compare — NO
 * userDayWindow/currentUserDate bucketing. (`_tz` is unused, kept for detector
 * signature parity.)
 */
function detectSleepRecovery(
  db: Connection,
  userId: number,
  today: string,
  _tz: string,
  config: AccomplishmentsConfig,
): DetectedCandidate[] {
  const baseline = DEFAULT_SLEEP_CONFIG.baselineHours;
  const windowN = config.sleepDensityWindowNights;
  // Floor the fetch to cover BOTH the density window (windowN) AND the
  // debt-cleared window (DEFAULT_SLEEP_CONFIG.windowDays) — they're independent
  // config values that happen to coincide today; Math.max keeps both flavors'
  // yesterday-windows in range if they ever diverge.
  const fetchDays = Math.max(windowN, DEFAULT_SLEEP_CONFIG.windowDays);
  const floor = addDaysIso(today, -fetchDays);
  const rows = db
    .prepare(
      `SELECT slept_on, hours FROM sleep_logs
       WHERE user_id = ? AND slept_on >= ? AND slept_on <= ?
       ORDER BY slept_on`,
    )
    .all(userId, floor, today) as Array<{ slept_on: string; hours: number }>;

  // Count nights at/above baseline within [asOf-(windowN-1), asOf].
  const goodNightsInWindow = (asOf: string): number => {
    const start = addDaysIso(asOf, -(windowN - 1));
    let n = 0;
    for (const r of rows) {
      if (r.slept_on >= start && r.slept_on <= asOf && r.hours >= baseline) n += 1;
    }
    return n;
  };

  const out: DetectedCandidate[] = [];

  // --- Density flavor (edge-triggered) ---
  const goodToday = goodNightsInWindow(today);
  const goodYesterday = goodNightsInWindow(addDaysIso(today, -1));
  const metToday = goodToday >= config.sleepDensityMinNights;
  const metYesterday = goodYesterday >= config.sleepDensityMinNights;
  if (metToday && !metYesterday) {
    out.push({
      code: "sleep_recovery",
      earned_on: today,
      value: goodToday,
      dedup_key: `density:${today}`,
      message: `${goodToday} of the last ${windowN} nights at ${baseline}h+`,
      details: {
        kind: "density",
        good_nights: goodToday,
        window_nights: windowN,
        baseline_hours: baseline,
      },
    });
  }

  // --- Debt-cleared flavor (edge-triggered) ---
  // Reuse computeSleepDebt's own verdict + window (DEFAULT_SLEEP_CONFIG.windowDays)
  // and its untracked-night exclusion. A window with zero logged nights has
  // debt_hours === 0 trivially — that is NOT a win, so require nights_logged > 0.
  const untracked = getUntrackedDays(
    db,
    userId,
    addDaysIso(today, -DEFAULT_SLEEP_CONFIG.windowDays),
    today,
  );
  const debtToday = computeSleepDebt(rows, today, DEFAULT_SLEEP_CONFIG, untracked);
  const debtYesterday = computeSleepDebt(
    rows,
    addDaysIso(today, -1),
    DEFAULT_SLEEP_CONFIG,
    untracked,
  );
  const clearedToday = debtToday.nights_logged > 0 && debtToday.debt_hours === 0;
  const clearedYesterday = debtYesterday.nights_logged > 0 && debtYesterday.debt_hours === 0;
  if (clearedToday && !clearedYesterday) {
    out.push({
      code: "sleep_recovery",
      earned_on: today,
      // debt_cleared has no ordinal magnitude; value 0 is a sentinel. messageFor
      // disambiguates the two flavors on value (0 ⇒ debt_cleared). selectPriorBest's
      // `value < 0` never matches, so prior_best is always null here (correct — there
      // is no "better" debt clearance).
      value: 0,
      dedup_key: `debt:${today}`,
      message: "Cleared your sleep debt",
      details: {
        kind: "debt_cleared",
        avg_hours: Number(debtToday.avg_hours.toFixed(2)),
        nights_logged: debtToday.nights_logged,
      },
    });
  }

  return out;
}

/**
 * Reconstruct the human-readable message for a stored accomplishment row.
 * Must stay in sync with the messages emitted by each detector above. The
 * phase wins need `details` (weeks / day counts / phase_type) to rebuild, so
 * this takes the parsed details object.
 */
function messageFor(
  code: string,
  value: number,
  details: Record<string, unknown>,
  // Display unit for the weight-bearing codes. The read paths pass the user's
  // real preference; the detectors' own `DetectedCandidate.message` field is
  // vestigial (never persisted — the read path rebuilds the message), so they
  // omit it and accept the kg default.
  unitSystem: UnitSystem = "metric",
): string {
  // Weight figures render in the user's preferred unit; `value` itself stays kg
  // (canonical — see domain/units.ts). The unit label and converted magnitude
  // are reused across the weight-bearing codes below.
  const unit = weightUnitLabel(unitSystem);
  const asWeight = (kg: number) => kgToDisplayWeight(kg, unitSystem);
  switch (code) {
    case "weigh_in_streak":
      return `${value}-day weigh-in streak`;
    case "workout_consistency":
      return `${value}-week training streak`;
    case "target_adherence_streak":
      return `On target ${value} days running`;
    case "weight_milestone":
      return `Down ${asWeight(value)} ${unit} from phase start`;
    case "tdee_measured":
      return "Your TDEE is now measured from your real data";
    case "strength_pr": {
      const name = typeof details.exercise_name === "string" ? details.exercise_name : "exercise";
      return `New PR: ${name} e1RM ${displayE1rm(value, unitSystem)} ${unit}`;
    }
    case "phase_complete": {
      const verb = details.phase_type === "bulk" ? "Bulk" : "Cut";
      const weeks = typeof details.weeks === "number" ? details.weeks : 0;
      const w = asWeight(value);
      const signed = w > 0 ? `+${w}` : String(w);
      return `${verb} complete: ${signed} ${unit} over ${weeks} weeks`;
    }
    case "phase_halfway": {
      const noun = typeof details.phase_type === "string" ? details.phase_type : "phase";
      const daysIn = typeof details.days_in === "number" ? details.days_in : value;
      const plannedDays = typeof details.planned_days === "number" ? details.planned_days : 0;
      return `Halfway through your ${noun} — ${daysIn}/${plannedDays} days`;
    }
    case "workout_total":
      return `${value} workouts logged`;
    case "volume_total":
      // Lifetime tonnage: convert then round to a whole unit before grouping
      // (the figure is large; a decimal here is noise).
      return `${Math.round(asWeight(value)).toLocaleString("en-US")} ${unit} lifted`;
    case "meal_total":
      return `${value} meals logged`;
    case "weigh_in_total":
      return `${value} weigh-ins logged`;
    case "sleep_recovery":
      // value 0 ⇒ debt-cleared flavor; otherwise the density good-night count.
      // Density rows always have value >= sleepDensityMinNights (> 0) — the
      // detector only pushes a density row when goodToday meets the threshold —
      // so the 0 sentinel is unambiguous. The density window comes from
      // config.sleepDensityWindowNights and the sleep-debt window from
      // DEFAULT_SLEEP_CONFIG; both default to 7. Reconstruction uses
      // DEFAULT_SLEEP_CONFIG here, so message text drifts only if those configs
      // ever diverge (cosmetic; `value` is the canonical magnitude).
      return value === 0
        ? "Cleared your sleep debt"
        : `${value} of the last ${DEFAULT_SLEEP_CONFIG.windowDays} nights at ${DEFAULT_SLEEP_CONFIG.baselineHours}h+`;
    default:
      return "Accomplishment";
  }
}

/**
 * Resolve a row's `prior_best` with the correct per-code scoping. Shared by the
 * recent + history read paths so they can't drift. prior_best is per-code by
 * default, with exceptions:
 *  - phase_complete / phase_halfway: per-phase one-offs, not a running record —
 *    a cross-phase "previous best" would be misleading, so suppress entirely.
 *  - strength_pr: scoped to the same exercise (value spans different lifts).
 *  - sleep_recovery: the code carries TWO flavors (density value = good-night
 *    count; debt_cleared value = 0 sentinel). A plain per-code lookup lets the
 *    debt row's 0 surface as a density win's "prev best 0" — meaningless. Scope
 *    density to other density rows; debt_cleared has no ordinal best (→ null).
 */
function priorBestFor(
  db: Connection,
  userId: number,
  code: string,
  value: number,
  details: Record<string, unknown>,
): { earned_on: string; value: number } | null {
  let prior: ReturnType<typeof selectPriorBest>;
  if (code === "phase_complete" || code === "phase_halfway") {
    prior = null;
  } else if (code === "strength_pr" && typeof details.exercise_id === "number") {
    prior = selectPriorBestForExercise(db, userId, details.exercise_id, value);
  } else if (code === "sleep_recovery") {
    prior = details.kind === "density" ? selectPriorBestSleepDensity(db, userId, value) : null;
  } else {
    prior = selectPriorBest(db, userId, code, value);
  }
  return prior !== null ? { earned_on: prior.earned_on, value: prior.value } : null;
}

/**
 * Read persisted accomplishments for the recent window (default 14 days back
 * from the user-local today derived from `now`). Attaches `prior_best` for
 * each returned row by querying across ALL history — not just the window.
 * Returns a value matching `AccomplishmentsResponseSchema`.
 */
export function getRecentAccomplishments(
  db: Connection,
  userId: number,
  now: Date = new Date(),
  config: AccomplishmentsConfig = DEFAULT_ACCOMPLISHMENTS_CONFIG,
): AccomplishmentsResponse {
  const user = findUserById(db, userId);
  if (!user) throw new Error(`user ${userId} not found`);
  const today = currentUserDate(now, user.timezone);
  const since = addDaysIso(today, -config.recentWindowDays);
  const rows = listRecentAccomplishments(db, userId, since);

  const accomplishments = rows.map((r) => {
    const details = JSON.parse(r.details_json) as Record<string, unknown>;
    // r.code is guaranteed to be a valid AccomplishmentCode by the DB CHECK
    // constraint on the accomplishments table — cast is safe.
    const code = r.code as AccomplishmentsResponse["accomplishments"][number]["code"];
    return {
      code,
      earned_on: r.earned_on,
      value: r.value,
      message: messageFor(r.code, r.value, details, user.preferred_unit_system),
      details,
      prior_best: priorBestFor(db, userId, r.code, r.value, details),
    };
  });
  return { accomplishments };
}

/**
 * Full accomplishment history (no recent-window floor), newest first, each row
 * mapped to the same shape getRecentAccomplishments produces (message +
 * inline prior_best), plus light aggregates. config is accepted for signature
 * parity with the recent path but unused — history is unbounded.
 */
export function getAccomplishmentHistory(
  db: Connection,
  userId: number,
  _now: Date = new Date(),
  _config: AccomplishmentsConfig = DEFAULT_ACCOMPLISHMENTS_CONFIG,
): AccomplishmentHistoryResponse {
  const user = findUserById(db, userId);
  if (!user) throw new Error(`user ${userId} not found`);
  const rows = listAllAccomplishments(db, userId);

  const accomplishments: Accomplishment[] = rows.map((r) => {
    const details = JSON.parse(r.details_json) as Record<string, unknown>;
    const code = r.code as AccomplishmentCode;
    return {
      code,
      earned_on: r.earned_on,
      value: r.value,
      message: messageFor(r.code, r.value, details, user.preferred_unit_system),
      details,
      prior_best: priorBestFor(db, userId, r.code, r.value, details),
    };
  });

  return { accomplishments, aggregates: computeAccomplishmentAggregates(accomplishments) };
}

// NOTE: ALL_CODES / BOOLEAN_CODES must stay in sync with AccomplishmentCodeSchema
// in ../schemas/accomplishments.js (the authoritative enum). If a code is added
// there, add it here too.
const ALL_CODES: readonly AccomplishmentCode[] = [
  "weigh_in_streak",
  "workout_consistency",
  "target_adherence_streak",
  "weight_milestone",
  "tdee_measured",
  "strength_pr",
  "phase_complete",
  "phase_halfway",
  "workout_total",
  "volume_total",
  "meal_total",
  "weigh_in_total",
  "sleep_recovery",
];

// "Boolean" codes are counted in by_type but get a null best_by_type — a single
// max-value "personal best" is meaningless or misleading for them:
//   tdee_measured  — boolean milestone (value 0).
//   phase_complete — value is signed net kg (cut negative / bulk positive); a
//                    global max conflates directions and isn't a "best".
//   phase_halfway  — value is the phase midpoint day, not an achievement magnitude.
//   strength_pr    — value is an e1RM in kg, but the meaningful PR is PER-EXERCISE
//                    (prior_best is per-exercise); a global max across lifts is not
//                    a coherent personal best, so we count PRs without ranking them.
const BOOLEAN_CODES: ReadonlySet<AccomplishmentCode> = new Set([
  "tdee_measured",
  "phase_complete",
  "phase_halfway",
  "strength_pr",
]);

/**
 * Light aggregates over the full accomplishment list: total count, count per
 * code, and the max-value "personal best" per code (with the earliest date that
 * max was reached — on a value tie, the earliest earned_on wins). Pure — no DB.
 * Codes never earned get count 0 and best null; boolean codes (tdee_measured)
 * get a count but a null best.
 */
export function computeAccomplishmentAggregates(
  accomplishments: Accomplishment[],
): AccomplishmentAggregates {
  const by_type = Object.fromEntries(ALL_CODES.map((c) => [c, 0])) as Record<
    AccomplishmentCode,
    number
  >;
  const best_by_type = Object.fromEntries(ALL_CODES.map((c) => [c, null])) as Record<
    AccomplishmentCode,
    { value: number; earned_on: string } | null
  >;

  for (const a of accomplishments) {
    const code = a.code;
    by_type[code] += 1;
    if (BOOLEAN_CODES.has(code)) continue;
    const current = best_by_type[code];
    // Personal best = max value; on a value tie, the EARLIEST earned_on (the
    // first time that best was achieved). Order-independent — does not assume
    // any particular input ordering.
    if (
      current === null ||
      a.value > current.value ||
      (a.value === current.value && a.earned_on < current.earned_on)
    ) {
      best_by_type[code] = { value: a.value, earned_on: a.earned_on };
    }
  }

  return { total: accomplishments.length, by_type, best_by_type };
}

/**
 * Phase-relative weight-loss milestones: a candidate per whole kg the smoothed
 * trend weight has dropped below the phase-start trend. Reuses `computeTrendWeight`
 * (the same EMA the dashboard shows) over the active phase's window — no raw
 * weight, no parallel smoothing. No active phase → no candidates.
 *
 * `body_weights.measured_on` is stored YYYY-MM-DD (user-local), so the phase
 * window filter is a plain string compare (no UTC bucketing).
 */
function detectWeightMilestone(db: Connection, userId: number, today: string): DetectedCandidate[] {
  const phase = findActivePhase(db, userId);
  if (!phase) return [];

  const readings = db
    .prepare(
      `SELECT measured_on, weight_kg FROM body_weights
       WHERE user_id = ? AND measured_on >= ? AND measured_on <= ?
       ORDER BY measured_on`,
    )
    .all(userId, phase.started_on, today) as Array<{ measured_on: string; weight_kg: number }>;

  const trend = computeTrendWeight(readings);
  if (trend.length === 0) return [];

  // Phase-start trend: the trend point on the phase start date if present,
  // else the earliest available point (control-flow narrowed, no `!`).
  const startPoint = trend.find((p) => p.date === phase.started_on) ?? trend[0];
  const endPoint = trend[trend.length - 1];
  if (startPoint === undefined || endPoint === undefined) return [];
  const startTrend = startPoint.trend_kg;
  const nowTrend = endPoint.trend_kg;

  const kgDown = Math.floor(startTrend - nowTrend);
  const out: DetectedCandidate[] = [];
  for (let k = 1; k <= kgDown; k++) {
    out.push({
      code: "weight_milestone",
      earned_on: today,
      value: k,
      // Per-phase dedup: the same kg in a different phase is a distinct win.
      dedup_key: `${phase.id}:${k}`,
      message: `Down ${k} kg from phase start`,
      details: {
        start_trend_kg: Number(startTrend.toFixed(2)),
        current_trend_kg: Number(nowTrend.toFixed(2)),
      },
    });
  }
  return out;
}

/**
 * Strength PR: for each exercise trained in the most-recently-logged session,
 * fire when that session's best Epley e1RM strictly beats the user's prior best
 * e1RM for the same exercise. "Best" excludes bodyweight (0 kg) sets and
 * high-rep (> `strengthPrRepCap`) sets — the Epley estimator is only a sane 1RM
 * proxy in the low-rep, loaded regime.
 *
 * Sessions are compared by their `started_at` (ISO-UTC) ordering — the latest
 * timestamp is "this session", anything strictly earlier is "prior". The
 * earned-on day is bucketed from `started_at` to the user-local day via
 * `currentUserDate` (NOT `date()`/`slice`), so a non-UTC evening session lands
 * on the correct day (CLAUDE.md).
 */
function detectStrengthPr(
  db: Connection,
  userId: number,
  tz: string,
  config: AccomplishmentsConfig,
): DetectedCandidate[] {
  // The session just logged = the workout with the greatest started_at.
  const latest = db
    .prepare(`SELECT started_at FROM workouts WHERE user_id = ? ORDER BY started_at DESC LIMIT 1`)
    .get(userId) as { started_at: string } | undefined;
  if (latest === undefined) return []; // no workouts → no-op

  const sessionStartedAt = latest.started_at;
  const earnedOn = currentUserDate(new Date(sessionStartedAt), tz);

  const exRows = db
    .prepare(
      `SELECT DISTINCT ei.exercise_id AS exercise_id
       FROM exercise_instances ei
       JOIN workouts w ON w.id = ei.workout_id
       WHERE w.user_id = ? AND w.started_at = ?`,
    )
    .all(userId, sessionStartedAt) as Array<{ exercise_id: number }>;

  const out: DetectedCandidate[] = [];
  for (const { exercise_id } of exRows) {
    const setRows = db
      .prepare(
        `SELECT s.weight_kg AS weight_kg, s.reps AS reps, w.started_at AS started_at
         FROM sets s
         JOIN exercise_instances ei ON ei.id = s.exercise_instance_id
         JOIN workouts w ON w.id = ei.workout_id
         WHERE w.user_id = ?
           AND ei.exercise_id = ?
           AND s.weight_kg IS NOT NULL
           AND s.weight_kg > 0
           AND s.reps BETWEEN 1 AND ?`,
      )
      .all(userId, exercise_id, config.strengthPrRepCap) as Array<{
      weight_kg: number;
      reps: number;
      started_at: string;
    }>;

    // Partition sets into "this session" vs "earlier" by started_at. workouts
    // has no UNIQUE on started_at, so two sessions logged at the exact same
    // timestamp would merge into "today" — a benign limitation: it can only
    // inflate todaysBest, never fabricate a priorBest, so it can't produce a
    // false PR (at worst it misses one). Distinct session timestamps are assumed.
    let todaysBest = 0;
    let todaysBestWeight = 0;
    let todaysBestReps = 0;
    let priorBest = 0;
    for (const r of setRows) {
      const e = epleyE1rm(r.weight_kg, r.reps);
      if (r.started_at === sessionStartedAt) {
        if (e > todaysBest) {
          todaysBest = e;
          todaysBestWeight = r.weight_kg;
          todaysBestReps = r.reps;
        }
      } else if (r.started_at < sessionStartedAt) {
        if (e > priorBest) priorBest = e;
      }
    }

    if (todaysBest === 0 || priorBest === 0) continue; // no qualifying today, or first-ever
    if (todaysBest <= priorBest) continue; // must strictly beat

    const exName =
      (
        db
          .prepare(`SELECT name FROM exercises WHERE id = ? AND user_id = ?`)
          .get(exercise_id, userId) as { name: string } | undefined
      )?.name ?? "exercise";

    const roundedNew = roundToStep(todaysBest, config.strengthPrE1rmRoundingKg);
    const roundedPrior = roundToStep(priorBest, config.strengthPrE1rmRoundingKg);
    out.push({
      code: "strength_pr",
      earned_on: earnedOn,
      value: roundedNew,
      dedup_key: `${exercise_id}:${roundedNew}`,
      message: `New PR: ${exName} e1RM ${roundedNew} kg`,
      details: {
        exercise_id,
        exercise_name: exName,
        weight_kg: todaysBestWeight,
        reps: todaysBestReps,
        prior_e1rm: roundedPrior,
      },
    });
  }
  return out;
}

/**
 * Phase-completion result: when a cut/bulk phase has ended (within the scan
 * window), mint one win summarizing the net smoothed-trend-weight change over
 * the phase window, framed by intent. Reuses `computeTrendWeight` (same EMA as
 * the dashboard and `detectWeightMilestone`) — never raw weight.
 *
 * Only cut and bulk are celebrated, and only in their intended direction (a cut
 * that gained, or a bulk that lost, mints nothing). maintenance/recomp/null
 * phase_type have no clean result delta and are skipped.
 *
 * dedup_key = String(phase.id) → once per phase, ever. The lookback window is a
 * cost bound on the scan, not the dedup guarantee: a phase ended outside the
 * window (with no later write to re-surface it) simply isn't re-derived. All of
 * started_on / ended_on / measured_on are user-local YYYY-MM-DD (plain string
 * compare; no UTC bucketing).
 */
function detectPhaseCompletion(
  db: Connection,
  userId: number,
  today: string,
  config: AccomplishmentsConfig,
): DetectedCandidate[] {
  const floor = addDaysIso(today, -config.phaseCompletionLookbackDays);
  const phases = listRecentlyEndedPhases(db, userId, floor);
  const out: DetectedCandidate[] = [];

  for (const phase of phases) {
    if (phase.phase_type !== "cut" && phase.phase_type !== "bulk") continue;
    if (phase.ended_on === null) continue;
    const phaseType = phase.phase_type;
    const endedOn = phase.ended_on;

    const readings = db
      .prepare(
        `SELECT measured_on, weight_kg FROM body_weights
         WHERE user_id = ? AND measured_on >= ? AND measured_on <= ?
         ORDER BY measured_on`,
      )
      .all(userId, phase.started_on, endedOn) as Array<{
      measured_on: string;
      weight_kg: number;
    }>;
    if (readings.length < 2) continue;

    const trend = computeTrendWeight(readings);
    const startPoint = trend.find((p) => p.date === phase.started_on) ?? trend[0];
    const endPoint = trend[trend.length - 1];
    if (startPoint === undefined || endPoint === undefined) continue;
    const startTrend = startPoint.trend_kg;
    const endTrend = endPoint.trend_kg;
    const delta = endTrend - startTrend;

    // Direction gate: cut celebrates loss (delta < 0), bulk celebrates gain.
    if (phaseType === "cut" && delta >= 0) continue;
    if (phaseType === "bulk" && delta <= 0) continue;

    // Clamp to >= 1: a sub-4-day phase would otherwise round to "over 0 weeks".
    // Stored in details too, so the read-path message (messageFor) agrees.
    const weeks = Math.max(1, Math.round(daysBetweenIso(phase.started_on, endedOn) / 7));
    const value = Math.round(delta * 10) / 10;

    const details = {
      phase_type: phaseType,
      start_trend_kg: Number(startTrend.toFixed(2)),
      end_trend_kg: Number(endTrend.toFixed(2)),
      weeks,
      phase_name: phase.name,
    };
    out.push({
      code: "phase_complete",
      earned_on: today,
      value,
      dedup_key: String(phase.id),
      message: messageFor("phase_complete", value, details),
      details,
    });
  }
  return out;
}

/**
 * Phase-halfway milestone: once the active phase (which must have a
 * planned_end_on) reaches its planned midpoint and is not yet past its planned
 * end, mint a one-shot "halfway there" win. dedup_key = String(phase.id).
 *
 * Fires on the ongoing write hook (no transition event marks crossing the
 * midpoint) — the per-phase dedup makes that safe. started_on / planned_end_on
 * are user-local YYYY-MM-DD (plain string math).
 */
function detectPhaseHalfway(db: Connection, userId: number, today: string): DetectedCandidate[] {
  const phase = findActivePhase(db, userId);
  if (!phase || phase.planned_end_on === null) return [];

  const plannedDays = daysBetweenIso(phase.started_on, phase.planned_end_on);
  if (plannedDays <= 0) return [];
  const daysIn = daysBetweenIso(phase.started_on, today);
  const midpoint = Math.ceil(plannedDays / 2);

  // Reached the midpoint, and not yet past the planned end.
  if (daysIn < midpoint) return [];
  if (today > phase.planned_end_on) return [];

  const details = {
    days_in: daysIn,
    planned_days: plannedDays,
    phase_type: phase.phase_type,
    phase_name: phase.name,
  };
  return [
    {
      code: "phase_halfway",
      earned_on: today,
      value: midpoint,
      dedup_key: String(phase.id),
      message: messageFor("phase_halfway", midpoint, details),
      details,
    },
  ];
}
