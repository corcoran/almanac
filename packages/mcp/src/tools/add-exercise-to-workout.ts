import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

const SetInputSchema = z.object({
  reps: z.number().int().nonnegative(),
  weight_kg: z.number().nullish(),
  notes: z.string().nullish(),
});
const CompactSetsSchema = z.object({
  count: z.number().int().positive(),
  reps: z.number().int().nonnegative(),
  weight_kg: z.number().nullish(),
});
const SetsShapeSchema = z.union([z.array(SetInputSchema), CompactSetsSchema]);

export const AddExerciseToWorkoutInputSchema = z.object({
  workout_id: z.number().int().positive().describe("Parent workout id."),
  exercise_id: z.number().int().positive(),
  display_order: z.number().int().nonnegative(),
  planned_sets: z.number().int().nonnegative(),
  notes: z.string().nullish(),
  sets: SetsShapeSchema,
});

export type AddExerciseToWorkoutInput = z.infer<typeof AddExerciseToWorkoutInputSchema>;

export function makeAddExerciseToWorkoutTool(deps: ToolDeps): Tool<AddExerciseToWorkoutInput> {
  const { api } = deps;
  return {
    name: "add_exercise_to_workout",
    description:
      "Append an exercise instance to an already-logged workout. Use when the user says 'oh, I also did some curls at the end'. Provide the parent `workout_id`, the `exercise_id`, `display_order` (position within the workout), `planned_sets`, and the actual `sets[]` (either an array of {reps, weight_kg} or a compact {count, reps, weight_kg}).",
    inputSchema: AddExerciseToWorkoutInputSchema,
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (input) => {
      const { workout_id, ...body } = input;
      const created = await api.request<{ id: number }>(
        "POST",
        `/api/v1/workouts/${workout_id}/exercise-instances`,
        body,
        { bearer: deps.currentToken() },
      );
      return { workout_id, exercise_instance: created };
    },
  };
}
