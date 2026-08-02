import type { Connection } from "../db/connection.js";
import { addDaysIso, currentUserDate, userDayWindow } from "../domain/user-day.js";
import { findDailyNet } from "../repos/daily-net.repo.js";
import { findActivePhase } from "../repos/nutrition-phases.repo.js";
import { getUntrackedDays } from "../repos/untracked-periods.repo.js";
import { findUserById } from "../repos/users.repo.js";
import { listWorkoutsInRangeWithTemplateName } from "../repos/workouts.repo.js";
import type { ShareReport } from "../schemas/report.js";
import { computeDailyTargetForDate } from "./inputs.js";
import { getTodayContext } from "./today.js";

const HISTORY_DAYS = 14;

/**
 * Assemble the LLM-share report: today's full context, a 14-day per-day macros
 * grid, and a workout-window summary. The history grid mirrors the macros
 * route's `computeForDate`, with one deliberate difference: a `phase_incomplete`
 * day yields `day_target: null` here (it does NOT throw), so a half-set-up phase
 * can't blow up the whole report.
 */
export function assembleReport(
  db: Connection,
  userId: number,
  now: Date = new Date(),
): ShareReport {
  const user = findUserById(db, userId);
  if (!user) throw new Error(`user ${userId} not found`);
  const tz = user.timezone;

  const context = getTodayContext(db, userId, now);
  const today = context.today_date;
  const fromDate = addDaysIso(today, -(HISTORY_DAYS - 1));

  // Workout window: the active phase's span, else the trailing 14 days. Fetched
  // up front so we can both roll up by-template AND build a per-day "what did I
  // train" map for the history grid (mirrors the dashboard calendar).
  const phase = findActivePhase(db, userId);
  const windowLabel: "phase" | "last_14_days" = phase ? "phase" : "last_14_days";
  const windowFrom = phase ? phase.started_on : fromDate;
  const fromUtc = userDayWindow(windowFrom, tz).startUtc.toISOString();
  const toUtc = userDayWindow(today, tz).endUtc.toISOString();
  const rows = listWorkoutsInRangeWithTemplateName(db, userId, {
    from: fromUtc,
    to: toUtc,
    limit: 200,
  });

  // Per-day workout template name, bucketed to the user-local day (never UTC).
  // `rows` is ordered started_at DESC, so the first write per date wins → the
  // latest workout that day is the one surfaced if a day has more than one.
  const workoutNameByDate = new Map<string, string | null>();
  for (const w of rows) {
    const day = currentUserDate(new Date(w.started_at), tz);
    if (!workoutNameByDate.has(day)) workoutNameByDate.set(day, w.template_name);
  }

  // 14-day per-day grid (oldest → newest).
  const untracked = getUntrackedDays(db, userId, fromDate, today);
  const history_14d: ShareReport["history_14d"] = [];
  for (let i = 0; i < HISTORY_DAYS; i++) {
    const date = addDaysIso(fromDate, i);
    const dt = computeDailyTargetForDate(db, userId, tz, date);
    const net = findDailyNet(db, userId, date);
    history_14d.push({
      date,
      day_totals: dt.totals,
      day_target: dt.kind === "ready" ? dt.dayTarget : null,
      net_kcal: net?.net_kcal ?? null,
      untracked: untracked.has(date),
      // Distinguishes "logged 0 kcal" from "didn't log" — see ReportHistoryDaySchema.
      meals_logged: dt.mealCount > 0,
      // `undefined` (no workout that day) and an ad-hoc workout (null template)
      // both render as "—"; a named template surfaces by name.
      workout_name: workoutNameByDate.get(date) ?? null,
    });
  }

  const counts = new Map<string | null, number>();
  for (const w of rows) counts.set(w.template_name, (counts.get(w.template_name) ?? 0) + 1);
  const by_template = [...counts.entries()]
    .map(([template_name, count]) => ({ template_name, count }))
    .sort(
      (a, b) => b.count - a.count || (a.template_name ?? "").localeCompare(b.template_name ?? ""),
    );

  return {
    generated_for_date: today,
    context,
    history_14d,
    workouts: {
      window_from: windowFrom,
      window_label: windowLabel,
      total: rows.length,
      by_template,
    },
  };
}
