import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const DefineStoredMealInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe(
      "Unique label for this saved meal, e.g. 'usual breakfast'. Defining the same name again overwrites its macros.",
    ),
  kcal: z.number().int().nonnegative(),
  protein_g: z.number().nonnegative(),
  carb_g: z.number().nonnegative(),
  fat_g: z.number().nonnegative(),
  description: z
    .string()
    .optional()
    .describe("Optional free-text of what's in it, e.g. '2 eggs, toast, coffee'."),
});

export type DefineStoredMealInput = z.infer<typeof DefineStoredMealInputSchema>;

export function makeDefineStoredMealTool(deps: ToolDeps): Tool<DefineStoredMealInput> {
  const { api } = deps;
  return {
    name: "define_stored_meal",
    description:
      "Save (or overwrite) a reusable meal definition in the user's meal library. " +
      "Upserts on name: defining an existing name updates its macros. Use when the user " +
      "wants to remember a meal they eat regularly so it can be logged later in one step " +
      "via `log_meal_from_stored`. This does NOT log an eating event — it only stores the definition.",
    inputSchema: DefineStoredMealInputSchema,
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    handler: async (input) => {
      const stored_meal = await api.request<{
        id: number;
        name: string;
        kcal: number;
        protein_g: number;
        carb_g: number;
        fat_g: number;
        description: string | null;
      }>("POST", "/api/v1/stored-meals", input, { bearer: deps.currentToken() });
      return { stored_meal };
    },
  };
}
