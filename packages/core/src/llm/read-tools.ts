import type { Connection } from "../db/connection.js";
import { addDaysIso, currentUserDate, userDayWindow } from "../domain/user-day.js";
import { listAlcoholSessions } from "../repos/alcohol.repo.js";
import { listBodyWeights } from "../repos/body-weights.repo.js";
import { listCardioSessions } from "../repos/cardio.repo.js";
import { listExercises } from "../repos/exercises.repo.js";
import { listMeals } from "../repos/meals.repo.js";
import { listPhases } from "../repos/nutrition-phases.repo.js";
import { listSleepLogs } from "../repos/sleep.repo.js";
import { listStepLogs } from "../repos/step-logs.repo.js";
import { listStoredMeals } from "../repos/stored-meals.repo.js";
import { listUntrackedPeriods } from "../repos/untracked-periods.repo.js";
import { findUserById } from "../repos/users.repo.js";
import { listTemplates } from "../repos/workout-templates.repo.js";
import {
  findWorkoutByIdForUser,
  listWorkoutsInRange,
  listWorkoutsWithDetail,
} from "../repos/workouts.repo.js";
import { getAccomplishmentHistory, getRecentAccomplishments } from "../signals/accomplishments.js";
import { computeDayStatus } from "../signals/day-status.js";
import { recommendTemplateForUser, summarizeTrainingHistory } from "../signals/index.js";
import { computeDailyTargetForDate, computeTdeeForUser } from "../signals/inputs.js";
import { computeNextBestAction } from "../signals/next-best-action.js";
import { assembleReport } from "../signals/report.js";
import { buildReportMarkdown } from "../signals/report-markdown.js";
import { computeTrendWeight } from "../signals/trend-weight.js";
import type { AgentTool, ToolOutcome } from "./run-agent.js";

/** Hard upper bound on a get_macros_range window so a wide request can't blow up the loop. */
export const MAX_MACROS_RANGE_DAYS = 90;
/** Default look-back window for the weight trend when the model omits from_days_ago. */
const DEFAULT_TREND_DAYS = 90;
/**
 * `listBodyWeights` hard-caps at 200 rows (one row/day), so the trend can only ever
 * cover ~200 days. Clamp the look-back to this so a larger `from_days_ago` can't make
 * `computeTrendWeight` re-anchor its EWMA late on a silently-truncated window.
 */
const MAX_TREND_READINGS = 200;

/**
 * The per-request context every read-tool handler is scoped to. `userId` is the
 * AUTHENTICATED user — handlers NEVER take a user id from model input (the IDOR
 * guard). `now`/`tz` resolve "today" and user-day windows deterministically.
 */
export type ReadToolCtx = {
  db: Connection;
  userId: number;
  tz: string;
  now: Date;
};

/**
 * A read-only chat tool: its API `definition` (what the model sees) bound to a
 * `handler` factory (what runs when the model calls it). Binding them in one
 * object means they can't drift apart — you can't add a definition and forget
 * the dispatch branch. A handler returns `{ kind: "continue", toolResult }` so
 * the model reads the data and answers in prose; read tools are never terminal.
 */
export type ReadTool = {
  definition: AgentTool;
  handler: (ctx: ReadToolCtx) => (input: unknown) => ToolOutcome<string>;
};

/**
 * Compose a selected set of read tools into the pieces an agent needs:
 * `definitions` (pass to runAgent's `tools`) and a single `dispatch` that routes
 * a tool call by name to its handler. The whole dispatch is try/caught so a tool
 * can never throw out of the agent loop; an unknown name returns a continue
 * carrying an error the model can read.
 */
export function buildReadDispatch(
  tools: ReadTool[],
  ctx: ReadToolCtx,
): {
  definitions: AgentTool[];
  dispatch: (name: string, input: unknown) => ToolOutcome<string>;
} {
  // Tool names are assumed unique within a catalog subset (it's a hand-curated
  // constant). On a name collision the last entry wins the handler — keep the
  // catalog free of duplicates.
  const handlers = new Map<string, (input: unknown) => ToolOutcome<string>>();
  for (const t of tools) handlers.set(t.definition.name, t.handler(ctx));

  return {
    definitions: tools.map((t) => t.definition),
    dispatch: (name, input) => {
      try {
        const handler = handlers.get(name);
        if (handler === undefined) {
          return { kind: "continue", toolResult: { error: `unknown tool: ${name}` } };
        }
        return handler(input);
      } catch (e) {
        return { kind: "continue", toolResult: { error: String(e) } };
      }
    },
  };
}

/**
 * The full data overview (today's context, the 14-day macros grid, the active
 * phase) for a SPECIFIC day — rendered markdown. Scoped to the authenticated user.
 */
export const getReportTool: ReadTool = {
  definition: {
    name: "get_report",
    description:
      "The full data overview (today's context, the 14-day macros grid, the active " +
      "phase) for a SPECIFIC day. Use when continuing a PAST conversation about that " +
      "day's numbers, or to re-ground a long conversation. NOT needed for today — " +
      "today's overview is already embedded in the prompt. Pass `date` (YYYY-MM-DD) " +
      "for a past day; omit it for today. Returns rendered markdown.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD; omit for today." },
      },
    },
  },
  handler:
    ({ db, userId, tz, now }) =>
    (input) => {
      const date = (input as { date?: string }).date;
      const ymd = /^\d{4}-\d{2}-\d{2}$/;
      if (date !== undefined && !ymd.test(date)) {
        return { kind: "continue", toolResult: { error: "date must be YYYY-MM-DD" } };
      }
      // Use startUtc (date @ 4am local — INSIDE the target user-day), not endUtc
      // (the EXCLUSIVE upper bound, which is the next user-day's first instant).
      // assembleReport derives the report day via currentUserDate(asOf, tz), so
      // endUtc would bucket the report onto date+1. See user-day.ts.
      const asOf = date ? userDayWindow(date, tz).startUtc : now;
      return {
        kind: "continue",
        toolResult: buildReportMarkdown(assembleReport(db, userId, asOf)),
      };
    },
};

/**
 * The user's exponentially-weighted body-weight trend series (raw + smoothed).
 * Scoped to the authenticated user.
 */
export const getWeightTrendTool: ReadTool = {
  definition: {
    name: "get_weight_trend",
    description:
      "The user's exponentially-weighted body-weight trend series (raw + smoothed). " +
      "Use ONLY when the question is about weight TRAJECTORY over time — the overview " +
      "already has the current weight and recent change. Returns an array of " +
      "{ date, raw_kg, trend_kg } points. The trend covers up to ~200 days back.",
    input_schema: {
      type: "object",
      properties: {
        from_days_ago: {
          type: "integer",
          description: "How many days back to start the series (default 90).",
        },
      },
    },
  },
  handler:
    ({ db, userId, tz, now }) =>
    (input) => {
      const raw = (input as { from_days_ago?: number }).from_days_ago;
      const requested = typeof raw === "number" && raw > 0 ? raw : DEFAULT_TREND_DAYS;
      // Clamp to the readings cap: >200 days back can't return more than 200 rows
      // (one row/day), so a larger lookback would silently truncate. Make it honest.
      const daysAgo = Math.min(requested, MAX_TREND_READINGS);
      const today = currentUserDate(now, tz);
      const from = addDaysIso(today, -daysAgo);
      // listBodyWeights returns rows with measured_on + weight_kg, which is
      // exactly the Reading shape computeTrendWeight expects. A generous limit
      // (one row per day at most) keeps the whole window in scope.
      const readings = listBodyWeights(db, userId, { from, limit: MAX_TREND_READINGS }).map(
        (r) => ({
          measured_on: r.measured_on,
          weight_kg: r.weight_kg,
        }),
      );
      return { kind: "continue", toolResult: computeTrendWeight(readings) };
    },
};

/**
 * All of the user's nutrition phases, past and present (newest first). Scoped to
 * the authenticated user.
 */
export const getPhaseHistoryTool: ReadTool = {
  definition: {
    name: "get_phase_history",
    description:
      "All of the user's nutrition phases, past and present (newest first). Use for " +
      "'how does this phase compare to my last one' questions — the overview only " +
      "contains the ACTIVE phase. Takes no arguments.",
    input_schema: { type: "object", properties: {} },
  },
  handler:
    ({ db, userId }) =>
    () => {
      return { kind: "continue", toolResult: listPhases(db, userId) };
    },
};

/**
 * Day-by-day macro totals + targets for an explicit date window. Scoped to the
 * authenticated user.
 */
export const getMacrosRangeTool: ReadTool = {
  definition: {
    name: "get_macros_range",
    description:
      "Day-by-day macro totals + targets for an explicit date window. Use ONLY for " +
      "windows OLDER than the last 14 days — the overview already covers the recent " +
      "14-day grid. Range is bounded to 90 days. Dates are YYYY-MM-DD.",
    input_schema: {
      type: "object",
      properties: {
        from_date: { type: "string", description: "YYYY-MM-DD inclusive start." },
        to_date: { type: "string", description: "YYYY-MM-DD inclusive end." },
      },
      required: ["from_date", "to_date"],
    },
  },
  handler:
    ({ db, userId, tz }) =>
    (input) => {
      const { from_date, to_date } = input as { from_date?: string; to_date?: string };
      if (!from_date || !to_date) {
        return { kind: "continue", toolResult: { error: "from_date and to_date are required" } };
      }
      const ymd = /^\d{4}-\d{2}-\d{2}$/;
      if (!ymd.test(from_date) || !ymd.test(to_date)) {
        return {
          kind: "continue",
          toolResult: { error: "from_date and to_date must be YYYY-MM-DD" },
        };
      }
      const days: Array<{
        date: string;
        day_totals: unknown;
        day_target: unknown;
        meals_logged: boolean;
      }> = [];
      // O(days × ~6 SQLite queries) — computeDailyTargetForDate runs several reads per
      // day. Don't raise MAX_MACROS_RANGE_DAYS without weighing that multiplier.
      let lastDate = from_date;
      for (
        let d = from_date;
        d <= to_date && days.length < MAX_MACROS_RANGE_DAYS;
        d = addDaysIso(d, 1)
      ) {
        const dt = computeDailyTargetForDate(db, userId, tz, d);
        days.push({
          date: d,
          day_totals: dt.totals,
          day_target: dt.kind === "ready" ? dt.dayTarget : null,
          // Without this, a zero-kcal day is indistinguishable from one the
          // user never logged.
          meals_logged: dt.mealCount > 0,
        });
        lastDate = d;
      }
      // Signal when the cap clipped a still-larger requested range, so the model
      // knows the window is incomplete rather than silently short.
      if (days.length === MAX_MACROS_RANGE_DAYS && lastDate < to_date) {
        return { kind: "continue", toolResult: { days, truncated: true } };
      }
      return { kind: "continue", toolResult: { days } };
    },
};

/**
 * The individual meals the user logged on a day (today by default, or any past
 * day). Scoped to the authenticated user. The meal-by-meal breakdown a daily
 * total can't give.
 */
export const listMealsForDayTool: ReadTool = {
  definition: {
    name: "list_meals_for_day",
    description:
      "The individual meals the user logged on a day, with name + macros + time. " +
      "Today's meals are already in the overview; use this for a past day. " +
      "Use when the user asks what they ate, or to break a day's intake into its meals. " +
      "`date` is YYYY-MM-DD for a past day (omitting it returns today, which the overview already has). Returns an array of " +
      "{ eaten_at, name, kcal, protein_g, carb_g, fat_g }.",
    input_schema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description:
            "YYYY-MM-DD for a past day (omitting it returns today, which the overview already has).",
        },
      },
    },
  },
  handler:
    ({ db, userId, tz, now }) =>
    (input) => {
      const date = (input as { date?: string }).date;
      const ymd = /^\d{4}-\d{2}-\d{2}$/;
      if (date !== undefined && !ymd.test(date)) {
        return { kind: "continue", toolResult: { error: "date must be YYYY-MM-DD" } };
      }
      const day = date ?? currentUserDate(now, tz);
      const { startUtc, endUtc } = userDayWindow(day, tz);
      const meals = listMeals(db, userId, {
        from: startUtc.toISOString(),
        to: endUtc.toISOString(),
        limit: 200,
      }).map((m) => ({
        eaten_at: m.eaten_at,
        name: m.name,
        kcal: m.kcal,
        protein_g: m.protein_g,
        carb_g: m.carb_g,
        fat_g: m.fat_g,
      }));
      return { kind: "continue", toolResult: meals };
    },
};

/**
 * The user's saved-meal library (reusable meals/recipes with macros). Scoped to
 * the authenticated user.
 */
export const listStoredMealsTool: ReadTool = {
  definition: {
    name: "list_stored_meals",
    description:
      "The user's saved meal library with macros. The overview does NOT include it. Takes no " +
      "arguments. Each item has `days_eaten_14d` (how many of the 14 days before today a meal " +
      "with this name was logged), `last_eaten_on` (most recent such day) and `eaten_today`. " +
      "A meal eaten on most recent days up to yesterday and not yet today is a habit worth " +
      "asking about. One eaten in a burst that then stopped is likely used up. Recent use " +
      "never shows what's on hand.",
    input_schema: { type: "object", properties: {} },
  },
  handler:
    ({ db, userId, tz, now }) =>
    () => {
      const today = currentUserDate(now, tz);
      const eaten = listMeals(db, userId, {
        from: userDayWindow(addDaysIso(today, -14), tz).startUtc.toISOString(),
        to: userDayWindow(today, tz).endUtc.toISOString(),
        limit: 200,
      });
      const usage = new Map<string, { days: Set<string>; today: boolean }>();
      for (const m of eaten) {
        if (m.name === null) continue;
        const key = m.name.trim().toLowerCase();
        const entry = usage.get(key) ?? { days: new Set<string>(), today: false };
        const day = currentUserDate(new Date(m.eaten_at), tz);
        if (day === today) entry.today = true;
        else entry.days.add(day);
        usage.set(key, entry);
      }
      const meals = listStoredMeals(db, userId).map((m) => {
        const entry = usage.get(m.name.trim().toLowerCase());
        const days = entry ? [...entry.days].sort() : [];
        return {
          id: m.id,
          name: m.name,
          kcal: m.kcal,
          protein_g: m.protein_g,
          carb_g: m.carb_g,
          fat_g: m.fat_g,
          description: m.description,
          days_eaten_14d: days.length,
          last_eaten_on: days.at(-1) ?? null,
          eaten_today: entry?.today ?? false,
        };
      });
      return { kind: "continue", toolResult: meals };
    },
};

/**
 * Ranked workout recommendation based on muscle-group recovery state. Scoped to
 * the authenticated user.
 */
export const getWorkoutRecommendationTool: ReadTool = {
  definition: {
    name: "get_workout_recommendation",
    description:
      "Which workout should the user train next? Returns, per workout split/template, " +
      "which MUSCLE GROUPS are recovered/prime vs. trained-too-recently (too_soon) vs. " +
      "overdue, plus a ranked recommendation and a `confidence`. Call this to ground ANY " +
      "claim about workout recovery or what to train — you have NO other source of " +
      "muscle-recovery data, so never guess which muscles are fresh or fatigued. " +
      "Each item: { template_name, score, confidence ('actionable'|'low'), " +
      "avg_recovery_hours, reasoning: { prime_groups_hit, in_window_groups_hit, " +
      "too_soon_groups_hit, neutral_groups_hit, overdue_groups_hit } }. When the top " +
      "pick is confidence:'low' (returning from a layoff — everything overdue/untrained), " +
      "do NOT present it as 'train this today'; any split is fine.",
    input_schema: {
      type: "object",
      properties: {
        top_n: {
          type: "integer",
          description: "How many ranked recommendations to return (1-10, default 1).",
        },
      },
    },
  },
  handler:
    ({ db, userId, now }) =>
    (input) => {
      const raw = (input as { top_n?: number }).top_n;
      const topN = typeof raw === "number" && raw >= 1 && raw <= 10 ? Math.trunc(raw) : 1;
      return {
        kind: "continue",
        toolResult: recommendTemplateForUser(db, userId, now, { topN }),
      };
    },
};

/**
 * Per-session exercise detail for a specific day: exercises, sets, reps,
 * weights, RPE, and duration. Scoped to the authenticated user.
 */
export const getWorkoutForDayTool: ReadTool = {
  definition: {
    name: "get_workout_for_day",
    description:
      "The exercises, sets, reps, weights, RPE, and duration of the workout(s) the user " +
      "logged on a day — the per-session detail the overview does NOT contain (it only has " +
      "session counts). Use when the user asks how a specific session went, or what they " +
      "did/lifted. Omit `date` for today; pass `date` (YYYY-MM-DD) for a past day. Returns " +
      "an array of { template_name, started_at, duration_min, rpe, est_kcal, exercises: " +
      "[{ name, skipped, sets: [{ reps, weight_kg }] }] }. If a value (e.g. duration) is " +
      "null, it was not logged — do NOT guess it.",
    input_schema: {
      type: "object",
      properties: { date: { type: "string", description: "YYYY-MM-DD; omit for today." } },
    },
  },
  handler:
    ({ db, userId, tz, now }) =>
    (input) => {
      const date = (input as { date?: string }).date;
      const ymd = /^\d{4}-\d{2}-\d{2}$/;
      if (date !== undefined && !ymd.test(date)) {
        return { kind: "continue", toolResult: { error: "date must be YYYY-MM-DD" } };
      }
      const day = date ?? currentUserDate(now, tz);
      const { startUtc, endUtc } = userDayWindow(day, tz);
      const exerciseName = new Map(
        listExercises(db, userId, { includeArchived: true }).map((e) => [e.id, e.name]),
      );
      const templateName = new Map(
        listTemplates(db, userId, { includeArchived: true }).map((t) => [t.id, t.name]),
      );
      const sessions = listWorkoutsWithDetail(db, userId, {
        from: startUtc.toISOString(),
        to: endUtc.toISOString(),
        limit: 50,
      }).map((w) => ({
        template_name: w.template_id != null ? (templateName.get(w.template_id) ?? null) : null,
        started_at: w.started_at,
        duration_min: w.duration_min,
        rpe: w.rpe,
        est_kcal: w.est_kcal,
        exercises: (w.exercises ?? []).map((ei) => ({
          name: exerciseName.get(ei.exercise_id) ?? `exercise ${ei.exercise_id}`,
          skipped: ei.skipped_at != null,
          sets: (ei.sets ?? []).map((s) => ({ reps: s.reps, weight_kg: s.weight_kg })),
        })),
      }));
      return { kind: "continue", toolResult: sessions };
    },
};

/**
 * Pre-analyzed training-pattern summary for the last N days. Covers per-split
 * session counts, RPE trends, template-deviation rates, load progression, and
 * frequency imbalances. Scoped to the authenticated user.
 */
export const getTrainingHistoryTool: ReadTool = {
  definition: {
    name: "get_training_history",
    description:
      "A pre-analyzed ~2-week TRAINING-PATTERN read — use this for workout INSIGHT, not " +
      "for recovery state (that's get_workout_recommendation). Per workout split: session " +
      "count, last trained, average RPE and whether RPE is drifting up/down vs the user's " +
      "own baseline, template-deviation rate (skipped exercises) + a notable deviation, plus " +
      "load progression (which main lifts are climbing/stalled/dropping) and a frequency " +
      "imbalance note. Surface the NON-OBVIOUS findings here (an RPE creep, a lagging split, " +
      "a stalling lift) — do not just restate what the user obviously did. Input: optional " +
      "`days` (1-35, default 14).",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "integer", description: "Window size in days (1-35, default 14)." },
      },
    },
  },
  handler:
    ({ db, userId, tz, now }) =>
    (input) => {
      const raw = (input as { days?: number }).days;
      const days = typeof raw === "number" && raw >= 1 && raw <= 35 ? Math.trunc(raw) : 14;
      return {
        kind: "continue",
        toolResult: summarizeTrainingHistory(db, userId, now, tz, { days }),
      };
    },
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Inclusive user-local [from, to] dates from optional input, defaulting to the last `days` days. */
function resolveDays(
  input: unknown,
  ctx: ReadToolCtx,
  defaultDays: number,
): { from: string; to: string } | { error: string } {
  const i = (input ?? {}) as { from_date?: unknown; to_date?: unknown };
  const today = currentUserDate(ctx.now, ctx.tz);
  const from = i.from_date ?? addDaysIso(today, -(defaultDays - 1));
  const to = i.to_date ?? today;
  if (
    typeof from !== "string" ||
    !DATE_RE.test(from) ||
    typeof to !== "string" ||
    !DATE_RE.test(to)
  ) {
    return { error: "from_date and to_date must be YYYY-MM-DD" };
  }
  return { from, to };
}

const DATE_RANGE_SCHEMA = {
  type: "object",
  properties: {
    from_date: {
      type: "string",
      description: "YYYY-MM-DD inclusive (default: 13 days ago, so the range is the last 14 days).",
    },
    to_date: { type: "string", description: "YYYY-MM-DD inclusive (default: today)." },
  },
};

function instantRange(r: { from: string; to: string }, tz: string): { from: string; to: string } {
  return {
    from: userDayWindow(r.from, tz).startUtc.toISOString(),
    to: userDayWindow(r.to, tz).endUtc.toISOString(),
  };
}

export const getSleepRecentTool: ReadTool = {
  definition: {
    name: "get_sleep_recent",
    description:
      "Nightly sleep logs (hours, quality 1-5, notes) for a date range. The overview only has " +
      "the weekly average and sleep debt; use this for night-by-night patterns.",
    input_schema: DATE_RANGE_SCHEMA,
  },
  handler: (ctx) => (input) => {
    const r = resolveDays(input, ctx, 14);
    if ("error" in r) return { kind: "continue", toolResult: r };
    const logs = listSleepLogs(ctx.db, ctx.userId, {
      from: r.from,
      to: addDaysIso(r.to, 1),
      limit: 200,
    });
    return { kind: "continue", toolResult: logs };
  },
};

export const getStepsRecentTool: ReadTool = {
  definition: {
    name: "get_steps_recent",
    description: "Daily step counts for a date range.",
    input_schema: DATE_RANGE_SCHEMA,
  },
  handler: (ctx) => (input) => {
    const r = resolveDays(input, ctx, 14);
    if ("error" in r) return { kind: "continue", toolResult: r };
    const logs = listStepLogs(ctx.db, ctx.userId, {
      from: r.from,
      to: addDaysIso(r.to, 1),
      limit: 200,
    });
    return { kind: "continue", toolResult: logs };
  },
};

export const getCardioRecentTool: ReadTool = {
  definition: {
    name: "get_cardio_recent",
    description:
      "Individual cardio sessions (type, duration, distance, avg heart rate, est kcal) for a date " +
      "range. The overview only has weekly totals.",
    input_schema: DATE_RANGE_SCHEMA,
  },
  handler: (ctx) => (input) => {
    const r = resolveDays(input, ctx, 14);
    if ("error" in r) return { kind: "continue", toolResult: r };
    const sessions = listCardioSessions(ctx.db, ctx.userId, {
      ...instantRange(r, ctx.tz),
      limit: 200,
    });
    return { kind: "continue", toolResult: sessions };
  },
};

export const getAlcoholRecentTool: ReadTool = {
  definition: {
    name: "get_alcohol_recent",
    description:
      "Individual drinking sessions (drinks, est kcal, time) for a date range. The overview only " +
      "has weekly drink counts.",
    input_schema: DATE_RANGE_SCHEMA,
  },
  handler: (ctx) => (input) => {
    const r = resolveDays(input, ctx, 14);
    if ("error" in r) return { kind: "continue", toolResult: r };
    const sessions = listAlcoholSessions(ctx.db, ctx.userId, {
      ...instantRange(r, ctx.tz),
      limit: 200,
    });
    return { kind: "continue", toolResult: sessions };
  },
};

export const getRecentWorkoutsTool: ReadTool = {
  definition: {
    name: "get_recent_workouts",
    description:
      "Workout sessions in a date range (template, start/end, notes). Pass `id` instead to get " +
      "one session in full (exercises, sets, reps, weight, RPE).",
    input_schema: {
      type: "object",
      properties: {
        ...DATE_RANGE_SCHEMA.properties,
        id: { type: "integer", description: "A workout id from a previous call." },
      },
    },
  },
  handler: (ctx) => (input) => {
    const id = (input as { id?: unknown } | null)?.id;
    if (typeof id === "number") {
      const w = findWorkoutByIdForUser(ctx.db, ctx.userId, id);
      return { kind: "continue", toolResult: w ?? { error: `workout ${id} not found` } };
    }
    const r = resolveDays(input, ctx, 14);
    if ("error" in r) return { kind: "continue", toolResult: r };
    const workouts = listWorkoutsInRange(ctx.db, ctx.userId, {
      ...instantRange(r, ctx.tz),
      limit: 200,
    });
    return { kind: "continue", toolResult: workouts };
  },
};

export const listUntrackedPeriodsTool: ReadTool = {
  definition: {
    name: "list_untracked_periods",
    description:
      "Periods the user marked as not tracked (vacation, illness). Days inside them are excluded " +
      "from averages and TDEE. Check this before reading a gap in logging as lapsed tracking.",
    input_schema: {
      type: "object",
      properties: {
        from_date: {
          type: "string",
          description:
            "YYYY-MM-DD inclusive (default: 89 days ago, so the range is the last 90 days).",
        },
        to_date: { type: "string", description: "YYYY-MM-DD inclusive (default: today)." },
      },
    },
  },
  handler: (ctx) => (input) => {
    const r = resolveDays(input, ctx, 90);
    if ("error" in r) return { kind: "continue", toolResult: r };
    return { kind: "continue", toolResult: listUntrackedPeriods(ctx.db, ctx.userId, r) };
  },
};

export const listWorkoutTemplatesTool: ReadTool = {
  definition: {
    name: "list_workout_templates",
    description:
      "The user's active workout templates with each exercise's prescription (sets, reps, " +
      "default weight in kg, notes) in order. Use when reviewing or suggesting changes to a program.",
    input_schema: { type: "object", properties: {} },
  },
  handler: (ctx) => () => {
    const names = new Map(
      listExercises(ctx.db, ctx.userId, { includeArchived: true }).map((e) => [e.id, e.name]),
    );
    const templates = listTemplates(ctx.db, ctx.userId).map((t) => ({
      id: t.id,
      name: t.name,
      notes: t.notes,
      exercises: (t.items ?? []).map((it) => ({
        exercise: names.get(it.exercise_id) ?? `exercise ${it.exercise_id}`,
        sets: it.default_sets,
        reps: it.default_reps,
        weight_kg: it.default_weight_kg,
        notes: it.notes,
      })),
    }));
    return { kind: "continue", toolResult: templates };
  },
};

/** The caller's profile, minus email and account flags. */
export const getUserProfileTool: ReadTool = {
  definition: {
    name: "get_user_profile",
    description:
      "The user's profile: name, date of birth, height, sex, unit system, timezone, activity level. " +
      "Use for age/sex/bodyweight-relative comparisons. Weights from tools are kg; speak in the " +
      "user's unit system.",
    input_schema: { type: "object", properties: {} },
  },
  handler: (ctx) => () => {
    const u = findUserById(ctx.db, ctx.userId);
    if (!u) return { kind: "continue", toolResult: { error: "profile not found" } };
    const { name, dob, height_cm, sex, preferred_unit_system, timezone, activity_level } = u;
    return {
      kind: "continue",
      toolResult: { name, dob, height_cm, sex, preferred_unit_system, timezone, activity_level },
    };
  },
};

export const getTdeeTool: ReadTool = {
  definition: {
    name: "get_tdee",
    description:
      "The current calculated TDEE with its basis (profile_baseline while calibrating, " +
      "measured_intake once enough weigh-ins and meal days exist) and the inputs behind it.",
    input_schema: { type: "object", properties: {} },
  },
  handler: (ctx) => () => ({
    kind: "continue",
    toolResult: computeTdeeForUser(ctx.db, ctx.userId, ctx.now),
  }),
};

export const getDayStatusTool: ReadTool = {
  definition: {
    name: "get_day_status",
    description:
      "Today's status against target plus the nudges the app is currently showing and its next " +
      "best action. Use to know what the dashboard is already telling the user.",
    input_schema: { type: "object", properties: {} },
  },
  handler: (ctx) => () => ({
    kind: "continue",
    toolResult: {
      day_status: computeDayStatus(ctx.db, ctx.userId, ctx.now),
      next_best_action: computeNextBestAction(ctx.db, ctx.userId, ctx.now),
    },
  }),
};

export const getAccomplishmentsTool: ReadTool = {
  definition: {
    name: "get_accomplishments",
    description:
      "The user's wins: recent accomplishments (last 7 days) and the full history with totals. " +
      "Weights inside are kg.",
    input_schema: { type: "object", properties: {} },
  },
  handler: (ctx) => () => ({
    kind: "continue",
    toolResult: {
      recent: getRecentAccomplishments(ctx.db, ctx.userId, ctx.now),
      history: getAccomplishmentHistory(ctx.db, ctx.userId, ctx.now),
    },
  }),
};
