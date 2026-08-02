import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const ListStoredMealsInputSchema = z.object({});

export type ListStoredMealsInput = z.infer<typeof ListStoredMealsInputSchema>;

export function makeListStoredMealsTool(deps: ToolDeps): Tool<ListStoredMealsInput> {
  const { api } = deps;
  return {
    name: "list_stored_meals",
    description:
      "List the user's saved meal definitions (their reusable meal library), each with id, " +
      "name, macros, and description. Call this when the user refers to a saved / usual / regular " +
      "meal by name, then pass the chosen id to `log_meal_from_stored` to log it as today's meal.",
    inputSchema: ListStoredMealsInputSchema,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    handler: async () => {
      const stored_meals = await api.request<
        Array<{
          id: number;
          name: string;
          kcal: number;
          protein_g: number;
          carb_g: number;
          fat_g: number;
          description: string | null;
        }>
      >("GET", "/api/v1/stored-meals", undefined, { bearer: deps.currentToken() });
      return { stored_meals, count: stored_meals.length };
    },
  };
}
