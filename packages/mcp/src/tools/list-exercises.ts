import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const ListExercisesInputSchema = z.object({
  group_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Filter by exercise group (use `list_exercise_groups` to discover ids)."),
  include_archived: z
    .boolean()
    .optional()
    .describe("Include exercises with `archived_at` set. Default false."),
});
export type ListExercisesInput = z.infer<typeof ListExercisesInputSchema>;

type ExerciseResponse = {
  id: number;
  name: string;
  group_id: number;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
};

export function makeListExercisesTool(deps: ToolDeps): Tool<ListExercisesInput> {
  const { api } = deps;
  return {
    name: "list_exercises",
    description:
      "List the user's exercises, optionally filtered by group. Exercises are the building blocks of workout templates and ad-hoc sessions. Use this to discover ids before referencing an exercise in `define_workout_template`, `update_workout_template`, or `add_exercise_to_workout`. Discover groups with `list_exercise_groups`; create exercises with `define_exercise`.",
    inputSchema: ListExercisesInputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      const qs = new URLSearchParams();
      if (input.group_id !== undefined) qs.set("group_id", String(input.group_id));
      if (input.include_archived) qs.set("include_archived", "true");
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      const exercises = await api.request<ExerciseResponse[]>(
        "GET",
        `/api/v1/exercises${suffix}`,
        undefined,
        { bearer: deps.currentToken() },
      );
      return { exercises };
    },
  };
}
