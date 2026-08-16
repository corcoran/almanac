import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const GetMacrosRangeInputSchema = z.object({
  from_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("Inclusive start date (YYYY-MM-DD). Interpreted in the user's profile timezone."),
  to_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("Inclusive end date (YYYY-MM-DD). Max 90 days from start."),
});
export type GetMacrosRangeInput = z.infer<typeof GetMacrosRangeInputSchema>;

export function makeGetMacrosRangeTool(deps: ToolDeps): Tool<GetMacrosRangeInput> {
  const { api } = deps;
  return {
    name: "get_macros_range",
    description:
      "Get day-by-day macro totals (kcal, protein, carb, fat) and per-day phase target snapshots across a date range. Returns `{ days: [{ date, day_totals, day_target, ... }] }` where each `day_target` is the structured `{ target, maintenance, intake, observed }` block (or `null` for days with no active phase). Use for week-to-date / month-to-date trend analysis. Range is bounded to 90 days; longer windows are rejected as 400. Date boundaries respect the user's profile timezone (a 1am snack belongs to the previous day). The response also carries `avg_kcal_in_over_range` (average kcal in, skipping no-phase and untracked vacation/sick/deload days) and `days_in_avg`, the number of days that average covers. It spans at most the 7 most recent qualifying days, and fewer on a shorter range — read `days_in_avg` before comparing it against a weekly figure.",
    inputSchema: GetMacrosRangeInputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      const raw = await api.request<{
        days: Array<{
          date: string;
          day_totals: {
            kcal: number;
            protein_g: number;
            carb_g: number;
            fat_g: number;
            kcal_from_food: number;
            kcal_from_alcohol: number;
          };
          day_target: unknown | null;
          untracked: boolean;
        }>;
      }>(
        "GET",
        `/api/v1/signals/macros?from_date=${input.from_date}&to_date=${input.to_date}`,
        undefined,
        { bearer: deps.currentToken() },
      );
      // Average kcal_in over the queried range, skipping days with no active
      // phase. Days without a target shouldn't dilute the average — they're a
      // different cohort (often zero-intake days where the user wasn't tracking
      // yet) and pulling them in would systematically skew week-over-week
      // comparisons during the cold-start period.
      //
      // Capped at the 7 most recent qualifying days: a 90-day query reports the
      // trailing week, not the quarter. A shorter range averages only the days
      // it has, so the field name says "range", not "7d" — a 3-day query
      // returning a 3-day mean under a `7d` label reads as a week and isn't.
      const daysWithPhase = raw.days.filter((d) => d.day_target != null && !d.untracked);
      const recent = daysWithPhase.slice(-7);
      const avg_kcal_in_over_range =
        recent.length === 0
          ? null
          : recent.reduce((s, d) => s + d.day_totals.kcal, 0) / recent.length;
      return {
        ...raw,
        avg_kcal_in_over_range,
        days_in_avg: recent.length,
      };
    },
  };
}
