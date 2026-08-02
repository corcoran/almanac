import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const UpdateExerciseInputSchema = z.object({
  exercise_id: z
    .number()
    .int()
    .positive()
    .describe("ID of the exercise to modify. Use `list_exercises` to look it up."),
  name: z.string().min(1).optional().describe("New exercise name."),
  group_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Reassign the exercise to a different muscle group. Use `list_exercise_groups` to find IDs.",
    ),
  notes: z.string().nullish().describe("Cues, form notes, etc. Pass null to clear."),
});

export type UpdateExerciseInput = z.infer<typeof UpdateExerciseInputSchema>;

export function makeUpdateExerciseTool(deps: ToolDeps): Tool<UpdateExerciseInput> {
  const { api } = deps;
  return {
    name: "update_exercise",
    description:
      "Update an existing exercise definition — rename it, move it to a different muscle group, or change its notes. Only the fields you pass get touched; the rest are left alone. Useful when the user says 'rename Bench Press to Barbell Bench Press' or 'actually, dips belong under Triceps, not Chest'.",
    inputSchema: UpdateExerciseInputSchema,
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (input) => {
      const { exercise_id, ...body } = input;
      const exercise = await api.request<unknown>(
        "PATCH",
        `/api/v1/exercises/${exercise_id}`,
        body,
        {
          bearer: deps.currentToken(),
        },
      );
      return { exercise };
    },
  };
}
