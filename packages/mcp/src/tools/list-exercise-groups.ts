import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const ListExerciseGroupsInputSchema = z.object({});
export type ListExerciseGroupsInput = z.infer<typeof ListExerciseGroupsInputSchema>;

type GroupResponse = {
  id: number;
  user_id: number;
  name: string;
  display_order: number;
  created_at: string;
};

export function makeListExerciseGroupsTool(deps: ToolDeps): Tool<ListExerciseGroupsInput> {
  const { api } = deps;
  return {
    name: "list_exercise_groups",
    description:
      "List the user's exercise groups (muscle buckets like 'Chest', 'Quads'). Exercises belong to exactly one group. Use this before defining a new exercise to avoid duplicates, or to discover what groups already exist. Create groups with `define_exercise_group`; list exercises within a group with `list_exercises`.",
    inputSchema: ListExerciseGroupsInputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async () => {
      const exercise_groups = await api.request<GroupResponse[]>(
        "GET",
        "/api/v1/exercise-groups",
        undefined,
        { bearer: deps.currentToken() },
      );
      return { exercise_groups };
    },
  };
}
