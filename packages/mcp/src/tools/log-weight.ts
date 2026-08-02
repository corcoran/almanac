import { z } from "zod";
import { idempotencyKey, summarizeWeight } from "../format.js";
import type { Tool, ToolDeps } from "../tool.js";

export const LogWeightInputSchema = z.object({
  measured_on: z.string().describe("ISO date YYYY-MM-DD"),
  weight_kg: z.number().positive(),
  notes: z.string().optional(),
});

export type LogWeightInput = z.infer<typeof LogWeightInputSchema>;

export function makeLogWeightTool(deps: ToolDeps): Tool<LogWeightInput> {
  const { api, currentUserId } = deps;
  return {
    name: "log_weight",
    description:
      "Log the user's body weight on a given date. Idempotent — calling twice for the same date updates the existing reading. If this is the user's first weigh-in, call get_next_best_action afterward to continue onboarding (typically starting a nutrition phase).",
    inputSchema: LogWeightInputSchema,
    annotations: {
      readOnlyHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      const userId = await currentUserId();
      const row = await api.request<{ id: number; weight_kg: number; measured_on: string }>(
        "POST",
        "/api/v1/body-weights",
        input,
        {
          bearer: deps.currentToken(),
          headers: { "idempotency-key": idempotencyKey("body-weight", userId, input) },
        },
      );
      return {
        id: row.id,
        summary: summarizeWeight(row),
        weight_kg: row.weight_kg,
        measured_on: row.measured_on,
      };
    },
  };
}
