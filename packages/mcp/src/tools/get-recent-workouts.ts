import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const GetRecentWorkoutsInputSchema = z.object({
  from: z
    .string()
    .optional()
    .describe("ISO 8601 timestamp inclusive lower bound. Overrides from_days_ago."),
  to: z.string().optional().describe("ISO 8601 timestamp exclusive upper bound."),
  from_days_ago: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Convenience: how many days back to start. Default 7."),
  limit: z.number().int().positive().max(200).optional(),
});

export type GetRecentWorkoutsInput = z.infer<typeof GetRecentWorkoutsInputSchema>;

function resolveFrom(
  input: { from?: string; from_days_ago?: number },
  defaultDaysAgo: number,
): string {
  if (input.from) return input.from;
  const daysAgo = input.from_days_ago ?? defaultDaysAgo;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString();
}

export function makeGetRecentWorkoutsTool(deps: ToolDeps): Tool<GetRecentWorkoutsInput> {
  const { api } = deps;
  return {
    name: "get_recent_workouts",
    description:
      "List workouts in a date range. Defaults to the last 7 days. Widen the window explicitly when the user asks about older workouts.",
    inputSchema: GetRecentWorkoutsInputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      const params = new URLSearchParams();
      params.set("from", resolveFrom(input, 7));
      if (input.to) params.set("to", input.to);
      if (input.limit) params.set("limit", String(input.limit));
      const workouts = await api.request<unknown[]>(
        "GET",
        `/api/v1/workouts?${params.toString()}`,
        undefined,
        { bearer: deps.currentToken() },
      );
      return { workouts, count: workouts.length };
    },
  };
}
