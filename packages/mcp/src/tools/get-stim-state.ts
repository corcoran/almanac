import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const GetStimStateInputSchema = z.object({});

export type GetStimStateInput = z.infer<typeof GetStimStateInputSchema>;

export function makeGetStimStateTool(deps: ToolDeps): Tool<GetStimStateInput> {
  const { api } = deps;
  return {
    name: "get_stim_state",
    description:
      "Get per-muscle-group stimulus state — how recently each group was trained and how recovered it is. The 'stim' name refers to muscular stimulus, NOT caffeine/stimulants; Almanac doesn't track pharmacological stimulants. Returns one entry per exercise_group with `level` (0-100), `phase` (too_soon | acceptable | prime | in_window | fading | detrained), `hours_since_last_hit`, and a derived `trainable_capacity`: `'depleted'` (don't train yet — recent heavy work, recovery not complete), `'recovering'` (acceptable but not optimal — mid-fade), or `'fresh'` (prime window — full output expected). Use when answering 'what should I train today?' or 'is Push group ready?'.",
    inputSchema: GetStimStateInputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async () => {
      return await api.request<unknown>("GET", "/api/v1/signals/stim-states", undefined, {
        bearer: deps.currentToken(),
      });
    },
  };
}
