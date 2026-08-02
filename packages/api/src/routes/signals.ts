import {
  findActivePhase,
  findStepLogByDate,
  findWorkoutByIdForUser,
  listExercises,
  listGroups,
  listWorkoutsWithDetail,
} from "@almanac/core/repos";
import {
  AlcoholOverlayResponseSchema,
  DailyTargetResponseSchema,
  DayKcalInResponseSchema,
  DayStatusResponseSchema,
  NextBestActionResponseSchema,
  RecommendTemplateResponseSchema,
  SleepDebtResponseSchema,
  StimStateResponseSchema,
  TDEEResponseSchema,
  TodayContextResponseSchema,
  TrainingHistorySummarySchema,
  TrendWeightPointResponseSchema,
} from "@almanac/core/schemas";
import {
  computeAlcoholOverlay,
  computeDailyTarget,
  computeDayKcalIn,
  computeDayStatus,
  computeNextBestAction,
  computeSleepDebt,
  computeStimStates,
  computeTdeeForUser,
  computeTrendWeight,
  getTodayContext,
  recommendTemplateForUser,
  summarizeTrainingHistory,
  WORKOUT_KCAL_PER_MIN,
} from "@almanac/core/signals";
import { currentUserDate, userDayWindow } from "@almanac/core/types";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireUser, requireUserId } from "../auth.js";
import { ApiError } from "../errors.js";

/**
 * Read-only `/v1/signals/*` endpoints. Each handler:
 *   1. Resolves the current user.
 *   2. Pulls the inputs needed by the corresponding compute function from
 *      `@almanac/core/signals`. The compute functions are pure — windowing
 *      and aggregation live in core, not in the route.
 *   3. Returns the computed result, shaped by a Zod response schema.
 *
 * The repository signal functions are the source of truth for windowing
 * defaults; we only override here when the spec explicitly lets a caller
 * tune the window via query string (e.g., sleep-debt's `window_days`).
 */

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const registerSignalsRoutes: FastifyPluginAsyncZod = async (app) => {
  // -------- GET /v1/signals/today ------------------------------------------
  app.get(
    "/v1/signals/today",
    {
      schema: {
        querystring: z
          .object({
            date: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .optional(),
          })
          .strict(),
        response: { 200: TodayContextResponseSchema },
      },
    },
    async (req) => {
      const user = requireUser(app.db, req);
      const requested = req.query.date;
      if (requested === undefined) {
        return getTodayContext(app.db, user.id, new Date());
      }
      // Reject future dates (can't view a day that hasn't happened).
      const todayLocal = currentUserDate(new Date(), user.timezone);
      if (requested > todayLocal) {
        throw new ApiError(400, "validation_failed", `Cannot view a future date: ${requested}`);
      }
      // Derive a mid-day `now` for the requested user-local date: the user-day
      // starts at 4am (DAY_START_HOUR); +12h lands safely mid-window so
      // currentUserDate(now, tz) === requested regardless of tz/DST.
      const { startUtc } = userDayWindow(requested, user.timezone);
      const now = new Date(startUtc.getTime() + 12 * 60 * 60 * 1000);
      return getTodayContext(app.db, user.id, now);
    },
  );

  // -------- GET /v1/signals/stim-states ------------------------------------
  // Mirrors the stim-state portion of getTodayContext, but exposed standalone.
  app.get(
    "/v1/signals/stim-states",
    { schema: { response: { 200: z.array(StimStateResponseSchema) } } },
    async (req) => {
      const userId = requireUserId(req);
      const now = new Date();
      const today = todayIso();
      const thirtyFiveDaysAgo = addDaysIso(today, -34);

      const groups = listGroups(app.db, userId);
      const exercises = listExercises(app.db, userId, { includeArchived: true });
      const exerciseToGroup = new Map(exercises.map((e) => [e.id, e.group_id]));
      const workouts35 = listWorkoutsWithDetail(app.db, userId, {
        from: `${thirtyFiveDaysAgo}T00:00:00Z`,
        to: `${addDaysIso(today, 1)}T00:00:00Z`,
        limit: 200,
      });
      const latestBwRow = app.db
        .prepare(
          `SELECT weight_kg FROM body_weights
           WHERE user_id = ?
           ORDER BY measured_on DESC LIMIT 1`,
        )
        .get(userId) as { weight_kg: number } | undefined;

      return computeStimStates({
        groups: groups.map((g) => ({ id: g.id, name: g.name })),
        workouts: workouts35.map((w) => ({
          id: w.id,
          started_at: w.started_at,
          rpe: w.rpe,
          exercises: (w.exercises ?? []).map((ei) => ({
            exercise_id: ei.exercise_id,
            sets: (ei.sets ?? []).map((s) => ({
              reps: s.reps,
              weight_kg: s.weight_kg,
            })),
          })),
        })),
        exerciseToGroup,
        latestBodyWeightKg: latestBwRow?.weight_kg ?? null,
        now,
      });
    },
  );

  // -------- GET /v1/signals/recommend-template -----------------------------
  // Score the user's workout templates against current per-muscle-group stim
  // state. Returns the top-`top_n` recommendations with reasoning. Same stim
  // computation as /v1/signals/stim-states; deliberate duplication for now
  // (TODO: extract computeStimStatesForUser if a third caller appears).
  app.get(
    "/v1/signals/recommend-template",
    {
      schema: {
        querystring: z
          .object({ top_n: z.coerce.number().int().min(1).max(10).optional() })
          .strict(),
        response: { 200: RecommendTemplateResponseSchema },
      },
    },
    async (req) => {
      const userId = requireUserId(req);
      const topN = req.query.top_n ?? 1;
      return recommendTemplateForUser(app.db, userId, new Date(), { topN });
    },
  );

  // -------- GET /v1/signals/training-history --------------------------------
  app.get(
    "/v1/signals/training-history",
    {
      schema: {
        querystring: z.object({ days: z.coerce.number().int().min(1).max(35).optional() }).strict(),
        response: { 200: TrainingHistorySummarySchema },
      },
    },
    async (req) => {
      const user = requireUser(app.db, req);
      const days = req.query.days ?? 14;
      return summarizeTrainingHistory(app.db, user.id, new Date(), user.timezone, { days });
    },
  );

  // -------- GET /v1/signals/tdee -------------------------------------------
  app.get(
    "/v1/signals/tdee",
    {
      schema: {
        querystring: z
          .object({ window_days: z.coerce.number().int().positive().optional() })
          .strict(),
        response: { 200: TDEEResponseSchema },
      },
    },
    async (req) => {
      const user = requireUser(app.db, req);
      // computeTDEE picks the window itself based on data density; the
      // `window_days` query param is accepted for forward-compat but not
      // currently threaded through (matches today.ts behaviour). The db→input
      // assembly lives in `computeTdeeForUser` (core) so the accomplishment
      // `tdee_measured` detector computes against this exact definition.
      return computeTdeeForUser(app.db, user.id, new Date());
    },
  );

  // -------- GET /v1/signals/trend-weight -----------------------------------
  app.get(
    "/v1/signals/trend-weight",
    {
      schema: {
        querystring: z
          .object({
            from: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .optional(),
            to: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .optional(),
          })
          .strict(),
        response: { 200: z.array(TrendWeightPointResponseSchema) },
      },
    },
    async (req) => {
      const userId = requireUserId(req);
      const where: string[] = ["user_id = ?"];
      const params: unknown[] = [userId];
      if (req.query.from !== undefined) {
        where.push("measured_on >= ?");
        params.push(req.query.from);
      }
      if (req.query.to !== undefined) {
        where.push("measured_on <= ?");
        params.push(req.query.to);
      }
      const readings = app.db
        .prepare(
          `SELECT measured_on, weight_kg FROM body_weights
           WHERE ${where.join(" AND ")}
           ORDER BY measured_on`,
        )
        .all(...params) as Array<{ measured_on: string; weight_kg: number }>;
      return computeTrendWeight(readings);
    },
  );

  // -------- GET /v1/signals/sleep-debt -------------------------------------
  app.get(
    "/v1/signals/sleep-debt",
    {
      schema: {
        querystring: z
          .object({ window_days: z.coerce.number().int().positive().optional() })
          .strict(),
        response: { 200: SleepDebtResponseSchema },
      },
    },
    async (req) => {
      const userId = requireUserId(req);
      const today = todayIso();
      const windowDays = req.query.window_days ?? 7;
      const startDate = addDaysIso(today, -(windowDays - 1));
      const logs = app.db
        .prepare("SELECT slept_on, hours FROM sleep_logs WHERE user_id = ? AND slept_on >= ?")
        .all(userId, startDate) as Array<{ slept_on: string; hours: number }>;
      return computeSleepDebt(logs, today, { windowDays, baselineHours: 8 });
    },
  );

  // -------- GET /v1/signals/alcohol-overlay --------------------------------
  app.get(
    "/v1/signals/alcohol-overlay",
    {
      schema: {
        querystring: z.object({ workout_id: z.coerce.number().int().positive() }).strict(),
        response: { 200: AlcoholOverlayResponseSchema },
      },
    },
    async (req) => {
      const userId = requireUserId(req);
      const workout = findWorkoutByIdForUser(app.db, userId, req.query.workout_id);
      if (!workout) {
        throw new ApiError(404, "not_found", `Workout ${req.query.workout_id} not found`);
      }
      const wT = Date.parse(workout.started_at);
      const startMs = wT - 48 * 3600 * 1000;
      const sessions = app.db
        .prepare(
          `SELECT started_at, drinks_count, est_kcal FROM alcohol_sessions
           WHERE user_id = ? AND started_at >= ? AND started_at < ?`,
        )
        .all(userId, new Date(startMs).toISOString(), workout.started_at) as Array<{
        started_at: string;
        drinks_count: number;
        est_kcal: number;
      }>;
      return computeAlcoholOverlay({ id: workout.id, started_at: workout.started_at }, sessions);
    },
  );

  // -------- GET /v1/signals/daily-target -----------------------------------
  // Returns the structured { target, maintenance, intake, observed } block —
  // see core/schemas/signals.ts → DailyTargetResponseSchema. `target` is the
  // static phase anchor (doesn't shift with today's activity); `observed`
  // carries the per-day deltas vs. that target plus the on/off-track verdict.
  app.get(
    "/v1/signals/daily-target",
    {
      schema: {
        querystring: z
          .object({
            date: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .optional(),
          })
          .strict(),
        response: { 200: DailyTargetResponseSchema },
      },
    },
    async (req) => {
      const user = requireUser(app.db, req);
      const userId = user.id;
      const date = req.query.date ?? currentUserDate(new Date(), user.timezone);
      const phase = findActivePhase(app.db, userId);
      if (!phase) {
        throw new ApiError(404, "not_found", "No active nutrition phase");
      }
      // Migration 006 backfills the four TDEE refactor fields on the active
      // phase; null here would indicate data drift. computeDailyTarget itself
      // would throw, but the route surface should fail loud with a clearer
      // message.
      if (
        phase.phase_type == null ||
        phase.tdee_at_phase_start == null ||
        phase.tdee_source == null ||
        phase.deficit_kcal == null
      ) {
        throw new ApiError(
          500,
          "internal",
          `Active phase ${phase.id} is missing TDEE refactor fields — data integrity issue.`,
        );
      }
      // Day buckets run against the user-TZ window (DAY_START_HOUR rollover),
      // so an evening log that crosses UTC midnight stays on its local day.
      const { startUtc, endUtc } = userDayWindow(date, user.timezone);
      const startIso = startUtc.toISOString();
      const endIso = endUtc.toISOString();
      const workouts = app.db
        .prepare(
          `SELECT est_kcal, duration_min FROM workouts
           WHERE user_id = ? AND started_at >= ? AND started_at < ?`,
        )
        .all(userId, startIso, endIso) as Array<{
        est_kcal: number | null;
        duration_min: number | null;
      }>;
      const cardioSessions = app.db
        .prepare(
          `SELECT est_kcal FROM cardio_sessions
           WHERE user_id = ? AND started_at >= ? AND started_at < ?`,
        )
        .all(userId, startIso, endIso) as Array<{ est_kcal: number }>;
      const meals = app.db
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

      const cardio_kcal = cardioSessions.reduce((s, c) => s + c.est_kcal, 0);
      let workout_kcal = 0;
      for (const w of workouts) {
        if (w.est_kcal != null) workout_kcal += w.est_kcal;
        else if (w.duration_min != null)
          workout_kcal += Math.round(w.duration_min * WORKOUT_KCAL_PER_MIN);
      }
      // Steps for the requested date — snapshot from the step-logs repo, same
      // accounting today.ts and macros.ts use.
      const stepLog = findStepLogByDate(app.db, userId, date);
      const steps_kcal = stepLog?.est_kcal ?? 0;
      const intake = {
        kcal: meals.reduce((s, m) => s + m.kcal, 0),
        protein_g: meals.reduce((s, m) => s + m.protein_g, 0),
        carb_g: meals.reduce((s, m) => s + m.carb_g, 0),
        fat_g: meals.reduce((s, m) => s + m.fat_g, 0),
      };
      return computeDailyTarget({
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
        cardio_kcal,
        workout_kcal,
        steps_kcal,
      });
    },
  );

  // -------- GET /v1/signals/day-kcal-in ------------------------------------
  app.get(
    "/v1/signals/day-kcal-in",
    {
      schema: {
        querystring: z
          .object({
            date: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .optional(),
          })
          .strict(),
        response: { 200: DayKcalInResponseSchema },
      },
    },
    async (req) => {
      const user = requireUser(app.db, req);
      const userId = user.id;
      const date = req.query.date ?? currentUserDate(new Date(), user.timezone);
      // Day buckets run against the user-TZ window (DAY_START_HOUR rollover),
      // so an evening log that crosses UTC midnight stays on its local day.
      const { startUtc, endUtc } = userDayWindow(date, user.timezone);
      const startIso = startUtc.toISOString();
      const endIso = endUtc.toISOString();
      const meals = app.db
        .prepare(
          `SELECT eaten_at, kcal FROM meals
           WHERE user_id = ? AND eaten_at >= ? AND eaten_at < ?`,
        )
        .all(userId, startIso, endIso) as Array<{ eaten_at: string; kcal: number }>;
      const alcoholSessions = app.db
        .prepare(
          `SELECT started_at, est_kcal FROM alcohol_sessions
           WHERE user_id = ? AND started_at >= ? AND started_at < ?`,
        )
        .all(userId, startIso, endIso) as Array<{ started_at: string; est_kcal: number }>;
      return computeDayKcalIn({ date, meals, alcoholSessions });
    },
  );

  // GET /v1/signals/day-status — glanceable summary + threshold-driven
  // nudges (missing meals, no workouts in N days, stale weight log, etc.).
  // All logic in core/signals/day-status.ts; this route is a thin wrapper.
  app.get(
    "/v1/signals/day-status",
    { schema: { response: { 200: DayStatusResponseSchema } } },
    async (req) => {
      const userId = requireUserId(req);
      return computeDayStatus(app.db, userId);
    },
  );

  // GET /v1/signals/next-best-action — the single highest-priority action
  // for the user right now (onboarding → yesterday's gaps → today's nudges).
  // All logic in core/signals/next-best-action.ts; this route is a thin wrapper.
  app.get(
    "/v1/signals/next-best-action",
    { schema: { response: { 200: NextBestActionResponseSchema } } },
    async (req) => {
      const userId = requireUserId(req);
      return computeNextBestAction(app.db, userId);
    },
  );
};
