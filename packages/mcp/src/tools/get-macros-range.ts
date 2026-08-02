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
      "Get day-by-day macro totals (kcal, protein, carb, fat) and per-day phase target snapshots across a date range. Returns `{ days: [{ date, day_totals, day_target, ... }] }` where each `day_target` is the structured `{ target, maintenance, intake, observed }` block (or `null` for days with no active phase). Use for week-to-date / month-to-date trend analysis. Range is bounded to 90 days; longer windows are rejected as 400. Date boundaries respect the user's profile timezone (a 1am snack belongs to the previous day). The optional `rolling_7d_avg_kcal_in` field in the response is computed by skipping null/no-phase and untracked (vacation/sick/deload) days so they don't dilute the average.",
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
      // Compose a 7-day rolling avg of kcal_in that intentionally skips days
      // with no active phase. Days without a target shouldn't dilute the
      // average — they're a different cohort (often zero-intake days where
      // the user wasn't tracking yet) and pulling them in would systematically
      // skew week-over-week comparisons during the cold-start period.
      const daysWithPhase = raw.days.filter((d) => d.day_target != null && !d.untracked);
      const rolling_7d_avg_kcal_in =
        daysWithPhase.length === 0
          ? null
          : daysWithPhase.slice(-7).reduce((s, d) => s + d.day_totals.kcal, 0) /
            Math.min(daysWithPhase.length, 7);
      return {
        ...raw,
        rolling_7d_avg_kcal_in,
      };
    },
  };
}
