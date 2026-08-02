import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const UpdateCardioInputSchema = z.object({
  id: z.number().int().positive().describe("Cardio-session id."),
  started_at: z
    .string()
    .optional()
    .describe(
      "ISO 8601 timestamp. Only include if correcting. Pass with offset (e.g. '2026-05-08T16:20:00-04:00') or `Z` for an explicit UTC instant; pass without offset (e.g. '2026-05-08T16:20:00') to have it interpreted in the user's profile timezone (set via `update_user_profile`).",
    ),
  duration_min: z.number().int().positive().nullish(),
  modality: z.string().nullish(),
  avg_hr: z.number().int().positive().nullish(),
  distance_km: z.number().positive().nullish(),
  steps: z
    .number()
    .int()
    .nonnegative()
    .nullish()
    .describe("Step count for the session. Pass null to clear."),
  est_kcal: z.number().int().nonnegative().optional(),
  notes: z.string().nullish(),
});

export type UpdateCardioInput = z.infer<typeof UpdateCardioInputSchema>;

export function makeUpdateCardioTool(deps: ToolDeps): Tool<UpdateCardioInput> {
  const { api } = deps;
  return {
    name: "update_cardio",
    description:
      "Correct a previously logged cardio session. Pass the cardio-session `id` plus any fields to change. Omitted fields are left alone.",
    inputSchema: UpdateCardioInputSchema,
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (input) => {
      const { id, ...patch } = input;
      const updated = await api.request<{ id: number }>(
        "PATCH",
        `/api/v1/cardio-sessions/${id}`,
        patch,
        { bearer: deps.currentToken() },
      );
      return { cardio: updated };
    },
  };
}
