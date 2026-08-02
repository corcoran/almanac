import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const GetTrainingHistoryInputSchema = z.object({
  days: z
    .number()
    .int()
    .min(1)
    .max(35)
    .optional()
    .describe("Window size in days (1-35, default 14)."),
});
export type GetTrainingHistoryInput = z.infer<typeof GetTrainingHistoryInputSchema>;

export function makeGetTrainingHistoryTool(deps: ToolDeps): Tool<GetTrainingHistoryInput> {
  const { api } = deps;
  return {
    name: "get_training_history",
    description:
      "A pre-analyzed ~2-week training-pattern read for workout INSIGHT (distinct from " +
      "get_recommended_template, which gives recovery state). Per split: sessions, last " +
      "trained, average RPE and whether it's drifting up/down vs the user's baseline, " +
      "template-deviation rate + a notable deviation, plus load progression " +
      "(climbing/stalled/dropping main lifts) and a frequency-imbalance note. Use it to " +
      "surface non-obvious training patterns. Input: optional `days` (1-35, default 14).",
    inputSchema: GetTrainingHistoryInputSchema,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    handler: async (input) => {
      const days = input.days ?? 14;
      const result = await api.request<unknown>(
        "GET",
        `/api/v1/signals/training-history?days=${days}`,
        undefined,
        { bearer: deps.currentToken() },
      );
      return result;
    },
  };
}
