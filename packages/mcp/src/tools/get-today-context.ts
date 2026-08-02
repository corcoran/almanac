import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const GetTodayContextInputSchema = z.object({});

export type GetTodayContextInput = z.infer<typeof GetTodayContextInputSchema>;

export function makeGetTodayContextTool(deps: ToolDeps): Tool<GetTodayContextInput> {
  const { api } = deps;
  return {
    name: "get_today_context",
    description:
      "Get the full TodayContext snapshot: current phase, today's macros so far, stim states, sleep, weight trend, recent workouts. Use this as the default starting point when the user asks 'how am I doing today' or any unscoped question about their current state. Each muscle group's `trainable_capacity` is one of `'depleted'` (don't train this group yet — recent heavy work, recovery not complete), `'recovering'` (acceptable but not optimal — mid-fade), or `'fresh'` (prime window — full output expected). The user's free-text \"about_me\" profile note (if set) is included as background context.",
    inputSchema: GetTodayContextInputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async () => {
      const snapshot = await api.request<Record<string, unknown>>(
        "GET",
        "/api/v1/signals/today",
        undefined,
        { bearer: deps.currentToken() },
      );
      // about_me is advisory background context — fetch it best-effort and never
      // let it fail this workhorse tool. If the profile GET errors, omit it and
      // still return the snapshot (mirrors getUserTz, which defaults UTC on failure).
      let about_me: string | null = null;
      try {
        const profile = await api.request<{ about_me?: string | null }>(
          "GET",
          "/api/v1/users/me",
          undefined,
          { bearer: deps.currentToken() },
        );
        about_me = profile.about_me ?? null;
      } catch {
        about_me = null;
      }
      return { ...snapshot, about_me };
    },
  };
}
