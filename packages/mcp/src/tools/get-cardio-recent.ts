import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

export const GetCardioRecentInputSchema = z.object({
  from_date: DateOnly.optional().describe(
    "Preferred. Inclusive start date (YYYY-MM-DD), interpreted in the user's profile timezone. When provided, overrides `from`/`from_days_ago`.",
  ),
  to_date: DateOnly.optional().describe(
    "Inclusive end date (YYYY-MM-DD), interpreted in the user's profile timezone. Pass the same date as from_date to select a single day.",
  ),
  from: z
    .string()
    .optional()
    .describe(
      "ISO 8601 timestamp inclusive lower bound. Use only for instant-precise queries; prefer from_date. Overrides from_days_ago.",
    ),
  to: z
    .string()
    .optional()
    .describe(
      "ISO 8601 timestamp exclusive upper bound. Use only for instant-precise queries; prefer to_date.",
    ),
  from_days_ago: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Convenience: how many days back to start. Default 14. Ignored if from_date or from is set.",
    ),
  limit: z.number().int().positive().max(200).optional(),
});

export type GetCardioRecentInput = z.infer<typeof GetCardioRecentInputSchema>;

function resolveFrom(
  input: { from?: string; from_days_ago?: number },
  defaultDaysAgo: number,
): string {
  if (input.from) return input.from;
  const daysAgo = input.from_days_ago ?? defaultDaysAgo;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString();
}

export function makeGetCardioRecentTool(deps: ToolDeps): Tool<GetCardioRecentInput> {
  const { api } = deps;
  return {
    name: "get_cardio_recent",
    description:
      "List cardio sessions in a date range. Prefer from_date/to_date (YYYY-MM-DD) — the API resolves those to the user's profile timezone. Use from/to (ISO instants) only when you need sub-day precision. Defaults to the last 14 days.",
    inputSchema: GetCardioRecentInputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      const params = new URLSearchParams();
      if (input.from_date) {
        params.set("from_date", input.from_date);
        if (input.to_date) params.set("to_date", input.to_date);
      } else {
        params.set("from", resolveFrom(input, 14));
        if (input.to) params.set("to", input.to);
        if (input.to_date) params.set("to_date", input.to_date);
      }
      if (input.limit) params.set("limit", String(input.limit));
      const cardio_sessions = await api.request<unknown[]>(
        "GET",
        `/api/v1/cardio-sessions?${params.toString()}`,
        undefined,
        { bearer: deps.currentToken() },
      );
      return { cardio_sessions, count: cardio_sessions.length };
    },
  };
}
