import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const GetPhaseHistoryInputSchema = z.object({});

export type GetPhaseHistoryInput = z.infer<typeof GetPhaseHistoryInputSchema>;

export function makeGetPhaseHistoryTool(deps: ToolDeps): Tool<GetPhaseHistoryInput> {
  const { api } = deps;
  return {
    name: "get_phase_history",
    description:
      "List all the user's nutrition phases (past and current), in chronological order. Use to summarize phasing history or to find when a particular phase started/ended. Each phase has a `daily_kcal_target` (non-null on every phase — this is the rename of the legacy `base_kcal`). The four TDEE-refactor fields — `phase_type`, `tdee_at_phase_start`, `tdee_source`, `deficit_kcal` — are populated on the currently-active phase and on every new phase started post-refactor, but may be `null` on historical phases that predate migration 006.",
    inputSchema: GetPhaseHistoryInputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async () => {
      const phases = await api.request<unknown[]>("GET", "/api/v1/nutrition-phases", undefined, {
        bearer: deps.currentToken(),
      });
      return { phases, count: phases.length };
    },
  };
}
