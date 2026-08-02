import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const UpdateMealInputSchema = z.object({
  id: z
    .number()
    .int()
    .positive()
    .describe("Meal id (from get_meals or the original log_meal response)."),
  eaten_at: z
    .string()
    .optional()
    .describe(
      "ISO 8601 timestamp. Only include if correcting. Pass with offset (e.g. '2026-05-08T16:20:00-04:00') or `Z` for an explicit UTC instant; pass without offset (e.g. '2026-05-08T16:20:00') to have it interpreted in the user's profile timezone (set via `update_user_profile`).",
    ),
  name: z.string().nullish(),
  kcal: z.number().int().nonnegative().optional(),
  protein_g: z.number().nonnegative().optional(),
  carb_g: z.number().nonnegative().optional(),
  fat_g: z.number().nonnegative().optional(),
  notes: z.string().nullish(),
});

export type UpdateMealInput = z.infer<typeof UpdateMealInputSchema>;

export function makeUpdateMealTool(deps: ToolDeps): Tool<UpdateMealInput> {
  const { api } = deps;
  return {
    name: "update_meal",
    description:
      "Correct a previously logged meal. Pass the meal `id` plus any fields to change. Omitted fields are left alone. Use this when the user says things like 'actually that pasta was 600 kcal'.",
    inputSchema: UpdateMealInputSchema,
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (input) => {
      const { id, ...patch } = input;
      const updated = await api.request<{
        id: number;
        kcal: number;
        protein_g: number;
        carb_g: number;
        fat_g: number;
        eaten_at: string;
      }>("PATCH", `/api/v1/meals/${id}`, patch, { bearer: deps.currentToken() });
      return { meal: updated };
    },
  };
}
