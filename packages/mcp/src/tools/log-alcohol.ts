import { z } from "zod";
import { idempotencyKey, summarizeAlcohol } from "../format.js";
import type { Tool, ToolDeps } from "../tool.js";

export const LogAlcoholInputSchema = z.object({
  started_at: z
    .string()
    .describe(
      "ISO 8601 timestamp. Pass with offset (e.g. '2026-05-08T16:20:00-04:00') or `Z` for an explicit UTC instant; pass without offset (e.g. '2026-05-08T16:20:00') to have it interpreted in the user's profile timezone (set via `update_user_profile`).",
    ),
  ended_at: z
    .string()
    .optional()
    .describe(
      "ISO 8601 timestamp for when the session ended. Pass with offset (e.g. '2026-05-08T23:30:00-04:00') or `Z` for an explicit UTC instant; pass without offset (e.g. '2026-05-08T23:30:00') to have it interpreted in the user's profile timezone (set via `update_user_profile`).",
    ),
  drinks_count: z.number().positive().describe("US standard drinks; half-drinks OK"),
  est_kcal: z
    .number()
    .int()
    .nonnegative()
    .describe("Compute from beverage composition (the user describes drinks; you estimate)."),
  notes: z
    .string()
    .optional()
    .describe("Free-text composition record, e.g., '2 beer, 3 gin & soda'"),
});

export type LogAlcoholInput = z.infer<typeof LogAlcoholInputSchema>;

export function makeLogAlcoholTool(deps: ToolDeps): Tool<LogAlcoholInput> {
  const { api, currentUserId } = deps;
  return {
    name: "log_alcohol",
    description:
      "Log a drinking session. Session-based: '8pm-2am, 2 beer + 3 gin & soda' is one row with drinks_count=5 and your est_kcal estimate.",
    inputSchema: LogAlcoholInputSchema,
    annotations: {
      readOnlyHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      const userId = await currentUserId();
      const row = await api.request<{ id: number; drinks_count: number; est_kcal: number }>(
        "POST",
        "/api/v1/alcohol-sessions",
        input,
        {
          bearer: deps.currentToken(),
          headers: { "idempotency-key": idempotencyKey("alcohol", userId, input) },
        },
      );
      return { id: row.id, summary: summarizeAlcohol(row), est_kcal: row.est_kcal };
    },
  };
}
