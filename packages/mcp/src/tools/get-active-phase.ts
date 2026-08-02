import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const GetActivePhaseInputSchema = z.object({});

export type GetActivePhaseInput = z.infer<typeof GetActivePhaseInputSchema>;

export function makeGetActivePhaseTool(deps: ToolDeps): Tool<GetActivePhaseInput> {
  const { api } = deps;
  return {
    name: "get_active_phase",
    description:
      "Get the user's current active nutrition phase. Returns the full phase row including `phase_type` (cut/bulk/maintenance), `tdee_at_phase_start` (TDEE snapshot taken when the phase started — does NOT shift with weight or activity), `tdee_source` (`formula` | `measured` | `user_asserted`), `deficit_kcal` (signed: <0 cut, >0 bulk, ~0 maintenance), `daily_kcal_target` (= tdee_at_phase_start + deficit_kcal), and macro split. Returns a friendly `{ error }` object when no phase is active.",
    inputSchema: GetActivePhaseInputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async () => {
      try {
        return await api.request<unknown>("GET", "/api/v1/nutrition-phases/active", undefined, {
          bearer: deps.currentToken(),
        });
      } catch (err) {
        if ((err as Error).message.includes("404")) {
          return { error: "No active nutrition phase. Start one with `start_nutrition_phase`." };
        }
        throw err;
      }
    },
  };
}
