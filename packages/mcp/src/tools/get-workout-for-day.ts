import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const GetWorkoutForDayInputSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Day to fetch (YYYY-MM-DD). Omit for today."),
});
export type GetWorkoutForDayInput = z.infer<typeof GetWorkoutForDayInputSchema>;

export function makeGetWorkoutForDayTool(deps: ToolDeps): Tool<GetWorkoutForDayInput> {
  const { api } = deps;
  return {
    name: "get_workout_for_day",
    description:
      "The workout(s) the user logged on a DAY, with full exercise/set detail (reps, " +
      "weights, RPE, duration). Use to answer 'how was my session today' by date — unlike " +
      "get_workout, which needs a workout id. Omit `date` for today; pass YYYY-MM-DD for a " +
      "past day. Returns an array of workouts (a day may have more than one).",
    inputSchema: GetWorkoutForDayInputSchema,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    handler: async (input) => {
      const qs = input.date ? `?date=${input.date}` : "";
      return await api.request<unknown>("GET", `/api/v1/workouts/by-date${qs}`, undefined, {
        bearer: deps.currentToken(),
      });
    },
  };
}
