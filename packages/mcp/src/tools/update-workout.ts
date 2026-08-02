import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const UpdateWorkoutInputSchema = z.object({
  id: z.number().int().positive().describe("Workout id."),
  template_id: z.number().int().positive().nullish(),
  started_at: z
    .string()
    .optional()
    .describe(
      "ISO 8601 timestamp. Only include if correcting. Pass with offset (e.g. '2026-05-08T16:20:00-04:00') or `Z` for an explicit UTC instant; pass without offset (e.g. '2026-05-08T16:20:00') to have it interpreted in the user's profile timezone (set via `update_user_profile`).",
    ),
  duration_min: z.number().int().positive().nullish(),
  rpe: z.number().min(1).max(10).optional(),
  est_kcal: z.number().int().nonnegative().nullish(),
  notes: z.string().nullish(),
});

export type UpdateWorkoutInput = z.infer<typeof UpdateWorkoutInputSchema>;

export function makeUpdateWorkoutTool(deps: ToolDeps): Tool<UpdateWorkoutInput> {
  const { api } = deps;
  return {
    name: "update_workout",
    description:
      "Correct a previously logged workout. Pass the workout `id` plus any fields to change. Omitted fields are left alone. Use this when the user says things like 'actually that workout was RPE 8, not 7'.",
    inputSchema: UpdateWorkoutInputSchema,
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (input) => {
      const { id, ...patch } = input;
      const updated = await api.request<{ id: number }>("PATCH", `/api/v1/workouts/${id}`, patch, {
        bearer: deps.currentToken(),
      });
      return { workout: updated };
    },
  };
}
