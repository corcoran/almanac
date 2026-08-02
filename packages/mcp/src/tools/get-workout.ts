import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const GetWorkoutInputSchema = z.object({
  id: z.number().int().positive().describe("Workout id."),
});

export type GetWorkoutInput = z.infer<typeof GetWorkoutInputSchema>;

export function makeGetWorkoutTool(deps: ToolDeps): Tool<GetWorkoutInput> {
  const { api } = deps;
  return {
    name: "get_workout",
    description:
      "Fetch a single workout by id with its full nested structure (exercise instances and sets). Use after `get_recent_workouts` returns an id of interest.",
    inputSchema: GetWorkoutInputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      return await api.request<unknown>("GET", `/api/v1/workouts/${input.id}`, undefined, {
        bearer: deps.currentToken(),
      });
    },
  };
}
