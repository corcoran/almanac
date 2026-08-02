import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const UpdateStoredMealInputSchema = z.object({
  stored_meal_id: z
    .number()
    .int()
    .positive()
    .describe("ID of the stored meal to edit (from list_stored_meals)."),
  name: z
    .string()
    .min(1)
    .optional()
    .describe("New name. Renaming to an existing name is rejected (409)."),
  kcal: z.number().int().nonnegative().optional(),
  protein_g: z.number().nonnegative().optional(),
  carb_g: z.number().nonnegative().optional(),
  fat_g: z.number().nonnegative().optional(),
  description: z.string().nullish(),
});

export type UpdateStoredMealInput = z.infer<typeof UpdateStoredMealInputSchema>;

export function makeUpdateStoredMealTool(deps: ToolDeps): Tool<UpdateStoredMealInput> {
  const { api } = deps;
  return {
    name: "update_stored_meal",
    description:
      "Edit a saved meal definition by id — change its name (rename), macros, or description. " +
      "Omitted fields are left alone. Renaming to a name that already exists is rejected. " +
      "To redefine macros for a meal you can also just call `define_stored_meal` with the same name.",
    inputSchema: UpdateStoredMealInputSchema,
    annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    handler: async (input) => {
      const { stored_meal_id, ...patch } = input;
      const stored_meal = await api.request<{
        id: number;
        name: string;
        kcal: number;
        protein_g: number;
        carb_g: number;
        fat_g: number;
        description: string | null;
      }>("PATCH", `/api/v1/stored-meals/${stored_meal_id}`, patch, { bearer: deps.currentToken() });
      return { stored_meal };
    },
  };
}
