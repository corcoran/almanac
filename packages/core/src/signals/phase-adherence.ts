import type { Connection } from "../db/connection.js";
import { addDaysIso } from "../domain/user-day.js";
import { getUntrackedDays } from "../repos/untracked-periods.repo.js";
import { computeDailyTargetForDate } from "./inputs.js";

/**
 * Phase-to-date adherence summary for the "On Target" box.
 *
 * `logged_days` (N) = days from phase start through `today` that are NOT
 * untracked AND have at least one meal logged. `on_track_days` (X) = how many of
 * those had daily-target status `on_track`. `avg_delta_kcal` = mean of
 * (intake − tdee_at_phase_start) over the logged days (negative = deficit),
 * rounded; `null` when there are no logged days or no TDEE anchor.
 *
 * The two halves cover different day sets on purpose: X/N includes the
 * in-progress day, the average does not (see the loop).
 *
 * The per-day status and intake come from `computeDailyTargetForDate`, the same
 * assembly the dashboard's daily target uses — so this aggregate can't drift
 * from the single-day number. The untracked-skip + no-meal-skip rules mirror the
 * `target_adherence_streak` detector exactly; the only difference is aggregation
 * (a miss here decrements the ratio rather than breaking a streak).
 */
export interface PhaseAdherence {
  logged_days: number;
  on_track_days: number;
  avg_delta_kcal: number | null;
}

export function computePhaseAdherence(
  db: Connection,
  userId: number,
  tz: string,
  phase: { started_on: string; tdee_at_phase_start: number | null },
  today: string,
): PhaseAdherence {
  const untracked = getUntrackedDays(db, userId, phase.started_on, today);
  const anchor = phase.tdee_at_phase_start;
  let loggedDays = 0;
  let onTrackDays = 0;
  let deltaSum = 0;
  let completedDays = 0;

  for (let cursor = phase.started_on; cursor <= today; cursor = addDaysIso(cursor, 1)) {
    if (untracked.has(cursor)) continue;
    const day = computeDailyTargetForDate(db, userId, tz, cursor);
    // Skip days with no active/ready phase or no intake — a zero-intake day
    // would falsely read as on_track on a cut (0 <= target + grace).
    if (day.kind !== "ready" || day.mealCount === 0) continue;
    loggedDays += 1;
    if (day.dayTarget.observed.status === "on_track") onTrackDays += 1;
    // The average covers COMPLETED days only. Today's intake is still partway
    // through being logged, so its delta reads as a far bigger deficit than the
    // user is running — at 9am every cut looks like a 2000/day deficit. The
    // X/N ratio deliberately still counts today: it degrades gracefully (an
    // under-target day is simply "no miss yet") and gives the box something
    // live to respond to as the day fills in.
    if (cursor === today) continue;
    completedDays += 1;
    if (anchor != null) deltaSum += day.totals.kcal - anchor;
  }

  const avg_delta_kcal =
    completedDays > 0 && anchor != null ? Math.round(deltaSum / completedDays) : null;

  return { logged_days: loggedDays, on_track_days: onTrackDays, avg_delta_kcal };
}
