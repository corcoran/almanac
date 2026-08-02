import { z } from "zod";
import { IsoDateSchema } from "./common.js";
import { DayMacrosResponseSchema, TodayContextResponseSchema } from "./signals.js";

/**
 * A 14-day-history row for the report: the shared per-day macros shape plus two
 * report-only fields.
 *
 * - `meals_logged` separates "logged 0 kcal" from "didn't log" (the same
 *   distinction `today.meals_logged_today` makes), so an unlogged day renders as
 *   "not logged" rather than a real 0-kcal deficit.
 * - `workout_name` is the template name of a workout done that user-local day
 *   (e.g. "LEGS"), or null if none — lets the daily table mirror the dashboard
 *   calendar's per-day "what did I train" so an LLM can correlate intake with
 *   training. Plain ad-hoc workouts (no template) surface as "—" at render time.
 *
 * Everything else the table renders (carb_g/fat_g, kcal_from_alcohol,
 * observed.cardio_kcal/workout_kcal/steps_kcal, observed.status) already lives in
 * the inherited `DayMacrosResponseSchema` shape.
 */
export const ReportHistoryDaySchema = DayMacrosResponseSchema.extend({
  meals_logged: z.boolean(),
  workout_name: z.string().nullable(),
});

export const ShareReportSchema = z.object({
  generated_for_date: IsoDateSchema,
  context: TodayContextResponseSchema,
  history_14d: z.array(ReportHistoryDaySchema),
  workouts: z.object({
    window_from: IsoDateSchema,
    window_label: z.enum(["phase", "last_14_days"]),
    total: z.number().int(),
    by_template: z.array(
      z.object({
        template_name: z.string().nullable(),
        count: z.number().int(),
      }),
    ),
  }),
});

export type ShareReport = z.infer<typeof ShareReportSchema>;
