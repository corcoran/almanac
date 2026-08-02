import { z } from "zod";
import { idempotencyKey, summarizeMeal } from "../format.js";
import type { Tool, ToolDeps } from "../tool.js";

export const LogMealFromStoredInputSchema = z.object({
  stored_meal_id: z
    .number()
    .int()
    .positive()
    .describe("ID of a saved meal (from list_stored_meals) to log as an eating event."),
  eaten_at: z
    .string()
    .describe(
      "ISO 8601 timestamp. Pass with offset (e.g. '2026-05-08T16:20:00-04:00') or `Z` for an explicit UTC instant; pass without offset (e.g. '2026-05-08T16:20:00') to have it interpreted in the user's profile timezone. If 'just now', pass the current local time.",
    ),
});

export type LogMealFromStoredInput = z.infer<typeof LogMealFromStoredInputSchema>;

export function makeLogMealFromStoredTool(deps: ToolDeps): Tool<LogMealFromStoredInput> {
  const { api, currentUserId } = deps;
  return {
    name: "log_meal_from_stored",
    description:
      "Log a meal the user has saved in their library (see `list_stored_meals`), copying its " +
      "name and macros verbatim into a new logged eating event at `eaten_at`. Use when the user " +
      "says 'log my usual breakfast' or similar. If today's portion differs from the saved one, " +
      "use `log_meal` directly (or define a new variant) — this tool copies exactly.",
    inputSchema: LogMealFromStoredInputSchema,
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    handler: async (input) => {
      const userId = await currentUserId();
      // 1) Fetch the saved definition (404 → surface a clear error).
      const stored = await api.request<{
        id: number;
        name: string;
        kcal: number;
        protein_g: number;
        carb_g: number;
        fat_g: number;
      }>("GET", `/api/v1/stored-meals/${input.stored_meal_id}`, undefined, {
        bearer: deps.currentToken(),
      });
      // 2) Copy its name + macros into a logged meal at the supplied eaten_at.
      const mealBody = {
        eaten_at: input.eaten_at,
        name: stored.name,
        kcal: stored.kcal,
        protein_g: stored.protein_g,
        carb_g: stored.carb_g,
        fat_g: stored.fat_g,
      };
      const meal = await api.request<{
        id: number;
        eaten_at: string;
        kcal: number;
        protein_g: number;
        carb_g: number;
        fat_g: number;
      }>("POST", "/api/v1/meals", mealBody, {
        bearer: deps.currentToken(),
        headers: {
          "idempotency-key": idempotencyKey("meal", userId, mealBody),
        },
      });
      // 3) Fetch the day macro summary (same shape log_meal returns).
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
      const target_kcal = day.day_target?.target.kcal ?? null;
      const summary =
        target_kcal != null
          ? summarizeMeal(meal, day.date, day.day_totals.kcal, target_kcal)
          : `Logged ${stored.name} for ${day.date} — ${meal.kcal} kcal, ${meal.protein_g}p / ${meal.carb_g}c / ${meal.fat_g}f. ${day.date} total: ${day.day_totals.kcal} (no active nutrition phase).`;
      return {
        id: meal.id,
        day: day.date,
        from_stored_meal_id: stored.id,
        summary,
        day_totals: day.day_totals,
        day_target: day.day_target,
      };
    },
  };
}
