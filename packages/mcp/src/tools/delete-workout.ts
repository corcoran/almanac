import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const DeleteWorkoutInputSchema = z.object({
  workout_id: z.number().int().positive().describe("ID of the workout to delete."),
  confirm: z
    .literal(true)
    .describe(
      "Must be `true`. Ask the user to confirm BEFORE setting this — the deletion is permanent and cascades to ALL exercise instances and sets within the workout.",
    ),
});

export type DeleteWorkoutInput = z.infer<typeof DeleteWorkoutInputSchema>;

export function makeDeleteWorkoutTool(deps: ToolDeps): Tool<DeleteWorkoutInput> {
  const { api } = deps;
  return {
    name: "delete_workout",
    description:
      "Permanently delete a workout and ALL its exercise instances and sets (SQLite cascade). Requires explicit user confirmation: ask the user, then call with `confirm: true`. There is no undo. This is the right tool for the 'I accidentally logged the same workout twice' case — find the duplicate via `get_recent_workouts` and delete the unwanted one. To remove just a single set, use `delete_set` instead.",
    inputSchema: DeleteWorkoutInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      await api.request<unknown>("DELETE", `/api/v1/workouts/${input.workout_id}`, undefined, {
        bearer: deps.currentToken(),
      });
      return { deleted: true, workout_id: input.workout_id };
    },
  };
}
