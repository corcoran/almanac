import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const GetNextBestActionInputSchema = z.object({});

export type GetNextBestActionInput = z.infer<typeof GetNextBestActionInputSchema>;

export function makeGetNextBestActionTool(deps: ToolDeps): Tool<GetNextBestActionInput> {
  const { api } = deps;
  return {
    name: "get_next_best_action",
    description:
      "Return the single highest-priority thing the user should do next, plus the full ranked list. Spans the whole lifecycle: onboarding gates (complete profile → log initial weight → start a nutrition phase → set up workout templates), then yesterday's easy-to-forget logs (sleep, steps), then today's gaps (delegated to the same nudges as get_day_status — only warn/concern surface as actions). Call this after bootstrap/profile setup, after starting a phase, when the user asks 'what's next?' or 'how do I get started?', or at the start of a session to catch forgotten logs. Each action has a stable `code`, a `tier` (onboarding | previous_day | today), a human `title`/`detail`, a `suggested_tool`, and an optional non-authoritative `suggested_args` hint — confirm specifics (timezone, goal, kcal) with the user before calling the suggested tool. When nothing is pending, `all_clear` is true and `headline` is null.",
    inputSchema: GetNextBestActionInputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async () => {
      return await api.request<unknown>("GET", "/api/v1/signals/next-best-action", undefined, {
        bearer: deps.currentToken(),
      });
    },
  };
}
