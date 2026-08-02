import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const DefineExerciseInputSchema = z.object({
  group_id: z
    .number()
    .int()
    .positive()
    .describe(
      "ID of the exercise group (the muscle bucket). Use `list_exercise_groups` to discover existing groups; create one with `define_exercise_group` if needed.",
    ),
  name: z.string().min(1).describe("e.g., 'Bench press', 'Romanian deadlift'."),
  notes: z.string().nullish().describe("Optional cues, form notes, etc."),
});

export type DefineExerciseInput = z.infer<typeof DefineExerciseInputSchema>;

export function makeDefineExerciseTool(deps: ToolDeps): Tool<DefineExerciseInput> {
  const { api } = deps;
  return {
    name: "define_exercise",
    description:
      "Define a new exercise (e.g., 'Incline DB Press'). Each exercise belongs to one exercise group (the muscle bucket). Use `list_exercise_groups` to find existing groups; create one with `define_exercise_group` if needed. Once defined, the exercise can be added to templates via `define_workout_template`/`update_workout_template` or logged ad-hoc via `add_exercise_to_workout`.",
    inputSchema: DefineExerciseInputSchema,
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (input) => {
      const exercise = await api.request<unknown>("POST", "/api/v1/exercises", input, {
        bearer: deps.currentToken(),
      });
      return { exercise };
    },
  };
}
