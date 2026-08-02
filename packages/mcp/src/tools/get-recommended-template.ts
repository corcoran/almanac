import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const GetRecommendedTemplateInputSchema = z.object({
  top_n: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe("How many ranked recommendations to return. Default 1."),
});
export type GetRecommendedTemplateInput = z.infer<typeof GetRecommendedTemplateInputSchema>;

type Recommendation = {
  template_id: number;
  template_name: string;
  score: number;
  // "actionable" = the score means something. "low" = degenerate score-0 tie
  // (everything overdue/untrained), so don't present the top pick as advice.
  confidence: "actionable" | "low";
  // Secondary sort key (descending): average hours since last hit across the
  // template's muscle groups. Surfaced for diagnostics — when `score` is the
  // same across several templates, this explains why one ranked above
  // another (more recovered wins). Sentinel 999_999 = never trained.
  avg_recovery_hours: number;
  reasoning: {
    prime_groups_hit: string[];
    in_window_groups_hit: string[];
    too_soon_groups_hit: string[];
    neutral_groups_hit: string[];
    overdue_groups_hit: string[];
  };
};

export function makeGetRecommendedTemplateTool(deps: ToolDeps): Tool<GetRecommendedTemplateInput> {
  const { api } = deps;
  return {
    name: "get_recommended_template",
    description:
      "Score the user's workout templates against current per-muscle-group stim state and return the top-`top_n` recommendations. Score = 2 × (count of in_window groups hit) + (count of prime groups hit) − (2 if ANY too_soon group is hit, else 0). In-window groups (120-168h since last hit) are weighted above prime (72-120h) because they're hours from fading. The too_soon penalty is flat (binary conflict flag), not per-group; otherwise multi-group templates would lose harder than narrow ones just by touching more muscles. Ties on `score` break by `avg_recovery_hours` desc — when every template's groups are too_soon (recent training across the board), the template whose groups have waited longest wins. `avg_recovery_hours` = mean hours since last hit across the template's groups; untrained groups count as 999999h. Each recommendation carries a `confidence`: `'actionable'` means the score reflects a real timing signal; `'low'` means the score is a degenerate 0 because every group hit is overdue (fading/detrained) or untrained — the returning-from-layoff case. When the top pick is `confidence: 'low'`, do NOT present it as 'train this today' advice; tell the user they've been away and any split is fine. Reasoning includes which groups are prime / in_window / too_soon / neutral / overdue (fading or detrained — a training-gap signal) for each template. Define templates with `define_workout_template` first; an empty response means no templates exist.",
    inputSchema: GetRecommendedTemplateInputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      const topN = input.top_n ?? 1;
      const result = await api.request<{ recommendations: Recommendation[] }>(
        "GET",
        `/api/v1/signals/recommend-template?top_n=${topN}`,
        undefined,
        { bearer: deps.currentToken() },
      );
      return result;
    },
  };
}

export function makeGetWorkoutRecommendationTool(
  deps: ToolDeps,
): Tool<GetRecommendedTemplateInput> {
  const base = makeGetRecommendedTemplateTool(deps);
  return {
    ...base,
    name: "get_workout_recommendation",
    description:
      "Which workout should the user do next? Returns, per workout split, which MUSCLE " +
      "GROUPS are recovered/prime vs. trained-too-recently (too_soon) vs. overdue, plus a " +
      "ranked recommendation and confidence. Use this to ground what to train next and any " +
      "recovery claim. (Alias of get_recommended_template — same data.) " +
      "When the top pick is confidence:'low' (returning from a layoff), any split is fine.",
  };
}
