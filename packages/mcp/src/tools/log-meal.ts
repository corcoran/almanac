import { z } from "zod";
import { idempotencyKey, summarizeMeal } from "../format.js";
import type { Tool, ToolDeps } from "../tool.js";

export const LogMealInputSchema = z.object({
  eaten_at: z
    .string()
    .describe(
      "ISO 8601 timestamp. Pass with offset (e.g. '2026-05-08T16:20:00-04:00') or `Z` for an explicit UTC instant; pass without offset (e.g. '2026-05-08T16:20:00') to have it interpreted in the user's profile timezone (set via `update_user_profile`).",
    ),
  name: z.string().optional().describe("e.g., 'breakfast', 'post-workout shake'"),
  kcal: z.number().int().nonnegative(),
  protein_g: z.number().nonnegative(),
  carb_g: z.number().nonnegative(),
  fat_g: z.number().nonnegative(),
  notes: z.string().optional(),
});

export type LogMealInput = z.infer<typeof LogMealInputSchema>;

export function makeLogMealTool(deps: ToolDeps): Tool<LogMealInput> {
  const { api, currentUserId } = deps;
  return {
    name: "log_meal",
    description:
      "Log a FOOD meal with macros. Use whenever the user describes something they ate. " +
      "Do NOT use this tool for alcohol — drinks belong in `log_alcohol`, which is the " +
      "canonical source for alcohol kcal. Logging a drink as a meal will double-count its " +
      "kcal in day totals.",
    inputSchema: LogMealInputSchema,
    annotations: {
      readOnlyHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      const userId = await currentUserId();
      const meal = await api.request<{
        id: number;
        eaten_at: string;
        kcal: number;
        protein_g: number;
        carb_g: number;
        fat_g: number;
      }>("POST", "/api/v1/meals", input, {
        bearer: deps.currentToken(),
        headers: { "idempotency-key": idempotencyKey("meal", userId, input) },
      });
      // Post-TDEE-refactor: day_target is the structured
      // { target, maintenance, intake, observed } block. summarizeMeal needs
      // the kcal target, sourced from `day_target.target.kcal`.
      const day = await api.request<{
        date: string;
        day_totals: { kcal: number; protein_g: number; carb_g: number; fat_g: number };
        day_target: {
          target: { kcal: number; protein_g: number; carb_g: number; fat_g: number };
          maintenance: { kcal: number };
          intake: { kcal: number; protein_g: number; carb_g: number; fat_g: number };
          observed: unknown;
        } | null;
      }>("GET", `/api/v1/signals/macros?at=${encodeURIComponent(meal.eaten_at)}`, undefined, {
        bearer: deps.currentToken(),
      });
      // No active phase → can't compute pct against a target. Fall back to a
      // shorter summary that reports the day total without the comparison.
      const target_kcal = day.day_target?.target.kcal ?? null;
      const summary =
        target_kcal != null
          ? summarizeMeal(meal, day.date, day.day_totals.kcal, target_kcal)
          : `Logged meal for ${day.date} — ${meal.kcal} kcal, ${meal.protein_g}p / ${meal.carb_g}c / ${meal.fat_g}f. ${day.date} total: ${day.day_totals.kcal} (no active nutrition phase).`;
      return {
        id: meal.id,
        day: day.date,
        summary,
        day_totals: day.day_totals,
        day_target: day.day_target,
      };
    },
  };
}
