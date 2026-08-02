import type { DayMacrosResponseSchema } from "@almanac/core/schemas";
import type { z } from "zod";

type DayMacros = z.infer<typeof DayMacrosResponseSchema>;

export type IntakeMonthSummary = {
  logged: number;
  on_target: number;
  off_track: number;
};

/**
 * Header-line counts for the intake calendar, scoped to the visible month.
 *
 * logged    = in-month days with kcal > 0, not untracked, not in the future
 *             (today counts once it has intake).
 * on_target / off_track = logged PAST days only — today's verdict isn't
 *             final, so it never contributes a status count (mirrors its
 *             cell carrying no status tint). at_risk days are deliberately
 *             not counted: three numbers keep the line scannable.
 */
export function summarizeIntakeMonth(
  days: DayMacros[],
  month: string,
  today: string,
): IntakeMonthSummary {
  let logged = 0;
  let on_target = 0;
  let off_track = 0;
  for (const d of days) {
    if (!d.date.startsWith(`${month}-`)) continue;
    if (d.date > today) continue;
    if (d.untracked || d.day_totals.kcal <= 0) continue;
    logged += 1;
    if (d.date === today) continue;
    const status = d.day_target?.observed.status;
    if (status === "on_track") on_target += 1;
    else if (status === "off_track") off_track += 1;
  }
  return { logged, on_target, off_track };
}
