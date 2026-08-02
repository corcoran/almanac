import type { z } from "zod";
import type { Connection } from "../db/connection.js";
import type { NutritionPhase } from "../domain/nutrition.js";
import { currentUserDate, userDayWindow } from "../domain/user-day.js";
import type { ActivityLevel, UnitSystem } from "../domain/users.js";
import { listGroups } from "../repos/exercise-groups.repo.js";
import { listExercises } from "../repos/exercises.repo.js";
import { findActivePhase } from "../repos/nutrition-phases.repo.js";
import { findStepLogByDate } from "../repos/step-logs.repo.js";
import { getUntrackedDays } from "../repos/untracked-periods.repo.js";
import { findUserById } from "../repos/users.repo.js";
import { listWorkoutsWithDetail } from "../repos/workouts.repo.js";
import type { EnergyBalanceSchema } from "../schemas/signals.js";
import { type Aggregate, makeAggregate } from "./aggregate.js";
import { WORKOUT_KCAL_PER_MIN } from "./avg-activity.js";
import { DEFAULT_DAY_STATUS_CONFIG } from "./config.js";
import { computeDailyTarget, type DailyTargetOutput } from "./daily-target.js";
import { computeDayKcalIn } from "./day-kcal-in.js";
import { computeTdeeForUser } from "./inputs.js";
import { computePhaseAdherence } from "./phase-adherence.js";
import { computeSleepDebt, type SleepDebt } from "./sleep-debt.js";
import { computeStimStates, type StimState } from "./stim.js";
import type { TDEE } from "./tdee.js";
import { computeTrendWeight, computeWeightChange, type WeightChange } from "./trend-weight.js";

const WTD_WINDOW_DAYS = 7;

/**
 * Flattens an intersection like `A & B` into a single object literal so the
 * schemas/_verify.test.ts drift check (which uses a strict structural Equals)
 * can match `z.infer<TodayContextResponseSchema>` exactly. Without this, the
 * intersection in `phase` would survive in the resolved type and the Equals<>
 * check would fail even when the keys/types are pointwise identical.
 */
type Prettify<T> = { [K in keyof T]: T[K] } & {};

/**
 * The active-phase block on TodayContext. Inherits everything from
 * NutritionPhase plus two derived fields (days_in / days_remaining). The whole
 * object is `null` when the user has no currently-active nutrition phase — see
 * the no-phase branch in {@link getTodayContext}.
 */
export type PhaseSummary = Prettify<
  NutritionPhase & {
    // Calendar days since `started_on` in the user's TZ. 0 on the day the
    // phase started, 1 the next day. days_remaining is computed from
    // planned_end_on (Cluster C); null when planned_end_on is absent or the
    // column hasn't landed.
    days_in: number;
    days_remaining: number | null;
  }
>;

/**
 * Pre-composed energy-balance summary, derived from the shared
 * EnergyBalanceSchema so the TS shape and the wire contract can't drift.
 * `computeDayStatus` reuses this same object verbatim on its summary block,
 * which is why a single shared type covers both response surfaces.
 */
export type EnergyBalance = z.infer<typeof EnergyBalanceSchema>;

export type TodayContext = {
  now: string;
  /**
   * The resolved user-local calendar day (YYYY-MM-DD) that `now` belongs to,
   * after applying the DAY_START_HOUR rollover. Distinct from `now`'s date
   * portion: between midnight and 4am local, `now` is already tomorrow's
   * calendar date while `today` is still yesterday — surfacing the resolved
   * day keeps consumers from inferring the wrong date off `now` and
   * contradicting `get_day_status.date` (which reports this same value).
   */
  today_date: string;
  user: {
    id: number;
    name: string;
    timezone: string;
    preferred_unit_system: UnitSystem;
    activity_level: ActivityLevel | null;
  };
  /**
   * `null` when the user has no currently-active nutrition phase. New users
   * (before they've started their first phase) hit this branch — the dashboard
   * should still load, just without target/maintenance/observed. See Task 6 of
   * the TDEE refactor.
   */
  phase: PhaseSummary | null;
  today: {
    kcal_in: number;
    protein_g_in: number;
    carb_g_in: number;
    fat_g_in: number;
    /**
     * `true` iff the user logged at least one meal for the current
     * user-day. Distinguishes "ate zero kcal" (impossible in practice)
     * from "didn't log anything yet" — consumed by MCP summary tools and
     * the day-status `low_intake_today` nudge gate so they don't render
     * "0 kcal in" as if the user fasted.
     */
    meals_logged_today: boolean;
    /**
     * Static phase target: kcal/protein/carb/fat the user is aiming for today.
     * `null` when there's no active phase.
     */
    target: DailyTargetOutput["target"] | null;
    /**
     * Maintenance kcal snapshotted at phase start. `null` when no active phase.
     */
    maintenance: DailyTargetOutput["maintenance"] | null;
    /** Today's intake totals (always present — derived from logged meals). */
    intake: DailyTargetOutput["intake"];
    /**
     * Observed telemetry vs. the phase target: today's projected expenditure
     * (the phase maintenance anchor adjusted by today's activity variance — NOT
     * a measured TDEE), on/off track status, deltas. `null` when no active phase
     * (nothing to be on-track AGAINST).
     */
    observed: DailyTargetOutput["observed"] | null;
    /**
     * Weight reading for the current user-day, or null if the user didn't
     * weigh themselves today. Use `most_recent_weight` for a fallback that
     * always surfaces the latest known value (Gap 21).
     */
    body_weight_kg: number | null;
    most_recent_weight: { value_kg: number; on_date: string } | null;
    sleep: { hours: number; quality: number | null } | null;
    /**
     * Today's step log, if the user logged steps for the current user-day.
     * `null` when no step log row exists — distinct from a zero-steps log
     * (`{ count: 0, est_kcal: 0 }`), which is an explicit "I tracked, but
     * didn't move". The MCP summary tools use this distinction the same way
     * `meals_logged_today` separates "ate zero kcal" from "didn't log".
     */
    steps: { id: number; count: number; est_kcal: number } | null;
    workouts: Array<{ id: number; template_name: string | null; rpe: number }>;
    cardio: Array<{
      id: number;
      modality: string | null;
      duration_min: number | null;
      est_kcal: number;
    }>;
    alcohol: Array<{ id: number; drinks_count: number; est_kcal: number }>;
    // Pre-composed energy-balance summary — see EnergyBalanceSchema in
    // core/schemas/signals.ts for the field documentation and the
    // double-counting rule.
    energy_balance: EnergyBalance;
  };
  week_to_date: {
    // All aggregate fields are wrappers exposing { value, window_days,
    // days_with_data } so two aggregators using the same data can't silently
    // disagree about which days they counted. `sleep_debt` keeps its own
    // self-documenting shape.
    workouts_count: Aggregate;
    cardio_sessions_count: Aggregate;
    cardio_minutes: Aggregate;
    cardio_kcal: Aggregate;
    alcohol_drinks_count: Aggregate;
    alcohol_kcal: Aggregate;
    drinking_days_count: Aggregate;
    avg_kcal_in: Aggregate;
    avg_protein_g: Aggregate;
    sleep_avg_hours: Aggregate;
    sleep_debt: SleepDebt;
  };
  stim_states: StimState[];
  tdee: TDEE;
  trend_weight: { current_kg: number | null; weight_change: WeightChange | null };
  /**
   * `true` once the user has logged at least one body weight reading — the
   * minimum needed for the TDEE back-calc to ever have something to chew on.
   * The web UI (Task 11) uses this to render a "log your weight first" banner
   * when false. Phase existence is a separate concept (see `phase`).
   */
  profile_complete: boolean;
  /**
   * The most recent run of >= gapDetectionMinDays consecutive days with no
   * logged data of any kind, not covered by an untracked period, ending within
   * the last day or two. `null` when none — including once an untracked period
   * is created over it (the offer clears). Drives the "mark this gap" affordance.
   */
  unexplained_gap: { from: string; to: string; days: number } | null;
  /**
   * Phase-to-date adherence for the dashboard "On Target" box: how many logged,
   * non-untracked days this phase were on target (`on_track_days` / `logged_days`)
   * and the average daily delta vs the phase TDEE anchor (negative = deficit).
   * `null` when there is no active phase or no logged days yet. `avg_delta_kcal`
   * is `null` while the phase has no TDEE anchor (calibrating).
   */
  phase_adherence: {
    logged_days: number;
    on_track_days: number;
    avg_delta_kcal: number | null;
  } | null;
};

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days between two YYYY-MM-DD calendar strings. Signed: negative when
 *  `to` is before `from`. */
function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.floor((b - a) / 86_400_000);
}

export function getTodayContext(
  db: Connection,
  userId: number,
  now: Date = new Date(),
): TodayContext {
  const user = findUserById(db, userId);
  if (!user) throw new Error(`user ${userId} not found`);
  // No-active-phase is NOT an error: new users (haven't started a phase yet)
  // and lapsed users (closed their last phase, haven't opened a new one) still
  // need a working dashboard. The no-phase branch returns success with phase=
  // null and null target/maintenance/observed, but everything that doesn't
  // depend on a phase (intake, weight, sleep, workouts, energy balance, TDEE,
  // stim states, week-to-date) still resolves normally.
  const phase = findActivePhase(db, userId);

  // "Today" is the user-local calendar day at `now`, applying the
  // DAY_START_HOUR rollover. `todayWindow` brackets that day as a half-open
  // UTC range so timestamped event queries (meals, workouts, cardio,
  // alcohol) bucket correctly across timezones — an evening workout in EDT
  // is still "today" even though `started_at` in UTC may be on the next
  // calendar date.
  const tz = user.timezone;
  const today = currentUserDate(now, tz);
  const todayWindow = userDayWindow(today, tz);
  const todayStartUtc = todayWindow.startUtc.toISOString();
  const todayEndUtc = todayWindow.endUtc.toISOString();
  // The week sleep query is keyed by slept_on (a user-local YYYY-MM-DD), so it
  // uses the date directly — a slept_on=today night is last night, complete.
  const sevenDaysAgo = addDays(today, -6);
  const thirtyFiveDaysAgo = addDays(today, -34);
  // Completed-days window for the metrics that are PARTIAL on the current day
  // (intake, protein, and the workout/cardio/alcohol counts): the last 7
  // COMPLETED days, ending yesterday. A partial in-progress day would drag the
  // daily averages (and same-day counts) off the user's settled trajectory.
  // Today's own numbers are surfaced separately in the report's `## Today`
  // section. SLEEP is intentionally NOT re-windowed (a slept_on=today night is
  // last night, already complete).
  const weekCompletedStartUtc = userDayWindow(addDays(today, -7), tz).startUtc.toISOString();
  const weekCompletedEndUtc = todayStartUtc; // exclusive of today
  // Untracked (vacation/sick/deload) days inside the week-to-date window.
  // Used to exclude those days from the "usual" per-day averages (kcal,
  // protein, sleep) so a lightly-logged vacation doesn't distort them — the
  // same exclusion TDEE and the low_intake nudge apply. Counts/sums of what
  // actually happened (workouts, cardio, alcohol) intentionally keep
  // untracked days: those report real activity, not a "usual" baseline.
  // The range [today-7 .. today] is a deliberate SUPERSET spanning BOTH the
  // completed-days metric window (today-7 .. today-1) and the today-inclusive
  // sleep window (today-6 .. today), so untracked (vacation) days are excluded
  // from whichever metric's results contain them.
  const weekUntracked = getUntrackedDays(db, userId, addDays(today, -7), today);

  // Today's events
  const meals = db
    .prepare(
      `SELECT id, eaten_at, kcal, protein_g, carb_g, fat_g FROM meals
       WHERE user_id = ? AND eaten_at >= ? AND eaten_at < ?`,
    )
    .all(userId, todayStartUtc, todayEndUtc) as Array<{
    id: number;
    eaten_at: string;
    kcal: number;
    protein_g: number;
    carb_g: number;
    fat_g: number;
  }>;
  const cardioToday = db
    .prepare(
      `SELECT id, started_at, modality, duration_min, est_kcal
       FROM cardio_sessions
       WHERE user_id = ? AND started_at >= ? AND started_at < ?`,
    )
    .all(userId, todayStartUtc, todayEndUtc) as Array<{
    id: number;
    started_at: string;
    modality: string | null;
    duration_min: number | null;
    est_kcal: number;
  }>;
  const alcoholToday = db
    .prepare(
      `SELECT id, started_at, drinks_count, est_kcal
       FROM alcohol_sessions
       WHERE user_id = ? AND started_at >= ? AND started_at < ?`,
    )
    .all(userId, todayStartUtc, todayEndUtc) as Array<{
    id: number;
    started_at: string;
    drinks_count: number;
    est_kcal: number;
  }>;
  const workoutsToday = db
    .prepare(
      `SELECT w.id, w.rpe, w.est_kcal, w.duration_min, w.started_at, t.name AS template_name
       FROM workouts w
       LEFT JOIN workout_templates t ON t.id = w.template_id
       WHERE w.user_id = ? AND w.started_at >= ? AND w.started_at < ?`,
    )
    .all(userId, todayStartUtc, todayEndUtc) as Array<{
    id: number;
    rpe: number;
    est_kcal: number | null;
    duration_min: number | null;
    started_at: string;
    template_name: string | null;
  }>;

  // meals/alcoholToday/workoutsToday/cardioToday are already pre-filtered to
  // the user-day window via the SQL `[startUtc, endUtc)` bounds above. The
  // helpers below are pure summations — they trust the caller's day bucketing.
  const kcalIn = computeDayKcalIn({
    date: today,
    meals: meals.map((m) => ({ kcal: m.kcal })),
    alcoholSessions: alcoholToday.map((a) => ({ est_kcal: a.est_kcal })),
  });
  const proteinIn = meals.reduce((sum, m) => sum + m.protein_g, 0);
  const carbIn = meals.reduce((sum, m) => sum + m.carb_g, 0);
  const fatIn = meals.reduce((sum, m) => sum + m.fat_g, 0);

  // Pre-sum today's cardio + workout kcal (using the 6×duration fallback for
  // workouts with null est_kcal — the same accounting macros.ts / signals.ts
  // use, so the per-day totals stay consistent).
  // Computed unconditionally — the no-phase branch still surfaces these as
  // energy_balance.cardio_out / workout_out for the dashboard.
  const todayCardioKcal = cardioToday.reduce((s, c) => s + c.est_kcal, 0);
  let todayWorkoutKcal = 0;
  for (const w of workoutsToday) {
    if (w.est_kcal != null) todayWorkoutKcal += w.est_kcal;
    else if (w.duration_min != null)
      todayWorkoutKcal += Math.round(w.duration_min * WORKOUT_KCAL_PER_MIN);
  }

  // Today's step log, keyed by on_date (not a timestamped range). Snapshotted
  // est_kcal — already weight-aware from the repo's write-time computation.
  // Looked up unconditionally so the no-phase branch can still surface
  // today.steps and energy_balance.steps_out for the dashboard.
  const todayStepLog = findStepLogByDate(db, userId, today);
  const todayStepsKcal = todayStepLog?.est_kcal ?? 0;

  // Today's intake — always computed (no phase needed). Kept as a single
  // object so the no-phase branch can surface it unchanged.
  const intake = {
    kcal: kcalIn.kcal,
    protein_g: proteinIn,
    carb_g: carbIn,
    fat_g: fatIn,
  };

  // Daily-target snapshot. Only computed when there's an active phase —
  // computeDailyTarget needs phase_type, tdee_at_phase_start, tdee_source,
  // deficit_kcal to produce target/maintenance/observed. The no-phase branch
  // surfaces null for all three.
  let dailyTarget: DailyTargetOutput | null = null;
  if (phase) {
    // Narrow the four new fields. Migration 006 backfills them for every
    // active phase, but a runtime check is cheap belt-and-suspenders — if a
    // phase ever lands without them, fail loudly rather than silently
    // mis-computing maintenance/target.
    if (
      phase.phase_type == null ||
      phase.tdee_at_phase_start == null ||
      phase.tdee_source == null ||
      phase.deficit_kcal == null
    ) {
      throw new Error(
        `Active phase ${phase.id} is missing TDEE refactor fields — data integrity issue (migration 006 should have backfilled phase_type, tdee_at_phase_start, tdee_source, deficit_kcal).`,
      );
    }

    dailyTarget = computeDailyTarget({
      phase: {
        phase_type: phase.phase_type,
        tdee_at_phase_start: phase.tdee_at_phase_start,
        tdee_source: phase.tdee_source,
        deficit_kcal: phase.deficit_kcal,
        daily_kcal_target: phase.daily_kcal_target,
        base_protein_g: phase.base_protein_g,
        base_carb_g: phase.base_carb_g,
        base_fat_g: phase.base_fat_g,
      },
      intake,
      cardio_kcal: todayCardioKcal,
      workout_kcal: todayWorkoutKcal,
      steps_kcal: todayStepsKcal,
    });
  }

  const bw = db
    .prepare(
      `SELECT weight_kg FROM body_weights
       WHERE user_id = ? AND measured_on = ?`,
    )
    .get(userId, today) as { weight_kg: number } | undefined;
  const sleep = db
    .prepare(
      `SELECT hours, quality FROM sleep_logs
       WHERE user_id = ? AND slept_on = ?`,
    )
    .get(userId, today) as { hours: number; quality: number | null } | undefined;

  // Week aggregates over the COMPLETED-days window (the last 7 days ending
  // yesterday, EXCLUSIVE of today) — meal/workout/cardio/alcohol roll-ups use
  // weekCompletedStartUtc/weekCompletedEndUtc so a partial in-progress day
  // doesn't drag the averages. Only the sleep aggregate stays today-inclusive
  // (a slept_on=today night is last night, already complete). Bucket via a UTC
  // range anchored on the user-tz day so an evening (e.g. Sunday-night EDT)
  // event isn't misattributed to the wrong day/week.
  const weekMealRows = db
    .prepare(
      `SELECT eaten_at, kcal, protein_g
       FROM meals
       WHERE user_id = ? AND eaten_at >= ? AND eaten_at < ?`,
    )
    .all(userId, weekCompletedStartUtc, weekCompletedEndUtc) as Array<{
    eaten_at: string;
    kcal: number;
    protein_g: number;
  }>;
  const weekMealsByDay = new Map<string, { d: string; k: number; p: number }>();
  for (const m of weekMealRows) {
    const d = currentUserDate(new Date(m.eaten_at), tz);
    const cur = weekMealsByDay.get(d) ?? { d, k: 0, p: 0 };
    cur.k += m.kcal;
    cur.p += m.protein_g;
    weekMealsByDay.set(d, cur);
  }
  const weekMeals = Array.from(weekMealsByDay.values());
  // Tracked-only meal days for the "usual" kcal/protein averages — untracked
  // days are dropped so a lightly-logged vacation doesn't pull them down.
  const weekMealsTracked = weekMeals.filter((m) => !weekUntracked.has(m.d));
  // Two queries: total workout count vs days the user worked out.
  // For workouts_count: value = total workouts in window, days_with_data =
  // days the user trained (DISTINCT date). Twice in one day still counts
  // as one day with data, but two for value.
  const weekWorkoutTotal = db
    .prepare(
      `SELECT COUNT(*) AS n FROM workouts
       WHERE user_id = ? AND started_at >= ? AND started_at < ?`,
    )
    .get(userId, weekCompletedStartUtc, weekCompletedEndUtc) as { n: number };
  const weekWorkoutStartRows = db
    .prepare(
      `SELECT started_at FROM workouts
       WHERE user_id = ? AND started_at >= ? AND started_at < ?`,
    )
    .all(userId, weekCompletedStartUtc, weekCompletedEndUtc) as Array<{ started_at: string }>;
  const weekWorkoutDays = {
    n: new Set(weekWorkoutStartRows.map((r) => currentUserDate(new Date(r.started_at), tz))).size,
  };
  const weekCardioRows = (
    db
      .prepare(
        `SELECT started_at, duration_min, est_kcal
         FROM cardio_sessions
         WHERE user_id = ? AND started_at >= ? AND started_at < ?`,
      )
      .all(userId, weekCompletedStartUtc, weekCompletedEndUtc) as Array<{
      started_at: string;
      duration_min: number | null;
      est_kcal: number;
    }>
  ).map((r) => ({
    d: currentUserDate(new Date(r.started_at), tz),
    duration_min: r.duration_min,
    est_kcal: r.est_kcal,
  }));
  const cardioDaysWithData = new Set(weekCardioRows.map((r) => r.d)).size;
  const cardioMinutes = weekCardioRows.reduce((s, r) => s + (r.duration_min ?? 0), 0);
  const cardioKcal = weekCardioRows.reduce((s, r) => s + r.est_kcal, 0);
  const weekAlcoholRows = (
    db
      .prepare(
        `SELECT started_at, drinks_count, est_kcal
         FROM alcohol_sessions
         WHERE user_id = ? AND started_at >= ? AND started_at < ?`,
      )
      .all(userId, weekCompletedStartUtc, weekCompletedEndUtc) as Array<{
      started_at: string;
      drinks_count: number;
      est_kcal: number;
    }>
  ).map((r) => ({
    d: currentUserDate(new Date(r.started_at), tz),
    drinks_count: r.drinks_count,
    est_kcal: r.est_kcal,
  }));
  const drinkingDays = new Set(weekAlcoholRows.map((r) => r.d)).size;
  const drinksCount = weekAlcoholRows.reduce((s, r) => s + r.drinks_count, 0);
  const alcoholKcal = weekAlcoholRows.reduce((s, r) => s + r.est_kcal, 0);
  const weekSleep = db
    .prepare(
      `SELECT slept_on, hours FROM sleep_logs
       WHERE user_id = ? AND slept_on >= ?`,
    )
    // Deliberately stays on the today-inclusive sevenDaysAgo window (unlike the
    // sibling week queries, which moved to the completed-days window): a
    // slept_on=today night is last night, already complete.
    .all(userId, sevenDaysAgo) as Array<{ slept_on: string; hours: number }>;
  // computeSleepDebt clips to its own (7-day) window; weekUntracked spans the
  // matching range, so nights inside a vacation are dropped from both debt and
  // its average.
  const sleepDebt = computeSleepDebt(weekSleep, today, undefined, weekUntracked);
  // Tracked-only nights for the week sleep average + its days_with_data count.
  const weekSleepTracked = weekSleep.filter((s) => !weekUntracked.has(s.slept_on));
  const sleepAvg =
    weekSleepTracked.length === 0
      ? 0
      : weekSleepTracked.reduce((a, b) => a + b.hours, 0) / weekSleepTracked.length;

  // Stim states. Caller is responsible for the window — the signal trusts the input
  // and computes both recent-credit and baseline-credit internally from it.
  // 35 days back is enough to cover the baseline band (21d) plus a margin.
  const groups = listGroups(db, userId);
  const exercises = listExercises(db, userId, { includeArchived: true });
  const exerciseToGroup = new Map(exercises.map((e) => [e.id, e.group_id]));
  const workouts35 = listWorkoutsWithDetail(db, userId, {
    from: `${thirtyFiveDaysAgo}T00:00:00Z`,
    to: `${addDays(today, 1)}T00:00:00Z`,
    limit: 200,
  });
  // Latest body weight feeds bodyweight-exercise volume math (§5.2.1) AND
  // today.most_recent_weight (Gap 21 — fallback for callers who want a value
  // when the user skipped today's weigh-in).
  const latestBwRow = db
    .prepare(
      `SELECT measured_on, weight_kg FROM body_weights
       WHERE user_id = ?
       ORDER BY measured_on DESC LIMIT 1`,
    )
    .get(userId) as { measured_on: string; weight_kg: number } | undefined;
  const stimStates = computeStimStates({
    groups: groups.map((g) => ({ id: g.id, name: g.name })),
    workouts: workouts35.map((w) => ({
      id: w.id,
      started_at: w.started_at,
      rpe: w.rpe,
      // Drop skipped rows BEFORE feeding stim: they exist for adherence/audit
      // (sets=[], skipped_at set) but they're not training, so they must not
      // refresh last_hit_at or contribute volume for the group.
      exercises: (w.exercises ?? [])
        .filter((ei) => ei.skipped_at == null)
        .map((ei) => ({
          exercise_id: ei.exercise_id,
          sets: (ei.sets ?? []).map((s) => ({ reps: s.reps, weight_kg: s.weight_kg })),
        })),
    })),
    exerciseToGroup,
    latestBodyWeightKg: latestBwRow?.weight_kg ?? null,
    now,
  });

  // TDEE — delegate to computeTdeeForUser, which ends the back-calc window on
  // the last COMPLETED day (asOf = today − 1). The in-progress day is excluded
  // so a half-logged "today" can't drag the displayed TDEE intraday — matching
  // the NET signal and the /v1/signals/tdee endpoint. (weights30 below is still
  // fetched for the trend/weight-change, which DO include today's weigh-in.)
  const weights30 = db
    .prepare(
      `SELECT measured_on, weight_kg FROM body_weights
       WHERE user_id = ? AND measured_on >= ?
       ORDER BY measured_on`,
    )
    .all(userId, addDays(today, -60)) as Array<{
    measured_on: string;
    weight_kg: number;
  }>;
  const untrackedDays = getUntrackedDays(db, userId, addDays(today, -60), today);
  const tdee = computeTdeeForUser(db, userId, now);

  const trend = computeTrendWeight(weights30);
  // Round the surfaced EMA to 2dp — matches the rounding convention every other
  // surfaced float follows (stim 1dp, tdee/sleep 2dp, weight_change 2dp). The
  // raw EMA carries full float noise (e.g. 76.99041836737017) that's meaningless
  // at body-weight precision.
  const rawTrend = trend[trend.length - 1]?.trend_kg ?? null;
  const currentTrend = rawTrend === null ? null : Number(rawTrend.toFixed(2));
  const weightChange = computeWeightChange(weights30);

  // Energy balance for today. food_in is meals-only (no alcohol), alcohol_in
  // is alcohol sessions only — the two were being conflated by consumers
  // before this composite landed. cardio_out / workout_out / steps_out use the
  // same pre-summed numbers daily-target reads (with the duration×6 fallback
  // for workouts and the snapshotted step_logs.est_kcal for steps) so the
  // composites can't disagree. net intentionally subtracts only TDEE, not
  // TDEE+activity: TDEE already encompasses average cardio/workouts/steps via
  // the back-calc, so adding today's activity a second time would
  // double-count. steps_out
  // follows the same rule as cardio_out / workout_out — display-only.
  const foodIn = meals.reduce((sum, m) => sum + m.kcal, 0);
  const alcoholIn = alcoholToday.reduce((sum, a) => sum + a.est_kcal, 0);
  const energyBalance = {
    food_in: foodIn,
    alcohol_in: alcoholIn,
    total_in: foodIn + alcoholIn,
    tdee_baseline: tdee.kcal,
    cardio_out: todayCardioKcal,
    workout_out: todayWorkoutKcal,
    steps_out: todayStepsKcal,
    net: foodIn + alcoholIn - tdee.kcal,
  };

  // profile_complete: any logged body weight is enough. The TDEE back-calc
  // only needs ONE recent weight to start producing measured_intake estimates,
  // so "have you ever weighed yourself" is the right threshold for the web
  // UI's "log your weight first" prompt (Task 11).
  const profileComplete = latestBwRow != null;

  // --- unexplained_gap -------------------------------------------------------
  // The most recent run of >= gapDetectionMinDays consecutive days with NO
  // logged data of ANY kind (meals/workouts/weights/sleep/steps) that ISN'T
  // already covered by an untracked period, AND that is current (its last day
  // is >= today-1). Null otherwise. Gives the assistant/web UI a reliable
  // "offer to mark this gap" trigger. See the untracked-periods design.
  const gapMinDays = DEFAULT_DAY_STATUS_CONFIG.gapDetectionMinDays;
  const gapLookbackStart = addDays(today, -60);
  // The bucketing below is user-local (currentUserDate), but these two WHERE
  // clauses use SQLite's date() which is UTC. For an east-of-UTC user, a row
  // whose user-local day is exactly gapLookbackStart can carry a UTC date of
  // gapLookbackStart - 1 day (the DAY_START_HOUR window opens the previous UTC
  // day). Pad the UTC pre-filter by one day so those rows aren't dropped before
  // bucketing. The extra day cannot over-include: any row outside [gapLookbackStart,
  // today] simply won't match a user-local day in the gap scan below.
  const gapLookbackStartPadded = addDays(gapLookbackStart, -1);
  const loggedDates = new Set<string>();
  for (const row of db
    .prepare(`SELECT eaten_at FROM meals WHERE user_id = ? AND date(eaten_at) >= ?`)
    .all(userId, gapLookbackStartPadded) as Array<{ eaten_at: string }>)
    loggedDates.add(currentUserDate(new Date(row.eaten_at), tz));
  for (const row of db
    .prepare(`SELECT started_at FROM workouts WHERE user_id = ? AND date(started_at) >= ?`)
    .all(userId, gapLookbackStartPadded) as Array<{ started_at: string }>)
    loggedDates.add(currentUserDate(new Date(row.started_at), tz));
  for (const row of db
    .prepare(
      `SELECT DISTINCT measured_on d FROM body_weights WHERE user_id = ? AND measured_on >= ?`,
    )
    .all(userId, gapLookbackStart) as Array<{ d: string }>)
    loggedDates.add(row.d);
  for (const row of db
    .prepare(`SELECT DISTINCT slept_on d FROM sleep_logs WHERE user_id = ? AND slept_on >= ?`)
    .all(userId, gapLookbackStart) as Array<{ d: string }>)
    loggedDates.add(row.d);
  for (const row of db
    .prepare(`SELECT DISTINCT on_date d FROM step_logs WHERE user_id = ? AND on_date >= ?`)
    .all(userId, gapLookbackStart) as Array<{ d: string }>)
    loggedDates.add(row.d);

  let gapEnd: string | null = null;
  let gapStart: string | null = null;
  let cursor = today;
  while (cursor >= gapLookbackStart) {
    const empty = !loggedDates.has(cursor);
    const covered = untrackedDays.has(cursor);
    if (empty && !covered) {
      if (gapEnd === null) gapEnd = cursor;
      gapStart = cursor;
      cursor = addDays(cursor, -1);
    } else {
      break;
    }
  }
  let unexplainedGap: { from: string; to: string; days: number } | null = null;
  if (gapEnd !== null && gapStart !== null) {
    const days = daysBetween(gapStart, gapEnd) + 1;
    // NOTE: gapEnd is always `today` because this loop scans backward from today
    // and breaks at the first logged day, so `endsRecently` is structurally always
    // true here. Kept as an explicit guard so a future refactor to detect gaps
    // anywhere in the window doesn't silently lose the "only surface a gap ending
    // at today" intent.
    const endsRecently = gapEnd >= addDays(today, -1);
    if (days >= gapMinDays && endsRecently) {
      unexplainedGap = { from: gapStart, to: gapEnd, days };
    }
  }

  // Phase-to-date adherence for the dashboard "On Target" box. Only meaningful
  // with an active phase; null otherwise. Reuses the same per-day accounting as
  // today's daily target (computeDailyTargetForDate) so it can't drift.
  const phaseAdherence = phase
    ? computePhaseAdherence(
        db,
        userId,
        tz,
        { started_on: phase.started_on, tdee_at_phase_start: phase.tdee_at_phase_start },
        today,
      )
    : null;

  const phaseSummary: PhaseSummary | null = phase
    ? {
        ...phase,
        days_in: Math.max(0, daysBetween(phase.started_on, today)),
        // Negative days_remaining is allowed when the phase has overrun its
        // plan — "ended July 1, today is July 8" → days_remaining: -7. Lets a
        // caller spot the overrun without re-computing.
        days_remaining: phase.planned_end_on ? daysBetween(today, phase.planned_end_on) : null,
      }
    : null;

  return {
    now: now.toISOString(),
    today_date: today,
    user: {
      id: user.id,
      name: user.name,
      timezone: user.timezone,
      preferred_unit_system: user.preferred_unit_system,
      activity_level: user.activity_level,
    },
    phase: phaseSummary,
    today: {
      kcal_in: kcalIn.kcal,
      protein_g_in: proteinIn,
      carb_g_in: carbIn,
      fat_g_in: fatIn,
      meals_logged_today: meals.length > 0,
      target: dailyTarget?.target ?? null,
      maintenance: dailyTarget?.maintenance ?? null,
      intake,
      observed: dailyTarget?.observed ?? null,
      body_weight_kg: bw?.weight_kg ?? null,
      most_recent_weight: latestBwRow
        ? { value_kg: latestBwRow.weight_kg, on_date: latestBwRow.measured_on }
        : null,
      sleep: sleep ? { hours: sleep.hours, quality: sleep.quality } : null,
      steps: todayStepLog
        ? { id: todayStepLog.id, count: todayStepLog.steps, est_kcal: todayStepLog.est_kcal ?? 0 }
        : null,
      workouts: workoutsToday.map((w) => ({
        id: w.id,
        template_name: w.template_name,
        rpe: w.rpe,
      })),
      cardio: cardioToday.map((c) => ({
        id: c.id,
        modality: c.modality,
        duration_min: c.duration_min,
        est_kcal: c.est_kcal,
      })),
      alcohol: alcoholToday.map((a) => ({
        id: a.id,
        drinks_count: a.drinks_count,
        est_kcal: a.est_kcal,
      })),
      energy_balance: energyBalance,
    },
    week_to_date: {
      workouts_count: makeAggregate(weekWorkoutTotal.n, WTD_WINDOW_DAYS, weekWorkoutDays.n),
      cardio_sessions_count: makeAggregate(
        weekCardioRows.length,
        WTD_WINDOW_DAYS,
        cardioDaysWithData,
      ),
      cardio_minutes: makeAggregate(cardioMinutes, WTD_WINDOW_DAYS, cardioDaysWithData),
      cardio_kcal: makeAggregate(cardioKcal, WTD_WINDOW_DAYS, cardioDaysWithData),
      alcohol_drinks_count: makeAggregate(drinksCount, WTD_WINDOW_DAYS, drinkingDays, {
        round: false,
      }),
      alcohol_kcal: makeAggregate(alcoholKcal, WTD_WINDOW_DAYS, drinkingDays),
      drinking_days_count: makeAggregate(drinkingDays, WTD_WINDOW_DAYS, drinkingDays),
      avg_kcal_in: makeAggregate(
        weekMealsTracked.length === 0
          ? 0
          : weekMealsTracked.reduce((a, b) => a + b.k, 0) / weekMealsTracked.length,
        WTD_WINDOW_DAYS,
        weekMealsTracked.length,
      ),
      avg_protein_g: makeAggregate(
        weekMealsTracked.length === 0
          ? 0
          : weekMealsTracked.reduce((a, b) => a + b.p, 0) / weekMealsTracked.length,
        WTD_WINDOW_DAYS,
        weekMealsTracked.length,
      ),
      sleep_avg_hours: makeAggregate(
        Number(sleepAvg.toFixed(2)),
        WTD_WINDOW_DAYS,
        weekSleepTracked.length,
        { round: false },
      ),
      sleep_debt: sleepDebt,
    },
    stim_states: stimStates,
    tdee,
    trend_weight: { current_kg: currentTrend, weight_change: weightChange },
    profile_complete: profileComplete,
    unexplained_gap: unexplainedGap,
    phase_adherence: phaseAdherence && phaseAdherence.logged_days > 0 ? phaseAdherence : null,
  };
}
