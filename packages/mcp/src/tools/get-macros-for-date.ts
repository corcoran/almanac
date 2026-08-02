import { z } from "zod";
import { statusPhrase } from "../format.js";
import type { Tool, ToolDeps } from "../tool.js";

export const GetMacrosForDateInputSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("YYYY-MM-DD. Interpreted in the user's profile timezone."),
});
export type GetMacrosForDateInput = z.infer<typeof GetMacrosForDateInputSchema>;

/**
 * The /api/v1/signals/macros response shape we care about for the summary line.
 * Mirrors `DayMacrosResponseSchema` in core/schemas/signals.ts — kept loose so
 * unrelated additions to that schema don't break this tool.
 */
type DayMacrosResponse = {
  date: string;
  day_totals: { kcal: number; protein_g: number; carb_g: number; fat_g: number };
  day_target: {
    target: { kcal: number; protein_g: number; carb_g: number; fat_g: number };
    observed: { status: "on_track" | "at_risk" | "off_track" } | null;
  } | null;
};

export function makeGetMacrosForDateTool(deps: ToolDeps): Tool<GetMacrosForDateInput> {
  const { api } = deps;
  return {
    name: "get_macros_for_date",
    description:
      "Get macro totals (kcal, protein, carb, fat) and the active phase's daily target snapshot for a specific user-day. Returns `{ date, day_totals, day_target, summary }` where `day_target` is the structured `{ target, maintenance, intake, observed }` block (static `target` = phase anchor; `observed` = today's projected expenditure — phase anchor adjusted for that day's activity — deltas, and on/off/at-risk verdict). `day_target` is `null` for days when no nutrition phase was active. The `summary` field is a one-line glanceable string that includes the on/off/at-risk verdict when a phase is active. The day boundary respects the user's profile timezone — a 1am snack belongs to the previous day, a 5am breakfast to the new day. Use for any non-today query (yesterday, week-ago, audit of backfilled meals). Pair with `get_macros_range` for week or month rollups.",
    inputSchema: GetMacrosForDateInputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      const body = await api.request<DayMacrosResponse>(
        "GET",
        `/api/v1/signals/macros?date=${input.date}`,
        undefined,
        { bearer: deps.currentToken() },
      );
      const { date, day_totals, day_target } = body;
      let summary: string;
      if (day_target == null) {
        summary = `${date}: ${day_totals.kcal} kcal in, ${day_totals.protein_g}p / ${day_totals.carb_g}c / ${day_totals.fat_g}f — no nutrition phase active for this date.`;
      } else {
        const pct = Math.round((day_totals.kcal / day_target.target.kcal) * 100);
        const phrase = day_target.observed ? ` — ${statusPhrase(day_target.observed.status)}` : "";
        summary = `${date}: ${day_totals.kcal}/${day_target.target.kcal} kcal (${pct}%)${phrase}, ${day_totals.protein_g}p / ${day_totals.carb_g}c / ${day_totals.fat_g}f (target ${day_target.target.protein_g}p / ${day_target.target.carb_g}c / ${day_target.target.fat_g}f)`;
      }
      return { ...body, summary };
    },
  };
}
