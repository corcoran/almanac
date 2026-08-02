import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const UpdateAlcoholInputSchema = z.object({
  id: z.number().int().positive().describe("Alcohol-session id."),
  started_at: z
    .string()
    .optional()
    .describe(
      "ISO 8601 timestamp. Only include if correcting. Pass with offset (e.g. '2026-05-08T16:20:00-04:00') or `Z` for an explicit UTC instant; pass without offset (e.g. '2026-05-08T16:20:00') to have it interpreted in the user's profile timezone (set via `update_user_profile`).",
    ),
  ended_at: z
    .string()
    .nullish()
    .describe(
      "ISO 8601 timestamp for when the session ended. Pass with offset (e.g. '2026-05-08T23:30:00-04:00') or `Z` for an explicit UTC instant; pass without offset (e.g. '2026-05-08T23:30:00') to have it interpreted in the user's profile timezone (set via `update_user_profile`).",
    ),
  drinks_count: z.number().positive().optional(),
  est_kcal: z.number().int().nonnegative().optional(),
  notes: z.string().nullish(),
});

export type UpdateAlcoholInput = z.infer<typeof UpdateAlcoholInputSchema>;

export function makeUpdateAlcoholTool(deps: ToolDeps): Tool<UpdateAlcoholInput> {
  const { api } = deps;
  return {
    name: "update_alcohol",
    description:
      "Correct a previously logged alcohol session. Pass the alcohol-session `id` plus any fields to change. Omitted fields are left alone.",
    inputSchema: UpdateAlcoholInputSchema,
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (input) => {
      const { id, ...patch } = input;
      const updated = await api.request<{ id: number }>(
        "PATCH",
        `/api/v1/alcohol-sessions/${id}`,
        patch,
        { bearer: deps.currentToken() },
      );
      return { alcohol: updated };
    },
  };
}
