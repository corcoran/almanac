import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const DefineExerciseGroupInputSchema = z.object({
  name: z.string().min(1).describe("e.g., 'Push', 'Pull', 'Legs', 'Chest', 'Back'."),
  display_order: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Sort order in the UI. Defaults to next-available if omitted."),
});

export type DefineExerciseGroupInput = z.infer<typeof DefineExerciseGroupInputSchema>;

export function makeDefineExerciseGroupTool(deps: ToolDeps): Tool<DefineExerciseGroupInput> {
  const { api } = deps;
  return {
    name: "define_exercise_group",
    description:
      "Create a new exercise group (a muscle bucket like 'Chest', 'Back', 'Quads'). Groups contain exercises and are how the stim/recovery system tracks training freshness. Discover existing groups with `list_exercise_groups`; add exercises to a group with `define_exercise`.",
    inputSchema: DefineExerciseGroupInputSchema,
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (input) => {
      const exercise_group = await api.request<unknown>("POST", "/api/v1/exercise-groups", input, {
        bearer: deps.currentToken(),
      });
      return { exercise_group };
    },
  };
}
